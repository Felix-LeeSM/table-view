//! MongoDB adapter (Sprint 65 + Sprint 66).
//!
//! Sprint 65 wired lifecycle + namespace-enumeration paths:
//!
//! * `connect` / `disconnect` / `ping`
//! * `list_databases` (via `Client::list_database_names`)
//! * `list_collections(db)` (via `database.list_collection_names`)
//!
//! Sprint 66 replaces two of the remaining `AppError::Unsupported` stubs
//! with real implementations that power the P0 read path:
//!
//! * `infer_collection_fields(db, coll, sample_size)` — samples the first
//!   `sample_size` documents, aggregates top-level field names, records the
//!   modal BSON type for each field, marks fields missing from any sampled
//!   document as nullable, and forces `_id` to the first column.
//! * `find(db, coll, body)` — runs `collection.find(filter).with_options(...)`
//!   through the driver, flattens each document into a `rows: Vec<Vec<Value>>`
//!   projection using the column order established by a quick inference
//!   pass over the batch, and returns canonical extended-JSON `raw_documents`
//!   alongside `estimated_document_count()` as `total_count`.
//!
//! Sprint 72 (Phase 6 plan E-1) lifts the third stub by providing the
//! `aggregate` implementation that mirrors `find`'s cursor / flattening path
//! so the new `aggregate_documents` Tauri command (see
//! `commands/document/query.rs`) can drive the frontend Aggregate mode.
//! `total_count` for aggregate results is the number of returned rows —
//! `estimated_document_count()` is deliberately *not* used because it would
//! reflect raw collection cardinality rather than pipeline output.
//!
//! Sprint 80 (Phase 6 plan F-1) replaces the last three `AppError::Unsupported`
//! stubs with real driver-backed implementations:
//!
//! * `insert_document(db, coll, doc)` — `collection.insert_one` then maps the
//!   returned `Bson` id back into a `DocumentId` variant via
//!   `bson_id_to_document_id`.
//! * `update_document(db, coll, id, patch)` — rejects `_id` in `patch` to
//!   block identity mutation, wraps the patch in `{ $set: patch }` and calls
//!   `collection.update_one`. A zero `matched_count` surfaces as
//!   `AppError::NotFound` so the frontend can distinguish "no match" from
//!   genuine driver errors.
//! * `delete_document(db, coll, id)` — `collection.delete_one`; zero
//!   `deleted_count` again becomes `AppError::NotFound`.
//!
//! All three share two private helpers (`document_id_to_bson`,
//! `bson_id_to_document_id`) for the BSON ↔ `DocumentId` round-trip. The
//! Tauri command layer lives in `commands/document/mutate.rs`.
//!
//! ## State
//!
//! The adapter holds `(Option<Client>, Option<String>)` under two
//! `tokio::sync::Mutex`es — mirroring `PostgresAdapter`'s `Arc<Mutex<_>>`
//! pattern. The second slot stores the configured default database so
//! `list_collections(default_db)` can be routed without the caller passing
//! the name on every hop (Sprint 66+ will lean on this).
//!
//! ## Connection options
//!
//! Rather than assembling a URI string (which forces percent-encoding of user
//! / password and TLS/replica-set flags), we build
//! `mongodb::options::ClientOptions` programmatically. `auth_source`,
//! `replica_set`, and `tls_enabled` from `ConnectionConfig` flow straight
//! into the corresponding option fields.
//!
//! ## BSON → row cell flattening
//!
//! Per the execution brief, each document field becomes exactly one cell:
//!
//! * scalar BSON (`String`, `Int32/64`, `Double`, `Bool`, `Null`,
//!   `ObjectId`, `DateTime`) — serialised via `bson::Bson::serialize` which
//!   emits canonical extended JSON (`{"$oid": "..."}`, `{"$date": "..."}`),
//!   matching what the Quick Look panel (Sprint 67) expects to see.
//! * `Document(_)` — replaced with the sentinel string `"{...}"`.
//! * `Array(arr)` — replaced with the sentinel string `"[N items]"`.
//!
//! The sentinel strings are the contract the DataGrid consumes to decide
//! whether to render a muted/read-only cell and block inline edit; the
//! frontend regex is `^\[\d+ items\]$` / exact match `"{...}"`.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use ::mongodb::options::{ClientOptions, Credential, FindOptions, ServerAddress, Tls, TlsOptions};
use ::mongodb::Client;
use bson::{doc, Bson, Document};
use futures_util::stream::StreamExt;
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::error::AppError;
use crate::models::{ColumnInfo, ConnectionConfig, DatabaseType, QueryColumn, TableInfo};

use super::{
    BoxFuture, DbAdapter, DocumentAdapter, DocumentId, DocumentQueryResult, FindBody, NamespaceInfo,
};

/// Document-paradigm adapter backed by the official `mongodb` driver.
pub struct MongoAdapter {
    client: Arc<Mutex<Option<Client>>>,
    default_db: Arc<Mutex<Option<String>>>,
    /// Sprint 131 — the database the user has currently "use_db"'d into.
    ///
    /// Mirrors `default_db`'s lifecycle (seeded on `connect()`, cleared on
    /// `disconnect()`) but is mutated by `switch_active_db` so that future
    /// read/write call sites can pick up the user's active DB without
    /// changing the existing `DocumentAdapter` trait signatures (which
    /// take an explicit `db: &str`). The frontend dispatches Mongo
    /// queries through the active tab's `database`, which is kept in
    /// sync with this field via `connectionStore.activeStatuses[id].activeDb`.
    active_db: Arc<Mutex<Option<String>>>,
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
    fn build_options(config: &ConnectionConfig) -> Result<ClientOptions, AppError> {
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

    async fn current_client(&self) -> Result<Client, AppError> {
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

impl DocumentAdapter for MongoAdapter {
    /// Sprint 131 — delegates to the inherent `switch_active_db` so the
    /// trait dispatcher can drive Mongo DB swaps from the unified
    /// `switch_active_db` Tauri command. Mirrors
    /// `PostgresAdapter::switch_database` (S130).
    fn switch_database<'a>(&'a self, db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.switch_active_db(db_name).await })
    }

    /// Sprint 132 — surface the in-memory `active_db` selection without a
    /// driver round-trip. The `verify_active_db` Tauri command compares
    /// this against the optimistic `setActiveDb` value the frontend wrote
    /// after a raw-query DB switch, so the answer must mirror exactly
    /// what `current_active_db()` would return — same accessor.
    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async move { Ok(self.current_active_db().await) })
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move {
            let client = self.current_client().await?;
            let names = client
                .list_database_names()
                .await
                .map_err(|e| AppError::Database(format!("list_database_names failed: {e}")))?;
            Ok(names
                .into_iter()
                .map(|name| NamespaceInfo { name })
                .collect())
        })
    }

    fn list_collections<'a>(
        &'a self,
        db: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async move {
            // Sprint 137 (AC-S137-01) — route through `resolved_db_name`
            // so a `use_db("alpha")` swap takes effect even when an upstream
            // caller still passes an empty / whitespace-only `db` string.
            // When the caller passes a non-empty name, that name still wins
            // (preserves the original Sprint 65 per-row expand contract).
            // When the caller passes empty AND the user has switched the
            // active db, we follow the swap; this is the line that fixes
            // the "stale collection list" bug from the 2026-04-27 user
            // check. Falls back to the connection's `default_db` only when
            // no `switch_active_db` has ever been called.
            //
            // Sprint 180 (AC-180-04): the `tokio::select!` races driver work
            // against the cancel-token's `cancelled()` future. On cancel
            // we return the same `AppError::Database("Operation cancelled")`
            // shape used by `PostgresAdapter::execute_query`. The Mongo
            // driver's bundled version does NOT expose `killOperations`
            // so cancellation is cooperative-only — the future drops
            // locally; server-side work may continue briefly until the
            // driver's connection-level cleanup applies. This is the
            // documented per-adapter policy in ADR-0018.
            let work = async move {
                let requested = if db.trim().is_empty() { None } else { Some(db) };
                let resolved = self.resolved_db_name(requested).await.ok_or_else(|| {
                    AppError::Validation("Database name must not be empty".into())
                })?;
                let client = self.current_client().await?;
                let names = client
                    .database(&resolved)
                    .list_collection_names()
                    .await
                    .map_err(|e| {
                        AppError::Database(format!("list_collection_names failed: {e}"))
                    })?;
                Ok(names
                    .into_iter()
                    .map(|name| TableInfo {
                        name,
                        schema: resolved.clone(),
                        row_count: None,
                    })
                    .collect())
            };
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn infer_collection_fields<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        sample_size: usize,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move {
            // Sprint 180 (AC-180-04): cancel-token cooperation; same shape
            // as `list_collections` above.
            let work = async move {
                validate_ns(db, collection)?;
                let client = self.current_client().await?;
                let coll = client.database(db).collection::<Document>(collection);

                // Sprint 66 uses a best-effort sample: `find(None)` + `limit`.
                // Aggregation with `$sample` would be more uniform but requires
                // pipeline support which is still stubbed. The first N documents
                // is plenty for P0 inference and matches what the Quick Open
                // grid will preview initially.
                let limit_i64: i64 = sample_size.max(1).min(i64::MAX as usize) as i64;
                let mut cursor = coll
                    .find(Document::new())
                    .limit(limit_i64)
                    .await
                    .map_err(|e| AppError::Database(format!("find(sample) failed: {e}")))?;

                let mut samples: Vec<Document> = Vec::new();
                while let Some(next) = cursor.next().await {
                    match next {
                        Ok(d) => samples.push(d),
                        Err(e) => {
                            return Err(AppError::Database(format!(
                                "cursor iteration failed: {e}"
                            )));
                        }
                    }
                }

                Ok(infer_columns_from_samples(&samples))
            };
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn find<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        body: FindBody,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async move {
            // Sprint 180 (AC-180-04): cancel-token cooperation.
            let work = async move {
                validate_ns(db, collection)?;
                let started = Instant::now();
                let client = self.current_client().await?;
                let coll = client.database(db).collection::<Document>(collection);

                let FindBody {
                    filter,
                    sort,
                    projection,
                    skip,
                    limit,
                } = body;

                let mut opts = FindOptions::default();
                if let Some(s) = sort {
                    opts.sort = Some(s);
                }
                if let Some(p) = projection {
                    opts.projection = Some(p);
                }
                if skip > 0 {
                    opts.skip = Some(skip);
                }
                // `limit = 0` is treated as "no explicit limit" to match the
                // default behaviour documented on the DocumentAdapter trait;
                // values > 0 are forwarded verbatim.
                if limit > 0 {
                    opts.limit = Some(limit);
                }

                let mut cursor = coll
                    .find(filter)
                    .with_options(opts)
                    .await
                    .map_err(|e| AppError::Database(format!("find failed: {e}")))?;

                let mut raw_documents: Vec<Document> = Vec::new();
                while let Some(next) = cursor.next().await {
                    match next {
                        Ok(d) => raw_documents.push(d),
                        Err(e) => {
                            return Err(AppError::Database(format!(
                                "cursor iteration failed: {e}"
                            )));
                        }
                    }
                }

                // Derive the column order from the returned batch so the grid
                // has a stable projection even when the caller did not pre-call
                // `infer_collection_fields`. `_id` is forced to the leading
                // position to match the inference helper's contract.
                let columns = columns_from_docs(&raw_documents);

                // Flatten each document into the projected row order.
                let rows: Vec<Vec<serde_json::Value>> = raw_documents
                    .iter()
                    .map(|doc| project_row(doc, &columns))
                    .collect();

                // `estimated_document_count` is O(1) via collection metadata and
                // is acceptable for the P0 total-count badge — exact counts
                // require a full collection scan which Sprint 66 explicitly
                // defers.
                let total_count_u64 = coll.estimated_document_count().await.map_err(|e| {
                    AppError::Database(format!("estimated_document_count failed: {e}"))
                })?;
                let total_count = total_count_u64.min(i64::MAX as u64) as i64;

                let elapsed = started.elapsed();
                let execution_time_ms = elapsed.as_millis().min(u128::from(u64::MAX)) as u64;

                Ok(DocumentQueryResult {
                    columns,
                    rows,
                    raw_documents,
                    total_count,
                    execution_time_ms,
                })
            };
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn aggregate<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        pipeline: Vec<Document>,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async move {
            // Sprint 180 (AC-180-04): cancel-token cooperation.
            let work = async move {
                validate_ns(db, collection)?;
                let started = Instant::now();
                let client = self.current_client().await?;
                let coll = client.database(db).collection::<Document>(collection);

                let mut cursor = coll
                    .aggregate(pipeline)
                    .await
                    .map_err(|e| AppError::Database(format!("aggregate failed: {e}")))?;

                let mut raw_documents: Vec<Document> = Vec::new();
                while let Some(next) = cursor.next().await {
                    match next {
                        Ok(d) => raw_documents.push(d),
                        Err(e) => {
                            return Err(AppError::Database(format!(
                                "aggregate cursor iteration failed: {e}"
                            )));
                        }
                    }
                }

                // Derive the column order from the pipeline output so grid layout
                // is stable without a pre-inference round-trip. Mirrors `find`.
                let columns = columns_from_docs(&raw_documents);
                let rows: Vec<Vec<serde_json::Value>> = raw_documents
                    .iter()
                    .map(|doc| project_row(doc, &columns))
                    .collect();

                // `total_count` reflects aggregate output cardinality, not the
                // backing collection's document count. `estimated_document_count`
                // is deliberately NOT called here: pipelines like `$match` /
                // `$group` / `$limit` reshape the row set, so the upstream
                // estimate would be misleading.
                let total_count = rows.len() as i64;

                let elapsed = started.elapsed();
                let execution_time_ms = elapsed.as_millis().min(u128::from(u64::MAX)) as u64;

                Ok(DocumentQueryResult {
                    columns,
                    rows,
                    raw_documents,
                    total_count,
                    execution_time_ms,
                })
            };
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn insert_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        doc: Document,
    ) -> BoxFuture<'a, Result<DocumentId, AppError>> {
        Box::pin(async move {
            validate_ns(db, collection)?;
            let client = self.current_client().await?;
            let coll = client.database(db).collection::<Document>(collection);

            let inserted = coll
                .insert_one(doc)
                .await
                .map_err(|e| AppError::Database(format!("insert_one failed: {e}")))?;

            Ok(bson_id_to_document_id(&inserted.inserted_id))
        })
    }

    fn update_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        id: DocumentId,
        patch: Document,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            validate_ns(db, collection)?;

            // Sprint 80 contract: reject `_id` in the patch up-front so the
            // driver never sees a mutating update on the identity column.
            // The guard runs before `current_client()` so a misuse does not
            // burn a connection/round-trip.
            if patch.contains_key("_id") {
                return Err(AppError::Validation(
                    "update_document: patch must not contain _id".into(),
                ));
            }

            let filter_value = document_id_to_bson(&id)?;
            let client = self.current_client().await?;
            let coll = client.database(db).collection::<Document>(collection);

            let filter = doc! { "_id": filter_value };
            let update = doc! { "$set": patch };

            let result = coll
                .update_one(filter, update)
                .await
                .map_err(|e| AppError::Database(format!("update_one failed: {e}")))?;

            if result.matched_count == 0 {
                return Err(AppError::NotFound(format!(
                    "document with _id {} not found",
                    describe_document_id(&id)
                )));
            }

            Ok(())
        })
    }

    fn delete_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        id: DocumentId,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            validate_ns(db, collection)?;

            let filter_value = document_id_to_bson(&id)?;
            let client = self.current_client().await?;
            let coll = client.database(db).collection::<Document>(collection);

            let filter = doc! { "_id": filter_value };

            let result = coll
                .delete_one(filter)
                .await
                .map_err(|e| AppError::Database(format!("delete_one failed: {e}")))?;

            if result.deleted_count == 0 {
                return Err(AppError::NotFound(format!(
                    "document with _id {} not found",
                    describe_document_id(&id)
                )));
            }

            Ok(())
        })
    }
}

// ── Helpers (Sprint 66) ────────────────────────────────────────────────

/// Reject empty database or collection names before the driver does.
///
/// The driver eventually returns a descriptive error on empty inputs, but
/// validating up-front keeps the error surface uniform with
/// `list_collections` and skips a network round-trip when the caller
/// forgot to supply a value.
fn validate_ns(db: &str, collection: &str) -> Result<(), AppError> {
    if db.trim().is_empty() {
        return Err(AppError::Validation(
            "Database name must not be empty".into(),
        ));
    }
    if collection.trim().is_empty() {
        return Err(AppError::Validation(
            "Collection name must not be empty".into(),
        ));
    }
    Ok(())
}

/// Human-readable BSON type tag used in `ColumnInfo::data_type` and
/// `QueryColumn::data_type`.
///
/// Kept short so it fits the grid's data-type subheader; scalars use their
/// canonical BSON variant name so the frontend can render type-specific
/// hints later without re-parsing the raw document.
fn bson_type_name(b: &Bson) -> &'static str {
    match b {
        Bson::Double(_) => "Double",
        Bson::String(_) => "String",
        Bson::Array(_) => "Array",
        Bson::Document(_) => "Document",
        Bson::Boolean(_) => "Boolean",
        Bson::Null => "Null",
        Bson::RegularExpression(_) => "RegularExpression",
        Bson::JavaScriptCode(_) => "JavaScriptCode",
        Bson::JavaScriptCodeWithScope(_) => "JavaScriptCodeWithScope",
        Bson::Int32(_) => "Int32",
        Bson::Int64(_) => "Int64",
        Bson::Timestamp(_) => "Timestamp",
        Bson::Binary(_) => "Binary",
        Bson::ObjectId(_) => "ObjectId",
        Bson::DateTime(_) => "DateTime",
        Bson::Symbol(_) => "Symbol",
        Bson::Decimal128(_) => "Decimal128",
        Bson::Undefined => "Undefined",
        Bson::MaxKey => "MaxKey",
        Bson::MinKey => "MinKey",
        Bson::DbPointer(_) => "DbPointer",
    }
}

/// Flatten a single BSON value into the JSON cell shape the grid consumes.
///
/// Invariant (Sprint 66 contract):
///   * `Bson::Document(_) → Value::String("{...}")` (sentinel)
///   * `Bson::Array(arr)  → Value::String("[N items]")` (sentinel)
///   * anything else      → canonical extended JSON through
///     `bson::Bson::into_canonical_extjson` so that
///     `ObjectId` ≈ `{"$oid": "..."}` and `DateTime`
///     ≈ `{"$date": "..."}` match Quick Look later.
fn flatten_cell(b: &Bson) -> serde_json::Value {
    match b {
        Bson::Document(_) => serde_json::Value::String("{...}".into()),
        Bson::Array(arr) => serde_json::Value::String(format!("[{} items]", arr.len())),
        other => other.clone().into_canonical_extjson(),
    }
}

/// Build a `Vec<ColumnInfo>` from a document sample.
///
/// Rules:
///   * `_id` is always the first column (even when absent from every sample
///     — MongoDB guarantees `_id` on every persisted doc, so showing the
///     column lets the grid render "missing" cells as NULL coherently).
///   * For every other top-level key encountered, record the **modal**
///     BSON type across the sample (ties broken by insertion order).
///   * A field is `nullable = true` when it is missing from at least one
///     sampled document OR any sampled occurrence is `Bson::Null`.
///   * Deep / nested inference is explicitly out of scope in Sprint 66.
fn infer_columns_from_samples(samples: &[Document]) -> Vec<ColumnInfo> {
    // Preserve first-seen order so UI column layout is stable across
    // repeated inferences on the same sample set.
    let mut order: Vec<String> = Vec::new();
    // For each field: count occurrences per BSON type name.
    let mut type_counts: HashMap<String, HashMap<&'static str, usize>> = HashMap::new();
    // Track which docs actually contained each field (by index). After the
    // pass, any field whose presence count differs from `samples.len()` is
    // flagged as nullable — this catches both "absent from every earlier
    // doc before first appearance" and "missing from a later doc" cases in
    // a single uniform rule.
    let mut presence_count: HashMap<String, usize> = HashMap::new();
    // A field is `nullable = true` when any sampled occurrence is
    // `Bson::Null` — presence-driven nullability is applied below.
    let mut has_null: HashMap<String, bool> = HashMap::new();

    for doc in samples {
        for (k, v) in doc {
            if !type_counts.contains_key(k) {
                order.push(k.clone());
                type_counts.insert(k.clone(), HashMap::new());
                presence_count.insert(k.clone(), 0);
                has_null.insert(k.clone(), false);
            }
            *presence_count.get_mut(k).expect("inserted above") += 1;
            match v {
                Bson::Null => {
                    has_null.insert(k.clone(), true);
                }
                _ => {
                    let by_type = type_counts.get_mut(k).expect("inserted above");
                    *by_type.entry(bson_type_name(v)).or_insert(0) += 1;
                }
            }
        }
    }

    // A field is nullable when it is missing from at least one sample
    // (presence_count < samples.len()) OR any sampled occurrence is Null.
    let total = samples.len();
    let null_or_absent: HashMap<String, bool> = order
        .iter()
        .map(|k| {
            let missing_from_some = presence_count.get(k).copied().unwrap_or(0) < total;
            let any_null = has_null.get(k).copied().unwrap_or(false);
            (k.clone(), missing_from_some || any_null)
        })
        .collect();

    let seen_id = order.iter().any(|n| n == "_id");
    let mut columns: Vec<ColumnInfo> = Vec::with_capacity(order.len() + 1);
    // `_id` always first.
    if seen_id {
        let counts = type_counts.get("_id").cloned().unwrap_or_default();
        let data_type = modal_type(&counts).unwrap_or("ObjectId");
        let nullable = *null_or_absent.get("_id").unwrap_or(&false);
        columns.push(ColumnInfo {
            name: "_id".into(),
            data_type: data_type.to_string(),
            nullable,
            default_value: None,
            is_primary_key: true,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
        });
    } else {
        columns.push(ColumnInfo {
            name: "_id".into(),
            data_type: "ObjectId".into(),
            // Empty collection / sample: placeholder _id column is not
            // nullable because MongoDB will auto-assign one on write.
            nullable: false,
            default_value: None,
            is_primary_key: true,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
        });
    }

    for name in order.iter() {
        if name == "_id" {
            continue;
        }
        let counts = type_counts.get(name).cloned().unwrap_or_default();
        let data_type = modal_type(&counts).unwrap_or("Null");
        let nullable = *null_or_absent.get(name).unwrap_or(&true);
        columns.push(ColumnInfo {
            name: name.clone(),
            data_type: data_type.to_string(),
            nullable,
            default_value: None,
            is_primary_key: false,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
        });
    }

    columns
}

/// Pick the most frequently observed BSON type name in the counts map.
///
/// Ties are broken by lexicographic order of the type name; this keeps
/// inference output deterministic across runs with shuffled sample data
/// (the BSON type name is stable and not user-supplied, so the tiebreak
/// order is not surprising).
fn modal_type(counts: &HashMap<&'static str, usize>) -> Option<&'static str> {
    counts
        .iter()
        .max_by(|(a_name, a_count), (b_name, b_count)| {
            a_count.cmp(b_count).then_with(|| b_name.cmp(a_name))
        })
        .map(|(name, _)| *name)
}

/// Build `QueryColumn`s from a returned batch of documents.
///
/// Used by `find` to produce a column order when the caller did not pre-infer
/// the schema (e.g. ad-hoc queries). Mirrors `infer_columns_from_samples`'s
/// `_id`-first, modal-type rule but emits the lighter `QueryColumn` shape
/// that `DocumentQueryResult` carries.
fn columns_from_docs(docs: &[Document]) -> Vec<QueryColumn> {
    let cols = infer_columns_from_samples(docs);
    cols.into_iter()
        .map(|c| QueryColumn {
            name: c.name,
            data_type: c.data_type,
        })
        .collect()
}

/// Project a single BSON document into the row shape expected by the grid,
/// using the column order from the enclosing `DocumentQueryResult`.
///
/// Fields absent from `doc` become JSON `null`; extra fields in `doc` that
/// weren't in the column order are dropped so rows always match the column
/// count. This guarantees `rows[i].len() == columns.len()` — a precondition
/// the DataGrid depends on for its `<td>` layout.
fn project_row(doc: &Document, columns: &[QueryColumn]) -> Vec<serde_json::Value> {
    columns
        .iter()
        .map(|col| match doc.get(&col.name) {
            Some(b) => flatten_cell(b),
            None => serde_json::Value::Null,
        })
        .collect()
}

// ── Mutate helpers (Sprint 80) ─────────────────────────────────────────

/// Convert a `DocumentId` into the `Bson` shape MongoDB expects in an
/// `_id` filter position.
///
/// The four `DocumentId` variants map as follows:
///   * `ObjectId(hex)` — parsed via `bson::oid::ObjectId::parse_str`; an
///     invalid hex string surfaces as `AppError::Validation` so the caller
///     can distinguish "bad client input" from a driver failure.
///   * `String(s)`     — `Bson::String` (pass-through).
///   * `Number(n)`     — `Bson::Int64` (the wire type of `DocumentId::Number`).
///   * `Raw(b)`        — the wrapped `Bson` is cloned through, reserving an
///     escape hatch for composite / binary `_id` shapes that do not fit the
///     top three cases.
fn document_id_to_bson(id: &DocumentId) -> Result<Bson, AppError> {
    match id {
        DocumentId::ObjectId(hex) => bson::oid::ObjectId::parse_str(hex)
            .map(Bson::ObjectId)
            .map_err(|e| AppError::Validation(format!("invalid ObjectId hex '{hex}': {e}"))),
        DocumentId::String(s) => Ok(Bson::String(s.clone())),
        DocumentId::Number(n) => Ok(Bson::Int64(*n)),
        DocumentId::Raw(b) => Ok(b.clone()),
    }
}

/// Convert the BSON `_id` emitted by the driver (e.g. `InsertOneResult::inserted_id`)
/// into the `DocumentId` shape that the frontend consumes.
///
/// Reverses `document_id_to_bson` for the three well-typed variants and
/// falls through to `DocumentId::Raw` for everything else so new BSON types
/// do not force a breaking change to the public enum.
fn bson_id_to_document_id(value: &Bson) -> DocumentId {
    match value {
        Bson::ObjectId(oid) => DocumentId::ObjectId(oid.to_hex()),
        Bson::String(s) => DocumentId::String(s.clone()),
        Bson::Int32(n) => DocumentId::Number(i64::from(*n)),
        Bson::Int64(n) => DocumentId::Number(*n),
        other => DocumentId::Raw(other.clone()),
    }
}

/// Short, human-friendly rendering of a `DocumentId` for error messages —
/// keeps the `AppError::NotFound` payload informative without leaking the
/// full `Bson` shape when the id is a `Raw` variant.
fn describe_document_id(id: &DocumentId) -> String {
    match id {
        DocumentId::ObjectId(hex) => hex.clone(),
        DocumentId::String(s) => s.clone(),
        DocumentId::Number(n) => n.to_string(),
        DocumentId::Raw(b) => format!("{b:?}"),
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

    #[tokio::test]
    async fn list_databases_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.list_databases().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn list_collections_rejects_empty_db_name() {
        let adapter = MongoAdapter::new();
        match adapter.list_collections("   ", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    // -- Unsupported stub coverage ------------------------------------------
    //
    // Sprint 66 lifted `infer_collection_fields` and `find` out of the
    // Unsupported path; Sprint 72 lifted `aggregate`. The remaining three
    // stubs keep their regression guard so the next sprint notices when
    // they're uplifted.

    #[tokio::test]
    async fn infer_collection_fields_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.infer_collection_fields("db", "c", 10, None).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn infer_collection_fields_rejects_empty_db_name() {
        let adapter = MongoAdapter::new();
        match adapter.infer_collection_fields("   ", "c", 10, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn infer_collection_fields_rejects_empty_collection_name() {
        let adapter = MongoAdapter::new();
        match adapter.infer_collection_fields("db", "   ", 10, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn find_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        let body = FindBody::default();
        match adapter.find("db", "c", body, None).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn find_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        let body = FindBody::default();
        match adapter.find("   ", "", body, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    // -- Helper coverage ----------------------------------------------------
    //
    // These tests exercise the pure inference + projection helpers so the
    // rule "_id first, modal type, nullable-on-absence" is not just a
    // comment. They run regardless of whether MongoDB is up — a
    // counterpart integration test in `src-tauri/tests/mongo_integration.rs`
    // verifies the driver-backed paths end-to-end.

    #[test]
    fn infer_columns_from_empty_sample_returns_only_id() {
        let cols = infer_columns_from_samples(&[]);
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "_id");
        assert_eq!(cols[0].data_type, "ObjectId");
        assert!(!cols[0].nullable);
        assert!(cols[0].is_primary_key);
    }

    #[test]
    fn infer_columns_puts_id_first_and_marks_missing_fields_nullable() {
        use bson::oid::ObjectId;
        let sample1 = doc! {
            "_id": ObjectId::new(),
            "name": "alice",
            "age": 30_i32,
        };
        let sample2 = doc! {
            "_id": ObjectId::new(),
            "name": "bob",
            // `age` absent here → nullable flips to true.
        };
        let cols = infer_columns_from_samples(&[sample1, sample2]);
        assert_eq!(cols[0].name, "_id", "_id must be the first column");
        assert_eq!(cols[0].data_type, "ObjectId");
        assert!(cols[0].is_primary_key);

        let name_col = cols.iter().find(|c| c.name == "name").unwrap();
        assert_eq!(name_col.data_type, "String");
        assert!(!name_col.nullable);

        let age_col = cols.iter().find(|c| c.name == "age").unwrap();
        assert_eq!(age_col.data_type, "Int32");
        assert!(
            age_col.nullable,
            "age must be nullable when absent in sample2"
        );
    }

    #[test]
    fn infer_columns_picks_modal_type_over_mixed_samples() {
        // Majority Int32 for "count" across 3 of 4 docs; minority String.
        let samples = vec![
            doc! { "count": 1_i32 },
            doc! { "count": 2_i32 },
            doc! { "count": 3_i32 },
            doc! { "count": "many" },
        ];
        let cols = infer_columns_from_samples(&samples);
        let count_col = cols.iter().find(|c| c.name == "count").unwrap();
        assert_eq!(count_col.data_type, "Int32");
    }

    #[test]
    fn flatten_cell_replaces_documents_and_arrays_with_sentinels() {
        let nested = Bson::Document(doc! { "x": 1_i32 });
        assert_eq!(flatten_cell(&nested), serde_json::json!("{...}"));

        let arr = Bson::Array(vec![Bson::Int32(1), Bson::Int32(2), Bson::Int32(3)]);
        assert_eq!(flatten_cell(&arr), serde_json::json!("[3 items]"));

        let empty_arr = Bson::Array(vec![]);
        assert_eq!(flatten_cell(&empty_arr), serde_json::json!("[0 items]"));
    }

    #[test]
    fn flatten_cell_preserves_scalars_through_canonical_extjson() {
        // String round-trips verbatim.
        assert_eq!(
            flatten_cell(&Bson::String("hi".into())),
            serde_json::json!("hi")
        );
        // Int64 becomes extended JSON `{"$numberLong": "..."}`.
        let long = flatten_cell(&Bson::Int64(42));
        assert!(
            long.get("$numberLong").is_some(),
            "Int64 should serialise as canonical extended JSON: {long}"
        );
    }

    #[test]
    fn project_row_fills_absent_fields_with_null() {
        let cols = vec![
            QueryColumn {
                name: "_id".into(),
                data_type: "ObjectId".into(),
            },
            QueryColumn {
                name: "name".into(),
                data_type: "String".into(),
            },
            QueryColumn {
                name: "missing".into(),
                data_type: "String".into(),
            },
        ];
        let doc = doc! {
            "_id": bson::oid::ObjectId::new(),
            "name": "alice",
        };
        let row = project_row(&doc, &cols);
        assert_eq!(row.len(), 3);
        assert_eq!(row[1], serde_json::json!("alice"));
        assert_eq!(row[2], serde_json::Value::Null);
    }

    #[tokio::test]
    async fn test_aggregate_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.aggregate("db", "c", Vec::new(), None).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn test_aggregate_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter.aggregate("", "c", Vec::new(), None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
        match adapter.aggregate("db", "   ", Vec::new(), None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    // -- Mutate coverage (Sprint 80) ---------------------------------------
    //
    // The three `*_returns_unsupported` predecessors have been retired now
    // that `insert_document` / `update_document` / `delete_document` carry
    // real driver-backed bodies. The replacements exercise the pre-driver
    // error paths (no connection, empty namespace, `_id` in patch) plus the
    // two `document_id` helpers so the Sprint 80 contract can be verified
    // without Docker.

    #[tokio::test]
    async fn insert_document_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.insert_document("db", "c", Document::new()).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn insert_document_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter.insert_document("   ", "c", Document::new()).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
        match adapter.insert_document("db", "   ", Document::new()).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_document_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter
            .update_document("db", "c", DocumentId::Number(1), doc! { "name": "x" })
            .await
        {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_document_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter
            .update_document("   ", "c", DocumentId::Number(1), doc! { "name": "x" })
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_document_rejects_id_in_patch() {
        use bson::oid::ObjectId;
        let adapter = MongoAdapter::new();
        // Guard runs before the connection probe so this does not need a
        // live MongoDB instance to exercise.
        let patch = doc! { "_id": ObjectId::new(), "name": "x" };
        match adapter
            .update_document("db", "c", DocumentId::Number(1), patch)
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("patch must not contain _id"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn delete_document_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter
            .delete_document("db", "c", DocumentId::Number(1))
            .await
        {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn delete_document_rejects_empty_namespace() {
        let adapter = MongoAdapter::new();
        match adapter
            .delete_document("db", "   ", DocumentId::Number(1))
            .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    // -- document_id helpers (Sprint 80) -----------------------------------

    #[test]
    fn document_id_to_bson_parses_objectid_hex() {
        let hex = "507f1f77bcf86cd799439011";
        let bson = document_id_to_bson(&DocumentId::ObjectId(hex.into()))
            .expect("valid ObjectId hex should parse");
        match bson {
            Bson::ObjectId(oid) => assert_eq!(oid.to_hex(), hex),
            other => panic!("expected Bson::ObjectId, got {other:?}"),
        }
    }

    #[test]
    fn document_id_to_bson_rejects_invalid_objectid_hex() {
        let err = document_id_to_bson(&DocumentId::ObjectId("not-hex".into()))
            .expect_err("invalid hex must surface a Validation error");
        match err {
            AppError::Validation(msg) => assert!(
                msg.contains("invalid ObjectId hex"),
                "unexpected message: {msg}"
            ),
            other => panic!("expected Validation error, got {other:?}"),
        }
    }

    #[test]
    fn document_id_to_bson_preserves_string_and_number() {
        let s = document_id_to_bson(&DocumentId::String("abc".into()))
            .expect("string id should pass through");
        assert_eq!(s, Bson::String("abc".into()));

        let n = document_id_to_bson(&DocumentId::Number(42))
            .expect("number id should pass through as Int64");
        assert_eq!(n, Bson::Int64(42));
    }

    #[test]
    fn document_id_to_bson_preserves_raw_variant() {
        let raw = Bson::Boolean(true);
        let out = document_id_to_bson(&DocumentId::Raw(raw.clone()))
            .expect("raw variant should pass through");
        assert_eq!(out, raw);
    }

    #[test]
    fn bson_id_to_document_id_maps_objectid_and_int32() {
        use bson::oid::ObjectId;
        let oid = ObjectId::new();
        let id = bson_id_to_document_id(&Bson::ObjectId(oid));
        match id {
            DocumentId::ObjectId(hex) => assert_eq!(hex, oid.to_hex()),
            other => panic!("expected DocumentId::ObjectId, got {other:?}"),
        }

        // Int32 must widen to i64.
        let id32 = bson_id_to_document_id(&Bson::Int32(5));
        match id32 {
            DocumentId::Number(n) => assert_eq!(n, 5_i64),
            other => panic!("expected DocumentId::Number(5), got {other:?}"),
        }
    }

    #[test]
    fn bson_id_to_document_id_maps_string_int64_and_raw() {
        let id_str = bson_id_to_document_id(&Bson::String("x".into()));
        match id_str {
            DocumentId::String(s) => assert_eq!(s, "x"),
            other => panic!("expected DocumentId::String, got {other:?}"),
        }

        let id64 = bson_id_to_document_id(&Bson::Int64(9_999_999_999));
        match id64 {
            DocumentId::Number(n) => assert_eq!(n, 9_999_999_999_i64),
            other => panic!("expected DocumentId::Number, got {other:?}"),
        }

        // Boolean falls through to Raw — it has no lossless DocumentId
        // representation so the enum escape hatch is the correct mapping.
        let id_raw = bson_id_to_document_id(&Bson::Boolean(true));
        match id_raw {
            DocumentId::Raw(b) => assert_eq!(b, Bson::Boolean(true)),
            other => panic!("expected DocumentId::Raw, got {other:?}"),
        }
    }

    #[test]
    fn find_body_default_is_empty_filter_no_sort_no_projection() {
        let body = FindBody::default();
        assert!(body.filter.is_empty());
        assert!(body.sort.is_none());
        assert!(body.projection.is_none());
        assert_eq!(body.skip, 0);
        assert_eq!(body.limit, 0);
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
