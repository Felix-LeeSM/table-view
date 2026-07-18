// Direct app-storage upsert for fixture-managed connections.
// Reads + rewrites `connections.json` in the platform app data dir
// (matches Rust storage path: ~/Library/Application Support/table-view/
// connections.json on macOS, ~/.local/share/table-view/... on Linux).
//
// Password handling: the Rust storage layer treats every on-disk `password`
// field as AES-256-GCM ciphertext (plaintext throws "Ciphertext too short" the
// moment the user clicks Connect), so the fixture re-implements the same
// envelope (12-byte nonce + ciphertext + 16-byte GCM tag, base64) in Node.
// The AES key MUST be the one the app decrypts with, and its home moved in
// Sprint 356: the app now keeps the file-key in the OS keyring (macOS Keychain
// entry `com.tableview.app.file-key`) and secure-deletes the disk `.key` after
// migration. So once the app has run on macOS the key lives ONLY in the
// Keychain — the fixture reads it from there (see loadOrCreateAppKey). Minting
// a fresh disk key while the app already holds a keyring key is exactly what
// produced `error: aead::Error` at Connect (key divergence).
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { homedir, platform } from "node:os";
import type { FixtureConnection, ProfileSpec, ResolvedSpec } from "./spec.js";
import { pgEnvConn } from "./postgres.js";
import { mongoEnvConn } from "./mongo.js";
import {
  ensureMysqlDatabaseAndGrant,
  mysqlEnvConn,
  mysqlRootEnvConn,
} from "./mysql.js";
import { mariadbEnvConn } from "./mariadb.js";
import { mssqlEnvConn } from "./mssql.js";
import { oracleEnvConn } from "./oracle.js";
import { redisEnvConn } from "./redis.js";
import { ensureSqliteDatabase, sqliteEnvPath } from "./sqlite.js";
import { duckdbEnvPath, ensureDuckdbDatabase } from "./duckdb.js";

const FIXTURE_GROUP_ID = "fixture-group";
const FIXTURE_GROUP_NAME = "Fixtures";

interface StoredConnection {
  id: string;
  name: string;
  db_type:
    | "postgresql"
    | "mongodb"
    | "mysql"
    | "sqlite"
    | "redis"
    | "duckdb"
    | "mariadb"
    | "mssql"
    | "oracle";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  read_only?: boolean;
  group_id: string | null;
  color: string | null;
  connection_timeout: number | null;
  keep_alive_interval: number | null;
  environment: string | null;
  auth_source: string | null;
  replica_set: string | null;
  tls_enabled: boolean | null;
}

interface StoredGroup {
  id: string;
  name: string;
  color: string | null;
  collapsed: boolean;
}

interface StorageData {
  connections: StoredConnection[];
  groups: StoredGroup[];
}

function appDataPath(): string {
  if (process.env.TABLE_VIEW_TEST_DATA_DIR)
    return process.env.TABLE_VIEW_TEST_DATA_DIR;
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return resolve(home, "Library", "Application Support", "table-view");
    case "win32":
      return resolve(process.env.APPDATA ?? home, "table-view");
    default:
      return resolve(
        process.env.XDG_DATA_HOME ?? resolve(home, ".local", "share"),
        "table-view",
      );
  }
}

function storageFilePath(): string {
  return resolve(appDataPath(), "connections.json");
}

function keyFilePath(): string {
  return resolve(appDataPath(), ".key");
}

// OS keyring entry the app stores the file-key under — matches
// `KEYRING_ENTRY_NAME` in src-tauri/src/storage/crypto.rs. Both the Keychain
// service and account are this string; the stored value is the raw 32-byte key.
const KEYRING_ENTRY = "com.tableview.app.file-key";

// `security find-generic-password -w` prints the app's raw key as 64 lowercase
// hex chars (+ trailing newline). Accept hex first, then defensively base64 or
// raw bytes, but only ever return exactly 32 bytes. Exported for unit coverage
// (the `security` shell-out around it can't run in headless CI).
export function decodeKeyringSecret(raw: Buffer): Buffer | null {
  const text = raw.toString("utf8").trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, "hex");
  const b64 = Buffer.from(text, "base64");
  if (b64.length === 32) return b64;
  const bin = raw[raw.length - 1] === 0x0a ? raw.subarray(0, -1) : raw;
  if (bin.length === 32) return Buffer.from(bin);
  return null;
}

// macOS: read the app's file-key straight from the Keychain so the fixture
// encrypts with the SAME key the app decrypts with. Returns null off macOS,
// when the entry is absent (exit 44, no prompt), or when the Keychain is
// locked/denied. First access triggers a one-time Keychain prompt (the item
// was created by the app, not this process) — approve with "Always Allow".
function readMacKeyringKey(): Buffer | null {
  if (platform() !== "darwin") return null;
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYRING_ENTRY, "-a", KEYRING_ENTRY, "-w"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    return decodeKeyringSecret(out);
  } catch {
    return null;
  }
}

// Resolve the AES key the Rust app will decrypt with. Precedence mirrors
// `key_migration::migrate_or_initialize`: OS keyring (post-Sprint-356 macOS,
// where the app prefers the Keychain over any disk file) → disk `.key`
// (Linux/Path C, or a pre-first-launch machine) → mint a fresh disk key (truly
// new machine; the app's Path B adopts that same key on next boot). The
// keyring is a single global OS entry that can't be sandboxed, so under
// TABLE_VIEW_TEST_DATA_DIR (test isolation) we skip it and behave as a fresh
// machine — never touching the developer's real Keychain.
function loadOrCreateAppKey(): Buffer {
  const path = keyFilePath();
  if (!process.env.TABLE_VIEW_TEST_DATA_DIR) {
    const fromKeyring = readMacKeyringKey();
    if (fromKeyring) return fromKeyring;
  }
  if (existsSync(path)) {
    const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
    if (key.length !== 32) {
      throw new Error(
        `invalid key at ${path}: expected 32 bytes (got ${key.length}). Move the file aside and re-run.`,
      );
    }
    return key;
  }
  const key = randomBytes(32);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key.toString("base64"), "utf8");
  if (platform() !== "win32") {
    try {
      chmodSync(path, 0o600);
    } catch {
      // best-effort; key file is still functional even if chmod fails.
    }
  }
  return key;
}

// Mirrors `crypto::encrypt` in src-tauri/src/storage/crypto.rs:
// nonce(12) ‖ ciphertext ‖ gcm_tag(16), all base64. The Rust `aes_gcm`
// crate appends the auth tag to its ciphertext output automatically;
// Node's `createCipheriv` returns the tag separately via getAuthTag(),
// hence the explicit concat below.
function encryptForStorage(plain: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString("base64");
}

function loadStorage(): StorageData {
  const path = storageFilePath();
  if (!existsSync(path)) return { connections: [], groups: [] };
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as StorageData;
    return {
      connections: Array.isArray(data.connections) ? data.connections : [],
      groups: Array.isArray(data.groups) ? data.groups : [],
    };
  } catch {
    // Corrupt file: refuse to clobber. Caller should `mv` it aside manually.
    throw new Error(
      `connections.json at ${path} is corrupt — quarantine the file before running fixture connection commands.`,
    );
  }
}

function saveStorage(data: StorageData): void {
  const path = storageFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  if (platform() !== "win32") {
    try {
      chmodSync(path, 0o600);
    } catch {
      // best-effort; file writes are still safe even if chmod fails.
    }
  }
}

export interface UpsertOptions {
  /**
   * Sprint 281 — when true, root-creds 로 fixture profile 의 mysql DB 를
   * ensure 하고 testuser GRANT 를 부여한다. CLI (`pnpm db:connections
   * upsert`) 는 항상 true 로 호출해 사용자 surface 의 1044 (Access denied)
   * 를 차단. unit test 는 default `false` 로 docker mysql 미의존 환경에서도
   * `upsertConnections` 의 storage 로직만 검증할 수 있게 한다.
   */
  ensureMysql?: boolean;
}

export async function upsertConnections(
  spec: ResolvedSpec,
  opts: UpsertOptions = {},
): Promise<{
  added: number;
  updated: number;
}> {
  const profile = spec.profileSpec as ProfileSpec;
  if (
    opts.ensureMysql &&
    profile.connections?.mysql &&
    profile.connections.mysql.length > 0
  ) {
    const mysql = mysqlEnvConn();
    const mysqlDb = profile.database.mysql ?? profile.database.pg;
    await ensureMysqlDatabaseAndGrant(mysqlRootEnvConn(), mysqlDb, mysql.user);
  }

  const data = loadStorage();
  let added = 0;
  let updated = 0;

  // Ensure the Fixtures group exists.
  const groupExists = data.groups.some((g) => g.id === FIXTURE_GROUP_ID);
  if (!groupExists) {
    data.groups.push({
      id: FIXTURE_GROUP_ID,
      name: FIXTURE_GROUP_NAME,
      color: null,
      collapsed: false,
    });
  }

  const key = loadOrCreateAppKey();
  await ensureFileFixtureDatabases(profile);
  for (const conn of buildConnections(spec, key)) {
    const existingIdx = data.connections.findIndex((c) => c.id === conn.id);
    if (existingIdx >= 0) {
      data.connections[existingIdx] = conn;
      updated += 1;
    } else {
      data.connections.push(conn);
      added += 1;
    }
  }

  saveStorage(data);
  return { added, updated };
}

async function ensureFileFixtureDatabases(profile: ProfileSpec): Promise<void> {
  if (
    profile.database.sqlite &&
    (profile.connections?.sqlite?.length ?? 0) > 0
  ) {
    await ensureSqliteDatabase(sqliteEnvPath(), profile.database.sqlite);
  }
  if (
    profile.database.duckdb &&
    (profile.connections?.duckdb?.length ?? 0) > 0
  ) {
    await ensureDuckdbDatabase(duckdbEnvPath(), profile.database.duckdb);
  }
}

export function clearConnections(): { removed: number } {
  const data = loadStorage();
  const before = data.connections.length;
  data.connections = data.connections.filter(
    (c) => !c.id.startsWith("fixture-"),
  );
  // Remove the Fixtures group only if no fixture-* connections remain (safety
  // net for the case where users add their own connection into the group).
  data.groups = data.groups.filter(
    (g) =>
      g.id !== FIXTURE_GROUP_ID ||
      data.connections.some((c) => c.group_id === g.id),
  );
  saveStorage(data);
  return { removed: before - data.connections.length };
}

function activeFixtureConnections(
  connections: readonly FixtureConnection[] | undefined,
): FixtureConnection[] {
  return (connections ?? []).filter(
    (conn) => (conn.status ?? "active") === "active",
  );
}

function buildConnections(spec: ResolvedSpec, key: Buffer): StoredConnection[] {
  const out: StoredConnection[] = [];
  const pg = pgEnvConn();
  const mongo = mongoEnvConn();
  const mysql = mysqlEnvConn();
  const profile = spec.profileSpec as ProfileSpec;

  for (const c of activeFixtureConnections(profile.connections?.pg)) {
    out.push({
      id: c.id,
      name: c.name,
      db_type: "postgresql",
      host: pg.host,
      port: pg.port,
      user: pg.user,
      password: encryptForStorage(pg.password, key),
      database: profile.database.pg,
      group_id: FIXTURE_GROUP_ID,
      color: c.color ?? null,
      connection_timeout: null,
      keep_alive_interval: null,
      environment: c.environment ?? null,
      auth_source: null,
      replica_set: null,
      tls_enabled: null,
    });
  }

  for (const c of activeFixtureConnections(profile.connections?.mongo)) {
    out.push({
      id: c.id,
      name: c.name,
      db_type: "mongodb",
      host: mongo.host,
      port: mongo.port,
      user: mongo.user,
      password: encryptForStorage(mongo.password, key),
      database: profile.database.mongo,
      group_id: FIXTURE_GROUP_ID,
      color: c.color ?? null,
      connection_timeout: null,
      keep_alive_interval: null,
      environment: c.environment ?? null,
      auth_source: "admin",
      replica_set: null,
      tls_enabled: null,
    });
  }

  // Sprint 281 — MySQL Slice A. profile yaml 이 `database.mysql` 미지정
  // 시 PG database 명을 fallback (시각적 일관성 + 단순한 default).
  // 실 사용자 connection 은 `pnpm db:seed mysql` 합류(Slice B+) 시 자동
  // populated 된다. 현재는 빈 schema 의 connection 만 etablish.
  const mysqlDb = profile.database.mysql ?? profile.database.pg;
  for (const c of activeFixtureConnections(profile.connections?.mysql)) {
    out.push({
      id: c.id,
      name: c.name,
      db_type: "mysql",
      host: mysql.host,
      port: mysql.port,
      user: mysql.user,
      password: encryptForStorage(mysql.password, key),
      database: mysqlDb,
      group_id: FIXTURE_GROUP_ID,
      color: c.color ?? null,
      connection_timeout: null,
      keep_alive_interval: null,
      environment: c.environment ?? null,
      auth_source: null,
      replica_set: null,
      tls_enabled: null,
    });
  }

  const sqliteFile = profile.database.sqlite;
  if (sqliteFile) {
    for (const c of activeFixtureConnections(profile.connections?.sqlite)) {
      out.push({
        id: c.id,
        name: c.name,
        db_type: "sqlite",
        host: "",
        port: 0,
        user: "",
        password: "",
        database: resolve(sqliteEnvPath().directory, sqliteFile),
        read_only: false,
        group_id: FIXTURE_GROUP_ID,
        color: c.color ?? null,
        connection_timeout: null,
        keep_alive_interval: null,
        environment: c.environment ?? null,
        auth_source: null,
        replica_set: null,
        tls_enabled: null,
      });
    }
  }

  // DuckDB — file-based, same pattern as SQLite.
  const duckdbFile = profile.database.duckdb;
  if (duckdbFile) {
    for (const c of activeFixtureConnections(profile.connections?.duckdb)) {
      out.push({
        id: c.id,
        name: c.name,
        db_type: "duckdb",
        host: "",
        port: 0,
        user: "",
        password: "",
        database: resolve(duckdbEnvPath().directory, duckdbFile),
        read_only: false,
        group_id: FIXTURE_GROUP_ID,
        color: c.color ?? null,
        connection_timeout: null,
        keep_alive_interval: null,
        environment: c.environment ?? null,
        auth_source: null,
        replica_set: null,
        tls_enabled: null,
      });
    }
  }

  // MariaDB — reuses MySQL protocol with separate port.
  const mariadb = mariadbEnvConn();
  const mariadbDb = profile.database.mariadb;
  if (mariadbDb) {
    for (const c of activeFixtureConnections(profile.connections?.mariadb)) {
      out.push({
        id: c.id,
        name: c.name,
        db_type: "mariadb",
        host: mariadb.host,
        port: mariadb.port,
        user: mariadb.user,
        password: encryptForStorage(mariadb.password, key),
        database: mariadbDb,
        group_id: FIXTURE_GROUP_ID,
        color: c.color ?? null,
        connection_timeout: null,
        keep_alive_interval: null,
        environment: c.environment ?? null,
        auth_source: null,
        replica_set: null,
        tls_enabled: null,
      });
    }
  }

  // MSSQL
  const mssql = mssqlEnvConn();
  const mssqlDb = profile.database.mssql;
  if (mssqlDb) {
    for (const c of activeFixtureConnections(profile.connections?.mssql)) {
      out.push({
        id: c.id,
        name: c.name,
        db_type: "mssql",
        host: mssql.host,
        port: mssql.port,
        user: mssql.user,
        password: encryptForStorage(mssql.password, key),
        database: mssqlDb,
        group_id: FIXTURE_GROUP_ID,
        color: c.color ?? null,
        connection_timeout: null,
        keep_alive_interval: null,
        environment: c.environment ?? null,
        auth_source: null,
        replica_set: null,
        tls_enabled: null,
      });
    }
  }

  // Oracle
  const oracle = oracleEnvConn();
  const oracleDb = profile.database.oracle;
  if (oracleDb) {
    for (const c of activeFixtureConnections(profile.connections?.oracle)) {
      out.push({
        id: c.id,
        name: c.name,
        db_type: "oracle",
        host: oracle.host,
        port: oracle.port,
        user: oracle.user,
        password: encryptForStorage(oracle.password, key),
        database: oracle.serviceName,
        group_id: FIXTURE_GROUP_ID,
        color: c.color ?? null,
        connection_timeout: null,
        keep_alive_interval: null,
        environment: c.environment ?? null,
        auth_source: null,
        replica_set: null,
        tls_enabled: null,
      });
    }
  }

  // Redis
  const redisDbNum = profile.database.redis ?? 0;
  const redis = redisEnvConn(redisDbNum);
  for (const c of activeFixtureConnections(profile.connections?.redis)) {
    out.push({
      id: c.id,
      name: c.name,
      db_type: "redis",
      host: redis.host,
      port: redis.port,
      user: "",
      password: encryptForStorage(redis.password, key),
      database: String(redisDbNum),
      group_id: FIXTURE_GROUP_ID,
      color: c.color ?? null,
      connection_timeout: null,
      keep_alive_interval: null,
      environment: c.environment ?? null,
      auth_source: null,
      replica_set: null,
      tls_enabled: null,
    });
  }

  return out;
}

// Test seam — exposed for unit tests, not part of the public CLI surface.
export const __test = {
  appDataPath,
  storageFilePath,
  loadStorage,
  saveStorage,
};
