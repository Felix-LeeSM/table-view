// Direct app-storage upsert for fixture-managed connections.
// Reads + rewrites `connections.json` in the platform app data dir
// (matches Rust storage path: ~/Library/Application Support/table-view/
// connections.json on macOS, ~/.local/share/table-view/... on Linux).
// Plaintext password (per locked decision); group "Fixtures" auto-created.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir, platform } from "node:os";
import type { ProfileSpec, ResolvedSpec } from "./spec.js";
import { pgEnvConn } from "./postgres.js";
import { mongoEnvConn } from "./mongo.js";

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

  for (const conn of buildConnections(spec)) {
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

function buildConnections(spec: ResolvedSpec): StoredConnection[] {
  const out: StoredConnection[] = [];
  const pg = pgEnvConn();
  const mongo = mongoEnvConn();
  const profile = spec.profileSpec as ProfileSpec;

  for (const c of profile.connections?.pg ?? []) {
    out.push({
      id: c.id,
      name: c.name,
      db_type: "postgresql",
      host: pg.host,
      port: pg.port,
      user: pg.user,
      password: pg.password,
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
      password: mongo.password,
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

  return out;
}

// Test seam — exposed for unit tests, not part of the public CLI surface.
export const __test = {
  appDataPath,
  storageFilePath,
  loadStorage,
  saveStorage,
};
