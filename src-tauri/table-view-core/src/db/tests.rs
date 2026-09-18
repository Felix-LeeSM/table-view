//! Unit tests for `db/mod.rs` — moved out of the inline `mod tests` block
//! (commit a60074d) so production code in mod.rs is no longer ~60% buried
//! under test scaffolding. mod.rs was then split into
//! `types`/`traits`/`active`, so this file imports the external
//! (non-`crate::db::*`) types it needs explicitly — they were previously
//! brought in by mod.rs's own `use` aliases via `super::*`, which is no
//! longer the right shape.

use super::*;
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DatabaseType, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, IndexInfo, RenameTableRequest,
    SchemaChangeResult, SchemaInfo, TableData, TableInfo,
};
use tokio_util::sync::CancellationToken;

// Reason (2026-07-24, issue #1625): normal / empty / unicode are three subsets
// that differ only in input (testing-scenarios P9) — one table-driven test
// recovers the contract that `From<SchemaInfo>` carries `name` across
// unchanged. The empty-string and unicode boundary values are preserved.
#[test]
fn namespace_info_from_schema_info_preserves_name() {
    for name in ["public", "", "스키마_名前"] {
        let ns: NamespaceInfo = SchemaInfo {
            name: name.to_string(),
        }
        .into();
        assert_eq!(ns.name, name);
    }
}

// ── AC-180-04: cancel-token cooperation tests ────────────────────────
//
// Reason for these tests (2026-04-30): the AC-180-04 contract requires
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
                truncated: false,
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
        // Request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Request-shaped trait stub.
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
        // Request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Request-shaped trait stub.
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
    ) -> BoxFuture<'a, Result<Vec<DocumentCollectionInfo>, AppError>> {
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
                    truncated: false,
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
        _comment: Option<String>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async move {
            let work = async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(DocumentQueryResult {
                    truncated: false,
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
    // 2026-05-14 — cancel-token honouring stubs for the 4
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
        _body: FindBody,
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
    // 2026-05-17 — runCommand gateway stub.
    fn run_command<'a>(
        &'a self,
        _database: Option<&'a str>,
        _command: bson::Document,
    ) -> BoxFuture<'a, Result<serde_json::Value, AppError>> {
        Box::pin(async { Ok(serde_json::json!({ "ok": 1 })) })
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

// Reason (2026-07-24, issue #1625): the 4 RDB and 4 Document cancel tests each
// repeated the same shape — pre-cancelled token → method call →
// `assert_cancelled` (subsets that differ only in input, testing-scenarios P9).
// One parameterised test per layer recovers every cooperative-abort arm of the
// fake's `tokio::select!` while dropping the boilerplate. Without a pool the
// real `PostgresAdapter` cancel wrapper bails out of `active_pool()` with
// "Not connected" before it reaches the select! arm, so the fake is what pins
// the AC-180-04 contract.
fn pre_cancelled() -> CancellationToken {
    let t = CancellationToken::new();
    t.cancel();
    t
}

#[tokio::test]
async fn test_rdb_cancellable_methods_honor_pre_cancelled_token() {
    let adapter = FakeCancellableRdb;
    assert_cancelled(
        adapter
            .query_table_data(
                "public",
                "t",
                1,
                100,
                None,
                None,
                None,
                Some(&pre_cancelled()),
            )
            .await,
    );
    assert_cancelled(
        adapter
            .get_columns("public", "t", Some(&pre_cancelled()))
            .await,
    );
    assert_cancelled(
        adapter
            .get_table_indexes("public", "t", Some(&pre_cancelled()))
            .await,
    );
    assert_cancelled(
        adapter
            .get_table_constraints("public", "t", Some(&pre_cancelled()))
            .await,
    );
}

// ── Document ─────────────────────────────────────────────────────────

// Reason (2026-07-24, issue #1625): same as the RDB counterpart — the bundled
// Mongo driver does not expose killOperations, so dropping the future is the
// abort contract (ADR-0018); this recovers the `tokio::select!` cancelled arm
// of each method.
#[tokio::test]
async fn test_document_cancellable_methods_honor_pre_cancelled_token() {
    let adapter = FakeCancellableDocument;
    assert_cancelled(
        adapter
            .find("db", "c", FindBody::default(), Some(&pre_cancelled()))
            .await,
    );
    assert_cancelled(
        adapter
            .aggregate("db", "c", Vec::new(), None, Some(&pre_cancelled()))
            .await,
    );
    assert_cancelled(
        adapter
            .infer_collection_fields("db", "c", 100, Some(&pre_cancelled()))
            .await,
    );
    assert_cancelled(adapter.list_collections("db", Some(&pre_cancelled())).await);
}

// ── Sanity checks: passing `None` does NOT short-circuit ─────────────
//
// Reason (2026-04-30): the AC-180-04 contract requires the non-cancelled
// path to behave identically to the earlier inherent call. We can't
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
                truncated: false,
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
        // Request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Request-shaped trait stub.
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
        // Request-shaped trait stub.
        Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
    }
    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        // Request-shaped trait stub.
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
    // Reason (2026-04-30): AC-180-04 invariant — callers that predate
    // the token pass `None` and must observe identical behaviour to the
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
// Reason (2026-05-08): the default method bodies in `db/traits.rs` had 0%
// coverage. Neither `FastFakeRdb` nor `FakeCancellableDocument` overrides a
// method that has a default — deliberately — so a trait call on either instance
// runs the default impl. The `current_database` default branches four ways on
// the shape of the execute_sql result (no rows / no cols / non-string / string
// val + propagated err), so a separate `CurrentDbStub` is reshaped through a
// closure to check each one.

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
// FastFakeRdb deliberately does not override this method, so trait dispatch
// falls to the default body. Only PG overrides it (postgres.rs); MySQL and
// SQLite inherit the default and surface Unsupported to the frontend.
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
    // FastFakeRdb.execute_sql returns rows=[], so `result.rows.first()` is
    // None → the "returned no rows" branch.
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
    // rows=[[]] — `rows.first()` is Some(empty row) and `row.first()` is None
    // → the "returned no columns" branch.
    let stub = CurrentDbStub {
        response: Box::new(|| {
            Ok(RdbQueryResult {
                truncated: false,
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
                truncated: false,
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
    // rows=[[42]] → `val.as_str()` None → Ok(None). This does not happen
    // against PG, but it asserts the robustness of the default branch.
    let stub = CurrentDbStub {
        response: Box::new(|| {
            Ok(RdbQueryResult {
                truncated: false,
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
    // When execute_sql returns Err, `?` propagates it unchanged.
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

// ── RdbAdapter default impl coverage ────────────────────────────────
//
// Reason (2026-05-15): the newer default bodies in `db/traits.rs`
// (`create_database` / `drop_database`, `list_server_activity` /
// `kill_session`) are overridden only by PG, and FastFakeRdb inherits the
// default branch as-is. These assert that the default returns
// `AppError::Unsupported` (topping up regions/functions coverage).

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

// Reason (2026-05-15, coverage backfill): the older default bodies in traits.rs
// were also left at 0% region coverage because FastFakeRdb does not override
// them. The same Unsupported / empty Vec assertion pattern covers them too.

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

// Reason (2026-05-15, coverage backfill): the `create_table_plan` default body
// in traits.rs is the largest default block — it composes the sub-chain
// (create_table → create_index* → add_constraint*) — yet only PG overrides it
// and FastFakeRdb inherits the default branch as-is. Every child trait of
// FastFakeRdb returns Ok, so a three-pillar assertion (empty plan + 1 index +
// 1 constraint) covers the regions of the default body.

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
    // FastFakeRdb.create_index is Ok too, so the chain passes. The join
    // result is ";\n".
    assert!(adapter.create_table_plan(&req).await.is_ok());
}

// Reason (2026-05-15): assert that the `RdbAdapter::explain_query` default
// body returns Unsupported — FastFakeRdb does not override it, so the call
// falls to the default branch.
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

// Reason (2026-05-15): assert that the `RdbAdapter::collection_stats` default
// body returns Unsupported.
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

// Reason (2026-05-15): assert that the `RdbAdapter::server_info` default body
// returns Unsupported. Only PG overrides it; this guards against the regression
// where another RDB adapter stops returning Unsupported from the trait default
// branch.
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

// Reason (2026-05-15): assert that the `RdbAdapter::slow_queries` default body
// returns Unsupported. Only PG overrides it (pg_stat_statements); the other RDB
// adapters get Unsupported from the trait default.
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
