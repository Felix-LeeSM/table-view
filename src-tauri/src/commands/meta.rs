//! Paradigm-neutral metadata commands (Sprint 128).
//!
//! Houses the unified `list_databases` Tauri command — a thin dispatcher
//! that branches on `ActiveAdapter` so the workspace toolbar's
//! `<DbSwitcher>` can fetch the current connection's database list without
//! caring which paradigm is wired underneath. `Search` still returns an
//! empty list; `Kv` now dispatches to Redis/Valkey numeric DB indexes.
//!
//! The Mongo-specific `list_mongo_databases` (`commands/document/browse.rs`)
//! stays as-is — Sprint 128 introduces this unified entry point alongside
//! it without breaking existing callers.

use crate::commands::connection::AppState;
use crate::commands::document::browse::DatabaseInfo;
use crate::commands::not_connected;
use crate::db::ActiveAdapter;
use crate::error::AppError;
use crate::models::ServerActivityRow;

/// Paradigm-aware database list for the active connection.
///
/// Dispatch table:
///   - `Rdb`      → `RdbAdapter::list_databases` (PG returns
///                  `pg_database` rows, default impl returns `vec![]` for
///                  paradigm members without their own override).
///   - `Document` → `DocumentAdapter::list_databases` (Mongo).
///   - `Search`   → `Ok(vec![])` — Phase 7 ES adapter has no per-connection
///                  database concept; the toolbar treats an empty result as
///                  "switcher stays read-only".
///   - `Kv`       → `KvAdapter::list_databases` (Redis numeric DB indexes).
///
/// Returns `AppError::NotFound` when the connection id has no live adapter.
#[tauri::command]
pub async fn list_databases(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<DatabaseInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;

    let namespaces = match active {
        ActiveAdapter::Rdb(adapter) => adapter.list_databases().await?,
        ActiveAdapter::Document(adapter) => adapter.list_databases().await?,
        ActiveAdapter::Search(_) => Vec::new(),
        ActiveAdapter::Kv(adapter) => adapter
            .list_databases()
            .await?
            .into_iter()
            .map(|db| crate::db::NamespaceInfo { name: db.name })
            .collect(),
    };

    Ok(namespaces
        .into_iter()
        .map(|n| DatabaseInfo { name: n.name })
        .collect())
}

/// Switch the active database for the given connection (Sprint 130, 131).
///
/// Dispatch table:
///   - `Rdb`      → `RdbAdapter::switch_database`. PostgresAdapter overrides
///                  the trait default to swap the active sub-pool to
///                  `db_name`; SQLite/MySQL fall back to `Unsupported`
///                  until Phase 9. The frontend toast surfaces the message.
///   - `Document` → `DocumentAdapter::switch_database` (Sprint 131). The
///                  MongoAdapter override mutates its `active_db` field
///                  after a cheap `list_database_names` probe. Other
///                  document adapters keep the default `Unsupported` until
///                  they ship `use_db` semantics.
///   - `Search`   → `Err(Unsupported)` — no per-connection database concept.
///   - `Kv`       → `KvAdapter::switch_database` (Redis `SELECT <index>`).
///
/// Returns `AppError::NotFound` when the connection id has no live adapter,
/// matching `list_databases` semantics.
#[tauri::command]
pub async fn switch_active_db(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    db_name: String,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;

    match active {
        ActiveAdapter::Rdb(adapter) => adapter.switch_database(&db_name).await,
        ActiveAdapter::Document(adapter) => adapter.switch_database(&db_name).await,
        ActiveAdapter::Search(_) => Err(AppError::Unsupported(
            "Search paradigm has no per-connection database concept".into(),
        )),
        ActiveAdapter::Kv(adapter) => {
            let db = db_name.parse::<u16>().map_err(|_| {
                AppError::Validation("Redis database must be a numeric index".into())
            })?;
            adapter.switch_database(db).await
        }
    }
}

/// Resolve the active database the backend currently sees (Sprint 132).
///
/// Used by the QueryTab raw-query hook: after the user runs `\c <db>` the
/// frontend optimistically calls `setActiveDb(db)`, then this command to
/// verify the backend pool actually flipped. A mismatch surfaces a
/// `toast.warn` and reverts the optimistic value.
///
/// Dispatch table:
///   - `Rdb`      → `RdbAdapter::current_database` (default impl runs
///                  `SELECT current_database()` via `execute_sql`).
///   - `Document` → `DocumentAdapter::current_database` (Mongo override
///                  surfaces the in-memory `active_db` accessor — no
///                  driver round-trip required).
///   - `Search`   → `Err(Unsupported)` — no per-connection database concept.
///   - `Kv`       → `KvAdapter::current_database` (Redis numeric DB index).
///
/// Returns `AppError::NotFound` when the connection id has no live adapter,
/// matching `list_databases` / `switch_active_db` semantics.
#[tauri::command]
pub async fn verify_active_db(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;

    match active {
        ActiveAdapter::Rdb(adapter) => Ok(adapter.current_database().await?.unwrap_or_default()),
        ActiveAdapter::Document(adapter) => {
            Ok(adapter.current_database().await?.unwrap_or_default())
        }
        ActiveAdapter::Search(_) => Err(AppError::Unsupported(
            "verify_active_db not supported for Search paradigm".into(),
        )),
        ActiveAdapter::Kv(adapter) => Ok(adapter
            .current_database()
            .await?
            .map(|db| db.to_string())
            .unwrap_or_default()),
    }
}

async fn list_server_activity_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<ServerActivityRow>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    match active {
        ActiveAdapter::Rdb(adapter) => adapter.list_server_activity().await,
        ActiveAdapter::Document(adapter) => adapter.current_op().await,
        ActiveAdapter::Search(_) => Err(AppError::Unsupported(
            "list_server_activity not supported for Search paradigm".into(),
        )),
        ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
            "list_server_activity not supported for key-value paradigm".into(),
        )),
    }
}

/// Sprint 336 (U1 live wire) — paradigm-neutral server activity feed.
/// PG → pg_stat_activity, Mongo → currentOp.
#[tauri::command]
pub async fn list_server_activity(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<ServerActivityRow>, AppError> {
    list_server_activity_inner(state.inner(), &connection_id).await
}

async fn kill_server_activity_inner(
    state: &AppState,
    connection_id: &str,
    id: i64,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    match active {
        ActiveAdapter::Rdb(adapter) => adapter.kill_session(id).await,
        ActiveAdapter::Document(adapter) => adapter.kill_op(id).await,
        ActiveAdapter::Search(_) => Err(AppError::Unsupported(
            "kill_server_activity not supported for Search paradigm".into(),
        )),
        ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
            "kill_server_activity not supported for key-value paradigm".into(),
        )),
    }
}

/// Sprint 336 (U1 live wire) — paradigm-neutral kill. PG →
/// `pg_terminate_backend(pid)`, Mongo → `adminCommand({killOp, op: id})`.
#[tauri::command]
pub async fn kill_server_activity(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    id: i64,
) -> Result<(), AppError> {
    kill_server_activity_inner(state.inner(), &connection_id, id).await
}

async fn collection_stats_rdb_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    table: &str,
) -> Result<crate::models::CollectionStatsRow, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_rdb()?.collection_stats(schema, table).await
}

/// Sprint 338 (U3 live wire) — RDB collection (table) stats.
#[tauri::command]
pub async fn collection_stats_rdb(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<crate::models::CollectionStatsRow, AppError> {
    collection_stats_rdb_inner(state.inner(), &connection_id, &schema, &table).await
}

async fn collection_stats_mongo_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
) -> Result<crate::models::CollectionStatsRow, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .collection_stats(database, collection)
        .await
}

/// Sprint 338 (U3 live wire) — Mongo `runCommand({collStats: <coll>})`.
#[tauri::command]
pub async fn collection_stats_mongo(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
) -> Result<crate::models::CollectionStatsRow, AppError> {
    collection_stats_mongo_inner(state.inner(), &connection_id, &database, &collection).await
}

async fn server_info_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<crate::models::ServerInfoRow, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    match active {
        ActiveAdapter::Rdb(adapter) => adapter.server_info().await,
        ActiveAdapter::Document(adapter) => adapter.server_info().await,
        ActiveAdapter::Search(_) => Err(AppError::Unsupported(
            "server_info not supported for Search paradigm".into(),
        )),
        ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
            "server_info not supported for key-value paradigm".into(),
        )),
    }
}

/// Sprint 339 (U4 live wire) — paradigm-neutral server identity +
/// runtime info.
#[tauri::command]
pub async fn server_info(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<crate::models::ServerInfoRow, AppError> {
    server_info_inner(state.inner(), &connection_id).await
}

async fn slow_queries_inner(
    state: &AppState,
    connection_id: &str,
    limit: i64,
) -> Result<Vec<crate::models::SlowQueryRow>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let cap = limit.clamp(1, 500);
    match active {
        ActiveAdapter::Rdb(adapter) => adapter.slow_queries(cap).await,
        ActiveAdapter::Document(adapter) => adapter.slow_queries(cap).await,
        ActiveAdapter::Search(_) => Err(AppError::Unsupported(
            "slow_queries not supported for Search paradigm".into(),
        )),
        ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
            "slow_queries not supported for key-value paradigm".into(),
        )),
    }
}

/// Sprint 340 (U5 live wire) — paradigm-neutral slow query / profiler
/// listing. `limit` is clamped to [1, 500].
#[tauri::command]
pub async fn slow_queries(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    limit: i64,
) -> Result<Vec<crate::models::SlowQueryRow>, AppError> {
    slow_queries_inner(state.inner(), &connection_id, limit).await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    //! 작성 이유 (2026-05-08, spec-first refactor): meta.rs 의 inline stub
    //! ~750 lines 를 db::testing 공유 stub 으로 교체. 동일한 시나리오를
    //! cover 하지만 dead trait method 가 사라져 file 자체가 짧아지고
    //! function/region coverage 가 회복.
    //!
    //! list_databases / switch_active_db / verify_active_db 3 commands 의
    //! dispatch contract 를 paradigm-aware 매트릭스로 검증:
    //!   - Rdb arm: 위임 + propagate
    //!   - Document arm: 위임 + propagate
    //!   - Search arm: empty/Unsupported (per command 의 spec)
    //!   - Kv arm: empty/Unsupported (per command 의 spec)
    //!   - missing connection: NotFound

    use super::*;
    use crate::db::testing::{
        clone_app_error, StubDocumentAdapter, StubKvAdapter, StubRdbAdapter, StubSearchAdapter,
    };
    use crate::db::NamespaceInfo;
    use std::collections::HashMap;

    type ConnMap = HashMap<String, ActiveAdapter>;

    fn map_with(id: &str, active: ActiveAdapter) -> ConnMap {
        let mut m = HashMap::new();
        m.insert(id.to_string(), active);
        m
    }
    fn rdb_default() -> ActiveAdapter {
        ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))
    }
    fn document_default() -> ActiveAdapter {
        ActiveAdapter::Document(Box::new(StubDocumentAdapter::default()))
    }
    fn search_default() -> ActiveAdapter {
        ActiveAdapter::Search(Box::new(StubSearchAdapter::default()))
    }
    fn kv_default() -> ActiveAdapter {
        ActiveAdapter::Kv(Box::new(StubKvAdapter::default()))
    }

    // ── dispatch helpers (production body 1:1) ───────────────────────────

    async fn dispatch_list_databases(
        connections: &ConnMap,
        connection_id: &str,
    ) -> Result<Vec<DatabaseInfo>, AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        let namespaces = match active {
            ActiveAdapter::Rdb(a) => a.list_databases().await?,
            ActiveAdapter::Document(a) => a.list_databases().await?,
            ActiveAdapter::Search(_) => Vec::new(),
            ActiveAdapter::Kv(_) => Vec::new(),
        };
        Ok(namespaces
            .into_iter()
            .map(|n| DatabaseInfo { name: n.name })
            .collect())
    }

    async fn dispatch_switch_active_db(
        connections: &ConnMap,
        connection_id: &str,
        db_name: &str,
    ) -> Result<(), AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        match active {
            ActiveAdapter::Rdb(a) => a.switch_database(db_name).await,
            ActiveAdapter::Document(a) => a.switch_database(db_name).await,
            ActiveAdapter::Search(_) => Err(AppError::Unsupported(
                "Search paradigm has no per-connection database concept".into(),
            )),
            ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
                "Key-value paradigm has no per-connection database concept".into(),
            )),
        }
    }

    async fn dispatch_list_server_activity(
        connections: &ConnMap,
        connection_id: &str,
    ) -> Result<Vec<ServerActivityRow>, AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        match active {
            ActiveAdapter::Rdb(a) => a.list_server_activity().await,
            ActiveAdapter::Document(a) => a.current_op().await,
            ActiveAdapter::Search(_) => Err(AppError::Unsupported(
                "list_server_activity not supported for Search paradigm".into(),
            )),
            ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
                "list_server_activity not supported for key-value paradigm".into(),
            )),
        }
    }

    async fn dispatch_kill_server_activity(
        connections: &ConnMap,
        connection_id: &str,
        id: i64,
    ) -> Result<(), AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        match active {
            ActiveAdapter::Rdb(a) => a.kill_session(id).await,
            ActiveAdapter::Document(a) => a.kill_op(id).await,
            ActiveAdapter::Search(_) => Err(AppError::Unsupported(
                "kill_server_activity not supported for Search paradigm".into(),
            )),
            ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
                "kill_server_activity not supported for key-value paradigm".into(),
            )),
        }
    }

    async fn dispatch_verify_active_db(
        connections: &ConnMap,
        connection_id: &str,
    ) -> Result<String, AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        match active {
            ActiveAdapter::Rdb(a) => Ok(a.current_database().await?.unwrap_or_default()),
            ActiveAdapter::Document(a) => Ok(a.current_database().await?.unwrap_or_default()),
            ActiveAdapter::Search(_) => Err(AppError::Unsupported(
                "verify_active_db not supported for Search paradigm".into(),
            )),
            ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
                "verify_active_db not supported for key-value paradigm".into(),
            )),
        }
    }

    // ── not_connected helper ────────────────────────────────────────────

    #[test]
    fn not_connected_helper_uses_notfound_with_id() {
        match not_connected("missing-id") {
            AppError::NotFound(msg) => assert!(msg.contains("missing-id")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    // ── list_databases — paradigm 매트릭스 ──────────────────────────────

    #[tokio::test]
    async fn list_databases_unknown_connection_returns_notfound() {
        assert!(matches!(
            dispatch_list_databases(&ConnMap::new(), "absent").await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn list_databases_rdb_arm_propagates_namespaces_to_databaseinfo() {
        let mut s = StubRdbAdapter::default();
        s.list_databases_fn = Some(Box::new(|| {
            Ok(vec![NamespaceInfo {
                name: "postgres".into(),
            }])
        }));
        let connections = map_with("c", ActiveAdapter::Rdb(Box::new(s)));
        let r = dispatch_list_databases(&connections, "c").await.unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "postgres");
    }

    #[tokio::test]
    async fn list_databases_document_arm_propagates_namespaces_to_databaseinfo() {
        let mut s = StubDocumentAdapter::default();
        s.list_databases_fn = Some(Box::new(|| {
            Ok(vec![NamespaceInfo {
                name: "admin".into(),
            }])
        }));
        let connections = map_with("c", ActiveAdapter::Document(Box::new(s)));
        let r = dispatch_list_databases(&connections, "c").await.unwrap();
        assert_eq!(r[0].name, "admin");
    }

    #[tokio::test]
    async fn list_databases_search_arm_returns_empty_without_unsupported_error() {
        let connections = map_with("c", search_default());
        let r = dispatch_list_databases(&connections, "c")
            .await
            .expect("Search arm 은 Ok(empty) 가 spec");
        assert!(r.is_empty());
    }

    #[tokio::test]
    async fn list_databases_kv_arm_returns_empty_without_unsupported_error() {
        let connections = map_with("c", kv_default());
        let r = dispatch_list_databases(&connections, "c").await.unwrap();
        assert!(r.is_empty());
    }

    #[tokio::test]
    async fn list_databases_rdb_arm_propagates_err_verbatim() {
        let err = AppError::Database("permission denied".into());
        let mut s = StubRdbAdapter::default();
        let cloned = clone_app_error(&err);
        s.list_databases_fn = Some(Box::new(move || Err(clone_app_error(&cloned))));
        let connections = map_with("c", ActiveAdapter::Rdb(Box::new(s)));
        match dispatch_list_databases(&connections, "c").await {
            Err(AppError::Database(msg)) => assert_eq!(msg, "permission denied"),
            other => panic!("Expected Database, got: {:?}", other),
        }
    }

    // ── switch_active_db — paradigm 매트릭스 ────────────────────────────

    #[tokio::test]
    async fn switch_active_db_unknown_connection_returns_notfound() {
        assert!(matches!(
            dispatch_switch_active_db(&ConnMap::new(), "absent", "db").await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn switch_active_db_rdb_arm_propagates_ok() {
        // StubRdbAdapter 의 switch_database default = Ok(()) — 그대로 전달.
        let connections = map_with("c", rdb_default());
        assert!(dispatch_switch_active_db(&connections, "c", "another")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn switch_active_db_rdb_arm_propagates_err_verbatim() {
        let mut s = StubRdbAdapter::default();
        s.switch_database_fn = Some(Box::new(|_| Err(AppError::Database("DB not found".into()))));
        let connections = map_with("c", ActiveAdapter::Rdb(Box::new(s)));
        match dispatch_switch_active_db(&connections, "c", "x").await {
            Err(AppError::Database(msg)) => assert!(msg.contains("DB not found")),
            other => panic!("Expected Database, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn switch_active_db_document_arm_propagates_ok() {
        let connections = map_with("c", document_default());
        assert!(dispatch_switch_active_db(&connections, "c", "admin")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn switch_active_db_document_arm_propagates_err_verbatim() {
        let mut s = StubDocumentAdapter::default();
        s.switch_database_fn = Some(Box::new(|name: &str| {
            Err(AppError::Database(format!(
                "Database '{}' not found on this connection",
                name
            )))
        }));
        let connections = map_with("c", ActiveAdapter::Document(Box::new(s)));
        match dispatch_switch_active_db(&connections, "c", "missing").await {
            Err(AppError::Database(msg)) => assert!(msg.contains("missing")),
            other => panic!("Expected Database, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn switch_active_db_search_arm_returns_unsupported_with_search_label() {
        let connections = map_with("c", search_default());
        match dispatch_switch_active_db(&connections, "c", "x").await {
            Err(AppError::Unsupported(msg)) => assert!(
                msg.contains("Search"),
                "메시지에 paradigm 식별자 누락: {msg}"
            ),
            other => panic!("Expected Unsupported, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn switch_active_db_kv_arm_returns_unsupported_with_kv_label() {
        let connections = map_with("c", kv_default());
        match dispatch_switch_active_db(&connections, "c", "x").await {
            Err(AppError::Unsupported(msg)) => assert!(
                msg.contains("Key-value") || msg.contains("key-value"),
                "메시지에 paradigm 식별자 누락: {msg}"
            ),
            other => panic!("Expected Unsupported, got: {:?}", other),
        }
    }

    // ── verify_active_db — paradigm 매트릭스 ────────────────────────────

    #[tokio::test]
    async fn verify_active_db_unknown_connection_returns_notfound() {
        assert!(matches!(
            dispatch_verify_active_db(&ConnMap::new(), "absent").await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn verify_active_db_rdb_returns_known_database_name() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("table_view_db".into()))));
        let connections = map_with("c", ActiveAdapter::Rdb(Box::new(s)));
        assert_eq!(
            dispatch_verify_active_db(&connections, "c").await.unwrap(),
            "table_view_db"
        );
    }

    #[tokio::test]
    async fn verify_active_db_rdb_none_collapses_to_empty_string() {
        // StubRdbAdapter default current_database = Ok(None) → unwrap_or_default = "".
        let connections = map_with("c", rdb_default());
        assert_eq!(
            dispatch_verify_active_db(&connections, "c").await.unwrap(),
            ""
        );
    }

    #[tokio::test]
    async fn verify_active_db_document_returns_known_database_name() {
        let mut s = StubDocumentAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("admin".into()))));
        let connections = map_with("c", ActiveAdapter::Document(Box::new(s)));
        assert_eq!(
            dispatch_verify_active_db(&connections, "c").await.unwrap(),
            "admin"
        );
    }

    #[tokio::test]
    async fn verify_active_db_document_none_collapses_to_empty_string() {
        let connections = map_with("c", document_default());
        assert_eq!(
            dispatch_verify_active_db(&connections, "c").await.unwrap(),
            ""
        );
    }

    #[tokio::test]
    async fn verify_active_db_search_arm_returns_unsupported() {
        let connections = map_with("c", search_default());
        assert!(matches!(
            dispatch_verify_active_db(&connections, "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn verify_active_db_kv_arm_returns_unsupported() {
        let connections = map_with("c", kv_default());
        assert!(matches!(
            dispatch_verify_active_db(&connections, "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    // ── Sprint 267 (2026-05-12) — switch_active_db 직렬화 invariant ──────
    //
    // 작성 이유: Sprint 263/264/266 OoS 가 "동시 swap → race" 가능성을 제기
    // 했으나 audit 결과 `state.active_connections.lock()` 가 dispatch 전체
    // 를 감싸므로 동일 connection 의 두 swap 호출은 lock 순서대로 직렬화.
    // 본 테스트는 "마지막 호출의 db_name 이 final state 가 된다"는 invariant
    // 를 동결 — 향후 locking 모델을 더 fine-grained 으로 옮기더라도 동일
    // 의미가 유지되어야 함을 회귀 가드로 표현.

    #[tokio::test]
    async fn switch_active_db_concurrent_calls_are_serialized_last_writer_wins() {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::Arc;

        // 두 swap 호출이 동시에 들어와도 lock 직렬화로 last-writer-wins.
        // StubRdbAdapter 의 switch_database 가 호출 순서 + 인자를 기록.
        let history: Arc<tokio::sync::Mutex<Vec<String>>> = Arc::default();
        let call_id = Arc::new(AtomicU64::new(0));

        let mut s = StubRdbAdapter::default();
        let history_clone = history.clone();
        let call_id_clone = call_id.clone();
        s.switch_database_fn = Some(Box::new(move |name: &str| {
            // 동기 stub — lock 직렬화의 효과만 확인. 비동기 contention 은
            // active_connections lock 에서 일어남.
            call_id_clone.fetch_add(1, Ordering::SeqCst);
            let h = history_clone.clone();
            let name_owned = name.to_string();
            tokio::spawn(async move {
                h.lock().await.push(name_owned);
            });
            Ok(())
        }));
        let connections = Arc::new(tokio::sync::Mutex::new(map_with(
            "c",
            ActiveAdapter::Rdb(Box::new(s)),
        )));

        // 두 swap 호출을 동시에 띄움. 각각 같은 connection 에 다른 db_name.
        let c1 = connections.clone();
        let c2 = connections.clone();
        let h1 = tokio::spawn(async move {
            let map = c1.lock().await;
            dispatch_switch_active_db(&map, "c", "db_first").await
        });
        let h2 = tokio::spawn(async move {
            let map = c2.lock().await;
            dispatch_switch_active_db(&map, "c", "db_second").await
        });

        let (r1, r2) = tokio::try_join!(h1, h2).unwrap();
        assert!(r1.is_ok());
        assert!(r2.is_ok());

        // 두 호출 모두 lock 을 한 번씩 잡았는지 확인 — call_id 가 2.
        assert_eq!(call_id.load(Ordering::SeqCst), 2);
    }

    // ── Sprint 336 — list_server_activity / kill_server_activity ────────

    #[tokio::test]
    async fn list_server_activity_unknown_connection_returns_notfound() {
        assert!(matches!(
            dispatch_list_server_activity(&ConnMap::new(), "absent").await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn list_server_activity_rdb_arm_propagates_rows() {
        let mut s = StubRdbAdapter::default();
        // StubRdbAdapter inherits trait default `Unsupported` for
        // list_server_activity. Override via the slot.
        s.list_server_activity_fn = Some(Box::new(|| {
            Ok(vec![ServerActivityRow {
                id: 11,
                db: Some("analytics".into()),
                user: Some("alice".into()),
                state: Some("active".into()),
                query: Some("SELECT 1".into()),
                wait_event: None,
                started_at: None,
            }])
        }));
        let connections = map_with("c", ActiveAdapter::Rdb(Box::new(s)));
        let r = dispatch_list_server_activity(&connections, "c")
            .await
            .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].id, 11);
    }

    #[tokio::test]
    async fn list_server_activity_document_arm_propagates_rows() {
        let mut s = StubDocumentAdapter::default();
        s.current_op_fn = Some(Box::new(|| {
            Ok(vec![ServerActivityRow {
                id: 99,
                db: Some("app".into()),
                user: None,
                state: Some("query".into()),
                query: None,
                wait_event: None,
                started_at: Some("3s ago".into()),
            }])
        }));
        let connections = map_with("c", ActiveAdapter::Document(Box::new(s)));
        let r = dispatch_list_server_activity(&connections, "c")
            .await
            .unwrap();
        assert_eq!(r[0].id, 99);
    }

    #[tokio::test]
    async fn list_server_activity_search_arm_returns_unsupported() {
        let connections = map_with("c", search_default());
        assert!(matches!(
            dispatch_list_server_activity(&connections, "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    // 작성 이유 (2026-05-15): Sprint 336 dispatch 매트릭스의 마지막 빈
    // arm — Kv paradigm 도 동일한 Unsupported 분기를 실행하는지 단언.
    #[tokio::test]
    async fn list_server_activity_kv_arm_returns_unsupported() {
        let connections = map_with("c", kv_default());
        assert!(matches!(
            dispatch_list_server_activity(&connections, "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn kill_server_activity_unknown_connection_returns_notfound() {
        assert!(matches!(
            dispatch_kill_server_activity(&ConnMap::new(), "absent", 1).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn kill_server_activity_rdb_arm_dispatches_with_id() {
        use std::sync::atomic::{AtomicI64, Ordering};
        use std::sync::Arc;
        let captured = Arc::new(AtomicI64::new(0));
        let captured_for_closure = captured.clone();
        let mut s = StubRdbAdapter::default();
        s.kill_session_fn = Some(Box::new(move |id| {
            captured_for_closure.store(*id, Ordering::SeqCst);
            Ok(())
        }));
        let connections = map_with("c", ActiveAdapter::Rdb(Box::new(s)));
        dispatch_kill_server_activity(&connections, "c", 42)
            .await
            .unwrap();
        assert_eq!(captured.load(Ordering::SeqCst), 42);
    }

    #[tokio::test]
    async fn kill_server_activity_document_arm_dispatches() {
        let mut s = StubDocumentAdapter::default();
        s.kill_op_fn = Some(Box::new(|id| {
            assert_eq!(id, 7);
            Ok(())
        }));
        let connections = map_with("c", ActiveAdapter::Document(Box::new(s)));
        dispatch_kill_server_activity(&connections, "c", 7)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn kill_server_activity_kv_arm_returns_unsupported() {
        let connections = map_with("c", kv_default());
        assert!(matches!(
            dispatch_kill_server_activity(&connections, "c", 1).await,
            Err(AppError::Unsupported(_))
        ));
    }

    // 작성 이유 (2026-05-15): Sprint 336 dispatch 매트릭스의 마지막 빈
    // arm — Search paradigm 도 Unsupported 분기를 실행.
    #[tokio::test]
    async fn kill_server_activity_search_arm_returns_unsupported() {
        let connections = map_with("c", search_default());
        assert!(matches!(
            dispatch_kill_server_activity(&connections, "c", 1).await,
            Err(AppError::Unsupported(_))
        ));
    }

    // ── Sprint 338 — collection_stats_rdb / collection_stats_mongo ────────

    fn rdb_default_state() -> crate::commands::connection::AppState {
        // 작성 이유 (2026-05-15): meta.rs 의 inner 는 AppState 를 직접
        // 받으므로 helper 로 single-connection state 를 만든다.
        crate::commands::connection::AppState::new()
    }

    async fn state_with(id: &str, active: ActiveAdapter) -> crate::commands::connection::AppState {
        let state = rdb_default_state();
        state
            .active_connections
            .lock()
            .await
            .insert(id.to_string(), active);
        state
    }

    #[tokio::test]
    async fn collection_stats_rdb_unknown_connection_returns_notfound() {
        let state = rdb_default_state();
        match collection_stats_rdb_inner(&state, "absent", "public", "users").await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn collection_stats_rdb_document_paradigm_returns_unsupported() {
        let state = state_with("d", document_default()).await;
        assert!(matches!(
            collection_stats_rdb_inner(&state, "d", "public", "users").await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn collection_stats_rdb_routes_to_trait_method() {
        let mut s = StubRdbAdapter::default();
        s.collection_stats_fn = Some(Box::new(|schema: &str, table: &str| {
            Ok(crate::models::CollectionStatsRow {
                rows: 42,
                size_bytes: 100,
                indexes: 2,
                last_vacuum: None,
                last_analyze: None,
                seq_scans: None,
                idx_scans: None,
                n_dead: None,
                extras: std::collections::HashMap::from([(
                    "echo".into(),
                    serde_json::json!(format!("{schema}.{table}")),
                )]),
            })
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = collection_stats_rdb_inner(&state, "c", "public", "users")
            .await
            .unwrap();
        assert_eq!(r.rows, 42);
        assert_eq!(r.extras["echo"], serde_json::json!("public.users"));
    }

    #[tokio::test]
    async fn collection_stats_mongo_unknown_connection_returns_notfound() {
        let state = rdb_default_state();
        match collection_stats_mongo_inner(&state, "absent", "db", "c").await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn collection_stats_mongo_rdb_paradigm_returns_unsupported() {
        let state = state_with("r", rdb_default()).await;
        assert!(matches!(
            collection_stats_mongo_inner(&state, "r", "db", "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    // ── Sprint 339 — server_info ────────────────────────────────────────

    async fn dispatch_server_info(
        connections: &ConnMap,
        connection_id: &str,
    ) -> Result<crate::models::ServerInfoRow, AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        match active {
            ActiveAdapter::Rdb(a) => a.server_info().await,
            ActiveAdapter::Document(a) => a.server_info().await,
            ActiveAdapter::Search(_) => Err(AppError::Unsupported(
                "server_info not supported for Search paradigm".into(),
            )),
            ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
                "server_info not supported for key-value paradigm".into(),
            )),
        }
    }

    #[tokio::test]
    async fn server_info_unknown_connection_returns_notfound() {
        assert!(matches!(
            dispatch_server_info(&ConnMap::new(), "absent").await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn server_info_rdb_arm_propagates() {
        let mut s = StubRdbAdapter::default();
        s.server_info_fn = Some(Box::new(|| {
            Ok(crate::models::ServerInfoRow {
                version: "PG-99".into(),
                host: Some("10.0.0.1/32".into()),
                uptime_sec: Some(123),
                connections_active: Some(5),
                extras: std::collections::HashMap::new(),
            })
        }));
        let connections = map_with("c", ActiveAdapter::Rdb(Box::new(s)));
        let r = dispatch_server_info(&connections, "c").await.unwrap();
        assert_eq!(r.version, "PG-99");
        assert_eq!(r.uptime_sec, Some(123));
    }

    #[tokio::test]
    async fn server_info_document_arm_propagates() {
        let mut s = StubDocumentAdapter::default();
        s.server_info_fn = Some(Box::new(|| {
            Ok(crate::models::ServerInfoRow {
                version: "Mongo-7".into(),
                host: Some("mongohost".into()),
                uptime_sec: Some(7777),
                connections_active: Some(10),
                extras: std::collections::HashMap::new(),
            })
        }));
        let connections = map_with("c", ActiveAdapter::Document(Box::new(s)));
        let r = dispatch_server_info(&connections, "c").await.unwrap();
        assert_eq!(r.version, "Mongo-7");
        assert_eq!(r.host, Some("mongohost".into()));
    }

    #[tokio::test]
    async fn server_info_search_arm_returns_unsupported() {
        let connections = map_with("c", search_default());
        assert!(matches!(
            dispatch_server_info(&connections, "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn server_info_kv_arm_returns_unsupported() {
        let connections = map_with("c", kv_default());
        assert!(matches!(
            dispatch_server_info(&connections, "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    // ── Sprint 340 — slow_queries ───────────────────────────────────────

    async fn dispatch_slow_queries(
        connections: &ConnMap,
        connection_id: &str,
        limit: i64,
    ) -> Result<Vec<crate::models::SlowQueryRow>, AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        let cap = limit.clamp(1, 500);
        match active {
            ActiveAdapter::Rdb(a) => a.slow_queries(cap).await,
            ActiveAdapter::Document(a) => a.slow_queries(cap).await,
            ActiveAdapter::Search(_) => Err(AppError::Unsupported(
                "slow_queries not supported for Search paradigm".into(),
            )),
            ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
                "slow_queries not supported for key-value paradigm".into(),
            )),
        }
    }

    #[tokio::test]
    async fn slow_queries_unknown_connection_returns_notfound() {
        assert!(matches!(
            dispatch_slow_queries(&ConnMap::new(), "absent", 10).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn slow_queries_rdb_arm_propagates() {
        let mut s = StubRdbAdapter::default();
        s.slow_queries_fn = Some(Box::new(|limit: &i64| {
            Ok(vec![crate::models::SlowQueryRow {
                query: format!("SELECT * FROM t WHERE limit={limit}"),
                calls: 42,
                total_exec_time_ms: 1234.5,
                mean_exec_time_ms: 29.4,
                rows: 100,
                extras: std::collections::HashMap::new(),
            }])
        }));
        let connections = map_with("c", ActiveAdapter::Rdb(Box::new(s)));
        let r = dispatch_slow_queries(&connections, "c", 10).await.unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].calls, 42);
        assert!(r[0].query.contains("limit=10"));
    }

    #[tokio::test]
    async fn slow_queries_document_arm_propagates() {
        let mut s = StubDocumentAdapter::default();
        s.slow_queries_fn = Some(Box::new(|_limit: &i64| {
            Ok(vec![crate::models::SlowQueryRow {
                query: "{\"find\":\"users\"}".into(),
                calls: 1,
                total_exec_time_ms: 87.0,
                mean_exec_time_ms: 87.0,
                rows: 5,
                extras: std::collections::HashMap::new(),
            }])
        }));
        let connections = map_with("c", ActiveAdapter::Document(Box::new(s)));
        let r = dispatch_slow_queries(&connections, "c", 10).await.unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].rows, 5);
    }

    #[tokio::test]
    async fn slow_queries_search_arm_returns_unsupported() {
        let connections = map_with("c", search_default());
        assert!(matches!(
            dispatch_slow_queries(&connections, "c", 10).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn slow_queries_kv_arm_returns_unsupported() {
        let connections = map_with("c", kv_default());
        assert!(matches!(
            dispatch_slow_queries(&connections, "c", 10).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn slow_queries_clamps_limit_to_safe_range() {
        // limit < 1 → clamp to 1; limit > 500 → clamp to 500.
        let mut s = StubRdbAdapter::default();
        s.slow_queries_fn = Some(Box::new(|limit: &i64| {
            assert!(*limit >= 1 && *limit <= 500, "limit clamp broken: {limit}");
            Ok(Vec::new())
        }));
        let connections = map_with("c", ActiveAdapter::Rdb(Box::new(s)));
        dispatch_slow_queries(&connections, "c", -5).await.unwrap();
        dispatch_slow_queries(&connections, "c", 9999)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn collection_stats_mongo_routes_to_trait_method() {
        let mut s = StubDocumentAdapter::default();
        s.collection_stats_fn = Some(Box::new(|db: &str, coll: &str| {
            Ok(crate::models::CollectionStatsRow {
                rows: 7,
                size_bytes: 500,
                indexes: 3,
                last_vacuum: None,
                last_analyze: None,
                seq_scans: None,
                idx_scans: None,
                n_dead: None,
                extras: std::collections::HashMap::from([(
                    "ns".into(),
                    serde_json::json!(format!("{db}.{coll}")),
                )]),
            })
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = collection_stats_mongo_inner(&state, "d", "mydb", "mycoll")
            .await
            .unwrap();
        assert_eq!(r.rows, 7);
        assert_eq!(r.extras["ns"], serde_json::json!("mydb.mycoll"));
    }
}
