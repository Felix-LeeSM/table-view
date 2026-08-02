//! DuckDB transactional batch execution — ADR 0051 Stage 1 (grid row edits).
//!
//! Connection-per-call (ADR 0051 dec.3) means the whole batch must be atomic
//! inside one closure. `Connection::unchecked_transaction()` wraps the fresh
//! connection in a `BEGIN..COMMIT` whose default drop-behavior rolls back on any
//! early return, so a statement-K failure or the single-row guard
//! (`enforce_single_row_effect`, #1469) rolls back statements 1..K-1 (dec.4).

use duckdb::Connection;
use tokio_util::sync::CancellationToken;

use crate::db::enforce_single_row_effect;
use crate::db::traits::finalize_cancelled;
use crate::error::AppError;
use crate::models::{QueryResult, QueryType};

use super::connection::DuckdbAdapter;
use super::sql_text::{strip_trailing_terminator, validate_supported_sql};

impl DuckdbAdapter {
    /// ADR 0051 Stage 1 — execute a structured row-edit batch inside one
    /// `BEGIN..COMMIT`. Statement K's failure (or the single-row guard) rolls
    /// back 1..K-1. Mirrors the SQLite template
    /// (`db/adapters/sqlite/batch.rs`); `dry_run_sql_batch` stays inherited
    /// `Unsupported` pending Stage 3.
    pub async fn execute_query_batch(
        &self,
        statements: &[String],
        cancel_token: Option<&CancellationToken>,
    ) -> Result<Vec<QueryResult>, AppError> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        // Validate before opening a connection: a blank statement is a caller
        // error, and the capability guard (extension install/load, external
        // file access) applies to batch statements exactly as it gates
        // free-form `execute_sql`.
        for (idx, raw) in statements.iter().enumerate() {
            let stmt = strip_trailing_terminator(raw);
            if stmt.trim().is_empty() {
                return Err(AppError::Validation(format!(
                    "Statement {} of {} is empty",
                    idx + 1,
                    statements.len()
                )));
            }
            validate_supported_sql(stmt)?;
        }

        let owned: Vec<String> = statements.to_vec();
        let total = owned.len();
        let result = self
            .with_connection_cancellable(cancel_token, move |conn| {
                run_commit_batch(conn, &owned, total)
            })
            .await;
        finalize_cancelled(result, cancel_token)
    }
}

fn run_commit_batch(
    conn: &Connection,
    statements: &[String],
    total: usize,
) -> Result<Vec<QueryResult>, AppError> {
    // `unchecked_transaction()` opens on a `&Connection` (the closure owns the
    // fresh connection) with the default `DropBehavior::Rollback`, so any `?`
    // below drops `tx` and rolls back the statements already run.
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut results = Vec::with_capacity(total);
    for (idx, raw) in statements.iter().enumerate() {
        let stmt = strip_trailing_terminator(raw);
        let start = std::time::Instant::now();
        let rows_affected = tx.execute(stmt, []).map_err(|error| {
            AppError::Database(format!(
                "statement {} of {} failed: {}",
                idx + 1,
                total,
                error
            ))
        })? as u64;
        // #1469 — a structured edit must affect exactly one row; anything else
        // (0 → target vanished, N → not uniquely identified) rolls the whole
        // batch back via the early return.
        enforce_single_row_effect(idx, total, rows_affected)?;
        results.push(QueryResult {
            truncated: false,
            columns: Vec::new(),
            rows: Vec::new(),
            total_count: rows_affected as i64,
            execution_time_ms: start.elapsed().as_millis() as u64,
            query_type: QueryType::Dml { rows_affected },
        });
    }

    tx.commit()
        .map_err(|e| AppError::Database(format!("commit failed: {e}")))?;
    Ok(results)
}

#[cfg(test)]
mod tests {
    // Purpose: DuckDB Stage 1 transactional row-edit batch (ADR 0051, #1070) —
    // commit atomicity, statement-failure rollback, single-row guard, read-only
    // rejection, and blank-statement validation (2026-07-24).
    use tempfile::TempDir;

    use super::*;
    use crate::models::{ConnectionConfig, DatabaseType};

    fn duckdb_config(path: &str, read_only: bool) -> ConnectionConfig {
        ConnectionConfig {
            id: "duckdb-batch".to_string(),
            name: "DuckDB batch".to_string(),
            db_type: DatabaseType::Duckdb,
            host: String::new(),
            port: 0,
            user: String::new(),
            password: String::new(),
            database: path.to_string(),
            read_only,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
            trust_server_certificate: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        }
    }

    fn seed(path: &std::path::Path) {
        let conn = duckdb::Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name VARCHAR, qty INTEGER);
             INSERT INTO items VALUES (1, 'a', 10), (2, 'b', 20);",
        )
        .unwrap();
    }

    async fn fixture(read_only: bool) -> (TempDir, DuckdbAdapter) {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("batch.duckdb");
        seed(&db_path);
        let adapter = DuckdbAdapter::new();
        adapter
            .connect_file(&duckdb_config(db_path.to_str().unwrap(), read_only))
            .await
            .unwrap();
        (dir, adapter)
    }

    // Reason: ADR 0051 Stage 1 — a multi-statement row edit must commit
    // atomically so a fresh connection-per-call read sees every change (#1070)
    // (2026-07-24).
    #[tokio::test]
    async fn execute_query_batch_commits_all_statements_atomically_1070() {
        let (_dir, adapter) = fixture(false).await;

        let results = adapter
            .execute_query_batch(
                &[
                    "UPDATE items SET qty = 11 WHERE id = 1".to_string(),
                    "INSERT INTO items VALUES (3, 'c', 30)".to_string(),
                ],
                None,
            )
            .await
            .unwrap();

        assert_eq!(results.len(), 2);
        assert!(matches!(
            results[0].query_type,
            QueryType::Dml { rows_affected: 1 }
        ));

        // A reopened connection (per-call) must observe the committed writes.
        let page = adapter
            .query_table_data("main", "items", 1, 100, Some("id ASC"), None, None, None)
            .await
            .unwrap();
        assert_eq!(page.total_count, 3);
        assert_eq!(page.rows[0][2], serde_json::json!(11));
        assert_eq!(page.rows[2][0], serde_json::json!(3));
    }

    // Reason: ADR 0051 Stage 1 — a statement-K failure rolls back statements
    // 1..K-1 so no partial write persists (#1070) (2026-07-24).
    #[tokio::test]
    async fn execute_query_batch_rolls_back_on_statement_failure_1070() {
        let (_dir, adapter) = fixture(false).await;

        let err = adapter
            .execute_query_batch(
                &[
                    "INSERT INTO items VALUES (3, 'c', 30)".to_string(),
                    "UPDATE does_not_exist SET x = 1".to_string(),
                ],
                None,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Database(_)), "got: {err:?}");

        // The first INSERT must have been rolled back — still two seed rows.
        let page = adapter
            .query_table_data("main", "items", 1, 100, None, None, None, None)
            .await
            .unwrap();
        assert_eq!(page.total_count, 2, "partial write must roll back");
    }

    // Reason: ADR 0051 Stage 1 — the single-row guard (enforce_single_row_effect,
    // #1469) rolls back a statement that affects != 1 row so a mis-scoped edit
    // never silently mass-updates (#1070) (2026-07-24).
    #[tokio::test]
    async fn execute_query_batch_single_row_guard_rolls_back_multi_row_effect_1070() {
        let (_dir, adapter) = fixture(false).await;

        let err = adapter
            .execute_query_batch(
                &["UPDATE items SET qty = 0 WHERE id IN (1, 2)".to_string()],
                None,
            )
            .await
            .unwrap_err();
        match err {
            AppError::Database(message) => {
                assert!(
                    message.contains("expected to affect exactly 1 row"),
                    "unexpected message: {message}"
                );
            }
            other => panic!("expected single-row guard error, got: {other:?}"),
        }

        // Both rows keep their seed values — the guard rolled the update back.
        let page = adapter
            .query_table_data("main", "items", 1, 100, Some("id ASC"), None, None, None)
            .await
            .unwrap();
        assert_eq!(page.rows[0][2], serde_json::json!(10));
        assert_eq!(page.rows[1][2], serde_json::json!(20));
    }

    // Reason: ADR 0051 dec.1 — a read_only connection must reject writes; the
    // batch surfaces the connection's read-only failure instead of committing
    // (#1070) (2026-07-24).
    #[tokio::test]
    async fn execute_query_batch_rejects_writes_on_read_only_connection_1070() {
        let (_dir, adapter) = fixture(true).await;

        let err = adapter
            .execute_query_batch(&["INSERT INTO items VALUES (3, 'c', 30)".to_string()], None)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Database(_) | AppError::Connection(_)),
            "read-only write must fail, got: {err:?}"
        );
    }

    // Reason: a blank/whitespace statement is a validation error, not a silent
    // no-op — mirrors the SQLite batch guard (#1070) (2026-07-24).
    #[tokio::test]
    async fn execute_query_batch_rejects_blank_statement_1070() {
        let (_dir, adapter) = fixture(false).await;

        let err = adapter
            .execute_query_batch(&["   ".to_string()], None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }
}
