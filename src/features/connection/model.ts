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
  /**
   * #1649 (ADR 0058) — the uniform TLS posture for every engine. Replaces the
   * `(tlsEnabled, trustServerCertificate)` boolean pair: the backend stores
   * this enum and folds any legacy pair on read, so the frontend never sees
   * the booleans again.
   *
   * Optional for the same reason `walletPassword` is — the backend always emits
   * it, but the many connection fixtures need not carry it. Read it through
   * `draftSslMode` so the absent case resolves to the driver default rather
   * than being handled ad hoc at each call site.
   */
  sslMode?: SslMode;
  /**
   * #1649 (ADR 0058) — filesystem path to the CA certificate that `verify-ca`
   * trusts in addition to the built-in public roots. A path reference only,
   * stripped from exports. Required whenever `sslMode` is `verify-ca` — the
   * backend rejects the combination without it.
   */
  caCertPath?: string | null;

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
export interface ConnectionDraft
  extends Omit<ConnectionConfig, "hasPassword" | "hasWalletPassword"> {
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
 * Membership gate for carrying the TLS posture across a `dbType` switch
 * (`applyDbTypeChange`). Members: `mssql`, `mongodb`, `redis`, `valkey`,
 * `elasticsearch`, `opensearch` — the engines whose form renders a plain
 * on/off encryption toggle rather than the sslmode dropdown.
 *
 * `mssql` is a member but its behavior never depends on the membership: the
 * consumer special-cases `dbType === "mssql"` first (encrypt-by-default seed),
 * so that branch wins before `exposesTlsToggle` is ever consulted.
 *
 * `postgresql` renders a TLS control (#1526) but is deliberately kept OUT,
 * along with the no-TLS-control types (mysql/mariadb/oracle/sqlite/duckdb):
 * a posture must not be carried onto — or persisted for — those drafts, so the
 * switch resets them to `prefer`.
 *
 * #1649 note: the pre-#1649 rationale for this split was the
 * `tls_enabled=true, trust=None` combination that the backend hard-rejected
 * (#1062). `SslMode` makes that combination unrepresentable, so what survives
 * here is only the "don't leak a skip-verify posture onto the new engine" rule.
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
 * #1649 (ADR 0058) — the TLS posture vocabulary, mirroring the PostgreSQL
 * `sslmode` values. Since #1649 this is the **persisted** field on every
 * engine, not a derived view over a boolean pair:
 *
 * | mode          | encrypts                       | verifies cert | needs CA      |
 * |---------------|--------------------------------|---------------|---------------|
 * | `disable`     | never                          | —             | no            |
 * | `prefer`      | opportunistic (driver default) | no            | no            |
 * | `require`     | always                         | no            | no            |
 * | `verify-ca`   | always                         | yes           | yes (`caCertPath`) |
 * | `verify-full` | always                         | yes           | no (public roots) |
 */
export type SslMode =
  | "disable"
  | "prefer"
  | "require"
  | "verify-ca"
  | "verify-full";

/**
 * The postures the dropdown offers. `verify-ca` is deliberately absent: it is
 * only usable with a CA file, and the file picker (plus its validation) is the
 * follow-up slice of #1649. Selecting it today would produce a draft the user
 * cannot complete, since the backend rejects `verify-ca` with no `caCertPath`.
 * A connection already stored as `verify-ca` still renders — see
 * `sslModeChoices`.
 */
/** Every representable posture, in ladder order. The runtime counterpart of
 *  the `SslMode` union — used to narrow untrusted wire values. */
export const SSL_MODES: readonly SslMode[] = [
  "disable",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
];

export const SSL_MODE_OPTIONS: readonly SslMode[] = [
  "disable",
  "prefer",
  "require",
  "verify-full",
];

/** Whether the posture negotiates TLS at all. Mirrors `SslMode::tls_on`. */
export function sslModeTlsOn(mode: SslMode | undefined): boolean {
  return mode !== undefined && mode !== "disable" && mode !== "prefer";
}

/** The posture a draft/connection is in, defaulting an absent field to the
 *  driver default. The single place the optional-field fallback lives. */
export function draftSslMode(
  source: Pick<ConnectionConfig, "sslMode">,
): SslMode {
  return source.sslMode ?? "prefer";
}

/**
 * The options a dropdown must render for `current` — `SSL_MODE_OPTIONS` plus
 * `current` itself when it is not offered. Without this a connection stored as
 * `verify-ca` would render with an empty select and a save would silently
 * rewrite its posture.
 */
export function sslModeChoices(current: SslMode): readonly SslMode[] {
  return SSL_MODE_OPTIONS.includes(current)
    ? SSL_MODE_OPTIONS
    : [...SSL_MODE_OPTIONS, current];
}

/** True for the engines that render the sslmode dropdown (pg/mysql/mariadb). */
export function usesSslModeSelect(dbType: DatabaseType): boolean {
  return dbType === "postgresql" || dbType === "mysql" || dbType === "mariadb";
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
    // #1649 — the driver default. Every engine's form seeds its own posture
    // from here; `prefer` is the pre-#1062 behavior for a brand-new draft.
    sslMode: "prefer",
    walletPassword: "",
  };
}

/**
 * Resolve the `sslMode` the edit form should start from.
 *
 * MSSQL keeps its encrypt-by-default UX: a connection that never chose a
 * posture (`prefer`) opens with encryption on. Every other engine carries the
 * stored posture verbatim.
 *
 * #1649 — the pre-#1649 version of this function also *healed* the invalid
 * `tls_enabled=true, trust=None` residue that the backend rejected (#1062).
 * `SslMode` makes that state unrepresentable and the backend folds any stored
 * legacy pair on read, so the healing branch is gone rather than ported.
 */
function resolveDraftSslMode(conn: ConnectionConfig): SslMode {
  const stored = draftSslMode(conn);
  if (conn.dbType === "mssql" && stored === "prefer") return "verify-full";
  return stored;
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
    sslMode: resolveDraftSslMode(conn),
    caCertPath: conn.caCertPath,
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
  fields: Partial<Pick<ConnectionDraft, "sslMode" | "caCertPath">>;
  /** Raw `key=value` of a TLS parameter that could not be reflected onto the
   *  form (e.g. `sslmode=verify-ca`), or `null` when nothing was dropped. */
  unreflected: string | null;
}

/**
 * #1063 — resolve a pasted URL's TLS parameter onto the draft's `sslMode`.
 * `prefer`/`preferred` is treated as "unset" (same posture as no parameter) so
 * it is neither applied nor flagged. Values the form cannot complete leave the
 * field untouched and are surfaced via `unreflected` so the paste handler can
 * warn.
 *
 * #1649 — `verify-ca` is now a representable posture, but it is deliberately
 * still reported as unreflected: it is unusable without a CA file, and the CA
 * file picker is the follow-up slice. Reflecting it would seed a draft the user
 * cannot complete and whose save the backend rejects. It becomes reflectable in
 * the same change that adds the picker.
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
        return { fields: { sslMode: "disable" }, unreflected: null };
      case "prefer":
      case "preferred":
        return { fields: {}, unreflected: null };
      case "require":
      case "required":
        return { fields: { sslMode: "require" }, unreflected: null };
      case "verify-full":
      case "verify_full":
      case "verify-identity":
      case "verify_identity":
        return { fields: { sslMode: "verify-full" }, unreflected: null };
      default:
        // verify-ca (no CA picker yet), allow, and any unknown value.
        return { fields: {}, unreflected: `${key}=${rawValue}` };
    }
  }
  // Boolean tls/ssl engines (mongo/redis/valkey/search).
  const found = findParamCaseInsensitive(searchParams, TLS_BOOL_PARAM_KEYS);
  if (!found) return { fields: {}, unreflected: null };
  const [key, rawValue] = found;
  const value = rawValue.toLowerCase();
  if (["true", "1", "yes"].includes(value)) {
    return { fields: { sslMode: "verify-full" }, unreflected: null };
  }
  if (["false", "0", "no"].includes(value)) {
    return { fields: { sslMode: "prefer" }, unreflected: null };
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
    const sqlServerTrust = sqlServerBooleanParam(
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
      ...(parsed.protocol === "rediss:"
        ? { sslMode: "verify-full" as SslMode }
        : {}),
      ...(dbType === "mssql"
        ? { sslMode: sqlServerSslMode(sqlServerEncrypt, sqlServerTrust) }
        : {}),
      paradigm: paradigmOf(dbType),
    };
  } catch {
    // Input is not a parseable URL — caller will try other connection-string forms.
    return null;
  }
}

/**
 * #1649 — fold SQL Server's own `encrypt` / `trustServerCertificate` URL params
 * onto the uniform posture, matching `SslMode::from_legacy` cell for cell so a
 * pasted URL and a migrated stored row land on the same posture.
 *
 * `encrypt=false` with `trustServerCertificate=true` is the contradictory pair:
 * a common legacy SQL Server connection string that the pre-#1649 backend
 * refused to connect at all ("SQL Server trustServerCertificate requires
 * TLS/encryption"). It folds to `require` — encrypt, and honor the trust
 * decision the string does state — because the alternative reading (`prefer`)
 * turns a refusal into a silent plaintext connection, and on SQL Server into
 * `EncryptionLevel::NotSupported`, i.e. forced plaintext with no notice.
 */
function sqlServerSslMode(encrypt: boolean, trust: boolean): SslMode {
  if (!encrypt) return trust ? "require" : "disable";
  return trust ? "require" : "verify-full";
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
