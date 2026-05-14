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
        // Sprint 308 (2026-05-14) — 6 new trait methods. Bare-minimum
        // stubs so the test impl block satisfies the trait surface.
        fn find_one<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _filter: bson::Document,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Option<DocumentRow>, AppError>> {
            Box::pin(async { Ok(None) })
        }
        fn count_documents<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _filter: bson::Document,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<i64, AppError>> {
            Box::pin(async { Ok(0) })
        }
        fn estimated_document_count<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<i64, AppError>> {
            Box::pin(async { Ok(0) })
        }
        fn distinct<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _field: &'a str,
            _filter: bson::Document,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<serde_json::Value>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn insert_many<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _docs: Vec<bson::Document>,
        ) -> BoxFuture<'a, Result<Vec<DocumentId>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn bulk_write<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _ops: Vec<BulkWriteOp>,
        ) -> BoxFuture<'a, Result<BulkWriteResult, AppError>> {
            Box::pin(async { Ok(BulkWriteResult::default()) })
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
    // Sprint 308 (2026-05-14) — cancel-token honouring stubs for the 4
    // read methods + simple `Ok(default)` stubs for the 2 writes. Mirrors
    // the `find` / `aggregate` `tokio::select!` shape so future cancel
    // tests for the new methods can opt-in without a re-write.
    fn find_one<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _filter: bson::Document,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Option<DocumentRow>, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(None)
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
    fn count_documents<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _filter: bson::Document,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(0)
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
    fn estimated_document_count<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(0)
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
    fn distinct<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _field: &'a str,
        _filter: bson::Document,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<serde_json::Value>, AppError>> {
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
    fn insert_many<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _docs: Vec<bson::Document>,
    ) -> BoxFuture<'a, Result<Vec<DocumentId>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn bulk_write<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _ops: Vec<BulkWriteOp>,
    ) -> BoxFuture<'a, Result<BulkWriteResult, AppError>> {
        Box::pin(async { Ok(BulkWriteResult::default()) })
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

// ── Default trait impl coverage (RdbAdapter / DocumentAdapter) ───────
//
// 작성 이유 (2026-05-08): `db/traits.rs` 의 default method body 가 0%
// coverage 였다. `FastFakeRdb` 와 `FakeCancellableDocument` 둘 다
// 의도적으로 default 가 있는 method 를 override 하지 않으므로
// 그 인스턴스에 trait 호출을 보내면 default impl 이 실행된다.
// `current_database` default 는 execute_sql 결과 형태에 따라 4-갈래
// 분기 (no rows / no cols / non-string / string val + propagated err)
// 가 있어 별도 stub `CurrentDbStub` 를 closure 로 변형해 검증한다.

#[tokio::test]
async fn test_rdb_default_list_databases_returns_empty_vec() {
    let adapter = FastFakeRdb;
    let dbs: Vec<NamespaceInfo> = adapter.list_databases().await.unwrap();
    assert!(dbs.is_empty());
}

#[tokio::test]
async fn test_rdb_default_switch_database_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.switch_database("any").await {
        Err(AppError::Unsupported(msg)) => {
            assert!(
                msg.contains("database switching"),
                "unexpected msg: {}",
                msg
            );
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_execute_sql_batch_returns_unsupported() {
    let adapter = FastFakeRdb;
    let stmts: Vec<String> = vec!["SELECT 1".into()];
    match adapter.execute_sql_batch(&stmts, None).await {
        Err(AppError::Unsupported(msg)) => {
            assert!(
                msg.contains("batched transactions"),
                "unexpected msg: {}",
                msg
            );
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

// [AC-247-B7] — RdbAdapter::dry_run_sql_batch default impl returns
// `AppError::Unsupported("This adapter does not support dry-run")`.
// FastFakeRdb 는 의도적으로 이 method 를 override 하지 않으므로 trait
// dispatch 가 default body 로 떨어진다. PG 만 override (postgres.rs); MySQL/
// SQLite 는 default 를 그대로 inherit 해 frontend 에 Unsupported 를 surface.
// Date 2026-05-09.
#[tokio::test]
async fn test_rdb_default_dry_run_sql_batch_returns_unsupported() {
    let adapter = FastFakeRdb;
    let stmts: Vec<String> = vec!["SELECT 1".into()];
    match adapter.dry_run_sql_batch(&stmts, None).await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("dry-run"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_stream_table_rows_returns_unsupported() {
    let adapter = FastFakeRdb;
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let cols: Vec<String> = vec!["id".into()];
    let res = adapter
        .stream_table_rows("public", "t", 100, &cols, tx, None)
        .await;
    match res {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("Row streaming"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_list_views_returns_empty_vec() {
    let adapter = FastFakeRdb;
    let views: Vec<crate::models::ViewInfo> = adapter.list_views("public").await.unwrap();
    assert!(views.is_empty());
}

#[tokio::test]
async fn test_rdb_default_list_functions_returns_empty_vec() {
    let adapter = FastFakeRdb;
    let funcs: Vec<crate::models::FunctionInfo> = adapter.list_functions("public").await.unwrap();
    assert!(funcs.is_empty());
}

#[tokio::test]
async fn test_rdb_default_list_types_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.list_types().await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("list types"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_current_database_no_rows_returns_database_err() {
    // FastFakeRdb.execute_sql 은 rows=[] 를 반환하므로
    // `result.rows.first()` 가 None → "returned no rows" 분기.
    let adapter = FastFakeRdb;
    match adapter.current_database().await {
        Err(AppError::Database(msg)) => {
            assert!(msg.contains("no rows"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Database err, got {:?}", other.is_ok()),
    }
}

/// Closure-driven stub specifically for exercising `current_database`
/// default body branches (empty cols / non-string / string val / Err).
struct CurrentDbStub {
    response: Box<dyn Fn() -> Result<RdbQueryResult, AppError> + Send + Sync>,
}

impl DbAdapter for CurrentDbStub {
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

impl RdbAdapter for CurrentDbStub {
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
        let res = (self.response)();
        Box::pin(async move { res })
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
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
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
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
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
async fn test_rdb_default_current_database_empty_first_row_returns_no_columns_err() {
    // rows=[[]] — `rows.first()` 는 Some(빈 row), `row.first()` 가 None
    // → "returned no columns" 분기.
    let stub = CurrentDbStub {
        response: Box::new(|| {
            Ok(RdbQueryResult {
                columns: Vec::new(),
                rows: vec![Vec::new()],
                total_count: 0,
                execution_time_ms: 0,
                query_type: crate::models::QueryType::Select,
            })
        }),
    };
    match stub.current_database().await {
        Err(AppError::Database(msg)) => {
            assert!(msg.contains("no columns"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Database err, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_current_database_string_val_returns_some() {
    // rows=[["mydb"]] → `val.as_str()` Some → Ok(Some("mydb")).
    let stub = CurrentDbStub {
        response: Box::new(|| {
            Ok(RdbQueryResult {
                columns: Vec::new(),
                rows: vec![vec![serde_json::json!("mydb")]],
                total_count: 0,
                execution_time_ms: 0,
                query_type: crate::models::QueryType::Select,
            })
        }),
    };
    let res = stub.current_database().await.unwrap();
    assert_eq!(res, Some("mydb".to_string()));
}

#[tokio::test]
async fn test_rdb_default_current_database_non_string_val_returns_none() {
    // rows=[[42]] → `val.as_str()` None → Ok(None). PG 환경에서는 일어
    // 나지 않지만 default 분기 robustness 단언.
    let stub = CurrentDbStub {
        response: Box::new(|| {
            Ok(RdbQueryResult {
                columns: Vec::new(),
                rows: vec![vec![serde_json::json!(42)]],
                total_count: 0,
                execution_time_ms: 0,
                query_type: crate::models::QueryType::Select,
            })
        }),
    };
    let res = stub.current_database().await.unwrap();
    assert_eq!(res, None);
}

#[tokio::test]
async fn test_rdb_default_current_database_propagates_execute_sql_err() {
    // execute_sql 이 Err 를 반환하면 `?` 로 그대로 전파.
    let stub = CurrentDbStub {
        response: Box::new(|| Err(AppError::Database("boom".into()))),
    };
    match stub.current_database().await {
        Err(AppError::Database(msg)) => assert_eq!(msg, "boom"),
        other => panic!("expected propagated Database err, got {:?}", other.is_ok()),
    }
}

// ── DocumentAdapter defaults ──────────────────────────────────────────

#[tokio::test]
async fn test_document_default_switch_database_returns_unsupported() {
    let adapter = FakeCancellableDocument;
    match adapter.switch_database("any").await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("document adapter"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_document_default_current_database_returns_none() {
    let adapter = FakeCancellableDocument;
    let res = adapter.current_database().await.unwrap();
    assert_eq!(res, None);
}
