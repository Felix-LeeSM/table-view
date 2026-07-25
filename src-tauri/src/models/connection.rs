use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    #[default]
    Postgresql,
    Mysql,
    Mariadb,
    Sqlite,
    Duckdb,
    Mssql,
    Oracle,
    Mongodb,
    Redis,
    Valkey,
    Elasticsearch,
    Opensearch,
}

impl DatabaseType {
    /// Paradigm tag exposed to the frontend. Sprint 65 promotes this from the
    /// previous `&'static str` return type to a typed `Paradigm` enum so the
    /// wire format is a validated discriminated tag rather than a free-form
    /// string.
    pub fn paradigm(&self) -> Paradigm {
        match self {
            DatabaseType::Postgresql
            | DatabaseType::Mysql
            | DatabaseType::Mariadb
            | DatabaseType::Sqlite
            | DatabaseType::Duckdb
            | DatabaseType::Mssql
            | DatabaseType::Oracle => Paradigm::Rdb,
            DatabaseType::Mongodb => Paradigm::Document,
            DatabaseType::Redis | DatabaseType::Valkey => Paradigm::Kv,
            DatabaseType::Elasticsearch | DatabaseType::Opensearch => Paradigm::Search,
        }
    }
}

impl FromStr for DatabaseType {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "postgresql" => Ok(DatabaseType::Postgresql),
            "mysql" => Ok(DatabaseType::Mysql),
            "mariadb" => Ok(DatabaseType::Mariadb),
            "sqlite" => Ok(DatabaseType::Sqlite),
            "duckdb" => Ok(DatabaseType::Duckdb),
            "mssql" | "sqlserver" | "sqlsrv" => Ok(DatabaseType::Mssql),
            "oracle" => Ok(DatabaseType::Oracle),
            "mongodb" => Ok(DatabaseType::Mongodb),
            "redis" => Ok(DatabaseType::Redis),
            "valkey" => Ok(DatabaseType::Valkey),
            "elasticsearch" | "elastic" | "es" => Ok(DatabaseType::Elasticsearch),
            "opensearch" | "os" => Ok(DatabaseType::Opensearch),
            _ => Err(()),
        }
    }
}

/// Database paradigm tag. Serialized lowercase (`"rdb"`, `"document"`,
/// `"search"`, `"kv"`) to match the frontend `Paradigm` string-literal union.
///
/// Sprint 65 promotes this from a bare `String` on `ConnectionConfigPublic` to
/// a typed enum so that wire payloads can no longer carry an arbitrary empty
/// string via `#[serde(default)]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Paradigm {
    Rdb,
    Document,
    Search,
    Kv,
}

/// #1649 (ADR 0058) — the uniform, all-engine TLS posture vocabulary. Promotes
/// the ADR 0053 `(tls_enabled, trust_server_certificate)` boolean pair — which
/// was the persisted SOT on pg/mysql and the plain on/off toggle on the 1-stage
/// engines — into a single `sslmode` enum stored on every engine. The five
/// variants mirror the PostgreSQL `sslmode` vocabulary so a pasted `?sslmode=`
/// value maps one-to-one:
///
/// | variant      | wire (`kebab`) | tls_on | skip_verify | needs CA |
/// |--------------|----------------|--------|-------------|----------|
/// | `Disable`    | `disable`      | no     | —           | no       |
/// | `Prefer`     | `prefer`       | opportunistic (driver default) | no |
/// | `Require`    | `require`      | yes    | yes         | no       |
/// | `VerifyCa`   | `verify-ca`    | yes    | no          | yes (`ca_cert_path`) |
/// | `VerifyFull` | `verify-full`  | yes    | no          | no (public roots)   |
///
/// `VerifyCa` (#1649) is the new advanced-depth posture: it adds a user-supplied
/// private/self-signed CA (`ca_cert_path`) to the trust anchors so a server no
/// public CA signs can still be authenticated, closing the MITM-substitution gap
/// that `Require` (skip-verify) leaves open. It is an **addition**, not a
/// restriction: sqlx 0.8.6 seeds the root store with the bundled Mozilla roots
/// and then adds the user's PEM
/// (`sqlx-core-0.8.6/src/net/tls/tls_rustls.rs:141` + `:153`), and exposes no way
/// to swap the store out, so `verify-ca` trusts *more* certificates than
/// `VerifyFull`, never fewer. Both postures verify the hostname: the adapters
/// deliberately map `VerifyCa` onto the drivers' `VerifyFull`/`VerifyIdentity`
/// rather than their `VerifyCa`, which would drop the hostname binding without
/// narrowing the anchor set (see `db::tls` module docs).
///
/// It is the one variant with a companion requirement: `ca_cert_path` must be
/// set, enforced at the write boundary (`save_connection`) and again at connect
/// (`db::tls::resolve_tls_decision`). libpq is one-to-one here too — it rejects
/// `sslmode=verify-ca` without a root certificate rather than silently treating
/// it as the built-in-public-roots posture (`verify-full`) the user did not
/// pick.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SslMode {
    /// Force plaintext — never negotiate TLS (`sslmode=disable`).
    Disable,
    /// Driver default — opportunistic encryption (`sslmode=prefer`). The
    /// pre-#1062 posture for legacy connections that set no TLS fields.
    #[default]
    Prefer,
    /// Force encryption, skip certificate verification (`sslmode=require`).
    /// MITM-exposed: encrypts but does not authenticate the server.
    Require,
    /// Force encryption + full chain **and hostname** verification, with the CA
    /// in `ca_cert_path` (`sslmode=verify-ca`, **required** for this posture)
    /// trusted in addition to the built-in public roots.
    VerifyCa,
    /// Force encryption + full chain + hostname verification against the
    /// built-in public roots only (`sslmode=verify-full`).
    VerifyFull,
}

impl SslMode {
    /// Whether the adapter should negotiate TLS at all. Used by the on/off
    /// engines (mongo/redis/valkey/search) and MSSQL that only need an
    /// encrypt-or-not decision, not the full sslmode ladder.
    pub fn tls_on(self) -> bool {
        !matches!(self, SslMode::Disable | SslMode::Prefer)
    }

    /// Whether certificate verification is skipped (the MITM-exposed
    /// `require`/skip-verify posture). Only `Require` skips verification;
    /// `VerifyCa`/`VerifyFull` authenticate the server.
    pub fn skip_verify(self) -> bool {
        matches!(self, SslMode::Require)
    }

    /// Migrate the legacy `(tls_enabled, trust_server_certificate)` pair
    /// (ADR 0053) into an `SslMode`. Preserves the exact
    /// `resolve_tls_decision` semantics for the pg/mysql path and applies the
    /// ADR 0053 derived rule for the on/off engines (`tls=true, trust=None`
    /// reinterprets as verify-full — the current effective behavior, zero
    /// downgrade). Used only at the deserialize + snapshot-reconstruct
    /// boundaries; there is no dual-write (1-stage migration).
    pub fn from_legacy(tls_enabled: Option<bool>, trust: Option<bool>) -> Self {
        match (tls_enabled.unwrap_or(false), trust) {
            (true, Some(true)) => SslMode::Require,
            (true, Some(false)) => SslMode::VerifyFull,
            // ADR 0053 derived rule: on/off engines stored `tls=true, trust=None`
            // and connected with verification — reinterpret as verify-full.
            (true, None) => SslMode::VerifyFull,
            // Explicit forced-plaintext marker (#1063).
            (false, Some(false)) => SslMode::Disable,
            // Unset, or the nonsensical trust-without-tls combo (never authored
            // by real data) — driver default.
            (false, _) => SslMode::Prefer,
        }
    }

    /// Inverse of [`SslMode::from_legacy`] onto the legacy boolean pair. Used to
    /// write the SQLite snapshot mirror's `tls_enabled`/`trust_server_certificate`
    /// integer columns without a schema change (the mirror is a lossy snapshot,
    /// not the SOT; `VerifyCa` reconstructs as `VerifyFull` there and the
    /// `ca_cert_path` is restored from the file SOT, mirroring how the mirror
    /// already drops `wallet_path`/`oracle_use_sid`).
    pub fn to_legacy(self) -> (Option<bool>, Option<bool>) {
        match self {
            SslMode::Prefer => (None, None),
            SslMode::Disable => (Some(false), Some(false)),
            SslMode::Require => (Some(true), Some(true)),
            SslMode::VerifyCa | SslMode::VerifyFull => (Some(true), Some(false)),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(from = "ConnectionConfigDe")]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    /// SQLite-only: open the user-managed database file without write access.
    #[serde(default)]
    pub read_only: bool,
    pub group_id: Option<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub connection_timeout: Option<u32>,
    #[serde(default)]
    pub keep_alive_interval: Option<u32>,
    #[serde(default)]
    pub environment: Option<String>,
    // ── Source-specific optional fields. ─────────────────────────────────
    // Fields are `#[serde(default)]` so existing persisted JSON
    // (which lacks these keys entirely) still deserializes unchanged.
    /// MongoDB authentication database (`authSource`). Ignored by non-mongo
    /// adapters.
    #[serde(default)]
    pub auth_source: Option<String>,
    /// MongoDB replica set name. Ignored by non-mongo adapters.
    #[serde(default)]
    pub replica_set: Option<String>,
    /// #1649 (ADR 0058) — the uniform all-engine TLS posture. Replaces the
    /// legacy `(tls_enabled, trust_server_certificate)` boolean pair; legacy
    /// persisted JSON migrates through [`ConnectionConfigDe`] (1-stage, no
    /// dual-write). `#[serde(default)]` yields `Prefer` for any payload lacking
    /// the key.
    #[serde(default)]
    pub ssl_mode: SslMode,
    /// #1649 (ADR 0058) — filesystem path to the CA certificate (PEM) that
    /// `SslMode::VerifyCa` trusts *in addition to* the driver's built-in public
    /// roots. A path *reference* only — never the certificate contents (ADR 0052
    /// file-credential precedent). Stripped from export envelopes like
    /// `wallet_path`. `None` for every non-verify-ca posture.
    #[serde(default)]
    pub ca_cert_path: Option<String>,
    /// Oracle-only (#1065): connect using a SID instead of a service name.
    /// `Some(true)` selects the driver's `Config::with_sid`; `None` /
    /// `Some(false)` use a service name. Ignored by non-Oracle adapters.
    #[serde(default)]
    pub oracle_use_sid: Option<bool>,
    /// Oracle-only (#1065): filesystem path to an Oracle wallet directory
    /// (containing `ewallet.pem`) enabling mTLS. A path *reference* only —
    /// never the wallet contents (ADR 0052 Q5 file-credential precedent).
    /// Stripped from export envelopes. Ignored by non-Oracle adapters.
    #[serde(default)]
    pub wallet_path: Option<String>,
    /// Oracle-only (#1065): wallet password that decrypts the wallet's
    /// encrypted private key. Encrypted at rest under the same keyring
    /// envelope as `password` (ADR 0040) and, like `password`, never crosses
    /// the IPC boundary in plaintext (ADR 0005). Empty means "none stored".
    #[serde(default)]
    pub wallet_password: String,
}

/// #1649 (ADR 0058) — deserialize shim that migrates the legacy
/// `(tls_enabled, trust_server_certificate)` boolean pair into `ssl_mode` in a
/// single stage. `ConnectionConfig` deserializes *through* this type
/// (`#[serde(from = ...)]`): a payload carrying an explicit `ssl_mode` uses it
/// verbatim; a legacy payload (booleans only, no `ssl_mode`) is folded via
/// [`SslMode::from_legacy`]. Serialization is one-way — `ConnectionConfig` only
/// ever writes `ssl_mode`/`ca_cert_path`, so the next save drops the legacy
/// keys (no dual-write). Every field mirrors `ConnectionConfig` with identical
/// serde attributes so the persisted shape round-trips unchanged.
#[derive(Deserialize)]
struct ConnectionConfigDe {
    id: String,
    name: String,
    db_type: DatabaseType,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
    #[serde(default)]
    read_only: bool,
    group_id: Option<String>,
    color: Option<String>,
    #[serde(default)]
    connection_timeout: Option<u32>,
    #[serde(default)]
    keep_alive_interval: Option<u32>,
    #[serde(default)]
    environment: Option<String>,
    #[serde(default)]
    auth_source: Option<String>,
    #[serde(default)]
    replica_set: Option<String>,
    /// New SOT posture. Absent for legacy payloads → folded from the pair below.
    #[serde(default)]
    ssl_mode: Option<SslMode>,
    #[serde(default)]
    ca_cert_path: Option<String>,
    /// Legacy (ADR 0053) — deserialized only to migrate; never re-serialized.
    #[serde(default)]
    tls_enabled: Option<bool>,
    #[serde(default)]
    trust_server_certificate: Option<bool>,
    #[serde(default)]
    oracle_use_sid: Option<bool>,
    #[serde(default)]
    wallet_path: Option<String>,
    #[serde(default)]
    wallet_password: String,
}

impl From<ConnectionConfigDe> for ConnectionConfig {
    fn from(de: ConnectionConfigDe) -> Self {
        let ssl_mode = de
            .ssl_mode
            .unwrap_or_else(|| SslMode::from_legacy(de.tls_enabled, de.trust_server_certificate));
        ConnectionConfig {
            id: de.id,
            name: de.name,
            db_type: de.db_type,
            host: de.host,
            port: de.port,
            user: de.user,
            password: de.password,
            database: de.database,
            read_only: de.read_only,
            group_id: de.group_id,
            color: de.color,
            connection_timeout: de.connection_timeout,
            keep_alive_interval: de.keep_alive_interval,
            environment: de.environment,
            auth_source: de.auth_source,
            replica_set: de.replica_set,
            ssl_mode,
            ca_cert_path: de.ca_cert_path,
            oracle_use_sid: de.oracle_use_sid,
            wallet_path: de.wallet_path,
            wallet_password: de.wallet_password,
        }
    }
}

/// P3-2 (#1455) — manual `Debug` so an accidental `{:?}` (log line, error
/// context, `#[derive(Debug)]` on an enclosing struct) never prints the
/// plaintext `password`. Every other field is rendered as-is; `password` and
/// `wallet_password` (#1065) are masked to a fixed `"***"` regardless of
/// length so the debug output leaks neither the value nor whether one is set.
/// The derived `Debug` printed both secrets verbatim.
impl std::fmt::Debug for ConnectionConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionConfig")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("db_type", &self.db_type)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user", &self.user)
            .field("password", &"***")
            .field("database", &self.database)
            .field("read_only", &self.read_only)
            .field("group_id", &self.group_id)
            .field("color", &self.color)
            .field("connection_timeout", &self.connection_timeout)
            .field("keep_alive_interval", &self.keep_alive_interval)
            .field("environment", &self.environment)
            .field("auth_source", &self.auth_source)
            .field("replica_set", &self.replica_set)
            .field("ssl_mode", &self.ssl_mode)
            .field("ca_cert_path", &self.ca_cert_path)
            .field("oracle_use_sid", &self.oracle_use_sid)
            .field("wallet_path", &self.wallet_path)
            .field("wallet_password", &"***")
            .finish()
    }
}

/// Public-facing connection shape returned to the frontend and exported to
/// JSON. Crucially this struct has **no password field** — the boolean
/// `hasPassword` is the only signal the UI gets about whether a password is
/// stored. The plaintext never leaves the backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "ConnectionConfigPublicDe")]
pub struct ConnectionConfigPublic {
    pub id: String,
    pub name: String,
    #[serde(alias = "db_type")]
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    #[serde(default, alias = "read_only")]
    pub read_only: bool,
    #[serde(alias = "group_id")]
    pub group_id: Option<String>,
    pub color: Option<String>,
    #[serde(default, alias = "connection_timeout")]
    pub connection_timeout: Option<u32>,
    #[serde(default, alias = "keep_alive_interval")]
    pub keep_alive_interval: Option<u32>,
    #[serde(default)]
    pub environment: Option<String>,
    /// Whether a password is stored on disk. Derived, never persisted.
    #[serde(default, alias = "has_password")]
    pub has_password: bool,
    /// Paradigm tag derived from `db_type`. Sprint 65 tightens this from the
    /// previous `String` + `#[serde(default)]` shape into a typed
    /// [`Paradigm`] enum; payloads lacking this field now fail to
    /// deserialize instead of silently defaulting to `""`. The frontend
    /// `Paradigm` string-literal union (`"rdb" | "document" | "search" |
    /// "kv"`) mirrors the lowercase serialization.
    pub paradigm: Paradigm,
    // ── Source-specific optional fields ──────────────────────────────────
    #[serde(default, alias = "auth_source")]
    pub auth_source: Option<String>,
    #[serde(default, alias = "replica_set")]
    pub replica_set: Option<String>,
    /// #1649 (ADR 0058) — the uniform all-engine TLS posture on the wire. A
    /// pre-#1649 payload (export envelope, hand-authored IPC call) carries the
    /// legacy boolean pair instead and folds through
    /// [`ConnectionConfigPublicDe`], so importing an old export keeps its
    /// posture rather than silently dropping to `prefer`.
    #[serde(default, alias = "ssl_mode")]
    pub ssl_mode: SslMode,
    /// #1649 (ADR 0058) — CA path for `verify-ca`. Stripped on export like
    /// `wallet_path`; the user re-selects it after import.
    #[serde(default, alias = "ca_cert_path")]
    pub ca_cert_path: Option<String>,
    #[serde(default, alias = "oracle_use_sid")]
    pub oracle_use_sid: Option<bool>,
    #[serde(default, alias = "wallet_path")]
    pub wallet_path: Option<String>,
    /// Whether a wallet password is stored on disk. Derived, never persisted —
    /// the plaintext wallet password never leaves the backend (#1065, ADR 0005).
    #[serde(default, alias = "has_wallet_password")]
    pub has_wallet_password: bool,
}

/// #1649 (ADR 0058) — deserialize shim for the public wire shape, mirroring
/// [`ConnectionConfigDe`]. `ConnectionConfigPublic` already keeps snake_case
/// aliases so older stored/exported payloads parse; this extends the same
/// promise to the TLS posture, folding the legacy
/// `(tlsEnabled, trustServerCertificate)` pair when `sslMode` is absent.
/// Without it a pre-#1649 export envelope would import as `prefer` — a silent
/// downgrade from a stored `require`/`verify-full`. Serialization is one-way:
/// `ConnectionConfigPublic` only ever writes `sslMode`/`caCertPath`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionConfigPublicDe {
    id: String,
    name: String,
    #[serde(alias = "db_type")]
    db_type: DatabaseType,
    host: String,
    port: u16,
    user: String,
    database: String,
    #[serde(default, alias = "read_only")]
    read_only: bool,
    #[serde(alias = "group_id")]
    group_id: Option<String>,
    color: Option<String>,
    #[serde(default, alias = "connection_timeout")]
    connection_timeout: Option<u32>,
    #[serde(default, alias = "keep_alive_interval")]
    keep_alive_interval: Option<u32>,
    #[serde(default)]
    environment: Option<String>,
    #[serde(default, alias = "has_password")]
    has_password: bool,
    paradigm: Paradigm,
    #[serde(default, alias = "auth_source")]
    auth_source: Option<String>,
    #[serde(default, alias = "replica_set")]
    replica_set: Option<String>,
    /// New SOT posture. Absent for legacy payloads → folded from the pair below.
    #[serde(default, alias = "ssl_mode")]
    ssl_mode: Option<SslMode>,
    #[serde(default, alias = "ca_cert_path")]
    ca_cert_path: Option<String>,
    /// Legacy (ADR 0053) — deserialized only to migrate; never re-serialized.
    #[serde(default, alias = "tls_enabled")]
    tls_enabled: Option<bool>,
    #[serde(default, alias = "trust_server_certificate")]
    trust_server_certificate: Option<bool>,
    #[serde(default, alias = "oracle_use_sid")]
    oracle_use_sid: Option<bool>,
    #[serde(default, alias = "wallet_path")]
    wallet_path: Option<String>,
    #[serde(default, alias = "has_wallet_password")]
    has_wallet_password: bool,
}

impl From<ConnectionConfigPublicDe> for ConnectionConfigPublic {
    fn from(de: ConnectionConfigPublicDe) -> Self {
        let ssl_mode = de
            .ssl_mode
            .unwrap_or_else(|| SslMode::from_legacy(de.tls_enabled, de.trust_server_certificate));
        ConnectionConfigPublic {
            id: de.id,
            name: de.name,
            db_type: de.db_type,
            host: de.host,
            port: de.port,
            user: de.user,
            database: de.database,
            read_only: de.read_only,
            group_id: de.group_id,
            color: de.color,
            connection_timeout: de.connection_timeout,
            keep_alive_interval: de.keep_alive_interval,
            environment: de.environment,
            has_password: de.has_password,
            paradigm: de.paradigm,
            auth_source: de.auth_source,
            replica_set: de.replica_set,
            ssl_mode,
            ca_cert_path: de.ca_cert_path,
            oracle_use_sid: de.oracle_use_sid,
            wallet_path: de.wallet_path,
            has_wallet_password: de.has_wallet_password,
        }
    }
}

impl From<&ConnectionConfig> for ConnectionConfigPublic {
    fn from(c: &ConnectionConfig) -> Self {
        Self {
            id: c.id.clone(),
            name: c.name.clone(),
            paradigm: c.db_type.paradigm(),
            db_type: c.db_type.clone(),
            host: c.host.clone(),
            port: c.port,
            user: c.user.clone(),
            database: c.database.clone(),
            read_only: c.read_only,
            group_id: c.group_id.clone(),
            color: c.color.clone(),
            connection_timeout: c.connection_timeout,
            keep_alive_interval: c.keep_alive_interval,
            environment: c.environment.clone(),
            has_password: !c.password.is_empty(),
            auth_source: c.auth_source.clone(),
            replica_set: c.replica_set.clone(),
            ssl_mode: c.ssl_mode,
            ca_cert_path: c.ca_cert_path.clone(),
            oracle_use_sid: c.oracle_use_sid,
            wallet_path: c.wallet_path.clone(),
            has_wallet_password: !c.wallet_password.is_empty(),
        }
    }
}

impl ConnectionConfigPublic {
    /// Promote a public config to a full ConnectionConfig with an empty
    /// password slot. Used by command handlers that accept this struct over
    /// IPC and then forward to the storage layer (which separately receives
    /// the optional new password).
    pub fn into_config_with_empty_password(self) -> ConnectionConfig {
        ConnectionConfig {
            id: self.id,
            name: self.name,
            db_type: self.db_type,
            host: self.host,
            port: self.port,
            user: self.user,
            password: String::new(),
            database: self.database,
            read_only: self.read_only,
            group_id: self.group_id,
            color: self.color,
            connection_timeout: self.connection_timeout,
            keep_alive_interval: self.keep_alive_interval,
            environment: self.environment,
            auth_source: self.auth_source,
            replica_set: self.replica_set,
            ssl_mode: self.ssl_mode,
            ca_cert_path: self.ca_cert_path,
            oracle_use_sid: self.oracle_use_sid,
            wallet_path: self.wallet_path,
            // Wallet password, like the DB password, never crosses IPC — the
            // storage layer separately receives the optional new value.
            wallet_password: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionGroup {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub collapsed: bool,
}

/// Internally-tagged enum for a clean discriminated union on the frontend.
///
/// Sprint 364 (Phase 3 Q14) — `Connecting` variant 추가 + `Connected` 가
/// struct variant 로 승격되어 `active_db: Option<String>` 을 운반한다.
/// `active_db` 는 PG `USE db` 결과 또는 connection string 의 `dbname` 으로,
/// `connect` IPC 가 pool 을 열 때 결정된다.
///
/// Serializes as:
/// - `{"type": "connecting"}` — connect IPC 진행 중 (pool acquire 전).
/// - `{"type": "connected"}` — pool ready, active_db 미지정.
/// - `{"type": "connected", "activeDb": "foo"}` — pool ready, active_db 지정.
/// - `{"type": "disconnected"}`
/// - `{"type": "error", "message": "..."}`
///
/// `active_db: None` 일 때 wire 에 `activeDb: null` 이 나타나지 않도록
/// `skip_serializing_if = "Option::is_none"` 로 필드를 omit (codex 3차 #6).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum ConnectionStatus {
    Connecting,
    Connected {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        active_db: Option<String>,
    },
    #[default]
    Disconnected,
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageData {
    pub connections: Vec<ConnectionConfig>,
    pub groups: Vec<ConnectionGroup>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// P3-2 (#1455) — `{:?}` on a `ConnectionConfig` must never leak the
    /// plaintext password. Low-entropy fake password keeps the no-secrets gate
    /// quiet while still proving the mask fires.
    #[test]
    fn debug_masks_password() {
        let conn = ConnectionConfig {
            id: "c1".into(),
            name: "DB".into(),
            db_type: DatabaseType::Postgresql,
            host: "h".into(),
            port: 5432,
            user: "u".into(),
            password: "pass@789ZZ".into(),
            database: "d".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::Prefer,
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        };
        let debug = format!("{conn:?}");
        assert!(
            !debug.contains("pass@789ZZ"),
            "debug output leaked the password: {debug}"
        );
        assert!(
            debug.contains("password: \"***\""),
            "debug output missing the password mask: {debug}"
        );
        // The rest of the struct still renders so debug stays useful.
        assert!(debug.contains("host: \"h\""));
    }

    /// #1065 — the crate's `Config`/`TlsConfig` derive Debug prints wallet
    /// passwords verbatim (threat model §2.5); our manual `Debug` must mask
    /// `wallet_password` the same way it masks `password` so an accidental
    /// `{:?}` on our `ConnectionConfig` never leaks it.
    #[test]
    fn debug_masks_wallet_password() {
        let conn = ConnectionConfig {
            id: "c1".into(),
            name: "Oracle".into(),
            db_type: DatabaseType::Oracle,
            host: "h".into(),
            port: 1521,
            user: "u".into(),
            password: String::new(),
            database: "XEPDB1".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::Prefer,
            ca_cert_path: None,
            oracle_use_sid: Some(true),
            wallet_path: Some("/home/u/wallet".into()),
            wallet_password: "wpass@42XY".into(),
        };
        let debug = format!("{conn:?}");
        assert!(
            !debug.contains("wpass@42XY"),
            "debug leaked the wallet password: {debug}"
        );
        assert!(
            debug.contains("wallet_password: \"***\""),
            "debug missing the wallet-password mask: {debug}"
        );
        // Non-secret Oracle fields still render.
        assert!(debug.contains("wallet_path: Some(\"/home/u/wallet\")"));
        assert!(debug.contains("oracle_use_sid: Some(true)"));
    }

    /// #1065 — the public/exported shape derives `has_wallet_password` from
    /// presence and carries the non-secret `oracle_use_sid` / `wallet_path`,
    /// but never a wallet-password value.
    #[test]
    fn public_derives_wallet_flags_without_leaking_secret() {
        let mut conn = ConnectionConfig {
            id: "c1".into(),
            name: "Oracle".into(),
            db_type: DatabaseType::Oracle,
            host: "h".into(),
            port: 1521,
            user: "u".into(),
            password: String::new(),
            database: "XEPDB1".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::Prefer,
            ca_cert_path: None,
            oracle_use_sid: Some(true),
            wallet_path: Some("/home/u/wallet".into()),
            wallet_password: "wpass@42XY".into(),
        };
        let public = ConnectionConfigPublic::from(&conn);
        assert!(public.has_wallet_password);
        assert_eq!(public.oracle_use_sid, Some(true));
        assert_eq!(public.wallet_path.as_deref(), Some("/home/u/wallet"));

        let json = serde_json::to_string(&public).unwrap();
        assert!(
            !json.contains("wpass@42XY") && !json.contains("walletPassword"),
            "public payload leaked the wallet password: {json}"
        );
        assert!(json.contains("\"hasWalletPassword\":true"));
        assert!(json.contains("\"oracleUseSid\":true"));

        conn.wallet_password = String::new();
        assert!(!ConnectionConfigPublic::from(&conn).has_wallet_password);
    }

    #[test]
    fn database_type_serializes_to_lowercase() {
        let json = serde_json::to_string(&DatabaseType::Postgresql).unwrap();
        assert_eq!(json, "\"postgresql\"");
        let json = serde_json::to_string(&DatabaseType::Mysql).unwrap();
        assert_eq!(json, "\"mysql\"");
        let json = serde_json::to_string(&DatabaseType::Mariadb).unwrap();
        assert_eq!(json, "\"mariadb\"");
        let json = serde_json::to_string(&DatabaseType::Duckdb).unwrap();
        assert_eq!(json, "\"duckdb\"");
        let json = serde_json::to_string(&DatabaseType::Mssql).unwrap();
        assert_eq!(json, "\"mssql\"");
        let json = serde_json::to_string(&DatabaseType::Oracle).unwrap();
        assert_eq!(json, "\"oracle\"");
        let json = serde_json::to_string(&DatabaseType::Valkey).unwrap();
        assert_eq!(json, "\"valkey\"");
    }

    #[test]
    fn database_type_paradigm_maps_expected_tags() {
        assert_eq!(DatabaseType::Postgresql.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Mysql.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Mariadb.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Sqlite.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Duckdb.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Mssql.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Oracle.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Mongodb.paradigm(), Paradigm::Document);
        assert_eq!(DatabaseType::Redis.paradigm(), Paradigm::Kv);
        assert_eq!(DatabaseType::Valkey.paradigm(), Paradigm::Kv);
        // Reason: search-paradigm variants were the 2/12 gap in this map
        // (2026-07-17).
        assert_eq!(DatabaseType::Elasticsearch.paradigm(), Paradigm::Search);
        assert_eq!(DatabaseType::Opensearch.paradigm(), Paradigm::Search);
    }

    #[test]
    fn paradigm_serializes_to_expected_lowercase_tags() {
        assert_eq!(serde_json::to_string(&Paradigm::Rdb).unwrap(), "\"rdb\"");
        assert_eq!(
            serde_json::to_string(&Paradigm::Document).unwrap(),
            "\"document\""
        );
        assert_eq!(
            serde_json::to_string(&Paradigm::Search).unwrap(),
            "\"search\""
        );
        assert_eq!(serde_json::to_string(&Paradigm::Kv).unwrap(), "\"kv\"");
    }

    #[test]
    fn connection_config_public_serializes_paradigm_for_postgres() {
        let conn = ConnectionConfig {
            id: "c1".into(),
            name: "DB".into(),
            db_type: DatabaseType::Postgresql,
            host: "h".into(),
            port: 5432,
            user: "u".into(),
            password: "p".into(),
            database: "d".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::Prefer,
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        };
        let public = ConnectionConfigPublic::from(&conn);
        assert_eq!(public.paradigm, Paradigm::Rdb);

        let json = serde_json::to_string(&public).unwrap();
        assert!(
            json.contains("\"paradigm\":\"rdb\""),
            "paradigm tag missing from payload: {}",
            json
        );
        assert!(
            json.contains("\"dbType\":\"postgresql\""),
            "db_type must serialize as dbType: {}",
            json
        );
        assert!(
            json.contains("\"hasPassword\":true"),
            "has_password must serialize as hasPassword: {}",
            json
        );
        assert!(
            !json.contains("db_type") && !json.contains("has_password"),
            "public connection wire shape must not expose snake_case keys: {}",
            json
        );
    }

    #[test]
    fn connection_config_public_serializes_paradigm_for_mongodb() {
        let conn = ConnectionConfig {
            id: "c1".into(),
            name: "DB".into(),
            db_type: DatabaseType::Mongodb,
            host: "h".into(),
            port: 27017,
            user: "u".into(),
            password: String::new(),
            database: "d".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: Some("admin".into()),
            replica_set: Some("rs0".into()),
            ssl_mode: SslMode::VerifyFull,
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        };
        let public = ConnectionConfigPublic::from(&conn);
        assert_eq!(public.paradigm, Paradigm::Document);

        let json = serde_json::to_string(&public).unwrap();
        assert!(
            json.contains("\"paradigm\":\"document\""),
            "paradigm tag missing from payload: {}",
            json
        );
        assert!(
            json.contains("\"authSource\":\"admin\""),
            "authSource missing from payload: {}",
            json
        );
        assert!(
            json.contains("\"replicaSet\":\"rs0\""),
            "replicaSet missing from payload: {}",
            json
        );
        assert!(
            json.contains("\"sslMode\":\"verify-full\""),
            "sslMode missing from payload: {}",
            json
        );
        assert!(
            !json.contains("auth_source")
                && !json.contains("replica_set")
                && !json.contains("ssl_mode"),
            "public connection wire shape must not expose snake_case keys: {}",
            json
        );
    }

    #[test]
    fn connection_config_public_deserializes_snake_case_payload() {
        // Reason: the public wire shape keeps snake_case aliases for backward
        // compatibility with older stored/exported payloads; #1649 folds the
        // TLS posture into `ssl_mode`/`ca_cert_path`. (2026-07-25)
        let json = r#"{
            "id": "c1",
            "name": "DB",
            "db_type": "mongodb",
            "host": "localhost",
            "port": 27017,
            "user": "u",
            "database": "admin",
            "group_id": "g1",
            "color": null,
            "connection_timeout": 30,
            "keep_alive_interval": 60,
            "environment": "production",
            "has_password": true,
            "paradigm": "document",
            "auth_source": "admin",
            "replica_set": "rs0",
            "ssl_mode": "require"
        }"#;

        let public: ConnectionConfigPublic = serde_json::from_str(json).unwrap();

        assert!(matches!(public.db_type, DatabaseType::Mongodb));
        assert_eq!(public.group_id.as_deref(), Some("g1"));
        assert_eq!(public.connection_timeout, Some(30));
        assert_eq!(public.keep_alive_interval, Some(60));
        assert!(public.has_password);
        assert_eq!(public.auth_source.as_deref(), Some("admin"));
        assert_eq!(public.replica_set.as_deref(), Some("rs0"));
        assert_eq!(public.ssl_mode, SslMode::Require);
        assert_eq!(public.ca_cert_path, None);
    }

    #[test]
    fn connection_config_public_deserializes_ssl_mode_wire_keys() {
        // Reason: #1649 — the public shape accepts both camelCase (`sslMode`,
        // `caCertPath`) and snake_case (`ssl_mode`, `ca_cert_path`) so IPC and
        // legacy exports both parse. (2026-07-25)
        let camel = r#"{
            "id": "c1",
            "name": "PG",
            "dbType": "postgresql",
            "host": "localhost",
            "port": 5432,
            "user": "u",
            "database": "d",
            "groupId": null,
            "color": null,
            "paradigm": "rdb",
            "sslMode": "verify-ca",
            "caCertPath": "/etc/ssl/ca.pem"
        }"#;
        let public: ConnectionConfigPublic = serde_json::from_str(camel).unwrap();
        assert_eq!(public.ssl_mode, SslMode::VerifyCa);
        assert_eq!(public.ca_cert_path.as_deref(), Some("/etc/ssl/ca.pem"));

        let snake = r#"{
            "id": "c1",
            "name": "PG",
            "db_type": "postgresql",
            "host": "localhost",
            "port": 5432,
            "user": "u",
            "database": "d",
            "group_id": null,
            "color": null,
            "paradigm": "rdb",
            "ssl_mode": "disable"
        }"#;
        let public: ConnectionConfigPublic = serde_json::from_str(snake).unwrap();
        assert_eq!(public.ssl_mode, SslMode::Disable);
    }

    #[test]
    fn connection_config_public_rejects_payload_without_paradigm_field() {
        // Sprint 65 tightens this: a payload lacking `paradigm` must no
        // longer silently default to an empty string. (Sprint 64 allowed it
        // via `#[serde(default)]`; the ability to round-trip old clients
        // without a paradigm tag is now removed by design.)
        let json = r#"{
            "id": "c1",
            "name": "DB",
            "dbType": "postgresql",
            "host": "h",
            "port": 5432,
            "user": "u",
            "database": "d",
            "groupId": null,
            "color": null
        }"#;
        let result: Result<ConnectionConfigPublic, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "expected missing paradigm field to fail deserialization"
        );
    }

    #[test]
    fn connection_status_serializes_as_discriminated_union() {
        // Sprint 364 (2026-05-16) — `Connected { active_db: None }` 평면
        // 직렬화 + `Error { message: ... }` struct variant 평면 직렬화
        // 회귀 가드. 4-case 전체 wire shape 는 `tests/connection_status_serde.rs`.
        let connected = ConnectionStatus::Connected { active_db: None };
        let json = serde_json::to_string(&connected).unwrap();
        assert_eq!(json, "{\"type\":\"connected\"}");

        let disconnected = ConnectionStatus::Disconnected;
        let json = serde_json::to_string(&disconnected).unwrap();
        assert_eq!(json, "{\"type\":\"disconnected\"}");

        let error = ConnectionStatus::Error {
            message: "timeout".into(),
        };
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(json, "{\"type\":\"error\",\"message\":\"timeout\"}");
    }

    #[test]
    fn connection_status_deserializes_from_discriminated_union() {
        let status: ConnectionStatus = serde_json::from_str("{\"type\":\"connected\"}").unwrap();
        match status {
            ConnectionStatus::Connected { active_db } => assert!(active_db.is_none()),
            other => panic!("Expected Connected variant, got {:?}", other),
        }

        let status: ConnectionStatus =
            serde_json::from_str("{\"type\":\"error\",\"message\":\"lost\"}").unwrap();
        match status {
            ConnectionStatus::Error { message } => assert_eq!(message, "lost"),
            _ => panic!("Expected Error variant"),
        }
    }

    #[test]
    fn connection_config_optional_fields_default_to_none() {
        // Simulates data saved before timeout/keep_alive/environment were added
        // — and, from Sprint 65, before auth_source/replica_set/tls_enabled.
        let json = r#"{
            "id": "test",
            "name": "test",
            "db_type": "postgresql",
            "host": "localhost",
            "port": 5432,
            "user": "postgres",
            "password": "",
            "database": "test",
            "group_id": null,
            "color": null
        }"#;
        let config: ConnectionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.connection_timeout, None);
        assert_eq!(config.keep_alive_interval, None);
        assert_eq!(config.environment, None);
        // Sprint 65 additions remain None for legacy payloads.
        assert_eq!(config.auth_source, None);
        assert_eq!(config.replica_set, None);
        // #1649 — a payload with no TLS keys migrates to the driver-default
        // `prefer` posture with no CA path.
        assert_eq!(config.ssl_mode, SslMode::Prefer);
        assert_eq!(config.ca_cert_path, None);
    }

    #[test]
    fn connection_config_preserves_mongo_fields_across_roundtrip() {
        let config = ConnectionConfig {
            id: "mongo-1".into(),
            name: "Mongo".into(),
            db_type: DatabaseType::Mongodb,
            host: "localhost".into(),
            port: 27017,
            user: "u".into(),
            password: "p".into(),
            database: "d".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: Some("admin".into()),
            replica_set: Some("rs0".into()),
            ssl_mode: SslMode::VerifyFull,
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: ConnectionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.auth_source.as_deref(), Some("admin"));
        assert_eq!(deserialized.replica_set.as_deref(), Some("rs0"));
        assert_eq!(deserialized.ssl_mode, SslMode::VerifyFull);
    }

    #[test]
    fn test_database_type_from_str_aliases_and_unknown() {
        // Reason: FromStr is hand-written branching (dialect aliases +
        // unknown → Err), separate from the serde derive that
        // `serializes_to_lowercase` covers; P4 error-branch gap. (2026-07-17)
        use std::str::FromStr;
        assert!(matches!(
            DatabaseType::from_str("sqlserver"),
            Ok(DatabaseType::Mssql)
        ));
        assert!(matches!(
            DatabaseType::from_str("sqlsrv"),
            Ok(DatabaseType::Mssql)
        ));
        assert!(matches!(
            DatabaseType::from_str("es"),
            Ok(DatabaseType::Elasticsearch)
        ));
        assert!(matches!(
            DatabaseType::from_str("elastic"),
            Ok(DatabaseType::Elasticsearch)
        ));
        assert!(matches!(
            DatabaseType::from_str("os"),
            Ok(DatabaseType::Opensearch)
        ));
        assert!(DatabaseType::from_str("not-a-db").is_err());
    }

    #[test]
    fn test_into_config_with_empty_password_clears_password_and_preserves_fields() {
        // Reason: promoting a public config to a full ConnectionConfig must
        // leave an empty password slot so a stale secret can never leak
        // through the IPC boundary, while every other field survives
        // (2026-07-17).
        let public = ConnectionConfigPublic {
            id: "c1".into(),
            name: "DB".into(),
            db_type: DatabaseType::Mongodb,
            host: "h".into(),
            port: 27017,
            user: "u".into(),
            database: "d".into(),
            read_only: true,
            group_id: Some("g1".into()),
            color: Some("#fff".into()),
            connection_timeout: Some(30),
            keep_alive_interval: Some(60),
            environment: Some("prod".into()),
            has_password: true,
            paradigm: Paradigm::Document,
            auth_source: Some("admin".into()),
            replica_set: Some("rs0".into()),
            ssl_mode: SslMode::VerifyCa,
            ca_cert_path: Some("/etc/ssl/ca.pem".into()),
            oracle_use_sid: None,
            wallet_path: None,
            has_wallet_password: false,
        };
        let config = public.into_config_with_empty_password();
        assert_eq!(config.password, "", "password slot must be cleared");
        assert!(matches!(config.db_type, DatabaseType::Mongodb));
        assert_eq!(config.id, "c1");
        assert_eq!(config.user, "u");
        assert_eq!(config.database, "d");
        assert!(config.read_only);
        assert_eq!(config.group_id.as_deref(), Some("g1"));
        assert_eq!(config.color.as_deref(), Some("#fff"));
        assert_eq!(config.connection_timeout, Some(30));
        assert_eq!(config.keep_alive_interval, Some(60));
        assert_eq!(config.environment.as_deref(), Some("prod"));
        assert_eq!(config.auth_source.as_deref(), Some("admin"));
        assert_eq!(config.replica_set.as_deref(), Some("rs0"));
        // #1649 — the sslmode posture and CA path survive the IPC promotion.
        assert_eq!(config.ssl_mode, SslMode::VerifyCa);
        assert_eq!(config.ca_cert_path.as_deref(), Some("/etc/ssl/ca.pem"));
    }

    /// Purpose: #1649 (ADR 0058) — the legacy `(tls_enabled,
    /// trust_server_certificate)` boolean pair migrates to `ssl_mode` on load in
    /// a single stage, and re-serialization drops the legacy keys entirely (no
    /// dual-write).
    #[test]
    fn connection_config_migrates_legacy_tls_booleans_to_ssl_mode() {
        // Reason: #1649 — a pre-migration connection stored `tls_enabled=true,
        // trust_server_certificate=true`; loading it must fold to `require`, and
        // saving it back must write `ssl_mode` while emitting neither legacy key,
        // so the on-disk vocabulary flips in one pass. (2026-07-25)
        let legacy = r#"{
            "id": "c1",
            "name": "PG",
            "db_type": "postgresql",
            "host": "h",
            "port": 5432,
            "user": "u",
            "password": "",
            "database": "d",
            "group_id": null,
            "color": null,
            "tls_enabled": true,
            "trust_server_certificate": true
        }"#;
        let config: ConnectionConfig = serde_json::from_str(legacy).unwrap();
        assert_eq!(config.ssl_mode, SslMode::Require);

        let round = serde_json::to_string(&config).unwrap();
        assert!(
            round.contains("\"ssl_mode\":\"require\""),
            "re-serialized config must carry ssl_mode: {round}"
        );
        assert!(
            !round.contains("tls_enabled") && !round.contains("trust_server_certificate"),
            "1-stage migration must drop the legacy TLS keys on save: {round}"
        );
    }

    /// Purpose: #1649 — an explicit `ssl_mode` in the payload wins over any
    /// legacy booleans that may still be present during the migration window.
    #[test]
    fn connection_config_prefers_explicit_ssl_mode_over_legacy_booleans() {
        // Reason: #1649 — a payload that carries both the new `ssl_mode` and a
        // stale legacy pair must honor `ssl_mode` (verify-ca) and read its CA
        // path, never silently downgrade to the boolean fold. (2026-07-25)
        let mixed = r#"{
            "id": "c1",
            "name": "PG",
            "db_type": "postgresql",
            "host": "h",
            "port": 5432,
            "user": "u",
            "password": "",
            "database": "d",
            "group_id": null,
            "color": null,
            "ssl_mode": "verify-ca",
            "ca_cert_path": "/etc/ssl/ca.pem",
            "tls_enabled": false,
            "trust_server_certificate": false
        }"#;
        let config: ConnectionConfig = serde_json::from_str(mixed).unwrap();
        assert_eq!(config.ssl_mode, SslMode::VerifyCa);
        assert_eq!(config.ca_cert_path.as_deref(), Some("/etc/ssl/ca.pem"));
    }

    /// Purpose: #1649 (ADR 0058) — the public wire shape folds the legacy
    /// `(tlsEnabled, trustServerCertificate)` pair too, so a pre-#1649 export
    /// envelope imports with its stored posture instead of silently dropping to
    /// the opportunistic `prefer`.
    #[test]
    fn connection_config_public_migrates_legacy_tls_booleans_to_ssl_mode() {
        // Reason: #1649 — `import_connections` parses an export file into this
        // shape, and an export written before the migration carries only the
        // booleans. Folding them here is what keeps a stored `require` /
        // `verify-full` from becoming `prefer` on import. (2026-07-25)
        let legacy = r#"{
            "id": "c1",
            "name": "ES",
            "dbType": "elasticsearch",
            "host": "localhost",
            "port": 9200,
            "user": "elastic",
            "database": "",
            "groupId": null,
            "color": null,
            "paradigm": "search",
            "tlsEnabled": true
        }"#;
        let public: ConnectionConfigPublic = serde_json::from_str(legacy).unwrap();
        assert_eq!(public.ssl_mode, SslMode::VerifyFull);

        let legacy_trusted = r#"{
            "id": "c1",
            "name": "PG",
            "db_type": "postgresql",
            "host": "localhost",
            "port": 5432,
            "user": "u",
            "database": "d",
            "group_id": null,
            "color": null,
            "paradigm": "rdb",
            "tls_enabled": true,
            "trust_server_certificate": true
        }"#;
        let public: ConnectionConfigPublic = serde_json::from_str(legacy_trusted).unwrap();
        assert_eq!(public.ssl_mode, SslMode::Require);

        // An explicit posture still wins over a stale legacy pair.
        let mixed = r#"{
            "id": "c1",
            "name": "PG",
            "dbType": "postgresql",
            "host": "localhost",
            "port": 5432,
            "user": "u",
            "database": "d",
            "groupId": null,
            "color": null,
            "paradigm": "rdb",
            "sslMode": "verify-ca",
            "tlsEnabled": false
        }"#;
        let public: ConnectionConfigPublic = serde_json::from_str(mixed).unwrap();
        assert_eq!(public.ssl_mode, SslMode::VerifyCa);

        // The camelCase legacy pair is still valid on the wire (IPC payloads
        // authored before #1649), so it must fold too — the snake_case case
        // above does not cover the `trustServerCertificate` alias.
        let legacy_camel = r#"{
            "id": "c1",
            "name": "PG",
            "dbType": "postgresql",
            "host": "localhost",
            "port": 5432,
            "user": "u",
            "database": "d",
            "groupId": null,
            "color": null,
            "paradigm": "rdb",
            "tlsEnabled": true,
            "trustServerCertificate": true
        }"#;
        let public: ConnectionConfigPublic = serde_json::from_str(legacy_camel).unwrap();
        assert_eq!(public.ssl_mode, SslMode::Require);
    }

    /// Purpose: #1649 review B3 — `to_legacy` writes the SQLite mirror's
    /// `tls_enabled` / `trust_server_certificate` columns
    /// (`commands/persist_connections.rs`, `storage/reconcile.rs`), which cold
    /// boot reads back through `from_legacy`. Nothing else in the suite fails if
    /// two arms are exchanged, so pin the whole table plus the round trip.
    #[test]
    fn ssl_mode_to_legacy_pins_the_mirror_columns() {
        // Reason: a swapped `Require` / `VerifyFull` arm would paint a
        // skip-verify connection as verify-full (and the reverse) in the boot
        // snapshot until the file SOT loads. The `VerifyCa` row is the one
        // documented lossy cell: the mirror has no CA column, so it reconstructs
        // as the stronger verify-full and the CA path comes back from the file
        // SOT. (2026-07-25)
        let cells = [
            (SslMode::Prefer, (None, None), SslMode::Prefer),
            (
                SslMode::Disable,
                (Some(false), Some(false)),
                SslMode::Disable,
            ),
            (SslMode::Require, (Some(true), Some(true)), SslMode::Require),
            (
                SslMode::VerifyFull,
                (Some(true), Some(false)),
                SslMode::VerifyFull,
            ),
            (
                SslMode::VerifyCa,
                (Some(true), Some(false)),
                SslMode::VerifyFull,
            ),
        ];
        for (mode, columns, reconstructed) in cells {
            assert_eq!(
                mode.to_legacy(),
                columns,
                "{mode:?} must write the mirror columns {columns:?}"
            );
            let (tls_enabled, trust) = mode.to_legacy();
            assert_eq!(
                SslMode::from_legacy(tls_enabled, trust),
                reconstructed,
                "{mode:?} must reconstruct from the mirror as {reconstructed:?}"
            );
        }
    }

    /// Purpose: #1649 — `SslMode` serializes to the kebab-case PostgreSQL
    /// `sslmode` vocabulary so a pasted `?sslmode=` value maps one-to-one.
    #[test]
    fn ssl_mode_serializes_kebab_case() {
        assert_eq!(
            serde_json::to_string(&SslMode::Disable).unwrap(),
            "\"disable\""
        );
        assert_eq!(
            serde_json::to_string(&SslMode::Prefer).unwrap(),
            "\"prefer\""
        );
        assert_eq!(
            serde_json::to_string(&SslMode::Require).unwrap(),
            "\"require\""
        );
        assert_eq!(
            serde_json::to_string(&SslMode::VerifyCa).unwrap(),
            "\"verify-ca\""
        );
        assert_eq!(
            serde_json::to_string(&SslMode::VerifyFull).unwrap(),
            "\"verify-full\""
        );
    }
}
