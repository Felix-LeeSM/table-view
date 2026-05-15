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
        fn list_collection_indexes<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
        ) -> BoxFuture<'a, Result<Vec<crate::models::IndexInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn create_collection_index<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _request: CreateMongoIndexRequest,
        ) -> BoxFuture<'a, Result<CreateMongoIndexResult, AppError>> {
            Box::pin(async {
                Ok(CreateMongoIndexResult {
                    name: String::new(),
                })
            })
        }
        fn drop_collection_index<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _name: &'a str,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn get_collection_validator<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
        ) -> BoxFuture<'a, Result<crate::db::CollectionValidatorRead, AppError>> {
            Box::pin(async { Ok(crate::db::CollectionValidatorRead::default()) })
        }
        fn set_collection_validator<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _validator: Option<serde_json::Value>,
            _validation_level: Option<String>,
            _validation_action: Option<String>,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn create_collection<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _options: Option<serde_json::Value>,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn rename_collection<'a>(
            &'a self,
            _db: &'a str,
            _from: &'a str,
            _to: &'a str,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn drop_database<'a>(&'a self, _name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn current_op<'a>(
            &'a self,
        ) -> BoxFuture<'a, Result<Vec<crate::models::ServerActivityRow>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn kill_op<'a>(&'a self, _id: i64) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn explain_query<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _filter: bson::Document,
            _verbosity: &'a str,
        ) -> BoxFuture<'a, Result<serde_json::Value, AppError>> {
            Box::pin(async { Ok(serde_json::Value::Null) })
        }
        fn collection_stats<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
        ) -> BoxFuture<'a, Result<crate::models::CollectionStatsRow, AppError>> {
            Box::pin(async {
                Ok(crate::models::CollectionStatsRow {
                    rows: 0,
                    size_bytes: 0,
                    indexes: 0,
                    last_vacuum: None,
                    last_analyze: None,
                    seq_scans: None,
                    idx_scans: None,
                    n_dead: None,
                    extras: std::collections::HashMap::new(),
                })
            })
        }
        fn server_info<'a>(
            &'a self,
        ) -> BoxFuture<'a, Result<crate::models::ServerInfoRow, AppError>> {
            Box::pin(async {
                Ok(crate::models::ServerInfoRow {
                    version: String::new(),
                    host: None,
                    uptime_sec: None,
                    connections_active: None,
                    extras: std::collections::HashMap::new(),
                })
            })
        }
        fn slow_queries<'a>(
            &'a self,
            _limit: i64,
        ) -> BoxFuture<'a, Result<Vec<crate::models::SlowQueryRow>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
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
    fn list_collection_indexes<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
    ) -> BoxFuture<'a, Result<Vec<crate::models::IndexInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn create_collection_index<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _request: CreateMongoIndexRequest,
    ) -> BoxFuture<'a, Result<CreateMongoIndexResult, AppError>> {
        Box::pin(async {
            Ok(CreateMongoIndexResult {
                name: String::new(),
            })
        })
    }
    fn drop_collection_index<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _name: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn get_collection_validator<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
    ) -> BoxFuture<'a, Result<crate::db::CollectionValidatorRead, AppError>> {
        Box::pin(async { Ok(crate::db::CollectionValidatorRead::default()) })
    }
    fn set_collection_validator<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _validator: Option<serde_json::Value>,
        _validation_level: Option<String>,
        _validation_action: Option<String>,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn create_collection<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _options: Option<serde_json::Value>,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn rename_collection<'a>(
        &'a self,
        _db: &'a str,
        _from: &'a str,
        _to: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn drop_database<'a>(&'a self, _name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn current_op<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<crate::models::ServerActivityRow>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn kill_op<'a>(&'a self, _id: i64) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn explain_query<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
        _filter: bson::Document,
        _verbosity: &'a str,
    ) -> BoxFuture<'a, Result<serde_json::Value, AppError>> {
        Box::pin(async { Ok(serde_json::Value::Null) })
    }
    fn collection_stats<'a>(
        &'a self,
        _db: &'a str,
        _collection: &'a str,
    ) -> BoxFuture<'a, Result<crate::models::CollectionStatsRow, AppError>> {
        Box::pin(async {
            Ok(crate::models::CollectionStatsRow {
                rows: 0,
                size_bytes: 0,
                indexes: 0,
                last_vacuum: None,
                last_analyze: None,
                seq_scans: None,
                idx_scans: None,
                n_dead: None,
                extras: std::collections::HashMap::new(),
            })
        })
    }
    fn server_info<'a>(&'a self) -> BoxFuture<'a, Result<crate::models::ServerInfoRow, AppError>> {
        Box::pin(async {
            Ok(crate::models::ServerInfoRow {
                version: String::new(),
                host: None,
                uptime_sec: None,
                connections_active: None,
                extras: std::collections::HashMap::new(),
            })
        })
    }
    fn slow_queries<'a>(
        &'a self,
        _limit: i64,
    ) -> BoxFuture<'a, Result<Vec<crate::models::SlowQueryRow>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
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

// ── Sprint 335/336 — RdbAdapter default impl coverage ───────────────
//
// 작성 이유 (2026-05-15): `db/traits.rs` 의 새 default body (Sprint 335
// `create_database` / `drop_database`; Sprint 336 `list_server_activity`
// / `kill_session`) 는 PG 만 override 하고 FastFakeRdb 는 default 분기
// 그대로 inherit. 그 default 가 `AppError::Unsupported` 를 반환하는지
// 단언한다 (regions/functions coverage 보강).

#[tokio::test]
async fn test_rdb_default_create_database_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.create_database("any").await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("database creation"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_drop_database_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.drop_database("any").await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("database drop"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_list_server_activity_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.list_server_activity().await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("server activity"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_kill_session_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.kill_session(42).await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("kill session"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

// 작성 이유 (2026-05-15, Sprint 336 coverage backfill): traits.rs 의
// pre-Sprint-336 default body 들도 FastFakeRdb 가 override 하지 않아
// region 0% 인 채로 남아 있었다. 동일한 Unsupported / empty Vec 단언
// 패턴으로 추가 cover.

#[tokio::test]
async fn test_rdb_default_count_null_rows_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.count_null_rows("public", "t", "col").await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("NULL row counting"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_list_triggers_returns_empty_vec() {
    let adapter = FastFakeRdb;
    let triggers: Vec<crate::models::TriggerInfo> =
        adapter.list_triggers("public", "t").await.unwrap();
    assert!(triggers.is_empty());
}

#[tokio::test]
async fn test_rdb_default_create_trigger_returns_unsupported() {
    use crate::models::CreateTriggerRequest;
    let adapter = FastFakeRdb;
    let req = CreateTriggerRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: "t".into(),
        trigger_name: "trg".into(),
        timing: "BEFORE".into(),
        events: vec!["INSERT".into()],
        orientation: "ROW".into(),
        when_expression: None,
        function_schema: "public".into(),
        function_name: "f".into(),
        function_arguments: None,
        preview_only: true,
        expected_database: None,
    };
    match adapter.create_trigger(&req).await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("trigger creation"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_drop_trigger_returns_unsupported() {
    use crate::models::DropTriggerRequest;
    let adapter = FastFakeRdb;
    let req = DropTriggerRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: "t".into(),
        trigger_name: "trg".into(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    };
    match adapter.drop_trigger(&req).await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("trigger drop"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_get_trigger_source_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.get_trigger_source("public", "t", "trg").await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("trigger source"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

// 작성 이유 (2026-05-15, Sprint 336 coverage backfill): traits.rs 의
// `create_table_plan` default body 는 sub-chain (create_table →
// create_index* → add_constraint*) 을 합성하는 가장 큰 default block
// 인데 PG 만 override 하고 FastFakeRdb 는 default 분기를 그대로 inherit.
// FastFakeRdb 의 child trait 들은 다 Ok 를 반환하므로 빈 plan + 1 index
// + 1 constraint 3-pillar 단언으로 default body 의 region 을 cover 한다.

#[tokio::test]
async fn test_rdb_default_create_table_plan_empty_plan_returns_parent_sql_only() {
    use crate::models::CreateTablePlanRequest;
    let adapter = FastFakeRdb;
    let req = CreateTablePlanRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        name: "t".into(),
        columns: Vec::new(),
        primary_key: None,
        table_comment: None,
        indexes: Vec::new(),
        constraints: Vec::new(),
        preview_only: true,
        expected_database: None,
    };
    let res = adapter.create_table_plan(&req).await.unwrap();
    // FastFakeRdb.create_table returns SchemaChangeResult { sql: "" };
    // empty children → joined sql is just the parent's empty string.
    assert_eq!(res.sql, "");
}

#[tokio::test]
async fn test_rdb_default_create_table_plan_with_one_index_chains_create_index() {
    use crate::models::{CreateTablePlanIndex, CreateTablePlanRequest};
    let adapter = FastFakeRdb;
    let req = CreateTablePlanRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        name: "t".into(),
        columns: Vec::new(),
        primary_key: None,
        table_comment: None,
        indexes: vec![CreateTablePlanIndex {
            index_name: "idx".into(),
            columns: vec!["a".into()],
            index_type: "btree".into(),
            is_unique: false,
        }],
        constraints: Vec::new(),
        preview_only: true,
        expected_database: None,
    };
    // FastFakeRdb.create_index 도 Ok 라서 chain 통과. join 결과는 ";\n".
    assert!(adapter.create_table_plan(&req).await.is_ok());
}

// 작성 이유 (2026-05-15, Sprint 337): RdbAdapter::explain_query 의
// default body 가 Unsupported 를 반환하는지 단언 — FastFakeRdb 가
// override 하지 않으므로 default 분기로 떨어진다.
#[tokio::test]
async fn test_rdb_default_explain_query_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.explain_query("SELECT 1").await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("EXPLAIN"), "unexpected msg: {}", msg);
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

// 작성 이유 (2026-05-15, Sprint 338): RdbAdapter::collection_stats default
// body Unsupported 단언.
#[tokio::test]
async fn test_rdb_default_collection_stats_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.collection_stats("public", "t").await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("collection stats"), "unexpected: {msg}");
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

// 작성 이유 (2026-05-15, Sprint 339): RdbAdapter::server_info default
// body Unsupported 단언. PG 만 override, 다른 RDB 어댑터는 trait default
// 분기에서 Unsupported 를 반환해야 함을 회귀 가드한다.
#[tokio::test]
async fn test_rdb_default_server_info_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.server_info().await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("server info"), "unexpected: {msg}");
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

// 작성 이유 (2026-05-15, Sprint 340): RdbAdapter::slow_queries default
// body Unsupported 단언. PG 만 override (pg_stat_statements), 다른 RDB
// 어댑터는 trait default 에서 Unsupported.
#[tokio::test]
async fn test_rdb_default_slow_queries_returns_unsupported() {
    let adapter = FastFakeRdb;
    match adapter.slow_queries(10).await {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("slow query"), "unexpected: {msg}");
        }
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn test_rdb_default_create_table_plan_with_one_constraint_chains_add_constraint() {
    use crate::models::{ConstraintDefinition, CreateTablePlanConstraint, CreateTablePlanRequest};
    let adapter = FastFakeRdb;
    let req = CreateTablePlanRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        name: "t".into(),
        columns: Vec::new(),
        primary_key: None,
        table_comment: None,
        indexes: Vec::new(),
        constraints: vec![CreateTablePlanConstraint {
            constraint_name: "pk".into(),
            definition: ConstraintDefinition::PrimaryKey {
                columns: vec!["id".into()],
            },
        }],
        preview_only: true,
        expected_database: None,
    };
    assert!(adapter.create_table_plan(&req).await.is_ok());
}
