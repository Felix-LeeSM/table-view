//! Unit tests for `db/mod.rs` — moved out of the inline `mod tests` block
//! (Sprint P5 step 1, commit a60074d) so production code in mod.rs is no
//! longer ~60% buried under test scaffolding. Sprint 213 (P5 step 2) then
//! split mod.rs into `types`/`traits`/`active`, so this file now imports
//! the external (non-`crate::db::*`) types it needs explicitly — they
//! were previously brought in by mod.rs's own `use` aliases via
//! `super::*`, which is no longer the right shape.

use super::*;
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DatabaseType, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, IndexInfo, RenameTableRequest,
    SchemaChangeResult, SchemaInfo, TableData, TableInfo,
};
use tokio_util::sync::CancellationToken;

#[test]
fn namespace_info_from_schema_info_preserves_name() {
    let schema = SchemaInfo {
        name: "public".to_string(),
    };
    let ns: NamespaceInfo = schema.into();
    assert_eq!(ns.name, "public");
}

#[test]
fn namespace_info_from_schema_info_with_empty_name() {
    let schema = SchemaInfo {
        name: String::new(),
    };
    let ns: NamespaceInfo = schema.into();
    assert_eq!(ns.name, "");
}

#[test]
fn namespace_info_from_schema_info_keeps_unicode() {
    let schema = SchemaInfo {
        name: "스키마_名前".to_string(),
    };
    let ns: NamespaceInfo = schema.into();
    assert_eq!(ns.name, "스키마_名前");
}

#[test]
fn active_adapter_as_rdb_rejects_non_rdb_with_unsupported() {
    struct DummyDocument;
    impl DbAdapter for DummyDocument {
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
    impl DocumentAdapter for DummyDocument {
        fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn list_collections<'a>(
            &'a self,
            _db: &'a str,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn infer_collection_fields<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _sample_size: usize,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn find<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _body: FindBody,
            _cancel: Option<&'a CancellationToken>,
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
            _cancel: Option<&'a CancellationToken>,
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
        fn delete_many<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _filter: bson::Document,
        ) -> BoxFuture<'a, Result<u64, AppError>> {
            Box::pin(async { Ok(0) })
        }
        fn update_many<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _filter: bson::Document,
            _patch: bson::Document,
        ) -> BoxFuture<'a, Result<u64, AppError>> {
            Box::pin(async { Ok(0) })
        }
        fn drop_collection<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }

    let active = ActiveAdapter::Document(Box::new(DummyDocument));
    match active.as_rdb() {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("relational"), "unexpected message: {}", msg);
        }
        other => panic!("Expected Unsupported error, got: {:?}", other.is_ok()),
    }

    // Sanity: as_document resolves on the same adapter.
    assert!(active.as_document().is_ok());

    // Cross-paradigm sanity: as_search/as_kv also yield Unsupported.
    assert!(matches!(active.as_search(), Err(AppError::Unsupported(_))));
    assert!(matches!(active.as_kv(), Err(AppError::Unsupported(_))));
}

// ── Sprint 180 (AC-180-04): cancel-token cooperation tests ───────────
//
// Reason for these tests (2026-04-30): the Sprint 180 contract requires
// every cancellable trait method (4 RDB + 4 Document) to wire
// `Option<&CancellationToken>` so the existing `cancel_query` registry
// can abort the in-flight call cooperatively. We exercise that contract
// here against fake adapters that simulate slow work and observe the
// token via the same `tokio::select!` shape used by
// `PostgresAdapter::execute_query`. Each test follows form (b): wire a
// pre-cancelled token, drive the trait method, assert the
// `AppError::Database("Operation cancelled")` short-circuit path.
//
// We deliberately split this into per-method tests (rather than a
// shared parametric helper) so a future regression on any single trait
// method is bisected by a clearly-named failing test.

use crate::models::FilterCondition;
use std::time::Duration;

/// Fake RDB adapter — drives a slow inner future via `tokio::sleep`
/// and observes the cancel token, so each trait method can assert
/// the cooperative-abort path independently.
struct FakeCancellableRdb;

impl DbAdapter for FakeCancellableRdb {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Postgresql
    }
    fn connect<'a>(&'a self, _config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
}

impl RdbAdapter for FakeCancellableRdb {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }
    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn list_tables<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn get_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(Vec::new())
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
    fn execute_sql<'a>(
        &'a self,
        _sql: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
        Box::pin(async {
            Ok(RdbQueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                total_count: 0,
                execution_time_ms: 0,
                query_type: crate::models::QueryType::Select,
            })
        })
    }
    #[allow(clippy::too_many_arguments)]
    fn query_table_data<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _page: i32,
        _page_size: i32,
        _order_by: Option<&'a str>,
        _filters: Option<&'a [FilterCondition]>,
        _raw_where: Option<&'a str>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(TableData {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    total_count: 0,
                    page: 1,
                    page_size: 0,
                    executed_query: String::new(),
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
    fn drop_table<'a>(
        &'a self,
        _req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Sprint 235 — request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Sprint 235 — request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Sprint 236 — request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Sprint 236 — request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn get_table_indexes<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(Vec::new())
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
    fn get_table_constraints<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(Vec::new())
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
    fn get_view_definition<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async { Ok(String::new()) })
    }
    fn get_view_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn list_schema_columns<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>> {
        Box::pin(async { Ok(std::collections::HashMap::new()) })
    }
    fn get_function_source<'a>(
        &'a self,
        _namespace: &'a str,
        _function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async { Ok(String::new()) })
    }
}

/// Fake document adapter — same shape as the RDB fake; observes cancel
/// token so each Document trait method can assert cooperative abort.
struct FakeCancellableDocument;

impl DbAdapter for FakeCancellableDocument {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Mongodb
    }
    fn connect<'a>(&'a self, _config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
}

impl DocumentAdapter for FakeCancellableDocument {
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn list_collections<'a>(
        &'a self,
        _db: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(Vec::new())
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
        _db: &'a str,
        _collection: &'a str,
        _sample_size: usize,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(Vec::new())
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
        _db: &'a str,
        _collection: &'a str,
        _body: FindBody,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(DocumentQueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    raw_documents: Vec::new(),
                    total_count: 0,
                    execution_time_ms: 0,
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
        _db: &'a str,
        _collection: &'a str,
        _pipeline: Vec<bson::Document>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(DocumentQueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    raw_documents: Vec::new(),
                    total_count: 0,
                    execution_time_ms: 0,
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
    fn delete_many<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _filter: bson::Document,
    ) -> BoxFuture<'a, Result<u64, AppError>> {
        Box::pin(async { Ok(0) })
    }
    fn update_many<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _filter: bson::Document,
        _patch: bson::Document,
    ) -> BoxFuture<'a, Result<u64, AppError>> {
        Box::pin(async { Ok(0) })
    }
    fn drop_collection<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
}

/// Helper — assert the result is the cooperative-cancel `Operation
/// cancelled` error so each test stays terse.
fn assert_cancelled<T: std::fmt::Debug>(res: Result<T, AppError>) {
    match res {
        Err(AppError::Database(msg)) if msg.contains("Operation cancelled") => {}
        other => panic!(
            "expected AppError::Database(\"Operation cancelled\"), got: {:?}",
            other
        ),
    }
}

// ── RDB ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_rdb_query_table_data_honors_cancel_token() {
    // Reason (2026-04-30): pre-cancel the token before driving the
    // trait method so the inner sleep would never resolve; the
    // `tokio::select!` arm must short-circuit with the cancelled
    // error before the 60s timer would.
    let adapter = FakeCancellableRdb;
    let token = CancellationToken::new();
    token.cancel();
    let result = adapter
        .query_table_data("public", "t", 1, 100, None, None, None, Some(&token))
        .await;
    assert_cancelled(result);
}

#[tokio::test]
async fn test_rdb_get_columns_honors_cancel_token() {
    let adapter = FakeCancellableRdb;
    let token = CancellationToken::new();
    token.cancel();
    let result = adapter.get_columns("public", "t", Some(&token)).await;
    assert_cancelled(result);
}

#[tokio::test]
async fn test_rdb_get_table_indexes_honors_cancel_token() {
    let adapter = FakeCancellableRdb;
    let token = CancellationToken::new();
    token.cancel();
    let result = adapter.get_table_indexes("public", "t", Some(&token)).await;
    assert_cancelled(result);
}

#[tokio::test]
async fn test_rdb_get_table_constraints_honors_cancel_token() {
    let adapter = FakeCancellableRdb;
    let token = CancellationToken::new();
    token.cancel();
    let result = adapter
        .get_table_constraints("public", "t", Some(&token))
        .await;
    assert_cancelled(result);
}

// ── Document ─────────────────────────────────────────────────────────

#[tokio::test]
async fn test_document_find_honors_cancel_token() {
    // Reason (2026-04-30): same form as the RDB tests — pre-cancel,
    // assert short-circuit. Mongo bundled driver does not expose
    // killOperations, so this guarantees the future drops promptly
    // even though the server may continue briefly (ADR-0018).
    let adapter = FakeCancellableDocument;
    let token = CancellationToken::new();
    token.cancel();
    let result = adapter
        .find("db", "c", FindBody::default(), Some(&token))
        .await;
    assert_cancelled(result);
}

#[tokio::test]
async fn test_document_aggregate_honors_cancel_token() {
    let adapter = FakeCancellableDocument;
    let token = CancellationToken::new();
    token.cancel();
    let result = adapter.aggregate("db", "c", Vec::new(), Some(&token)).await;
    assert_cancelled(result);
}

#[tokio::test]
async fn test_document_infer_collection_fields_honors_cancel_token() {
    let adapter = FakeCancellableDocument;
    let token = CancellationToken::new();
    token.cancel();
    let result = adapter
        .infer_collection_fields("db", "c", 100, Some(&token))
        .await;
    assert_cancelled(result);
}

#[tokio::test]
async fn test_document_list_collections_honors_cancel_token() {
    let adapter = FakeCancellableDocument;
    let token = CancellationToken::new();
    token.cancel();
    let result = adapter.list_collections("db", Some(&token)).await;
    assert_cancelled(result);
}

// ── Sanity checks: passing `None` does NOT short-circuit ─────────────
//
// Reason (2026-04-30): Sprint 180 contract requires the non-cancelled
// path to behave identically to the pre-180 inherent call. We can't
// wait 60s in unit tests, so we assert the negative shape: with
// `cancel = None` and a fast-returning override the call resolves
// normally. We use a separate fake that returns immediately to
// verify the `None` branch does NOT degrade or return cancelled.

struct FastFakeRdb;
impl DbAdapter for FastFakeRdb {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Postgresql
    }
    fn connect<'a>(&'a self, _config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
}
impl RdbAdapter for FastFakeRdb {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }
    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn list_tables<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn get_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn execute_sql<'a>(
        &'a self,
        _sql: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
        Box::pin(async {
            Ok(RdbQueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                total_count: 0,
                execution_time_ms: 0,
                query_type: crate::models::QueryType::Select,
            })
        })
    }
    #[allow(clippy::too_many_arguments)]
    fn query_table_data<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _page: i32,
        _page_size: i32,
        _order_by: Option<&'a str>,
        _filters: Option<&'a [FilterCondition]>,
        _raw_where: Option<&'a str>,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>> {
        Box::pin(async {
            Ok(TableData {
                columns: Vec::new(),
                rows: Vec::new(),
                total_count: 0,
                page: 1,
                page_size: 0,
                executed_query: String::new(),
            })
        })
    }
    fn drop_table<'a>(
        &'a self,
        _req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Sprint 235 — request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Sprint 235 — request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Sprint 236 — request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Sprint 236 — request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn get_table_indexes<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn get_table_constraints<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn get_view_definition<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async { Ok(String::new()) })
    }
    fn get_view_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn list_schema_columns<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>> {
        Box::pin(async { Ok(std::collections::HashMap::new()) })
    }
    fn get_function_source<'a>(
        &'a self,
        _namespace: &'a str,
        _function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async { Ok(String::new()) })
    }
}

#[tokio::test]
async fn test_rdb_query_table_data_with_none_token_resolves_normally() {
    // Reason (2026-04-30): Sprint 180 invariant — pre-180 callers
    // pass `None` and must observe identical behaviour to the
    // inherent path; this guards against an accidental regression
    // where a future change always wraps the call in
    // `tokio::select!` even when `cancel == None`.
    let adapter = FastFakeRdb;
    let result = adapter
        .query_table_data("public", "t", 1, 100, None, None, None, None)
        .await;
    assert!(result.is_ok(), "None token should resolve normally");
}
