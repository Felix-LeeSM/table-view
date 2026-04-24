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
//! The still-stubbed methods (`aggregate`, `insert_document`,
//! `update_document`, `delete_document`) retain their Sprint 65 placeholder
//! behaviour; regression tests below continue to assert the `Unsupported`
//! error path so future sprints notice when they're uplifted.
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

use crate::error::AppError;
use crate::models::{ColumnInfo, ConnectionConfig, DatabaseType, QueryColumn, TableInfo};

use super::{
    BoxFuture, DbAdapter, DocumentAdapter, DocumentId, DocumentQueryResult, FindBody, NamespaceInfo,
};

/// Document-paradigm adapter backed by the official `mongodb` driver.
pub struct MongoAdapter {
    client: Arc<Mutex<Option<Client>>>,
    default_db: Arc<Mutex<Option<String>>>,
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

    async fn current_client(&self) -> Result<Client, AppError> {
        let guard = self.client.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| AppError::Connection("MongoDB connection is not established".into()))
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
            {
                let mut guard = self.default_db.lock().await;
                *guard = if config.database.trim().is_empty() {
                    None
                } else {
                    Some(config.database.clone())
                };
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
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async move {
            if db.trim().is_empty() {
                return Err(AppError::Validation(
                    "Database name must not be empty".into(),
                ));
            }
            let client = self.current_client().await?;
            let names = client
                .database(db)
                .list_collection_names()
                .await
                .map_err(|e| AppError::Database(format!("list_collection_names failed: {e}")))?;
            let schema = db.to_string();
            Ok(names
                .into_iter()
                .map(|name| TableInfo {
                    name,
                    schema: schema.clone(),
                    row_count: None,
                })
                .collect())
        })
    }

    fn infer_collection_fields<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        sample_size: usize,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move {
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
                        return Err(AppError::Database(format!("cursor iteration failed: {e}")));
                    }
                }
            }

            Ok(infer_columns_from_samples(&samples))
        })
    }

    fn find<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        body: FindBody,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async move {
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
                        return Err(AppError::Database(format!("cursor iteration failed: {e}")));
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
            let total_count_u64 = coll
                .estimated_document_count()
                .await
                .map_err(|e| AppError::Database(format!("estimated_document_count failed: {e}")))?;
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
        })
    }

    fn aggregate<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _pipeline: Vec<Document>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "MongoAdapter::aggregate is not implemented until Sprint 68".into(),
            ))
        })
    }

    fn insert_document<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _doc: Document,
    ) -> BoxFuture<'a, Result<DocumentId, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "MongoAdapter::insert_document is not implemented until Sprint 69".into(),
            ))
        })
    }

    fn update_document<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _id: DocumentId,
        _patch: Document,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "MongoAdapter::update_document is not implemented until Sprint 69".into(),
            ))
        })
    }

    fn delete_document<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _id: DocumentId,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "MongoAdapter::delete_document is not implemented until Sprint 69".into(),
            ))
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
        match adapter.list_collections("   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    // -- Unsupported stub coverage ------------------------------------------
    //
    // Sprint 66 lifted `infer_collection_fields` and `find` out of the
    // Unsupported path; the remaining four stubs keep their regression
    // guard so the next sprint notices when they're uplifted.

    #[tokio::test]
    async fn infer_collection_fields_without_connection_returns_connection_error() {
        let adapter = MongoAdapter::new();
        match adapter.infer_collection_fields("db", "c", 10).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("not established"), "unexpected message: {msg}");
            }
            other => panic!("expected Connection error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn infer_collection_fields_rejects_empty_db_name() {
        let adapter = MongoAdapter::new();
        match adapter.infer_collection_fields("   ", "c", 10).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation error, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn infer_collection_fields_rejects_empty_collection_name() {
        let adapter = MongoAdapter::new();
        match adapter.infer_collection_fields("db", "   ", 10).await {
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
        match adapter.find("db", "c", body).await {
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
        match adapter.find("   ", "", body).await {
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
    async fn aggregate_returns_unsupported() {
        let adapter = MongoAdapter::new();
        match adapter.aggregate("db", "c", Vec::new()).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("aggregate")),
            other => panic!("expected Unsupported, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn insert_document_returns_unsupported() {
        let adapter = MongoAdapter::new();
        match adapter.insert_document("db", "c", Document::new()).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("insert_document")),
            other => panic!("expected Unsupported, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn update_document_returns_unsupported() {
        let adapter = MongoAdapter::new();
        match adapter
            .update_document("db", "c", DocumentId::Number(1), Document::new())
            .await
        {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("update_document")),
            other => panic!("expected Unsupported, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn delete_document_returns_unsupported() {
        let adapter = MongoAdapter::new();
        match adapter
            .delete_document("db", "c", DocumentId::Number(1))
            .await
        {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("delete_document")),
            other => panic!("expected Unsupported, got ok? {}", other.is_ok()),
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
}
