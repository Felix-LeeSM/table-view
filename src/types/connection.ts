export type DatabaseType =
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "mongodb"
  | "redis";

/**
 * Broad paradigm classification mirrored from the backend. Each
 * `DatabaseType` maps to exactly one paradigm. Sprint 64 introduced the tag;
 * Sprint 65 tightens consumption so the UI can branch on paradigm (e.g.
 * mongo → document tree placeholder) without falling back to the raw
 * `db_type` string.
 */
export type Paradigm = "rdb" | "document" | "search" | "kv";

/**
 * The shape of a connection as it lives in the frontend. Note: there is no
 * `password` field — passwords are kept exclusively in the encrypted backend
 * store and never sent to the renderer process. Use `has_password` to know
 * whether the user has set one.
 */
export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  user: string;
  database: string;
  group_id: string | null;
  color: string | null;
  connection_timeout?: number;
  keep_alive_interval?: number;
  environment?: string | null;
  /** Whether a password is currently stored on disk for this connection. */
  has_password: boolean;
  /**
   * Paradigm tag derived from `db_type` on the backend. Sprint 65 promotes
   * this from optional to **required** — the backend now emits a typed
   * `Paradigm` enum on every response (no `#[serde(default)]` fallback), so
   * consumers can rely on it being present instead of falling back to
   * `paradigmOf(conn.db_type)` for undefined safety.
   */
  paradigm: Paradigm;
  // ── MongoDB-specific optional fields (Sprint 65). ────────────────────
  // All three are serialised by the backend only when the user fills them
  // in, and the frontend treats them as optional so non-mongo connections
  // type-check without boilerplate.
  /** MongoDB auth source (`authSource`). */
  auth_source?: string | null;
  /** MongoDB replica set name. */
  replica_set?: string | null;
  /** Whether TLS is enabled for this MongoDB connection. */
  tls_enabled?: boolean | null;
}

/**
 * The shape used by ConnectionDialog while the user is editing a connection.
 * Adds a transient `password` field whose value carries one of three
 * meanings on save:
 * - `null`     → leave the stored password unchanged (only valid when editing)
 * - `""`       → explicitly clear the stored password
 * - non-empty  → set/replace the stored password
 */
export interface ConnectionDraft extends Omit<
  ConnectionConfig,
  "has_password"
> {
  password: string | null;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  color: string | null;
  collapsed: boolean;
}

/// Adjacently-tagged discriminated union matching Rust's serde serialization:
/// - { type: "connected", activeDb?: string }
/// - { type: "disconnected" }
/// - { type: "error", message: "..." }
///
/// Sprint 130 — `connected` carries an optional `activeDb` tracking the
/// currently active database (PG sub-pool key). The DbSwitcher trigger label
/// reads this field and falls back to `connection.database` when absent.
export type ConnectionStatus =
  | { type: "connected"; activeDb?: string }
  | { type: "connecting" }
  | { type: "disconnected" }
  | { type: "error"; message: string };

export const DATABASE_DEFAULTS: Record<DatabaseType, number> = {
  postgresql: 5432,
  mysql: 3306,
  sqlite: 0,
  mongodb: 27017,
  redis: 6379,
};

/** Map a DatabaseType to its paradigm tag. Mirrors
 *  `DatabaseType::paradigm` on the backend. */
export function paradigmOf(dbType: DatabaseType): Paradigm {
  switch (dbType) {
    case "postgresql":
    case "mysql":
    case "sqlite":
      return "rdb";
    case "mongodb":
      return "document";
    case "redis":
      return "kv";
  }
}

export function createEmptyDraft(): ConnectionDraft {
  return {
    id: "",
    name: "",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "",
    group_id: null,
    color: null,
    paradigm: "rdb",
  };
}

/** Derive a draft from an existing connection. Password starts as `null`
 * (meaning "do not change") so the dialog UX can leave the field empty
 * without clearing the stored password on save. */
export function draftFromConnection(conn: ConnectionConfig): ConnectionDraft {
  return {
    id: conn.id,
    name: conn.name,
    db_type: conn.db_type,
    host: conn.host,
    port: conn.port,
    user: conn.user,
    database: conn.database,
    group_id: conn.group_id,
    color: conn.color,
    connection_timeout: conn.connection_timeout,
    keep_alive_interval: conn.keep_alive_interval,
    environment: conn.environment,
    paradigm: conn.paradigm,
    auth_source: conn.auth_source,
    replica_set: conn.replica_set,
    tls_enabled: conn.tls_enabled,
    password: null,
  };
}

export function parseConnectionUrl(
  url: string,
): Partial<ConnectionDraft> | null {
  try {
    const parsed = new URL(url);
    const dbTypeMap: Record<string, DatabaseType> = {
      postgresql: "postgresql",
      postgres: "postgresql",
      mysql: "mysql",
      mongodb: "mongodb",
      redis: "redis",
    };
    const dbType = dbTypeMap[parsed.protocol.replace(":", "")];
    if (!dbType) return null;
    return {
      db_type: dbType,
      host: parsed.hostname || "localhost",
      port: parsed.port ? parseInt(parsed.port, 10) : DATABASE_DEFAULTS[dbType],
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
      paradigm: paradigmOf(dbType),
    };
  } catch {
    return null;
  }
}

/** Supported environment tags for connections. */
export type EnvironmentTag =
  | "local"
  | "testing"
  | "development"
  | "staging"
  | "production";

/** Metadata for environment tags. */
export const ENVIRONMENT_META: Record<
  EnvironmentTag,
  { label: string; color: string }
> = {
  local: { label: "Local", color: "#10b981" },
  testing: { label: "Testing", color: "#eab308" },
  development: { label: "Development", color: "#3b82f6" },
  staging: { label: "Staging", color: "#f97316" },
  production: { label: "Production", color: "#ef4444" },
};

/** All environment option values (for iteration). */
export const ENVIRONMENT_OPTIONS: EnvironmentTag[] = [
  "local",
  "testing",
  "development",
  "staging",
  "production",
];
