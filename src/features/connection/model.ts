export type DatabaseType =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "sqlite"
  | "duckdb"
  | "mssql"
  | "oracle"
  | "mongodb"
  | "redis"
  | "valkey"
  | "elasticsearch"
  | "opensearch";

/**
 * Legacy connection creation allow-list.
 *
 * Current source/profile support lives in `DATA_SOURCE_PROFILES`; connection UI
 * exposure is derived from `capabilities.connection.test` and tested to stay
 * aligned with this compatibility list.
 *
 * Sprint 281 (Phase 17 Slice A) — MySQL 추가. read path (namespaces /
 * tables / columns) 만 동작 — DDL / queries / streaming 은 Slice B~G
 * 합류 전까지 `AppError::Unsupported` 가 surfacing 된다.
 *
 * Oracle is exposed for service-name lifecycle plus bounded catalog/query/cancel
 * runtime. Edit/DDL, parser/completion, PL/SQL, SID/TNS/wallet/TLS remain
 * unclaimed.
 */
export const SUPPORTED_DATABASE_TYPES: readonly DatabaseType[] = [
  "postgresql",
  "mysql",
  "mariadb",
  "sqlite",
  "duckdb",
  "mssql",
  "oracle",
  "mongodb",
  "redis",
  "valkey",
  "elasticsearch",
  "opensearch",
];

export function isSupportedDatabaseType(t: DatabaseType): boolean {
  return SUPPORTED_DATABASE_TYPES.includes(t);
}

/** UI 라벨. SUPPORTED 와 별개로 모든 variant 에 대해 정의 — URL parser 가
 * 인식한 unsupported scheme 의 거부 메시지에서도 사용한다. */
export const DATABASE_TYPE_LABELS: Record<DatabaseType, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  sqlite: "SQLite",
  duckdb: "DuckDB",
  mssql: "Microsoft SQL Server",
  oracle: "Oracle",
  mongodb: "MongoDB",
  redis: "Redis",
  valkey: "Valkey",
  elasticsearch: "Elasticsearch",
  opensearch: "OpenSearch",
};

/**
 * Broad paradigm classification mirrored from the backend. Each
 * `DatabaseType` maps to exactly one paradigm so the UI can branch on
 * paradigm (e.g. mongo → document tree) without re-inspecting the raw
 * `dbType` string.
 */
export type Paradigm = "rdb" | "document" | "search" | "kv";

/**
 * The shape of a connection as it lives in the frontend. Note: there is no
 * `password` field — passwords are kept exclusively in the encrypted backend
 * store and never sent to the renderer process. Use `hasPassword` to know
 * whether the user has set one.
 */
export interface ConnectionConfig {
  // #1493 — kept as `string` in Phase 1: the swap-prone functions
  // (`rawEntryKey` / `findLiveIdleTab`) read `tab.connectionId`, never
  // `ConnectionConfig.id`, so branding this field buys no call-site
  // protection while forcing ~90 construction sites to re-brand. The
  // `ConnectionId` brand still guards those functions (connectionId is
  // asserted at each call boundary). Field branding is deferred to a
  // later phase where a value-level ingress can absorb the blast.
  id: string;
  name: string;
  dbType: DatabaseType;
  host: string;
  port: number;
  user: string;
  database: string;
  /** File-backed DBMS only: open the user-managed database file without write access. */
  readOnly?: boolean;
  groupId: string | null;
  color: string | null;
  connectionTimeout?: number;
  keepAliveInterval?: number;
  environment?: string | null;
  /** Whether a password is currently stored on disk for this connection. */
  hasPassword: boolean;
  /**
   * Paradigm tag derived from `dbType` on the backend. Required —
   * the backend always emits a typed `Paradigm` enum, so consumers
   * can rely on it being present.
   */
  paradigm: Paradigm;
  // ── Connection/auth optional fields ───────────────────────────────
  /** Whether TLS/encryption is enabled for DBMS forms that expose it. */
  tlsEnabled?: boolean | null;
  /** SQL Server: trust the server certificate instead of validating it. */
  trustServerCertificate?: boolean | null;

  // ── MongoDB-specific optional fields ──────────────────────────────
  // Serialised by the backend only when the user fills them in; the
  // frontend treats them as optional so non-mongo connections type-check
  // without boilerplate.
  /** MongoDB auth source (`authSource`). */
  authSource?: string | null;
  /** MongoDB replica set name. */
  replicaSet?: string | null;

  // ── Oracle-specific optional fields (#1065) ───────────────────────
  /** Oracle: connect via SID instead of a service name. */
  oracleUseSid?: boolean | null;
  /** Oracle: filesystem path to the wallet directory (`ewallet.pem`) for
   *  mTLS. A path reference only — stripped from exports. */
  walletPath?: string | null;
  /** Whether an Oracle wallet password is stored on disk. Like
   *  `hasPassword`, the plaintext never reaches the renderer. */
  hasWalletPassword?: boolean;
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
  "hasPassword" | "hasWalletPassword"
> {
  password: string | null;
  /** Oracle wallet password (#1065). Same three-way save semantics as
   * `password`: `null` keep / `""` clear / non-empty set. Optional so the
   * many non-Oracle draft fixtures/consumers need not carry it; the dialog
   * injects the resolved value at save/test time. */
  walletPassword?: string | null;
}

export function getMssqlConnectionUnsupportedMessage(
  draft: Pick<ConnectionDraft, "dbType" | "host" | "user">,
): string | null {
  if (draft.dbType !== "mssql") return null;
  if (draft.host.includes("\\")) {
    return "SQL Server named instances are not supported. Use the server host and TCP port.";
  }
  if (draft.user.includes("\\")) {
    return "Windows authentication is not supported. Use SQL authentication with a SQL Server login.";
  }
  return null;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  color: string | null;
  collapsed: boolean;
}

/// Adjacently-tagged discriminated union matching Rust's serde
/// serialization. The `connected` variant carries an optional `activeDb`
/// (PG sub-pool key); DbSwitcher reads it for the trigger label and
/// falls back to `connection.database` when absent.
export type ConnectionStatus =
  | { type: "connected"; activeDb?: string }
  | { type: "connecting" }
  | { type: "disconnected" }
  | { type: "error"; message: string };

export const DATABASE_DEFAULTS: Record<DatabaseType, number> = {
  postgresql: 5432,
  mysql: 3306,
  mariadb: 3306,
  sqlite: 0,
  duckdb: 0,
  mssql: 1433,
  oracle: 1521,
  mongodb: 27017,
  redis: 6379,
  valkey: 6379,
  elasticsearch: 9200,
  opensearch: 9200,
};

/**
 * Per-DBMS defaults seeded into the form when the user picks or switches
 * `dbType`. Adds `user` + `database` defaults on top of
 * `DATABASE_DEFAULTS`, so the dialog no longer hard-codes
 * `user="postgres"` for every DBMS.
 *
 * - `postgresql`: classic super-user/db pair.
 * - `mysql` / `mariadb`: standard root user, system DB default.
 * - `sqlite` / `duckdb`: file-based; the form swaps host/port/user/password
 *   for a file path field when the runtime is exposed.
 * - `mssql`: `sa` / `master` default.
 * - `oracle`: common local Oracle Free service default.
 * - `mongodb`: optional auth — empty user/db.
 * - `redis` / `valkey`: ACL optional, default DB index `"0"` (kept as
 *   string for ConnectionConfig parity).
 */
export interface ConnectionDefaultFields {
  port: number;
  user: string;
  database: string;
}

export const DATABASE_DEFAULT_FIELDS: Record<
  DatabaseType,
  ConnectionDefaultFields
> = {
  postgresql: { port: 5432, user: "postgres", database: "postgres" },
  mysql: { port: 3306, user: "root", database: "mysql" },
  mariadb: { port: 3306, user: "root", database: "mysql" },
  sqlite: { port: 0, user: "", database: "" },
  duckdb: { port: 0, user: "", database: "" },
  mssql: { port: 1433, user: "sa", database: "master" },
  oracle: { port: 1521, user: "system", database: "FREEPDB1" },
  mongodb: { port: 27017, user: "", database: "admin" },
  redis: { port: 6379, user: "", database: "0" },
  valkey: { port: 6379, user: "", database: "0" },
  elasticsearch: { port: 9200, user: "", database: "" },
  opensearch: { port: 9200, user: "", database: "" },
};

/** Map a DatabaseType to its paradigm tag. Mirrors
 *  `DatabaseType::paradigm` on the backend. */
export function paradigmOf(dbType: DatabaseType): Paradigm {
  switch (dbType) {
    case "postgresql":
    case "mysql":
    case "mariadb":
    case "sqlite":
    case "duckdb":
    case "mssql":
    case "oracle":
      return "rdb";
    case "mongodb":
      return "document";
    case "redis":
    case "valkey":
      return "kv";
    case "elasticsearch":
    case "opensearch":
      return "search";
  }
}

/** True for KV-paradigm engines (redis/valkey). Derives from `paradigmOf` so a
 *  future KV adapter converges here without touching call sites. Prefer over
 *  ad-hoc `dbType === "redis" || dbType === "valkey"` disjunctions. */
export const isKvFamily = (dbType: DatabaseType): boolean =>
  paradigmOf(dbType) === "kv";

/** True for search-paradigm engines (elasticsearch/opensearch). Prefer over
 *  ad-hoc `dbType === "elasticsearch" || dbType === "opensearch"`. */
export const isSearchFamily = (dbType: DatabaseType): boolean =>
  paradigmOf(dbType) === "search";

/**
 * Membership gate for `tlsEnabled` carry (`applyDbTypeChange`) and verbatim
 * preservation (`resolveDraftTlsEnabled`). Members: `mssql`, `mongodb`,
 * `redis`, `valkey`, `elasticsearch`, `opensearch`.
 *
 * `mssql` is a member but its behavior never depends on the membership: both
 * consumers special-case `dbType === "mssql"` first (seed `trust=true` /
 * `tlsEnabled ?? true`), so those branches win before `exposesTlsToggle` is
 * ever consulted. Its presence here is therefore inert. mongo/redis/valkey/
 * search are the types that genuinely rely on membership — their TLS toggle is
 * a plain on/off with no trust dependency, so `tls_enabled=true, trust=None`
 * is a legitimate stored state that must be carried/preserved verbatim.
 *
 * `postgresql` renders a TLS toggle (#1526) but is deliberately kept OUT.
 * Unlike mongo/redis it routes through the trust-dependent
 * `resolve_tls_decision` boundary where `tls_enabled=true, trust=None` is a
 * backend hard-reject (#1062). Staying out of the set keeps its two required
 * behaviors: `resolveDraftTlsEnabled` heals that reject-residue instead of
 * preserving it, and `applyDbTypeChange` resets TLS to null on `dbType` switch
 * instead of carrying a `true` that would leave `trust=None`. The PG form
 * itself seeds `trust=false` on enable so the invalid combo is never authored.
 *
 * The no-TLS-control types (mysql/mariadb/oracle/sqlite/duckdb) also stay out:
 * `tlsEnabled` must not be carried onto — or persisted for — those drafts.
 */
export const TLS_TOGGLE_DATABASE_TYPES: readonly DatabaseType[] = [
  "mssql",
  "mongodb",
  "redis",
  "valkey",
  "elasticsearch",
  "opensearch",
];

export function exposesTlsToggle(dbType: DatabaseType): boolean {
  return TLS_TOGGLE_DATABASE_TYPES.includes(dbType);
}

/**
 * #1063 — the sslmode dropdown vocabulary for the trust-dependent RDB engines
 * (pg/mysql/mariadb). This is a *view* over the stored `(tlsEnabled,
 * trustServerCertificate)` pair, not a new persisted field, so existing
 * connections reinterpret without a migration:
 *
 * | mode          | tlsEnabled | trust  | backend decision  |
 * |---------------|------------|--------|-------------------|
 * | `disable`     | false      | false  | force plaintext   |
 * | `prefer`      | null       | null   | driver default    |
 * | `require`     | true       | true   | encrypt, skip verify |
 * | `verify-full` | true       | false  | encrypt + verify  |
 *
 * `verify-ca` is intentionally omitted (needs a CA file — follow-up).
 */
export type SslMode = "disable" | "prefer" | "require" | "verify-full";

export const SSL_MODE_OPTIONS: readonly SslMode[] = [
  "disable",
  "prefer",
  "require",
  "verify-full",
];

/** True for the engines that render the sslmode dropdown (pg/mysql/mariadb). */
export function usesSslModeSelect(dbType: DatabaseType): boolean {
  return dbType === "postgresql" || dbType === "mysql" || dbType === "mariadb";
}

/** Derive the dropdown value from the stored TLS fields. The invalid residue
 *  `(tls=true, trust=null)` collapses to the secure `verify-full` rather than
 *  skip-verify. */
export function sslModeFromFields(
  tlsEnabled: boolean | null | undefined,
  trust: boolean | null | undefined,
): SslMode {
  if (tlsEnabled === true) return trust === true ? "require" : "verify-full";
  if (tlsEnabled === false && trust === false) return "disable";
  return "prefer";
}

/** Map a dropdown selection back onto the stored TLS fields. */
export function sslModeFields(
  mode: SslMode,
): Pick<ConnectionDraft, "tlsEnabled" | "trustServerCertificate"> {
  switch (mode) {
    case "disable":
      return { tlsEnabled: false, trustServerCertificate: false };
    case "prefer":
      return { tlsEnabled: null, trustServerCertificate: null };
    case "require":
      return { tlsEnabled: true, trustServerCertificate: true };
    case "verify-full":
      return { tlsEnabled: true, trustServerCertificate: false };
  }
}

export type FileConnectionDatabaseType = Extract<
  DatabaseType,
  "sqlite" | "duckdb"
>;

export function parseFileConnectionPath(
  dbType: FileConnectionDatabaseType,
  raw: string,
): Partial<ConnectionDraft> | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const defaults = DATABASE_DEFAULT_FIELDS[dbType];
  return {
    dbType,
    host: "",
    port: defaults.port,
    user: "",
    password: "",
    database: trimmed,
    readOnly: false,
    paradigm: paradigmOf(dbType),
  };
}

export function createEmptyDraft(): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "postgres",
    readOnly: false,
    groupId: null,
    color: null,
    paradigm: "rdb",
    walletPassword: "",
  };
}

/**
 * Resolve the `tlsEnabled` value the edit form should start from.
 *
 * - MSSQL defaults an unset toggle to `true` (encrypt-by-default UX).
 * - Other TLS-toggle forms (mongo/redis/valkey/search) carry the stored
 *   value verbatim — it is genuinely user-settable there.
 * - No-TLS-toggle types (pg/mysql/mariadb/oracle/sqlite/duckdb) have no TLS
 *   control, so a stored `tls_enabled=true` with no explicit trust decision
 *   is the invalid #1062 reject residue (only creatable by the pre-fix
 *   MSSQL→RDB carryover bug). Drop it to `null` so opening + saving the
 *   connection heals the stored entry. A valid explicit-trust combo
 *   (`trust=true|false`, rare hand-authored JSON) is preserved unchanged.
 */
function resolveDraftTlsEnabled(
  conn: ConnectionConfig,
): boolean | null | undefined {
  if (conn.dbType === "mssql") return conn.tlsEnabled ?? true;
  if (exposesTlsToggle(conn.dbType)) return conn.tlsEnabled;
  if (conn.tlsEnabled === true && conn.trustServerCertificate == null) {
    return null;
  }
  return conn.tlsEnabled;
}

/** Derive a draft from an existing connection. Password starts as `null`
 * (meaning "do not change") so the dialog UX can leave the field empty
 * without clearing the stored password on save. */
export function draftFromConnection(conn: ConnectionConfig): ConnectionDraft {
  return {
    id: conn.id,
    name: conn.name,
    dbType: conn.dbType,
    host: conn.host,
    port: conn.port,
    user: conn.user,
    database: conn.database,
    readOnly: conn.readOnly ?? false,
    groupId: conn.groupId,
    color: conn.color,
    connectionTimeout: conn.connectionTimeout,
    keepAliveInterval: conn.keepAliveInterval,
    environment: conn.environment,
    paradigm: conn.paradigm,
    authSource: conn.authSource,
    replicaSet: conn.replicaSet,
    tlsEnabled: resolveDraftTlsEnabled(conn),
    trustServerCertificate: conn.trustServerCertificate,
    oracleUseSid: conn.oracleUseSid,
    walletPath: conn.walletPath,
    password: null,
    // null = keep the stored wallet password unchanged on save (#1065).
    walletPassword: null,
  };
}

// URL-scheme aliases. `postgres` is legacy shorthand for `postgresql`;
// SQL Server clients use several scheme names; `mongodb+srv` is the
// SRV-record variant and the backend resolves SRV at connect time.
const URL_SCHEME_DB_TYPES: Record<string, DatabaseType> = {
  postgresql: "postgresql",
  postgres: "postgresql",
  mysql: "mysql",
  mariadb: "mariadb",
  mssql: "mssql",
  sqlserver: "mssql",
  sqlsrv: "mssql",
  oracle: "oracle",
  mongodb: "mongodb",
  "mongodb+srv": "mongodb",
  redis: "redis",
  rediss: "redis",
  valkey: "valkey",
  elasticsearch: "elasticsearch",
  elastic: "elasticsearch",
  es: "elasticsearch",
  opensearch: "opensearch",
};

// #1063 — connection-string TLS parameters we honor on paste. `sslmode`
// (pg) / `ssl-mode` (mysql connectors) / `ssl_mode` for the sslmode-select
// engines; a plain boolean `tls` / `ssl` for the on/off engines.
const SSLMODE_PARAM_KEYS = ["sslmode", "ssl-mode", "ssl_mode"];
const TLS_BOOL_PARAM_KEYS = ["tls", "ssl"];

function findParamCaseInsensitive(
  searchParams: URLSearchParams,
  keys: readonly string[],
): [string, string] | null {
  for (const [key, value] of searchParams.entries()) {
    if (keys.includes(key.toLowerCase())) return [key, value];
  }
  return null;
}

interface UrlTlsResolution {
  fields: Pick<ConnectionDraft, "tlsEnabled" | "trustServerCertificate">;
  /** Raw `key=value` of a TLS parameter that could not be reflected onto the
   *  form (e.g. `sslmode=verify-ca`), or `null` when nothing was dropped. */
  unreflected: string | null;
}

/**
 * #1063 — resolve a pasted URL's TLS parameter onto the draft's
 * `(tlsEnabled, trust)` fields. `prefer`/`preferred` is treated as "unset"
 * (same posture as no parameter) so it is neither applied nor flagged.
 * Values we cannot represent (verify-ca, allow, garbage) leave the fields
 * untouched and are surfaced via `unreflected` so the paste handler can warn.
 */
function resolveUrlTls(
  dbType: DatabaseType,
  searchParams: URLSearchParams,
): UrlTlsResolution {
  if (usesSslModeSelect(dbType)) {
    const found = findParamCaseInsensitive(searchParams, SSLMODE_PARAM_KEYS);
    if (!found) return { fields: {}, unreflected: null };
    const [key, rawValue] = found;
    switch (rawValue.toLowerCase()) {
      case "disable":
      case "disabled":
        return { fields: sslModeFields("disable"), unreflected: null };
      case "prefer":
      case "preferred":
        return { fields: {}, unreflected: null };
      case "require":
      case "required":
        return { fields: sslModeFields("require"), unreflected: null };
      case "verify-full":
      case "verify_full":
      case "verify-identity":
      case "verify_identity":
        return { fields: sslModeFields("verify-full"), unreflected: null };
      default:
        // verify-ca, allow, and any unknown value are not representable.
        return { fields: {}, unreflected: `${key}=${rawValue}` };
    }
  }
  // Boolean tls/ssl engines (mongo/redis/valkey/search).
  const found = findParamCaseInsensitive(searchParams, TLS_BOOL_PARAM_KEYS);
  if (!found) return { fields: {}, unreflected: null };
  const [key, rawValue] = found;
  const value = rawValue.toLowerCase();
  if (["true", "1", "yes"].includes(value)) {
    return { fields: { tlsEnabled: true }, unreflected: null };
  }
  if (["false", "0", "no"].includes(value)) {
    return { fields: { tlsEnabled: false }, unreflected: null };
  }
  return { fields: {}, unreflected: `${key}=${rawValue}` };
}

/**
 * #1063 — report a `key=value` TLS parameter from `url` that `parseConnectionUrl`
 * could not reflect onto the form (e.g. `sslmode=verify-ca`), else `null`.
 * The paste/import UI surfaces this so a dropped security parameter is visible
 * rather than silently lost.
 */
export function unreflectedTlsParam(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const dbType = URL_SCHEME_DB_TYPES[parsed.protocol.replace(":", "")];
  // mssql already honors its own encrypt/trustServerCertificate params.
  if (!dbType || dbType === "mssql") return null;
  return resolveUrlTls(dbType, parsed.searchParams).unreflected;
}

export function parseConnectionUrl(
  url: string,
): Partial<ConnectionDraft> | null {
  try {
    const parsed = new URL(url);
    // SQLite uses a file path, not a URL. Accept `sqlite:/absolute/path.db`
    // here; plain paths fall through to `parseSqliteFilePath` via the
    // catch branch.
    if (parsed.protocol === "sqlite:" || parsed.protocol === "duckdb:") {
      const dbType: FileConnectionDatabaseType =
        parsed.protocol === "sqlite:" ? "sqlite" : "duckdb";
      const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return parseFileConnectionPath(dbType, path);
    }
    const dbType = URL_SCHEME_DB_TYPES[parsed.protocol.replace(":", "")];
    if (!dbType) return null;
    // Empty host (`postgres://`, `mysql://@`, `mongodb+srv://`) is too
    // malformed to infer a target. Returning `null` lets the paste
    // handler treat it as "no recognised paste" and leave the form
    // unchanged (silent best-effort, no alert).
    if (!parsed.hostname) return null;
    const database = parsed.pathname.replace(/^\//, "");
    const searchParams = parsed.searchParams;
    const sqlServerEncrypt = sqlServerBooleanParam(
      searchParams,
      "encrypt",
      true,
    );
    const sqlServerTrustServerCertificate = sqlServerBooleanParam(
      searchParams,
      "trustServerCertificate",
      true,
    );
    // #1063 — honor sslmode/tls parameters for the non-mssql engines. The
    // `rediss:` scheme keeps precedence (it always means TLS on).
    const urlTls =
      dbType === "mssql" ? { fields: {} } : resolveUrlTls(dbType, searchParams);
    return {
      dbType,
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : DATABASE_DEFAULTS[dbType],
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: isKvFamily(dbType) && database === "" ? "0" : database,
      ...urlTls.fields,
      ...(parsed.protocol === "rediss:" ? { tlsEnabled: true } : {}),
      ...(dbType === "mssql"
        ? {
            tlsEnabled: sqlServerEncrypt,
            trustServerCertificate: sqlServerTrustServerCertificate,
          }
        : {}),
      paradigm: paradigmOf(dbType),
    };
  } catch {
    // Input is not a parseable URL — caller will try other connection-string forms.
    return null;
  }
}

function sqlServerBooleanParam(
  searchParams: URLSearchParams,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = searchParams.get(key);
  if (value === null) return defaultValue;
  return ["true", "1", "yes"].includes(value.toLowerCase());
}

/**
 * SQLite has no URL form — treat the raw input as a file path. Trims
 * whitespace; returns `null` for empty/whitespace-only input so the
 * caller can raise a validation error.
 */
export function parseSqliteFilePath(
  raw: string,
): Partial<ConnectionDraft> | null {
  return parseFileConnectionPath("sqlite", raw);
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

/**
 * Canonicalize a raw stored `environment` string to a known tag, else `null`.
 *
 * The connection form is a fixed Select, but the data layer (`environment` is
 * still a free `string | null` — type hardening is #1114's) can receive
 * non-canonical values via URL import, legacy-store reconcile, or a
 * hand-edited SQLite row (`"Production"`, `"prod"`, `"production "`). Those
 * must never masquerade as a canonical tag: production protection keys off
 * exact `=== "production"`, so a look-alike silently loses the guard.
 *
 * #1125 decision: unrecognized tag = null (treated as env-unset → allow, no
 * added friction) but surfaced as an info-level signal (an "Unknown" badge)
 * so the mismatch is visible rather than silent. This is the trust boundary
 * for that policy — safe-mode decision and badge both route through it.
 */
export function canonicalEnvironmentTag(
  raw: string | null | undefined,
): EnvironmentTag | null {
  // #1114 nit — membership check against the options array, not `in
  // ENVIRONMENT_META`: the `in` operator matches inherited prototype keys (a
  // stored `"constructor"` / `"toString"` would otherwise canonicalize as a
  // valid tag).
  return raw != null && (ENVIRONMENT_OPTIONS as string[]).includes(raw)
    ? (raw as EnvironmentTag)
    : null;
}
