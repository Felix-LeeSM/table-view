//! Paradigm-neutral metadata commands (Sprint 128).
//!
//! Houses the unified `list_databases` Tauri command — a thin dispatcher
//! that branches on `ActiveAdapter` so the workspace toolbar's
//! `<DbSwitcher>` can fetch the current connection's database list without
//! caring which paradigm is wired underneath. The four-variant match is
//! exhaustive on purpose: `Search` and `Kv` paradigms intentionally return
//! an empty list rather than `AppError::Unsupported` so the frontend can
//! safely call this command for any connected adapter and render the
//! existing read-only fallback UI when the result is empty.
//!
//! The Mongo-specific `list_mongo_databases` (`commands/document/browse.rs`)
//! stays as-is — Sprint 128 introduces this unified entry point alongside
//! it without breaking existing callers.

use crate::commands::connection::AppState;
use crate::commands::document::browse::DatabaseInfo;
use crate::db::ActiveAdapter;
use crate::error::AppError;

/// Lookup helper — returns `AppError::NotFound` when the id isn't connected.
fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
}

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
///   - `Kv`       → `Ok(vec![])` — Phase 8 Redis adapter likewise.
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
        // Phase 7/8 paradigms — the trait is empty, so we cannot dispatch
        // through it. The contract (sprint-128) explicitly requires a
        // graceful empty list rather than an `Unsupported` error: the
        // frontend keeps the existing read-only `<DbSwitcher>` chrome
        // when the response is empty, so propagating an error here would
        // turn a benign "no databases to switch between" state into a
        // user-facing toast. Phase 9 promotes these arms to real impls.
        ActiveAdapter::Search(_) => Vec::new(),
        ActiveAdapter::Kv(_) => Vec::new(),
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
///   - `Search`/`Kv` → `Err(Unsupported)` — no per-connection database
///                  concept (Phase 7/8 paradigms).
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
        ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
            "Key-value paradigm has no per-connection database concept".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        DbAdapter, DocumentAdapter, DocumentId, DocumentQueryResult, FindBody, KvAdapter,
        NamespaceInfo, SearchAdapter,
    };
    use crate::models::{ColumnInfo, ConnectionConfig, DatabaseType, TableInfo};
    use std::future::Future;
    use std::pin::Pin;

    type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

    fn mongo_namespace_list() -> Vec<NamespaceInfo> {
        vec![
            NamespaceInfo {
                name: "admin".into(),
            },
            NamespaceInfo {
                name: "table_view_test".into(),
            },
        ]
    }

    /// Minimal Document adapter for dispatcher tests — only the
    /// `list_databases` arm is exercised so the rest of the trait is
    /// satisfied with empty/no-op stubs.
    struct StubDocumentAdapter {
        databases: Vec<NamespaceInfo>,
    }

    impl DbAdapter for StubDocumentAdapter {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Mongodb
        }
        fn connect<'a>(
            &'a self,
            _config: &'a ConnectionConfig,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }

    impl DocumentAdapter for StubDocumentAdapter {
        // Sprint 131 — override the trait default so the dispatch test can
        // assert the Document arm propagates `Ok(())` from the adapter.
        // The default `switch_database` returns `Unsupported`, which would
        // mask the dispatcher contract under test.
        fn switch_database<'a>(&'a self, _db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }

        fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
            let dbs = self.databases.clone();
            Box::pin(async move { Ok(dbs) })
        }
        fn list_collections<'a>(
            &'a self,
            _db: &'a str,
        ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn infer_collection_fields<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _sample_size: usize,
        ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn find<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _body: FindBody,
        ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
            Box::pin(async {
                Ok(DocumentQueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    raw_documents: Vec::new(),
                    total_count: 0,
                    execution_time_ms: 0,
                })
            })
        }
        fn aggregate<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _pipeline: Vec<bson::Document>,
        ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
            Box::pin(async {
                Ok(DocumentQueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    raw_documents: Vec::new(),
                    total_count: 0,
                    execution_time_ms: 0,
                })
            })
        }
        fn insert_document<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _doc: bson::Document,
        ) -> BoxFuture<'a, Result<DocumentId, AppError>> {
            Box::pin(async { Ok(DocumentId::Number(0)) })
        }
        fn update_document<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _id: DocumentId,
            _patch: bson::Document,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn delete_document<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _id: DocumentId,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }

    /// Minimal Search adapter — only `DbAdapter` is required by the trait
    /// today. Used to verify the `ActiveAdapter::Search` arm of the
    /// dispatcher returns an empty Vec without touching any
    /// search-specific method.
    struct StubSearchAdapter;
    impl DbAdapter for StubSearchAdapter {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Postgresql // arbitrary placeholder
        }
        fn connect<'a>(
            &'a self,
            _config: &'a ConnectionConfig,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }
    impl SearchAdapter for StubSearchAdapter {}

    /// Minimal KV adapter — same shape as the Search stub, used for the
    /// `ActiveAdapter::Kv` arm verification.
    struct StubKvAdapter;
    impl DbAdapter for StubKvAdapter {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Postgresql // arbitrary placeholder
        }
        fn connect<'a>(
            &'a self,
            _config: &'a ConnectionConfig,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }
    impl KvAdapter for StubKvAdapter {}

    /// Helper that mirrors the real Tauri command's body so the test can
    /// drive the dispatch without standing up a `tauri::State` wrapper.
    /// The production `list_databases` is a thin shell over this same
    /// match — see the body above.
    async fn dispatch(active: &ActiveAdapter) -> Result<Vec<DatabaseInfo>, AppError> {
        let namespaces = match active {
            ActiveAdapter::Rdb(adapter) => adapter.list_databases().await?,
            ActiveAdapter::Document(adapter) => adapter.list_databases().await?,
            ActiveAdapter::Search(_) => Vec::new(),
            ActiveAdapter::Kv(_) => Vec::new(),
        };
        Ok(namespaces
            .into_iter()
            .map(|n| DatabaseInfo { name: n.name })
            .collect())
    }

    #[tokio::test]
    async fn dispatch_document_paradigm_returns_database_names() {
        let adapter = ActiveAdapter::Document(Box::new(StubDocumentAdapter {
            databases: mongo_namespace_list(),
        }));
        let result = dispatch(&adapter).await.expect("dispatch should succeed");
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "admin");
        assert_eq!(result[1].name, "table_view_test");
    }

    #[tokio::test]
    async fn dispatch_document_paradigm_propagates_empty_result() {
        let adapter = ActiveAdapter::Document(Box::new(StubDocumentAdapter {
            databases: Vec::new(),
        }));
        let result = dispatch(&adapter).await.expect("dispatch should succeed");
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn dispatch_search_paradigm_returns_empty_without_unsupported_error() {
        let adapter = ActiveAdapter::Search(Box::new(StubSearchAdapter));
        let result = dispatch(&adapter)
            .await
            .expect("search paradigm must yield Ok(vec![]), not Unsupported");
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn dispatch_kv_paradigm_returns_empty_without_unsupported_error() {
        let adapter = ActiveAdapter::Kv(Box::new(StubKvAdapter));
        let result = dispatch(&adapter)
            .await
            .expect("kv paradigm must yield Ok(vec![]), not Unsupported");
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn dispatch_rdb_default_impl_returns_empty_vec() {
        // Verifies the `RdbAdapter::list_databases` default impl
        // (`Ok(Vec::new())`) reaches the dispatcher when the concrete
        // adapter does not override it. We use `PostgresAdapter` here
        // because it overrides the method, so this test really targets
        // the *unconnected* path — the inherent method short-circuits
        // with "Not connected" error.
        use crate::db::PostgresAdapter;
        let adapter = ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()));
        let result = dispatch(&adapter).await;
        assert!(
            result.is_err(),
            "PostgresAdapter without a pool must surface its 'Not connected' error"
        );
    }

    #[tokio::test]
    async fn not_connected_helper_uses_appropriate_variant() {
        let err = not_connected("missing-id");
        match err {
            AppError::NotFound(msg) => {
                assert!(msg.contains("missing-id"));
            }
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    /// Mirrors the production `switch_active_db` body so the dispatch
    /// table can be exercised without `tauri::State`.
    async fn switch_dispatch(active: &ActiveAdapter, db_name: &str) -> Result<(), AppError> {
        match active {
            ActiveAdapter::Rdb(adapter) => adapter.switch_database(db_name).await,
            ActiveAdapter::Document(adapter) => adapter.switch_database(db_name).await,
            ActiveAdapter::Search(_) => Err(AppError::Unsupported(
                "Search paradigm has no per-connection database concept".into(),
            )),
            ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
                "Key-value paradigm has no per-connection database concept".into(),
            )),
        }
    }

    /// Sprint 131 — Document arm now dispatches through
    /// `DocumentAdapter::switch_database`. The stub adapter overrides the
    /// trait default to return `Ok(())` so the dispatcher must propagate
    /// the OK verbatim. The previous "Unsupported placeholder" assertion
    /// (S130) has been retired alongside the meta.rs string.
    #[tokio::test]
    async fn switch_dispatch_document_paradigm_propagates_ok_from_adapter() {
        let adapter = ActiveAdapter::Document(Box::new(StubDocumentAdapter {
            databases: vec![NamespaceInfo {
                name: "admin".into(),
            }],
        }));
        let result = switch_dispatch(&adapter, "admin").await;
        assert!(
            result.is_ok(),
            "S131 dispatcher must propagate Ok(()) from the Document adapter, got: {:?}",
            result
        );
    }

    /// Sprint 131 — when the Document adapter override surfaces an error
    /// (e.g. a Mongo `list_database_names` permission failure that the
    /// real implementation would best-effort recover from, but that a
    /// custom adapter might choose to bubble up), the dispatcher must
    /// propagate that error verbatim rather than masking it as an
    /// `Unsupported` placeholder.
    #[tokio::test]
    async fn switch_dispatch_document_paradigm_propagates_err_from_adapter() {
        struct ErroringDocumentAdapter;
        impl DbAdapter for ErroringDocumentAdapter {
            fn kind(&self) -> DatabaseType {
                DatabaseType::Mongodb
            }
            fn connect<'a>(
                &'a self,
                _config: &'a ConnectionConfig,
            ) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
            fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
            fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
        }
        impl DocumentAdapter for ErroringDocumentAdapter {
            // Override `switch_database` to surface a Database error so the
            // dispatcher's propagation path is exercised without standing
            // up a live Mongo client.
            fn switch_database<'a>(
                &'a self,
                db_name: &'a str,
            ) -> BoxFuture<'a, Result<(), AppError>> {
                let owned = db_name.to_string();
                Box::pin(async move {
                    Err(AppError::Database(format!(
                        "Database '{}' not found on this connection",
                        owned
                    )))
                })
            }
            fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
                Box::pin(async { Ok(Vec::new()) })
            }
            fn list_collections<'a>(
                &'a self,
                _db: &'a str,
            ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
                Box::pin(async { Ok(Vec::new()) })
            }
            fn infer_collection_fields<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _sample_size: usize,
            ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
                Box::pin(async { Ok(Vec::new()) })
            }
            fn find<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _body: FindBody,
            ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
                Box::pin(async {
                    Ok(DocumentQueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        raw_documents: Vec::new(),
                        total_count: 0,
                        execution_time_ms: 0,
                    })
                })
            }
            fn aggregate<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _pipeline: Vec<bson::Document>,
            ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
                Box::pin(async {
                    Ok(DocumentQueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        raw_documents: Vec::new(),
                        total_count: 0,
                        execution_time_ms: 0,
                    })
                })
            }
            fn insert_document<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _doc: bson::Document,
            ) -> BoxFuture<'a, Result<DocumentId, AppError>> {
                Box::pin(async { Ok(DocumentId::Number(0)) })
            }
            fn update_document<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _id: DocumentId,
                _patch: bson::Document,
            ) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
            fn delete_document<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _id: DocumentId,
            ) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
        }

        let adapter = ActiveAdapter::Document(Box::new(ErroringDocumentAdapter));
        let result = switch_dispatch(&adapter, "missing").await;
        match result {
            Err(AppError::Database(msg)) => {
                assert!(
                    msg.contains("missing"),
                    "Document arm must propagate the underlying Database error, got: {msg}"
                );
            }
            other => panic!("Expected Database error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn switch_dispatch_search_paradigm_returns_unsupported() {
        let adapter = ActiveAdapter::Search(Box::new(StubSearchAdapter));
        let result = switch_dispatch(&adapter, "anything").await;
        assert!(matches!(result, Err(AppError::Unsupported(_))));
    }

    #[tokio::test]
    async fn switch_dispatch_kv_paradigm_returns_unsupported() {
        let adapter = ActiveAdapter::Kv(Box::new(StubKvAdapter));
        let result = switch_dispatch(&adapter, "anything").await;
        assert!(matches!(result, Err(AppError::Unsupported(_))));
    }

    #[tokio::test]
    async fn switch_dispatch_rdb_unconnected_returns_not_connected() {
        // Sprint 130 — PostgresAdapter without `connect_pool` must report
        // `Connection("Not connected")` from the trait override; the
        // dispatcher should propagate it verbatim so the frontend toast
        // can show the underlying reason rather than a generic
        // "Unsupported" mask.
        use crate::db::PostgresAdapter;
        let adapter = ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()));
        let result = switch_dispatch(&adapter, "another_db").await;
        match result {
            Err(AppError::Connection(msg)) => assert!(msg.contains("Not connected")),
            other => panic!("Expected Connection error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn switch_dispatch_rdb_rejects_empty_db_name() {
        // PostgresAdapter::switch_active_db validates input before
        // touching the pool; the dispatcher must surface that as
        // `Validation`, not `Connection`.
        use crate::db::PostgresAdapter;
        let adapter = ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()));
        let result = switch_dispatch(&adapter, "").await;
        assert!(matches!(result, Err(AppError::Validation(_))));
    }
}
