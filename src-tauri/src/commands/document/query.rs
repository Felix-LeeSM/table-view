//! Document paradigm — read-path query commands.
//!
//! `find_documents` wraps the `DocumentAdapter::find` trait method. The
//! request body carries the
//! `filter` / `sort` / `projection` / `skip` / `limit` fields directly as
//! BSON documents so the frontend can forward its Find builder state
//! without an intermediate serialisation step.
//!
//! `aggregate_documents` is the sibling dispatcher for
//! `DocumentAdapter::aggregate`. The pipeline arrives as a
//! `Vec<bson::Document>` so the frontend can send a
//! `Record<string, unknown>[]` payload that serde deserialises element-wise
//! without a wrapper struct. All error paths mirror `find_documents`:
//! unknown connection id → `AppError::NotFound`, non-document paradigm →
//! `AppError::Unsupported` (via `as_document()?`), adapter failures bubble up
//! as `AppError::Database` / `AppError::Connection` / `AppError::Validation`.
//!
//! Handler bodies are hoisted into `_inner(&AppState)` shape; cancel-token
//! helpers moved to `commands/document/mod.rs`.

use crate::commands::connection::AppState;
use crate::db::{DocumentQueryResult, DocumentRow, FindBody};
use crate::error::AppError;

use super::{not_connected, register_cancel_token, release_cancel_token};

async fn find_documents_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    mut body: FindBody,
    query_id: Option<&str>,
) -> Result<DocumentQueryResult, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    // Issue #1269 (P1) — stamp the running op with the cancel tag so native
    // cancel (`killOp`) can resolve its opid via `$currentOp` on this comment.
    body.comment = query_id.map(str::to_string);

    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .find(
                database,
                collection,
                body,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

/// Execute a MongoDB `find` against `database.collection` and return the
/// flattened projection expected by the DataGrid (`DocumentQueryResult`).
///
/// `body` defaults to an empty filter with no sort/projection when omitted
/// fields are absent — see `FindBody::default()`.
#[tauri::command]
pub async fn find_documents(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    body: Option<FindBody>,
    // AC-180-04: optional cancel-token id.
    query_id: Option<String>,
) -> Result<DocumentQueryResult, AppError> {
    // Issue #1231 — publish the persisted row cap for the cursor drain loop.
    crate::commands::sqlite_pool::publish_row_cap().await;
    find_documents_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        body.unwrap_or_default(),
        query_id.as_deref(),
    )
    .await
}

async fn aggregate_documents_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    pipeline: Vec<bson::Document>,
    query_id: Option<&str>,
) -> Result<DocumentQueryResult, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .aggregate(
                database,
                collection,
                pipeline,
                // Issue #1269 (P1) — stamp the cancel tag so native cancel
                // (`killOp`) can resolve this op's opid via `$currentOp`.
                query_id.map(str::to_string),
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

/// Execute a MongoDB aggregation pipeline against `database.collection` and
/// return the flattened projection expected by the DataGrid
/// (`DocumentQueryResult`).
///
/// The caller supplies `pipeline` as a JSON array of stages; serde
/// deserialises each element into a `bson::Document`, so stages like
/// `[{"$match": {...}}, {"$sort": {...}}]` flow straight to the driver
/// without a wrapper struct. An empty pipeline degenerates to a pass-through
/// `find`-equivalent scan (driver default behaviour).
///
/// Side-effect stages (`$out`, `$merge`) are not explicitly blocked by this
/// command; the contract limits scope to read-only result
/// collection, and callers are expected to steer clear. Preview / safety
/// guards are to be revisited.
#[tauri::command]
pub async fn aggregate_documents(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    pipeline: Vec<bson::Document>,
    // AC-180-04: optional cancel-token id, mirrors find_documents.
    query_id: Option<String>,
) -> Result<DocumentQueryResult, AppError> {
    // Issue #1584 — pipeline stages `$out` / `$merge` write to a collection, so
    // treat aggregate as a destructive command: reject the launcher webview.
    crate::commands::guard::guard_not_launcher(window.label())?;
    // Issue #1231 — publish the persisted row cap for the cursor drain loop.
    crate::commands::sqlite_pool::publish_row_cap().await;
    aggregate_documents_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        pipeline,
        query_id.as_deref(),
    )
    .await
}

// ── Read-path commands (2026-05-14) ─────────────────────────────────────
//
// Reason: the `findOne` / `countDocuments` / `estimatedDocumentCount` /
// `distinct` methods the mongosh parser dispatches. Each inner fn follows the
// existing `find_documents_inner` pattern (cancel-token register/release +
// `as_document()?` gate) verbatim.

async fn find_one_document_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter: bson::Document,
    query_id: Option<&str>,
) -> Result<Option<DocumentRow>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .find_one(
                database,
                collection,
                filter,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

/// Single-document projection.
///
/// Dispatches `db.coll.findOne(<filter>)`. `Ok(None)` when no document
/// matches; `Ok(Some(DocumentRow))` otherwise (columns + projected row +
/// raw BSON for Quick Look).
#[tauri::command]
pub async fn find_one_document(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    filter: Option<bson::Document>,
    query_id: Option<String>,
) -> Result<Option<DocumentRow>, AppError> {
    find_one_document_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        filter.unwrap_or_default(),
        query_id.as_deref(),
    )
    .await
}

async fn count_documents_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter: bson::Document,
    query_id: Option<&str>,
) -> Result<i64, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .count_documents(
                database,
                collection,
                filter,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

/// Exact filter count.
///
/// Dispatches `db.coll.countDocuments(<filter>)`. The driver scans the
/// collection for an accurate match — for an O(1) metadata estimate, use
/// `estimated_document_count`.
#[tauri::command]
pub async fn count_documents(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    filter: Option<bson::Document>,
    query_id: Option<String>,
) -> Result<i64, AppError> {
    count_documents_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        filter.unwrap_or_default(),
        query_id.as_deref(),
    )
    .await
}

async fn estimated_document_count_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    query_id: Option<&str>,
) -> Result<i64, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .estimated_document_count(
                database,
                collection,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

/// O(1) metadata estimate of total document count.
///
/// Dispatches `db.coll.estimatedDocumentCount()`. Returns an approximate
/// count sourced from the collection's metadata — exact counts require the
/// slower `count_documents` path.
#[tauri::command]
pub async fn estimated_document_count(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    query_id: Option<String>,
) -> Result<i64, AppError> {
    estimated_document_count_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        query_id.as_deref(),
    )
    .await
}

async fn distinct_documents_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    field: &str,
    filter: bson::Document,
    query_id: Option<&str>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .distinct(
                database,
                collection,
                field,
                filter,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

/// Distinct field values.
///
/// Dispatches `db.coll.distinct(<field>, <filter>)`. Returns each unique
/// value flattened through `flatten_cell` so the wire shape matches the
/// grid / Quick Look helper paths used by the other read commands.
#[tauri::command]
pub async fn distinct_documents(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    field: String,
    filter: Option<bson::Document>,
    query_id: Option<String>,
) -> Result<Vec<serde_json::Value>, AppError> {
    distinct_documents_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        &field,
        filter.unwrap_or_default(),
        query_id.as_deref(),
    )
    .await
}

async fn explain_mongo_find_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    body: FindBody,
    verbosity: &str,
    // Issue #1269 — optional cooperative cancel id (see `explain_rdb_query`).
    // Cooperative only: `cancel_query(query_id)` drops the client-side await;
    // the server op is not natively killed.
    query_id: Option<&str>,
) -> Result<serde_json::Value, AppError> {
    if collection.trim().is_empty() {
        return Err(AppError::Validation(
            "Collection name must not be empty".into(),
        ));
    }
    let cancel_handle = register_cancel_token(state, query_id).await;
    let result = async {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        let doc = active.as_document()?;
        match cancel_handle.as_ref().map(|(_, tok)| tok) {
            Some(token) => tokio::select! {
                r = doc.explain_query(database, collection, body, verbosity) => r,
                _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
            },
            None => {
                doc.explain_query(database, collection, body, verbosity)
                    .await
            }
        }
    }
    .await;
    release_cancel_token(state, &cancel_handle).await;
    result
}

/// Mongo `runCommand({explain: {find, filter, ...}, verbosity})`.
/// Issue #1210 — `body` carries the same
/// filter/sort/projection/skip/limit the real `find` executes so the plan
/// matches actual execution. Returns the raw explain response as
/// `serde_json::Value`.
///
/// Issue #1619 — `body` is taken by value, not `Option<FindBody>`: the
/// sole caller (`explainMongoFind` in `src/lib/api/explain.ts`) always sends
/// `body: args.body ?? {}`, so the `None` arm of the old `Option` was dead.
/// An empty `{}` still deserialises to `FindBody::default()` via each field's
/// `#[serde(default)]`, so the no-body case keeps working without the wrapper.
#[tauri::command]
pub async fn explain_mongo_find(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    body: FindBody,
    verbosity: Option<String>,
    query_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    explain_mongo_find_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        body,
        verbosity.as_deref().unwrap_or("queryPlanner"),
        query_id.as_deref(),
    )
    .await
}

// ── Generic runCommand gateway (2026-05-17) ─────────────────────────────
//
// Reason: a thin gateway so the frontend can pass admin / diagnostic commands
// (`serverStatus`, `dbStats`, `currentOp`, `ping`, …) not covered by the
// mongosh method whitelist through one IPC call. Every mongosh admin helper is
// essentially a `runCommand` wrapper, so the generic dispatch is exposed on its
// own and coexists with the statement-level method whitelist. When `database`
// is `None` the driver runs against the `admin` DB (adminCommand semantics);
// `Some("myapp")` targets that db (db-scoped command).
//
// ── Extended-JSON → BSON conversion (2026-05-17) ────────────────────────
//
// Reason: the mongoshAst normalizes BSON literals like `ObjectId("507f…")`
// into the extended-JSON placeholder `{"$oid": "507f…"}`. If that
// placeholder serde-deserializes into `bson::Document` as-is, the driver
// sees a sub-document and the MongoDB server queries a plain doc instead
// of an ObjectId — a semantic bug. The IPC entry takes a
// `serde_json::Value` and converts it with a single
// `bson::Bson::try_from(...)` call into the real
// `Bson::ObjectId` / `Bson::DateTime` / `Bson::Int64` / `Bson::Decimal128` /
// `Bson::Binary(Uuid)` variant. A plain JSON body (no BSON markers)
// converts to the same BSON Document (regression-lock).

/// Convert a frontend-shaped JSON object into a BSON document, honouring
/// extended-JSON placeholders (`{$oid}`, `{$date}`, `{$numberLong}`,
/// `{$numberDecimal}`, `{$uuid}`) so the MongoDB driver sees real BSON
/// variants instead of sub-documents.
///
/// The wrapper around `bson::Document::try_from` exists so (a) we can keep
/// `AppError` boundaries thin and (b) we reject any
/// non-object root with a clear message (`runCommand` body is always an
/// object literal at the AST layer, but this is the IPC trust boundary).
fn extjson_to_bson_document(value: serde_json::Value) -> Result<bson::Document, AppError> {
    let obj = match value {
        serde_json::Value::Object(map) => map,
        other => {
            return Err(AppError::Validation(format!(
                "runCommand body must be a JSON object, got {}",
                match other {
                    serde_json::Value::Null => "null",
                    serde_json::Value::Bool(_) => "boolean",
                    serde_json::Value::Number(_) => "number",
                    serde_json::Value::String(_) => "string",
                    serde_json::Value::Array(_) => "array",
                    serde_json::Value::Object(_) => unreachable!(),
                }
            )))
        }
    };
    bson::Document::try_from(obj)
        .map_err(|e| AppError::Validation(format!("invalid extended-JSON in runCommand body: {e}")))
}

const READ_ONLY_MONGO_RUN_COMMANDS: &[&str] = &[
    "buildInfo",
    "collStats",
    "connectionStatus",
    "count",
    "currentOp",
    "dbStats",
    "distinct",
    "explain",
    "find",
    "getCmdLineOpts",
    "getLog",
    "getParameter",
    "hello",
    "hostInfo",
    "isMaster",
    "listCollections",
    "listDatabases",
    "listIndexes",
    "ping",
    "serverStatus",
    "whatsmyuri",
];

async fn run_mongo_command_inner(
    state: &AppState,
    connection_id: &str,
    database: Option<&str>,
    command: serde_json::Value,
    safety_confirmed: bool,
    query_id: Option<&str>,
) -> Result<serde_json::Value, AppError> {
    let mut command = extjson_to_bson_document(command)?;
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_document()?;
    require_run_command_safety(&command, safety_confirmed)?;
    // Issue #1269 (P1) — stamp the cancel tag so the running op carries
    // `command.comment == query_id`, letting native cancel
    // (`cancel_query_by_tag`) resolve the opid via `$currentOp`. A caller
    // that already set an explicit `comment` keeps it (their intent wins).
    if let Some(qid) = query_id {
        command
            .entry("comment".to_string())
            .or_insert_with(|| bson::Bson::String(qid.to_string()));
    }
    adapter.run_command(database, command).await
}

fn require_run_command_safety(command: &bson::Document, confirmed: bool) -> Result<(), AppError> {
    let Some(first_key) = command.keys().next() else {
        return Ok(());
    };
    if READ_ONLY_MONGO_RUN_COMMANDS.contains(&first_key.as_str()) || confirmed {
        return Ok(());
    }
    Err(AppError::Validation(format!(
        "runCommand {first_key} requires safety confirmation because it is not in the read-only allowlist"
    )))
}

/// Execute `db.runCommand({...})` / `db.adminCommand({...})`.
///
/// `database` passes the frontend's `tab.database` through verbatim —
/// `None` when empty, `Some(name)` otherwise. With `None` the backend
/// uses the driver's `admin` DB context to preserve admin-command
/// semantics.
///
/// `command` arrives as a `serde_json::Value` and is converted via
/// `bson::Bson::try_from`, turning extended-JSON placeholders (`{$oid}`,
/// `{$date}`, `{$numberLong}`, `{$numberDecimal}`, `{$uuid}`) into real
/// BSON variants before reaching the driver. Plain JSON converts to the
/// same BSON Document.
#[tauri::command]
pub async fn run_mongo_command(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: Option<String>,
    command: serde_json::Value,
    safety_confirmed: Option<bool>,
    // Issue #1269 (P1) — optional cancel-token id. Stamped as the op's
    // `comment` so native cancel (`cancel_query_by_tag`) can `killOp` it.
    query_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    run_mongo_command_inner(
        state.inner(),
        &connection_id,
        database.as_deref(),
        command,
        safety_confirmed.unwrap_or(false),
        query_id.as_deref(),
    )
    .await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    //! Reason (2026-05-08): the handlers were extracted as `_inner(&AppState)`,
    //! so the tests call them directly. Scenarios: NotFound /
    //! Unsupported(document) / trait delegation / cancel-token release.
    use super::*;
    use crate::commands::test_util::{document_default, rdb_default, state_with};

    // ── find_documents ──────────────────────────────────────────────────

    #[tokio::test]
    async fn find_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            find_documents_inner(&state, "absent", "db", "c", FindBody::default(), None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn find_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            find_documents_inner(&state, "rdb", "db", "c", FindBody::default(), None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn find_doc_default_returns_empty_query_result() {
        let state = state_with("d", document_default()).await;
        let r = find_documents_inner(&state, "d", "db", "c", FindBody::default(), None)
            .await
            .unwrap();
        assert!(r.columns.is_empty());
        assert!(r.rows.is_empty());
        assert_eq!(r.total_count, 0);
    }

    #[tokio::test]
    async fn find_releases_token_on_round_trip() {
        let state = state_with("d", document_default()).await;
        let _ =
            find_documents_inner(&state, "d", "db", "c", FindBody::default(), Some("q-find")).await;
        assert!(!state.query_tokens.lock().await.contains_key("q-find"));
    }

    // ── aggregate_documents ─────────────────────────────────────────────

    #[tokio::test]
    async fn aggregate_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            aggregate_documents_inner(&state, "absent", "db", "c", Vec::new(), None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn aggregate_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            aggregate_documents_inner(&state, "rdb", "db", "c", Vec::new(), None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn aggregate_doc_default_returns_empty_query_result() {
        let state = state_with("d", document_default()).await;
        let r = aggregate_documents_inner(&state, "d", "db", "c", Vec::new(), None)
            .await
            .unwrap();
        assert!(r.columns.is_empty());
        assert_eq!(r.total_count, 0);
    }

    #[tokio::test]
    async fn aggregate_releases_token_on_round_trip() {
        let state = state_with("d", document_default()).await;
        let _ = aggregate_documents_inner(&state, "d", "db", "c", Vec::new(), Some("q-agg")).await;
        assert!(!state.query_tokens.lock().await.contains_key("q-agg"));
    }

    #[tokio::test]
    async fn aggregate_stamps_comment_with_query_id() {
        // Issue #1269 (P1) — the query-tab aggregate runner forwards its
        // queryId as the op's `comment` so native cancel
        // (`cancel_query_by_tag`) can resolve the opid via `$currentOp`.
        use crate::db::testing::StubDocumentAdapter;
        use crate::db::ActiveAdapter;
        use std::sync::{Arc, Mutex};

        let captured: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let captured_for_closure = captured.clone();
        let mut s = StubDocumentAdapter::default();
        s.aggregate_fn = Some(Box::new(move |_pipeline, comment| {
            *captured_for_closure.lock().unwrap() = comment;
            Ok(DocumentQueryResult {
                truncated: false,
                columns: Vec::new(),
                rows: Vec::new(),
                raw_documents: Vec::new(),
                total_count: 0,
                execution_time_ms: 0,
            })
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;

        aggregate_documents_inner(&state, "d", "db", "c", Vec::new(), Some("q-agg"))
            .await
            .expect("aggregate should succeed");
        assert_eq!(captured.lock().unwrap().clone(), Some("q-agg".to_string()));
    }

    // ── Read commands (2026-05-14) ─────────────────────────────────────
    //
    // Reason: verify that each _inner handler passes the 3-rejection + 1-happy
    // matrix: (a) missing connection → NotFound, (b) RDB paradigm →
    // Unsupported, (c) document default stub → natural defaults
    // (None / 0 / Vec::new). The cancel-token release regression is common to
    // the read-path family, so a single tracer (`find_one`) represents it.
    use crate::db::testing::StubDocumentAdapter;
    use crate::db::ActiveAdapter;

    // ── find_one_document ──────────────────────────────────────────────

    #[tokio::test]
    async fn find_one_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            find_one_document_inner(&state, "absent", "db", "c", bson::Document::new(), None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn find_one_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            find_one_document_inner(&state, "rdb", "db", "c", bson::Document::new(), None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn find_one_default_returns_none() {
        let state = state_with("d", document_default()).await;
        let r = find_one_document_inner(&state, "d", "db", "c", bson::Document::new(), None)
            .await
            .unwrap();
        assert!(r.is_none());
    }

    #[tokio::test]
    async fn find_one_releases_token_on_round_trip() {
        let state = state_with("d", document_default()).await;
        let _ = find_one_document_inner(
            &state,
            "d",
            "db",
            "c",
            bson::Document::new(),
            Some("q-findone"),
        )
        .await;
        assert!(!state.query_tokens.lock().await.contains_key("q-findone"));
    }

    #[tokio::test]
    async fn find_one_routes_to_stub_with_document_row() {
        use crate::db::DocumentRow;
        use crate::models::{ColumnCategory, QueryColumn};
        let mut s = StubDocumentAdapter::default();
        s.find_one_fn = Some(Box::new(|_db: &str, _coll: &str| {
            Ok(Some(DocumentRow {
                columns: vec![QueryColumn {
                    name: "_id".into(),
                    data_type: "ObjectId".into(),
                    category: ColumnCategory::Unknown,
                }],
                row: vec![serde_json::Value::Null],
                raw: bson::Document::new(),
            }))
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = find_one_document_inner(&state, "d", "db", "c", bson::Document::new(), None)
            .await
            .expect("should succeed")
            .expect("should be Some");
        assert_eq!(r.columns.len(), 1);
        assert_eq!(r.columns[0].name, "_id");
    }

    // ── count_documents ────────────────────────────────────────────────

    #[tokio::test]
    async fn count_documents_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            count_documents_inner(&state, "absent", "db", "c", bson::Document::new(), None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn count_documents_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            count_documents_inner(&state, "rdb", "db", "c", bson::Document::new(), None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn count_documents_default_returns_zero() {
        let state = state_with("d", document_default()).await;
        assert_eq!(
            count_documents_inner(&state, "d", "db", "c", bson::Document::new(), None)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn count_documents_routes_to_stub() {
        let mut s = StubDocumentAdapter::default();
        s.count_documents_fn = Some(Box::new(|_db: &str, _coll: &str| Ok(7)));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = count_documents_inner(&state, "d", "db", "c", bson::Document::new(), None)
            .await
            .unwrap();
        assert_eq!(r, 7);
    }

    // ── estimated_document_count ───────────────────────────────────────

    #[tokio::test]
    async fn estimated_document_count_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            estimated_document_count_inner(&state, "absent", "db", "c", None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn estimated_document_count_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            estimated_document_count_inner(&state, "rdb", "db", "c", None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn estimated_document_count_default_returns_zero() {
        let state = state_with("d", document_default()).await;
        assert_eq!(
            estimated_document_count_inner(&state, "d", "db", "c", None)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn estimated_document_count_routes_to_stub() {
        let mut s = StubDocumentAdapter::default();
        s.estimated_document_count_fn = Some(Box::new(|_db: &str, _coll: &str| Ok(42)));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = estimated_document_count_inner(&state, "d", "db", "c", None)
            .await
            .unwrap();
        assert_eq!(r, 42);
    }

    // ── distinct_documents ─────────────────────────────────────────────

    #[tokio::test]
    async fn distinct_documents_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            distinct_documents_inner(
                &state,
                "absent",
                "db",
                "c",
                "field",
                bson::Document::new(),
                None
            )
            .await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn distinct_documents_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            distinct_documents_inner(
                &state,
                "rdb",
                "db",
                "c",
                "field",
                bson::Document::new(),
                None
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn distinct_documents_default_returns_empty_vec() {
        let state = state_with("d", document_default()).await;
        let r =
            distinct_documents_inner(&state, "d", "db", "c", "field", bson::Document::new(), None)
                .await
                .unwrap();
        assert!(r.is_empty());
    }

    #[tokio::test]
    async fn distinct_documents_routes_to_stub_with_field() {
        let mut s = StubDocumentAdapter::default();
        s.distinct_fn = Some(Box::new(|_db: &str, _coll: &str, field: &str| {
            Ok(vec![serde_json::Value::String(format!("got:{field}"))])
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = distinct_documents_inner(
            &state,
            "d",
            "db",
            "c",
            "myfield",
            bson::Document::new(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0], serde_json::json!("got:myfield"));
    }

    // ── explain_mongo_find ─────────────────────────────────────────────

    #[tokio::test]
    async fn explain_mongo_find_rejects_empty_collection() {
        let state = state_with("d", document_default()).await;
        match explain_mongo_find_inner(
            &state,
            "d",
            "db",
            "  ",
            FindBody::default(),
            "queryPlanner",
            None,
        )
        .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected: {msg}")
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn explain_mongo_find_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match explain_mongo_find_inner(
            &state,
            "absent",
            "db",
            "c",
            FindBody::default(),
            "queryPlanner",
            None,
        )
        .await
        {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn explain_mongo_find_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            explain_mongo_find_inner(
                &state,
                "rdb",
                "db",
                "c",
                FindBody::default(),
                "queryPlanner",
                None
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
    }

    // Issue #1210 — the command must thread the full find body (not just the
    // filter) to the adapter so the plan reflects sort/limit/projection.
    #[tokio::test]
    async fn explain_mongo_find_routes_to_trait_method_with_args() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        let called = Arc::new(AtomicBool::new(false));
        let called_for_closure = called.clone();
        let mut s = StubDocumentAdapter::default();
        s.explain_query_fn = Some(Box::new(move |db, coll, body, verbosity| {
            assert_eq!(db, "mydb");
            assert_eq!(coll, "mycoll");
            assert_eq!(verbosity, "executionStats");
            assert_eq!(body.filter, bson::doc! { "status": "active" });
            assert_eq!(body.sort, Some(bson::doc! { "name": -1 }));
            assert_eq!(body.limit, 10);
            called_for_closure.store(true, Ordering::SeqCst);
            Ok(serde_json::json!({ "ok": 1 }))
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = explain_mongo_find_inner(
            &state,
            "d",
            "mydb",
            "mycoll",
            FindBody {
                filter: bson::doc! { "status": "active" },
                sort: Some(bson::doc! { "name": -1 }),
                limit: 10,
                ..Default::default()
            },
            "executionStats",
            None,
        )
        .await
        .unwrap();
        assert!(called.load(Ordering::SeqCst));
        assert_eq!(r["ok"], serde_json::Value::from(1));
    }

    // ── run_mongo_command (2026-05-17) ─────────────────────────────────
    //
    // Reason: verify that the generic runCommand gateway (a) returns NotFound
    // for a missing connection, (b) Unsupported for an RDB paradigm,
    // (c) routes to the admin context when database=None, and (d) passes that
    // name through to the adapter when database=Some("myapp").

    #[tokio::test]
    async fn run_mongo_command_unknown_connection_returns_notfound() {
        let state = AppState::new();
        let cmd = serde_json::json!({ "ping": 1 });
        match run_mongo_command_inner(&state, "absent", None, cmd, false, None).await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_mongo_command_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        let cmd = serde_json::json!({ "ping": 1 });
        assert!(matches!(
            run_mongo_command_inner(&state, "rdb", None, cmd, false, None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn run_mongo_command_database_none_routes_to_admin_context() {
        // Reason: adminCommand semantics — when the frontend sends no chip
        // (`tab.database = undefined`) plus `db.runCommand({serverStatus: 1})`,
        // the backend must be called with `database = None`. The closure
        // captures the argument the adapter received (None) + the command
        // body to verify it.
        use crate::db::testing::StubDocumentAdapter;
        use crate::db::ActiveAdapter;
        use std::sync::{Arc, Mutex};

        let captured: Arc<Mutex<Option<Option<String>>>> = Arc::new(Mutex::new(None));
        let captured_for_closure = captured.clone();
        let mut s = StubDocumentAdapter::default();
        s.run_command_fn = Some(Box::new(move |database, command| {
            *captured_for_closure.lock().unwrap() = Some(database.map(|s| s.to_string()));
            assert!(command.contains_key("serverStatus"));
            Ok(serde_json::json!({ "ok": 1, "version": "7.0.0" }))
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;

        let cmd = serde_json::json!({ "serverStatus": 1 });
        let r = run_mongo_command_inner(&state, "d", None, cmd, false, None)
            .await
            .expect("should succeed");
        assert_eq!(r["ok"], serde_json::Value::from(1));
        assert_eq!(r["version"], serde_json::Value::from("7.0.0"));
        let captured = captured.lock().unwrap().clone();
        assert_eq!(captured, Some(None), "expected database=None routing");
    }

    #[tokio::test]
    async fn run_mongo_command_database_some_routes_to_named_db() {
        // Reason: db-scoped command — when the frontend sends chip = "myapp" +
        // `db.runCommand({dbStats: 1})`, the backend must be called with
        // `database = Some("myapp")`.
        use crate::db::testing::StubDocumentAdapter;
        use crate::db::ActiveAdapter;
        use std::sync::{Arc, Mutex};

        let captured: Arc<Mutex<Option<Option<String>>>> = Arc::new(Mutex::new(None));
        let captured_for_closure = captured.clone();
        let mut s = StubDocumentAdapter::default();
        s.run_command_fn = Some(Box::new(move |database, command| {
            *captured_for_closure.lock().unwrap() = Some(database.map(|s| s.to_string()));
            assert!(command.contains_key("dbStats"));
            Ok(serde_json::json!({ "ok": 1, "db": "myapp" }))
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;

        let cmd = serde_json::json!({ "dbStats": 1 });
        let r = run_mongo_command_inner(&state, "d", Some("myapp"), cmd, false, None)
            .await
            .expect("should succeed");
        assert_eq!(r["db"], serde_json::Value::from("myapp"));
        let captured = captured.lock().unwrap().clone();
        assert_eq!(
            captured,
            Some(Some("myapp".to_string())),
            "expected database=Some(\"myapp\") routing"
        );
    }

    #[tokio::test]
    async fn run_mongo_command_stamps_comment_with_query_id() {
        // Issue #1269 (P1) — the query-tab runCommand runner forwards its
        // queryId so the op carries `command.comment == query_id`, letting
        // native cancel (`cancel_query_by_tag`) resolve the opid via
        // `$currentOp`. `serverStatus` is read-only ⇒ no safety ack needed.
        use crate::db::testing::StubDocumentAdapter;
        use crate::db::ActiveAdapter;
        use std::sync::{Arc, Mutex};

        let captured: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let captured_for_closure = captured.clone();
        let mut s = StubDocumentAdapter::default();
        s.run_command_fn = Some(Box::new(move |_database, command| {
            *captured_for_closure.lock().unwrap() =
                command.get_str("comment").ok().map(str::to_string);
            Ok(serde_json::json!({ "ok": 1 }))
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;

        let cmd = serde_json::json!({ "serverStatus": 1 });
        run_mongo_command_inner(&state, "d", None, cmd, false, Some("q-cmd"))
            .await
            .expect("runCommand should succeed");
        assert_eq!(captured.lock().unwrap().clone(), Some("q-cmd".to_string()));
    }

    #[test]
    fn run_mongo_command_read_only_allowlist_does_not_require_safety_ack() {
        for command_name in READ_ONLY_MONGO_RUN_COMMANDS {
            let mut command = bson::Document::new();
            command.insert(*command_name, 1);
            require_run_command_safety(&command, false)
                .unwrap_or_else(|err| panic!("{command_name} should be read-only: {err:?}"));
        }
    }

    #[tokio::test]
    async fn run_mongo_command_destructive_without_safety_ack_is_validation_error() {
        let state = state_with("d", document_default()).await;
        let body = serde_json::json!({ "drop": "users" });
        match run_mongo_command_inner(&state, "d", Some("myapp"), body, false, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("safety confirmation"),
                    "unexpected validation message: {msg}"
                );
            }
            other => panic!("expected AppError::Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_mongo_command_write_commands_without_safety_ack_are_validation_errors() {
        let state = state_with("d", document_default()).await;
        for body in [
            serde_json::json!({ "delete": "users", "deletes": [{ "q": { "active": false }, "limit": 0 }] }),
            serde_json::json!({ "update": "users", "updates": [{ "q": { "active": false }, "u": { "$set": { "reviewed": true } }, "multi": true }] }),
            serde_json::json!({ "findAndModify": "users", "query": { "_id": 1 }, "update": { "$set": { "reviewed": true } } }),
        ] {
            match run_mongo_command_inner(&state, "d", Some("myapp"), body, false, None).await {
                Err(AppError::Validation(msg)) => {
                    assert!(
                        msg.contains("safety confirmation"),
                        "unexpected validation message: {msg}"
                    );
                }
                other => panic!("expected AppError::Validation, got: {:?}", other),
            }
        }
    }

    #[tokio::test]
    async fn run_mongo_command_unknown_command_without_safety_ack_is_validation_error() {
        let state = state_with("d", document_default()).await;
        let body = serde_json::json!({ "customWriteCapableCommand": 1 });
        match run_mongo_command_inner(&state, "d", Some("myapp"), body, false, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("safety confirmation"),
                    "unexpected validation message: {msg}"
                );
            }
            other => panic!("expected AppError::Validation, got: {:?}", other),
        }
    }

    // ── Extended-JSON → BSON conversion (2026-05-17) ───────────────────
    //
    // Reason: the mongoshAst turns `ObjectId(...)` / `ISODate(...)` /
    // `NumberLong(...)` / `Decimal128(...)` / `UUID(...)` into extended-JSON
    // placeholders (`{$oid: "..."}` etc.). Unless the IPC entry converts
    // that placeholder into a real BSON variant, the driver sees a
    // sub-document and the MongoDB server query breaks semantically. These
    // unit tests cover each marker converting into the actual Bson variant,
    // the plain JSON regression, and the rejection of an invalid placeholder.
    //
    // `StubDocumentAdapter` and `ActiveAdapter` are already imported above —
    // re-importing them here would raise E0252.

    use std::sync::{Arc, Mutex};

    /// Build a stub state + capture handle for the BSON variant captured by
    /// the adapter closure. Single field `target` is the key inside the body
    /// to inspect.
    async fn run_command_capturing(
        body: serde_json::Value,
        target: &'static str,
    ) -> (Result<serde_json::Value, AppError>, Option<bson::Bson>) {
        let captured: Arc<Mutex<Option<bson::Bson>>> = Arc::new(Mutex::new(None));
        let captured_for_closure = captured.clone();
        let target_owned = target.to_string();
        let mut s = StubDocumentAdapter::default();
        s.run_command_fn = Some(Box::new(move |_db, command| {
            *captured_for_closure.lock().unwrap() = command.get(&target_owned).cloned();
            Ok(serde_json::json!({ "ok": 1 }))
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = run_mongo_command_inner(&state, "d", None, body, true, None).await;
        let captured = captured.lock().unwrap().clone();
        (r, captured)
    }

    #[tokio::test]
    async fn run_mongo_command_converts_oid_placeholder_to_object_id() {
        // AC-384-P1-1 — ObjectId placeholder → Bson::ObjectId variant
        let body = serde_json::json!({ "_id": {"$oid": "507f1f77bcf86cd799439011"} });
        let (result, captured) = run_command_capturing(body, "_id").await;
        result.expect("conversion + dispatch succeed");
        match captured.expect("captured _id") {
            bson::Bson::ObjectId(oid) => {
                assert_eq!(oid.to_hex(), "507f1f77bcf86cd799439011")
            }
            other => panic!("expected Bson::ObjectId, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_mongo_command_converts_date_placeholder_to_datetime() {
        // AC-384-P1-2 — ISODate placeholder → Bson::DateTime variant
        let body = serde_json::json!({ "when": {"$date": "2026-05-18T12:00:00Z"} });
        let (result, captured) = run_command_capturing(body, "when").await;
        result.expect("conversion + dispatch succeed");
        match captured.expect("captured when") {
            bson::Bson::DateTime(_) => { /* ok */ }
            other => panic!("expected Bson::DateTime, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_mongo_command_converts_numberlong_placeholder_to_int64() {
        // AC-384-P1-3 — NumberLong placeholder → Bson::Int64 variant
        let body = serde_json::json!({ "n": {"$numberLong": "9223372036854775000"} });
        let (result, captured) = run_command_capturing(body, "n").await;
        result.expect("conversion + dispatch succeed");
        match captured.expect("captured n") {
            bson::Bson::Int64(v) => assert_eq!(v, 9_223_372_036_854_775_000_i64),
            other => panic!("expected Bson::Int64, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_mongo_command_converts_decimal128_placeholder_to_decimal128() {
        // AC-384-P1-4 — Decimal128 placeholder → Bson::Decimal128 variant
        let body = serde_json::json!({ "d": {"$numberDecimal": "3.14"} });
        let (result, captured) = run_command_capturing(body, "d").await;
        result.expect("conversion + dispatch succeed");
        match captured.expect("captured d") {
            bson::Bson::Decimal128(_) => { /* ok */ }
            other => panic!("expected Bson::Decimal128, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_mongo_command_converts_uuid_placeholder_to_binary() {
        // AC-384-P1-5 — UUID placeholder → Bson::Binary(subtype Uuid) variant
        let body = serde_json::json!({ "u": {"$uuid": "550e8400-e29b-41d4-a716-446655440000"} });
        let (result, captured) = run_command_capturing(body, "u").await;
        result.expect("conversion + dispatch succeed");
        match captured.expect("captured u") {
            bson::Bson::Binary(bin) => {
                assert_eq!(bin.subtype, bson::spec::BinarySubtype::Uuid);
                assert_eq!(bin.bytes.len(), 16);
            }
            other => panic!("expected Bson::Binary(Uuid), got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_mongo_command_passes_plain_json_through_unchanged() {
        // AC-384-P1-6 — regression lock: no extended-JSON markers ⇒ identical
        // BSON Document conversion (Int32 / String preserved).
        let body = serde_json::json!({ "ping": 1, "host": "example.com" });
        let (result, _) = run_command_capturing(body, "ping").await;
        result.expect("plain JSON dispatch succeeds");

        // Re-run with a fresh closure that captures the *whole* document so we
        // can assert the shape end-to-end.
        let captured: Arc<Mutex<Option<bson::Document>>> = Arc::new(Mutex::new(None));
        let captured_for_closure = captured.clone();
        let mut s = StubDocumentAdapter::default();
        s.run_command_fn = Some(Box::new(move |_db, command| {
            *captured_for_closure.lock().unwrap() = Some(command);
            Ok(serde_json::json!({ "ok": 1 }))
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let _ = run_mongo_command_inner(
            &state,
            "d",
            None,
            serde_json::json!({ "ping": 1, "host": "example.com" }),
            false,
            None,
        )
        .await
        .expect("ok");
        let doc = captured.lock().unwrap().clone().expect("captured doc");
        match doc.get("ping").expect("ping field") {
            bson::Bson::Int32(v) => assert_eq!(*v, 1),
            other => panic!("expected Bson::Int32 for ping, got: {:?}", other),
        }
        match doc.get("host").expect("host field") {
            bson::Bson::String(v) => assert_eq!(v, "example.com"),
            other => panic!("expected Bson::String for host, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_mongo_command_rejects_invalid_oid_placeholder_as_validation() {
        // AC-384-P1-7 — invalid extended-JSON (24-hex check) surfaces as
        // AppError::Validation, not a panic, not a Database error.
        let state = state_with("d", document_default()).await;
        let body = serde_json::json!({ "_id": {"$oid": "not-24-hex"} });
        match run_mongo_command_inner(&state, "d", None, body, false, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("extended-JSON") || msg.contains("oid") || msg.contains("hex"),
                    "unexpected validation message: {msg}"
                );
            }
            other => panic!("expected AppError::Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_mongo_command_rejects_non_object_body() {
        // Defensive boundary at the IPC trust line — runCommand body must be
        // an object literal. The AST guarantees this upstream, but the
        // converter rejects non-objects explicitly so a future caller cannot
        // smuggle a primitive past the type system.
        let state = state_with("d", document_default()).await;
        let body = serde_json::json!([{ "ping": 1 }]);
        match run_mongo_command_inner(&state, "d", None, body, false, None).await {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("JSON object") || msg.contains("array"),
                    "unexpected validation message: {msg}"
                );
            }
            other => panic!("expected AppError::Validation, got: {:?}", other),
        }
    }
}
