// Direct app-storage upsert for fixture-managed connections.
// Reads + rewrites `connections.json` in the platform app data dir
// (matches Rust storage path: ~/Library/Application Support/table-view/
// connections.json on macOS, ~/.local/share/table-view/... on Linux).
//
// Password handling: the Rust storage layer assumes every on-disk
// `password` field is AES-256-GCM ciphertext keyed by the file at
// `<app-data>/.key`. Plaintext fields throw "Ciphertext too short" the
// moment the user clicks Connect. Fixture therefore re-implements the
// same envelope (12-byte nonce + ciphertext + 16-byte GCM tag, base64)
// in Node, sharing the same `.key` file. Auto-generates the key when
// missing so fixture CLI works before the app has ever been launched.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { homedir, platform } from "node:os";
import type { ProfileSpec, ResolvedSpec } from "./spec.js";
import { pgEnvConn } from "./postgres.js";
import { mongoEnvConn } from "./mongo.js";
import { mysqlEnvConn } from "./mysql.js";

const FIXTURE_GROUP_ID = "fixture-group";
const FIXTURE_GROUP_NAME = "Fixtures";

interface StoredConnection {
  id: string;
  name: string;
  db_type: "postgresql" | "mongodb" | "mysql" | "sqlite" | "redis";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
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

// Mirrors `crypto::get_or_create_key` in src-tauri/src/storage/crypto.rs.
// The on-disk format is base64(32 random bytes) — anything shorter is
// rejected so we surface the corruption instead of silently producing
// an unusable AES key.
function loadOrCreateAppKey(): Buffer {
  const path = keyFilePath();
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

export function upsertConnections(spec: ResolvedSpec): {
  added: number;
  updated: number;
} {
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

function buildConnections(spec: ResolvedSpec, key: Buffer): StoredConnection[] {
  const out: StoredConnection[] = [];
  const pg = pgEnvConn();
  const mongo = mongoEnvConn();
  const mysql = mysqlEnvConn();
  const profile = spec.profileSpec as ProfileSpec;

  for (const c of profile.connections?.pg ?? []) {
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

  for (const c of profile.connections?.mongo ?? []) {
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
  for (const c of profile.connections?.mysql ?? []) {
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

  return out;
}

// Test seam — exposed for unit tests, not part of the public CLI surface.
export const __test = {
  appDataPath,
  storageFilePath,
  loadStorage,
  saveStorage,
};
