//! MongoAdapter struct + connection lifecycle + `impl DbAdapter`.
//!
//! Sprint 197 split — extracted from `db/mongodb.rs`. Holds:
//!   * the adapter struct (shared `(client, default_db, active_db)` slots)
//!   * `build_options` / `test` / `current_client` / `switch_active_db`
//!     / `current_active_db` / `resolved_db_name` (lifecycle inherent)
//!   * `impl DbAdapter for MongoAdapter` (`kind` / `connect` / `disconnect`
//!     / `ping`)
//!
//! The `impl DocumentAdapter` trait dispatch lives in `mod.rs`; the
//! per-method bodies live in `schema.rs` / `queries.rs` / `mutations.rs`.

use std::sync::Arc;

use ::mongodb::options::{ClientOptions, Credential, ServerAddress, Tls, TlsOptions};
use ::mongodb::Client;
use bson::doc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::error::AppError;
use crate::models::{ConnectionConfig, DatabaseType};

use super::super::{BoxFuture, DbAdapter};

/// Document-paradigm adapter backed by the official `mongodb` driver.
pub struct MongoAdapter {
    pub(super) client: Arc<Mutex<Option<Client>>>,
    pub(super) default_db: Arc<Mutex<Option<String>>>,
    /// Sprint 131 — the database the user has currently "use_db"'d into.
    ///
    /// Mirrors `default_db`'s lifecycle (seeded on `connect()`, cleared on
    /// `disconnect()`) but is mutated by `switch_active_db` so that future
    /// read/write call sites can pick up the user's active DB without
    /// changing the existing `DocumentAdapter` trait signatures (which
    /// take an explicit `db: &str`). The frontend dispatches Mongo
    /// queries through the active tab's `database`, which is kept in
    /// sync with this field via `connectionStore.activeStatuses[id].activeDb`.
    pub(super) active_db: Arc<Mutex<Option<String>>>,
}

impl Default for MongoAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl MongoAdapter {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            default_db: Arc::new(Mutex::new(None)),
            active_db: Arc::new(Mutex::new(None)),
        }
    }

    /// Build a `ClientOptions` from the caller's `ConnectionConfig`.
    ///
    /// Done programmatically (rather than via URI parsing) so that password
    /// special characters never need to be percent-encoded, and TLS / replica
    /// set / auth-source flags map to typed option fields.
    pub(super) fn build_options(config: &ConnectionConfig) -> Result<ClientOptions, AppError> {
        let mut opts = ClientOptions::default();

        opts.hosts = vec![ServerAddress::Tcp {
            host: config.host.clone(),
            port: Some(config.port),
        }];

        if !config.user.is_empty() {
            let mut cred = Credential::default();
            cred.username = Some(config.user.clone());
            if !config.password.is_empty() {
                cred.password = Some(config.password.clone());
            }
            if let Some(source) = config
                .auth_source
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                cred.source = Some(source.to_string());
            } else if !config.database.is_empty() {
                cred.source = Some(config.database.clone());
            }
            opts.credential = Some(cred);
        }

        if let Some(rs) = config
            .replica_set
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            opts.repl_set_name = Some(rs.to_string());
        }

        if matches!(config.tls_enabled, Some(true)) {
            opts.tls = Some(Tls::Enabled(TlsOptions::default()));
        }

        if let Some(timeout_secs) = config.connection_timeout {
            opts.connect_timeout = Some(std::time::Duration::from_secs(timeout_secs as u64));
            opts.server_selection_timeout =
                Some(std::time::Duration::from_secs(timeout_secs as u64));
        }

        opts.app_name = Some("table-view".to_string());
        Ok(opts)
    }

    /// Stateless connection probe used by the `test_connection` Tauri command.
    ///
    /// Mirrors `PostgresAdapter::test`'s contract — build a one-shot client,
    /// run a single round-trip against the server, and drop the client. The
    /// driver's connection pool is owned by `Client` and disposed when this
    /// function returns, so no explicit teardown is needed (vs. the PG case
    /// which calls `pool.close()`).
    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let opts = Self::build_options(config)?;
        let client = Client::with_options(opts)
            .map_err(|e| AppError::Connection(format!("MongoDB client build failed: {e}")))?;
        client
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await
            .map_err(|e| AppError::Connection(format!("MongoDB ping failed: {e}")))?;
        Ok(())
    }

    pub(super) async fn current_client(&self) -> Result<Client, AppError> {
        let guard = self.client.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| AppError::Connection("MongoDB connection is not established".into()))
    }

    /// Switch the user-active database for this connection (Sprint 131).
    ///
    /// Mirrors `PostgresAdapter::switch_active_db`'s contract from S130 with
    /// MongoDB-specific quirks:
    ///   * MongoDB has no per-database connection pool — `Client` already
    ///     multiplexes across DBs — so there is no sub-pool to evict, and
    ///     the swap is a single mutex-guarded mutation of `active_db`.
    ///   * Cheap probe via `client.list_database_names()` so a misspelled
    ///     `db_name` surfaces as `AppError::Database` rather than silently
    ///     creating an empty DB on first write (MongoDB auto-creates DBs).
    ///   * If `list_database_names` itself fails (the most common reason
    ///     being a restricted user without `listDatabases` privilege —
    ///     analogous to the PG `42501` permission case), the validation is
    ///     **silently skipped** and the rename proceeds with a `warn` log.
    ///     This best-effort fallback matches the design bar: power users on
    ///     locked-down accounts must still be able to flip between DBs they
    ///     can read.
    pub async fn switch_active_db(&self, db_name: &str) -> Result<(), AppError> {
        if db_name.trim().is_empty() {
            return Err(AppError::Validation(
                "Database name must not be empty".into(),
            ));
        }

        // Acquire `client` first — `active_db` always lock-orders after it
        // so any future code that needs both can rely on a stable order
        // and avoid deadlocks. Mirrors the PG sub-pool lock discipline.
        let client = self.current_client().await?;

        match client.list_database_names().await {
            Ok(names) => {
                if !names.iter().any(|n| n == db_name) {
                    return Err(AppError::Database(format!(
                        "Database '{}' not found on this connection",
                        db_name
                    )));
                }
            }
            Err(e) => {
                // Permission-restricted users (no listDatabases privilege)
                // hit this branch. We log the upstream message at warn
                // rather than surfacing it — the user explicitly asked for
                // a DB they presumably know exists, and the alternative is
                // a permanent block on the switcher for that account.
                warn!(
                    "Mongo list_database_names probe failed; proceeding with \
                     best-effort switch to '{}': {}",
                    db_name, e
                );
            }
        }

        {
            let mut guard = self.active_db.lock().await;
            *guard = Some(db_name.to_string());
        }
        info!("Switched active Mongo db to {}", db_name);
        Ok(())
    }

    /// Sprint 131 — accessor for the current user-active database.
    ///
    /// Returns `None` when the adapter is disconnected or the connection
    /// was opened without a default `database`. Mirrors
    /// `PostgresAdapter::current_database`'s shape so a future
    /// paradigm-neutral helper can read either adapter through one API.
    pub async fn current_active_db(&self) -> Option<String> {
        self.active_db.lock().await.clone()
    }

    /// Sprint 137 (AC-S137-01) — resolve which Mongo database name a
    /// metadata fetch should run against.
    ///
    /// Routing precedence (in order):
    ///   1. `requested` — when the caller explicitly provided a non-empty
    ///      database name, honor it verbatim. The frontend's existing
    ///      `list_mongo_collections(connection_id, database)` command path
    ///      passes the user-clicked database row this way, so this branch
    ///      preserves the original Sprint 65 contract.
    ///   2. `active_db` — when the caller did not provide a name (or
    ///      passed an empty/whitespace-only string), fall back to whatever
    ///      database the user most recently `use_db`'d into via
    ///      `switch_active_db`. **This is the key Sprint 137 fix**: prior to
    ///      S137 the only fallback was `default_db`, so a Mongo workspace
    ///      that opened against db `X` and then swapped to db `Y` via the
    ///      DbSwitcher kept resolving collection-list calls against `X`
    ///      because `default_db` never moves.
    ///   3. `default_db` — last-resort fallback for the very first
    ///      metadata fetch on a connection that was opened without an
    ///      intervening `switch_active_db`. Same value the adapter
    ///      seeded on `connect()` from `ConnectionConfig::database`.
    ///
    /// Returns `None` only when none of the three sources have a value
    /// (e.g. the adapter was constructed but never connected). Callers
    /// should surface that as an `AppError::Validation` so the frontend
    /// gets an actionable error instead of a silent empty list.
    ///
    /// Pure helper — no driver round-trip — so it is unit-testable
    /// without a live MongoDB instance.
    pub async fn resolved_db_name(&self, requested: Option<&str>) -> Option<String> {
        if let Some(name) = requested {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        if let Some(active) = self.active_db.lock().await.clone() {
            if !active.trim().is_empty() {
                return Some(active);
            }
        }
        let default = self.default_db.lock().await.clone();
        default.filter(|d| !d.trim().is_empty())
    }
}

impl DbAdapter for MongoAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Mongodb
    }

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            let opts = Self::build_options(config)?;
            let client = Client::with_options(opts)
                .map_err(|e| AppError::Connection(format!("MongoDB client build failed: {e}")))?;

            // Probe the server once so connect() actually fails fast when the
            // host is unreachable. MongoDB's driver is lazy otherwise and
            // later operations would be the first to notice.
            client
                .database("admin")
                .run_command(doc! { "ping": 1 })
                .await
                .map_err(|e| AppError::Connection(format!("MongoDB ping failed: {e}")))?;

            {
                let mut guard = self.client.lock().await;
                *guard = Some(client);
            }
            // Seed both `default_db` and `active_db` from the connection's
            // configured database. Sprint 131 — `active_db` mirrors
            // `default_db` on the initial connect; subsequent
            // `switch_active_db` calls move only `active_db`, so the
            // adapter retains the user's original landing DB even after
            // they navigate away.
            let initial = if config.database.trim().is_empty() {
                None
            } else {
                Some(config.database.clone())
            };
            {
                let mut guard = self.default_db.lock().await;
                *guard = initial.clone();
            }
            {
                let mut guard = self.active_db.lock().await;
                *guard = initial;
            }
            Ok(())
        })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            // Explicitly drop the client so pooled sockets are released.
            let mut guard = self.client.lock().await;
            *guard = None;
            let mut db_guard = self.default_db.lock().await;
            *db_guard = None;
            // Sprint 131 — clear the user-selected DB on disconnect so a
            // subsequent connect() does not silently reuse a stale
            // selection from the previous session.
            let mut active_guard = self.active_db.lock().await;
            *active_guard = None;
            Ok(())
        })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            let client = self.current_client().await?;
            client
                .database("admin")
                .run_command(doc! { "ping": 1 })
                .await
                .map(|_| ())
                .map_err(|e| AppError::Connection(format!("MongoDB ping failed: {e}")))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_adapter_reports_mongodb_kind() {
        let adapter = MongoAdapter::new();
        assert!(matches!(adapter.kind(), DatabaseType::Mongodb));
    }

    #[test]
    fn default_is_equivalent_to_new() {
        let a = MongoAdapter::default();
        assert!(matches!(a.kind(), DatabaseType::Mongodb));
    }

    fn sample_config() -> ConnectionConfig {
        ConnectionConfig {
            id: "m1".into(),
            name: "Mongo".into(),
            db_type: DatabaseType::Mongodb,
            host: "localhost".into(),
            port: 27017,
            user: "u".into(),
            password: "p".into(),
            database: "d".into(),
            group_id: None,
            color: None,
            connection_timeout: Some(5),
            keep_alive_interval: None,
            environment: None,
            auth_source: Some("admin".into()),
            replica_set: Some("rs0".into()),
            tls_enabled: Some(true),
        }
    }

    #[test]
    fn build_options_maps_fields_to_client_options() {
        let cfg = sample_config();
        let opts = MongoAdapter::build_options(&cfg).expect("build_options should succeed");

        // Host / port round-trip
        assert_eq!(opts.hosts.len(), 1);
        match &opts.hosts[0] {
            ServerAddress::Tcp { host, port } => {
                assert_eq!(host, "localhost");
                assert_eq!(*port, Some(27017));
            }
            other => panic!("unexpected ServerAddress variant: {other:?}"),
        }

        // Credentials pick up username/password + auth_source override.
        let cred = opts.credential.as_ref().expect("credential expected");
        assert_eq!(cred.username.as_deref(), Some("u"));
        assert_eq!(cred.password.as_deref(), Some("p"));
        assert_eq!(cred.source.as_deref(), Some("admin"));

        // Replica set propagated.
        assert_eq!(opts.repl_set_name.as_deref(), Some("rs0"));

        // TLS enabled.
        assert!(matches!(opts.tls, Some(Tls::Enabled(_))));

        // Timeouts derived from connection_timeout.
        assert_eq!(
            opts.connect_timeout,
            Some(std::time::Duration::from_secs(5))
        );
    }

    #[test]
    fn build_options_defaults_when_mongo_specific_fields_missing() {
        let cfg = ConnectionConfig {
            id: "m1".into(),
            name: "Mongo".into(),
            db_type: DatabaseType::Mongodb,
            host: "localhost".into(),
            port: 27017,
            user: "".into(),
            password: "".into(),
            database: "".into(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        };
        let opts = MongoAdapter::build_options(&cfg).expect("build_options should succeed");
        assert!(opts.credential.is_none());
        assert!(opts.repl_set_name.is_none());
        assert!(opts.tls.is_none());
        assert!(opts.connect_timeout.is_none());
    }

    #[tokio::test]
    async fn ping_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.ping().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got: {:?}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn disconnect_without_connection_is_ok() {
        let adapter = MongoAdapter::new();
        assert!(adapter.disconnect().await.is_ok());
    }

    // -- Sprint 131 — switch_active_db ---------------------------------------

    #[tokio::test]
    async fn test_switch_active_db_rejects_empty_db_name() {
        // Pure validation — no live MongoDB needed because the empty-name
        // guard runs before `current_client()`. Mirrors the PG sibling
        // test in postgres.rs (S130).
        let adapter = MongoAdapter::new();
        match adapter.switch_active_db("").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
        // Whitespace-only is also rejected — same guard, different input.
        match adapter.switch_active_db("   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn test_switch_active_db_returns_err_when_not_connected() {
        // Without a `connect()` the inner client mutex stays `None`, so
        // `current_client()` short-circuits with a Connection error. The
        // dispatcher (`commands/meta.rs`) propagates that verbatim so the
        // frontend toast can show the underlying reason.
        let adapter = MongoAdapter::new();
        match adapter.switch_active_db("admin").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
        // active_db should remain untouched after a failed switch.
        assert!(adapter.current_active_db().await.is_none());
    }

    #[tokio::test]
    async fn test_current_active_db_starts_none() {
        // Adapter constructed but never connected — the active_db slot
        // begins life as None. This pins the lifecycle invariant the
        // S131 contract relies on (no stale selection leaks across
        // connect → disconnect → connect cycles).
        let adapter = MongoAdapter::new();
        assert!(adapter.current_active_db().await.is_none());
    }

    // -- Sprint 137 — list_collections honors active_db (AC-S137-01) -------

    /// `resolved_db_name(Some("alpha"))` honors the explicit override even
    /// when a different `active_db` is already set. This pins the original
    /// Sprint 65 contract — frontend rows that pass an explicit DB name
    /// keep working as before — while leaving the empty-name path open
    /// for the active-db fallback (next test).
    #[tokio::test]
    async fn test_resolved_db_name_explicit_override_wins() {
        let adapter = MongoAdapter::new();
        // Seed `active_db` directly (no live Mongo needed).
        {
            let mut guard = adapter.active_db.lock().await;
            *guard = Some("alpha".into());
        }
        assert_eq!(
            adapter.resolved_db_name(Some("beta")).await.as_deref(),
            Some("beta"),
            "explicit non-empty override must win over active_db"
        );
    }

    /// `resolved_db_name(None)` (or empty/whitespace) falls back to the
    /// `active_db` slot. This is the line that fixes AC-S137-01 — the
    /// list_collections path now follows `use_db("alpha")` instead of
    /// staying pinned to the connection's stored default DB.
    #[tokio::test]
    async fn list_collections_uses_active_db_after_use_db() {
        let adapter = MongoAdapter::new();
        // Seed both `default_db` (the connection's original landing DB)
        // and `active_db` (where the user swapped to via use_db("alpha"))
        // so we can prove the resolver prefers `active_db`.
        {
            let mut guard = adapter.default_db.lock().await;
            *guard = Some("default_db".into());
        }
        {
            let mut guard = adapter.active_db.lock().await;
            *guard = Some("alpha".into());
        }

        // No explicit override → must follow the most recent use_db.
        assert_eq!(
            adapter.resolved_db_name(None).await.as_deref(),
            Some("alpha"),
            "list_collections (no explicit db) must route to active_db, not default_db"
        );

        // Empty string is treated as "no override" — same fallback path.
        assert_eq!(
            adapter.resolved_db_name(Some("")).await.as_deref(),
            Some("alpha"),
        );
        assert_eq!(
            adapter.resolved_db_name(Some("   ")).await.as_deref(),
            Some("alpha"),
            "whitespace-only input must trigger the active_db fallback"
        );
    }

    /// When `active_db` was never set (no use_db ever fired), the resolver
    /// falls back to `default_db` so the very first metadata fetch on a
    /// fresh connection still has somewhere to land. Mirrors the Sprint 65
    /// behavior for unswapped connections.
    #[tokio::test]
    async fn test_resolved_db_name_falls_back_to_default_when_no_active() {
        let adapter = MongoAdapter::new();
        {
            let mut guard = adapter.default_db.lock().await;
            *guard = Some("default_db".into());
        }
        // active_db remains None.
        assert_eq!(
            adapter.resolved_db_name(None).await.as_deref(),
            Some("default_db"),
            "without an active_db, must fall through to default_db"
        );
    }

    /// All three sources empty → resolver returns None and the
    /// `list_collections` caller surfaces a Validation error. This guards
    /// the empty-input path the existing
    /// `list_collections_rejects_empty_db_name` test asserts.
    #[tokio::test]
    async fn test_resolved_db_name_returns_none_when_no_source_available() {
        let adapter = MongoAdapter::new();
        assert!(adapter.resolved_db_name(None).await.is_none());
        assert!(adapter.resolved_db_name(Some("")).await.is_none());
        assert!(adapter.resolved_db_name(Some("   ")).await.is_none());
    }

    // The happy-path probe (`list_database_names` succeeds, `db_name`
    // present in the result, mutate `active_db`) requires a live MongoDB
    // instance because the driver insists on a real server handshake. We
    // gate the test behind `#[ignore]` so `cargo test --lib` passes in CI
    // and developers can run it locally with `cargo test -- --ignored`
    // against the docker-compose fixtures.
    #[tokio::test]
    #[ignore = "requires live MongoDB — exercises list_database_names probe and mutate path"]
    async fn test_switch_active_db_happy_path_with_live_mongo() {
        let adapter = MongoAdapter::new();
        let cfg = sample_config();
        adapter.connect(&cfg).await.expect("connect should succeed");
        adapter
            .switch_active_db("admin")
            .await
            .expect("admin must exist on a stock Mongo install");
        assert_eq!(
            adapter.current_active_db().await.as_deref(),
            Some("admin"),
            "active_db must reflect the most recent switch"
        );
    }
}
