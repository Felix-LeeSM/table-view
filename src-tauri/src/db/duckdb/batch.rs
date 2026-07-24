//! DuckDB transactional batch execution — ADR 0051 Stage 1 (grid row edits).
//!
//! Connection-per-call (ADR 0051 dec.3) means the whole batch must be atomic
//! inside one closure. `Connection::unchecked_transaction()` wraps the fresh
//! connection in a `BEGIN..COMMIT` whose default drop-behavior rolls back on any
//! early return, so a statement-K failure or the single-row guard
//! (`enforce_single_row_effect`, #1469) rolls back statements 1..K-1 (dec.4).

use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::QueryResult;

use super::connection::DuckdbAdapter;

impl DuckdbAdapter {
    pub async fn execute_query_batch(
        &self,
        _statements: &[String],
        _cancel_token: Option<&CancellationToken>,
    ) -> Result<Vec<QueryResult>, AppError> {
        Err(AppError::Unsupported(
            "DuckDB transactional batch not yet implemented".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    // Purpose: DuckDB Stage 1 transactional row-edit batch (ADR 0051, #1070).
    // RED snapshot — this commit fixes the pre-implementation contract (batch is
    // `Unsupported`); the GREEN commit replaces it with the committed/rollback
    // behavioral suite (2026-07-24).
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

    // Reason: RED — before ADR 0051 Stage 1, DuckDB's `execute_sql_batch`
    // inherited the trait `Unsupported` default, so structured grid row edits
    // were blocked even on a `read_only=false` connection (#1070) (2026-07-24).
    #[tokio::test]
    async fn execute_query_batch_is_unsupported_before_stage1_1070() {
        let (_dir, adapter) = fixture(false).await;

        let err = adapter
            .execute_query_batch(
                &["UPDATE items SET qty = 11 WHERE id = 1".to_string()],
                None,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Unsupported(_)), "got: {err:?}");
    }
}
