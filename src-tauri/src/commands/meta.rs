//! Paradigm-neutral metadata commands.
//!
//! Houses the unified `list_databases` Tauri command — a thin dispatcher
//! that branches on `ActiveAdapter` so the workspace toolbar's
//! `<DbSwitcher>` can fetch the current connection's database list without
//! caring which paradigm is wired underneath. The four-variant match is
//! exhaustive on purpose: `Search` returns an empty list rather than
//! `AppError::Unsupported`; `Kv` dispatches through the KV adapter so
//! Redis/Valkey can share the toolbar switcher.
//!
//! The Mongo-specific `list_mongo_databases` (`commands/document/browse.rs`)
//! stays as-is — this unified entry point was introduced alongside
//! it without breaking existing callers.

use crate::commands::connection::AppState;
use crate::commands::document::browse::DatabaseInfo;
use crate::commands::not_connected;
use crate::db::ActiveAdapter;
use crate::error::AppError;
use crate::models::{DatabaseUserRow, ServerActivityRow};

/// Paradigm-aware database list for the active connection.
///
/// Dispatch table:
///   - `Rdb`      → `RdbAdapter::list_databases` (PG returns
///                  `pg_database` rows, default impl returns `vec![]` for
///                  paradigm members without their own override).
///   - `Document` → `DocumentAdapter::list_databases` (Mongo).
///   - `Search`   → `Ok(vec![])` — the ES adapter has no per-connection
///                  database concept; the toolbar treats an empty result as
///                  "switcher stays read-only".
///   - `Kv`       → `KvAdapter::list_databases` (Redis/Valkey DB indexes).
///
/// Returns `AppError::NotFound` when the connection id has no live adapter.
#[tauri::command]
pub async fn list_databases(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<DatabaseInfo>, AppError> {
    let active = state
        .active_adapter(&connection_id)
        .await
        .ok_or_else(|| not_connected(&connection_id))?;

    let databases = match active.as_ref() {
        ActiveAdapter::Rdb(adapter) => adapter
            .list_databases()
            .await?
            .into_iter()
            .map(|n| DatabaseInfo { name: n.name })
            .collect(),
        ActiveAdapter::Document(adapter) => adapter
            .list_databases()
            .await?
            .into_iter()
            .map(|n| DatabaseInfo { name: n.name })
            .collect(),
        // Search has no database concept; keep the toolbar fallback quiet.
        ActiveAdapter::Search(_) => Vec::new(),
        ActiveAdapter::Kv(adapter) => adapter
            .list_databases()
            .await?
            .into_iter()
            .map(|n| DatabaseInfo { name: n.name })
            .collect(),
    };

    Ok(databases)
}

/// Switch the active database for the given connection.
///
/// Dispatch table:
///   - `Rdb`      → `RdbAdapter::switch_database`. PostgreSQL, MySQL and SQL
///                  Server override the trait default to swap the active
///                  sub-pool to `db_name`; an adapter without an override
///                  returns `Unsupported` and the frontend toast surfaces the
///                  message.
///   - `Document` → `DocumentAdapter::switch_database`. The
///                  MongoAdapter override mutates its `active_db` field
///                  after a cheap `list_database_names` probe. Other
///                  document adapters keep the default `Unsupported` until
///                  they ship `use_db` semantics.
///   - `Search` → `Err(Unsupported)` — no per-connection database concept.
///   - `Kv`     → parse numeric DB index and dispatch `KvAdapter`.
///
/// Returns `AppError::NotFound` when the connection id has no live adapter,
/// matching `list_databases` semantics.
#[tauri::command]
pub async fn switch_active_db(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    db_name: String,
) -> Result<(), AppError> {
    let kv_database = {
        let active = state
            .active_adapter(&connection_id)
            .await
            .ok_or_else(|| not_connected(&connection_id))?;

        match active.as_ref() {
            ActiveAdapter::Rdb(adapter) => {
                adapter.switch_database(&db_name).await?;
                None
            }
            ActiveAdapter::Document(adapter) => {
                adapter.switch_database(&db_name).await?;
                None
            }
            ActiveAdapter::Search(_) => {
                return Err(AppError::Unsupported(
                    "Search paradigm has no per-connection database concept".into(),
                ))
            }
            ActiveAdapter::Kv(adapter) => {
                let database = parse_kv_database_name(&db_name)?;
                adapter.switch_database(database).await?;
                Some(database)
            }
        }
    };

    if let Some(database) = kv_database {
        let mut statuses = state.connection_status.lock().await;
        statuses.insert(
            connection_id,
            crate::models::ConnectionStatus::Connected {
                active_db: Some(database.to_string()),
            },
        );
    }
    Ok(())
}

/// Resolve the active database the backend currently sees.
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
///   - `Search` → `Err(Unsupported)` — no per-connection database concept.
///   - `Kv`     → `KvAdapter::current_database` stringified.
///
/// Returns `AppError::NotFound` when the connection id has no live adapter,
/// matching `list_databases` / `switch_active_db` semantics.
#[tauri::command]
pub async fn verify_active_db(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<String, AppError> {
    let active = state
        .active_adapter(&connection_id)
        .await
        .ok_or_else(|| not_connected(&connection_id))?;

    match active.as_ref() {
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
            .unwrap_or_default()
            .to_string()),
    }
}

fn parse_kv_database_name(db_name: &str) -> Result<u16, AppError> {
    db_name
        .trim()
        .parse::<u16>()
        .map_err(|_| AppError::Validation("Key-value database must be a numeric index".into()))
}

async fn list_server_activity_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<ServerActivityRow>, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    match active.as_ref() {
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

/// Paradigm-neutral server activity feed.
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
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    match active.as_ref() {
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

/// Paradigm-neutral kill. PG →
/// `pg_terminate_backend(pid)`, Mongo → `adminCommand({killOp, op: id})`.
#[tauri::command]
pub async fn kill_server_activity(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    id: i64,
) -> Result<(), AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    kill_server_activity_inner(state.inner(), &connection_id, id).await
}

async fn collection_stats_rdb_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    table: &str,
) -> Result<crate::models::CollectionStatsRow, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_rdb()?.collection_stats(schema, table).await
}

/// RDB collection (table) stats.
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
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .collection_stats(database, collection)
        .await
}

/// Mongo `runCommand({collStats: <coll>})`.
#[tauri::command]
pub async fn collection_stats_mongo(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
) -> Result<crate::models::CollectionStatsRow, AppError> {
    collection_stats_mongo_inner(state.inner(), &connection_id, &database, &collection).await
}

async fn mongo_runtime_capabilities_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<crate::models::MongoRuntimeCapabilities, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    Ok(active.as_document()?.mongo_runtime_capabilities().await)
}

/// Issue #1821 — the connected MongoDB server's runtime capability
/// (deployment topology + parsed server version).
///
/// Read-only and cheap: the adapter probed `hello` + `buildInfo` once during
/// `connect()`, so this returns a cached value with no admin round trip. It is
/// deliberately fallible only on *routing* (`NotFound` for a dead connection
/// id, `Unsupported` for a non-document paradigm) — a MongoDB connection whose
/// probe was refused answers with the fail-closed `unknown` capability instead
/// of an error, because "we could not identify the server" is a normal outcome
/// for a locked-down account and must close features rather than break the
/// call.
#[tauri::command]
pub async fn mongo_runtime_capabilities(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<crate::models::MongoRuntimeCapabilities, AppError> {
    mongo_runtime_capabilities_inner(state.inner(), &connection_id).await
}

async fn server_info_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<crate::models::ServerInfoRow, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    match active.as_ref() {
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

/// Paradigm-neutral server identity +
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
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    let cap = limit.clamp(1, 500);
    match active.as_ref() {
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

/// Paradigm-neutral slow query / profiler
/// listing. `limit` is clamped to [1, 500].
#[tauri::command]
pub async fn slow_queries(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    limit: i64,
) -> Result<Vec<crate::models::SlowQueryRow>, AppError> {
    slow_queries_inner(state.inner(), &connection_id, limit).await
}

async fn list_database_users_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<DatabaseUserRow>, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    // Read-only accounts/permissions surface. Only the RDB arm serves it, and
    // only for engines whose adapter overrides the trait default (PG-first
    // parity lane) — the non-PG default and the non-RDB arms below are the
    // backend capability gate, so a missing frontend guard cannot leak data.
    match active.as_ref() {
        ActiveAdapter::Rdb(adapter) => adapter.list_database_users().await,
        ActiveAdapter::Document(_) => Err(AppError::Unsupported(
            "list_database_users not supported for Document paradigm".into(),
        )),
        ActiveAdapter::Search(_) => Err(AppError::Unsupported(
            "list_database_users not supported for Search paradigm".into(),
        )),
        ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
            "list_database_users not supported for key-value paradigm".into(),
        )),
    }
}

/// Issue #1077 Stage 2 — read-only users/roles listing for the active
/// connection. PG queries `pg_roles` (password-masked); MySQL and SQL Server
/// override it too, and every other adapter returns `Unsupported`.
#[tauri::command]
pub async fn list_database_users(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<DatabaseUserRow>, AppError> {
    list_database_users_inner(state.inner(), &connection_id).await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    //! Written 2026-05-08 (spec-first refactor): meta.rs's inline stub was
    //! replaced with the shared db::testing stub. It covers the same scenarios,
    //! but the dead trait methods disappear so the file itself gets shorter and
    //! function/region coverage recovers.
    //!
    //! Verifies the dispatch contract of the 3 commands list_databases /
    //! switch_active_db / verify_active_db as a paradigm-aware matrix:
    //!   - Rdb arm: delegate + propagate
    //!   - Document arm: delegate + propagate
    //!   - Search arm: empty/Unsupported (each command's spec)
    //!   - Kv arm: Redis/Valkey database index dispatch
    //!   - missing connection: NotFound

    use super::*;
    use crate::db::testing::{
        clone_app_error, StubDocumentAdapter, StubKvAdapter, StubRdbAdapter, StubSearchAdapter,
    };
    use crate::db::{KvDatabaseInfo, NamespaceInfo};
    use std::collections::HashMap;

    // Issue #1087 — mirror production: `active_connections` now stores
    // `Arc<ActiveAdapter>`, so the dispatch-mirror map does too.
    type ConnMap = HashMap<String, std::sync::Arc<ActiveAdapter>>;

    fn map_with(id: &str, active: ActiveAdapter) -> ConnMap {
        let mut m = HashMap::new();
        m.insert(id.to_string(), std::sync::Arc::new(active));
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
        let databases = match active.as_ref() {
            ActiveAdapter::Rdb(a) => a
                .list_databases()
                .await?
                .into_iter()
                .map(|n| DatabaseInfo { name: n.name })
                .collect(),
            ActiveAdapter::Document(a) => a
                .list_databases()
                .await?
                .into_iter()
                .map(|n| DatabaseInfo { name: n.name })
                .collect(),
            ActiveAdapter::Search(_) => Vec::new(),
            ActiveAdapter::Kv(a) => a
                .list_databases()
                .await?
                .into_iter()
                .map(|n| DatabaseInfo { name: n.name })
                .collect(),
        };
        Ok(databases)
    }

    async fn dispatch_switch_active_db(
        connections: &ConnMap,
        connection_id: &str,
        db_name: &str,
    ) -> Result<(), AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        match active.as_ref() {
            ActiveAdapter::Rdb(a) => a.switch_database(db_name).await,
            ActiveAdapter::Document(a) => a.switch_database(db_name).await,
            ActiveAdapter::Search(_) => Err(AppError::Unsupported(
                "Search paradigm has no per-connection database concept".into(),
            )),
            ActiveAdapter::Kv(a) => {
                let database = parse_kv_database_name(db_name)?;
                a.switch_database(database).await
            }
        }
    }

    async fn dispatch_list_server_activity(
        connections: &ConnMap,
        connection_id: &str,
    ) -> Result<Vec<ServerActivityRow>, AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        match active.as_ref() {
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

    // Issue #1077 Stage 2 — mirror of `list_database_users_inner`.
    async fn dispatch_list_database_users(
        connections: &ConnMap,
        connection_id: &str,
    ) -> Result<Vec<DatabaseUserRow>, AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        match active.as_ref() {
            ActiveAdapter::Rdb(a) => a.list_database_users().await,
            ActiveAdapter::Document(_) => Err(AppError::Unsupported(
                "list_database_users not supported for Document paradigm".into(),
            )),
            ActiveAdapter::Search(_) => Err(AppError::Unsupported(
                "list_database_users not supported for Search paradigm".into(),
            )),
            ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
                "list_database_users not supported for key-value paradigm".into(),
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
        match active.as_ref() {
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
        match active.as_ref() {
            ActiveAdapter::Rdb(a) => Ok(a.current_database().await?.unwrap_or_default()),
            ActiveAdapter::Document(a) => Ok(a.current_database().await?.unwrap_or_default()),
            ActiveAdapter::Search(_) => Err(AppError::Unsupported(
                "verify_active_db not supported for Search paradigm".into(),
            )),
            ActiveAdapter::Kv(a) => Ok(a.current_database().await?.unwrap_or_default().to_string()),
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

    // ── list_databases — paradigm matrix ────────────────────────────────

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
    async fn list_databases_kv_arm_propagates_database_indexes() {
        let mut s = StubKvAdapter::default();
        s.list_databases_fn = Some(Box::new(|| {
            Ok(vec![
                KvDatabaseInfo {
                    name: "0".into(),
                    index: 0,
                    key_count: Some(2),
                },
                KvDatabaseInfo {
                    name: "1".into(),
                    index: 1,
                    key_count: None,
                },
            ])
        }));
        let connections = map_with("c", ActiveAdapter::Kv(Box::new(s)));
        let r = dispatch_list_databases(&connections, "c").await.unwrap();
        assert_eq!(
            r.into_iter().map(|db| db.name).collect::<Vec<_>>(),
            vec!["0", "1"]
        );
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

    // ── switch_active_db — paradigm matrix ──────────────────────────────

    #[tokio::test]
    async fn switch_active_db_unknown_connection_returns_notfound() {
        assert!(matches!(
            dispatch_switch_active_db(&ConnMap::new(), "absent", "db").await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn switch_active_db_rdb_arm_propagates_ok() {
        // StubRdbAdapter's switch_database default is Ok(()) — passed through verbatim.
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
    async fn switch_active_db_kv_arm_parses_numeric_index_and_propagates_ok() {
        let mut s = StubKvAdapter::default();
        s.switch_database_fn = Some(Box::new(|database: &u16| {
            assert_eq!(*database, 2);
            Ok(())
        }));
        let connections = map_with("c", ActiveAdapter::Kv(Box::new(s)));
        assert!(dispatch_switch_active_db(&connections, "c", "2")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn switch_active_db_kv_arm_rejects_non_numeric_name() {
        let connections = map_with("c", kv_default());
        assert!(matches!(
            dispatch_switch_active_db(&connections, "c", "db2").await,
            Err(AppError::Validation(_))
        ));
    }

    // ── verify_active_db — paradigm matrix ──────────────────────────────

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
    async fn verify_active_db_kv_arm_returns_current_index_string() {
        let mut s = StubKvAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some(3))));
        let connections = map_with("c", ActiveAdapter::Kv(Box::new(s)));
        assert_eq!(
            dispatch_verify_active_db(&connections, "c").await.unwrap(),
            "3"
        );
    }

    #[tokio::test]
    async fn verify_active_db_kv_none_collapses_to_zero() {
        let connections = map_with("c", kv_default());
        assert_eq!(
            dispatch_verify_active_db(&connections, "c").await.unwrap(),
            "0"
        );
    }

    // ── switch_active_db serialization invariant (2026-05-12) ────────────
    //
    // Reason: earlier OoS findings raised a "concurrent swap → race" possibility,
    // but the audit showed `state.active_connections.lock()` wraps the whole
    // dispatch, so two swap calls on the same connection are serialized in lock
    // order. This test freezes the invariant that "the last call's db_name
    // becomes the final state" — a regression guard that the same semantics
    // must hold even if the locking model later moves to something more
    // fine-grained.

    #[tokio::test]
    async fn switch_active_db_concurrent_calls_are_serialized_last_writer_wins() {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::Arc;

        // Even when two swap calls arrive concurrently, lock serialization makes
        // it last-writer-wins. StubRdbAdapter's switch_database records the call
        // order and arguments.
        let history: Arc<tokio::sync::Mutex<Vec<String>>> = Arc::default();
        let call_id = Arc::new(AtomicU64::new(0));

        let mut s = StubRdbAdapter::default();
        let history_clone = history.clone();
        let call_id_clone = call_id.clone();
        s.switch_database_fn = Some(Box::new(move |name: &str| {
            // Synchronous stub — only checks the effect of lock serialization.
            // Async contention happens at the active_connections lock.
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

        // Spawn the two swap calls concurrently, each with a different db_name
        // on the same connection.
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

        // Confirm both calls took the lock exactly once — call_id is 2.
        assert_eq!(call_id.load(Ordering::SeqCst), 2);
    }

    // ── list_server_activity / kill_server_activity ──────────────────────

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

    // Written 2026-05-15: asserts that the last empty arm of the dispatch
    // matrix — the Kv paradigm — also runs the same Unsupported branch.
    #[tokio::test]
    async fn list_server_activity_kv_arm_returns_unsupported() {
        let connections = map_with("c", kv_default());
        assert!(matches!(
            dispatch_list_server_activity(&connections, "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    // ── Issue #1077 Stage 2 — list_database_users dispatch matrix ────────

    #[tokio::test]
    async fn list_database_users_unknown_connection_returns_notfound() {
        assert!(matches!(
            dispatch_list_database_users(&ConnMap::new(), "absent").await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn list_database_users_rdb_arm_propagates_rows() {
        let mut s = StubRdbAdapter::default();
        s.list_database_users_fn = Some(Box::new(|| {
            Ok(vec![crate::models::DatabaseUserRow {
                name: "alice".into(),
                can_login: true,
                is_superuser: false,
                can_create_db: false,
                can_create_role: false,
                replication: false,
                conn_limit: -1,
                valid_until: None,
                member_of: vec!["readonly".into()],
            }])
        }));
        let connections = map_with("c", ActiveAdapter::Rdb(Box::new(s)));
        let r = dispatch_list_database_users(&connections, "c")
            .await
            .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "alice");
        assert_eq!(r[0].member_of, vec!["readonly".to_string()]);
    }

    // Backend capability gate: an RDB engine without a `list_database_users`
    // override (non-PG parity lane) must be refused, not served an empty list.
    #[tokio::test]
    async fn list_database_users_rdb_without_override_is_gated() {
        let connections = map_with("c", rdb_default());
        assert!(matches!(
            dispatch_list_database_users(&connections, "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn list_database_users_document_arm_returns_unsupported() {
        let connections = map_with("c", document_default());
        assert!(matches!(
            dispatch_list_database_users(&connections, "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn list_database_users_search_arm_returns_unsupported() {
        let connections = map_with("c", search_default());
        assert!(matches!(
            dispatch_list_database_users(&connections, "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn list_database_users_kv_arm_returns_unsupported() {
        let connections = map_with("c", kv_default());
        assert!(matches!(
            dispatch_list_database_users(&connections, "c").await,
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

    // Written 2026-05-15: asserts the last empty arm of the dispatch
    // matrix — the Search paradigm also runs the Unsupported branch.
    #[tokio::test]
    async fn kill_server_activity_search_arm_returns_unsupported() {
        let connections = map_with("c", search_default());
        assert!(matches!(
            dispatch_kill_server_activity(&connections, "c", 1).await,
            Err(AppError::Unsupported(_))
        ));
    }

    // ── collection_stats_rdb / collection_stats_mongo ─────────────────────

    fn rdb_default_state() -> crate::commands::connection::AppState {
        // Written 2026-05-15: meta.rs's inner functions take AppState directly,
        // so a helper builds a single-connection state.
        crate::commands::connection::AppState::new()
    }

    async fn state_with(id: &str, active: ActiveAdapter) -> crate::commands::connection::AppState {
        let state = rdb_default_state();
        state
            .active_connections
            .lock()
            .await
            .insert(id.to_string(), std::sync::Arc::new(active));
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

    // ── server_info ──────────────────────────────────────────────────────

    async fn dispatch_server_info(
        connections: &ConnMap,
        connection_id: &str,
    ) -> Result<crate::models::ServerInfoRow, AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        match active.as_ref() {
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

    // ── slow_queries ─────────────────────────────────────────────────────

    async fn dispatch_slow_queries(
        connections: &ConnMap,
        connection_id: &str,
        limit: i64,
    ) -> Result<Vec<crate::models::SlowQueryRow>, AppError> {
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        let cap = limit.clamp(1, 500);
        match active.as_ref() {
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
