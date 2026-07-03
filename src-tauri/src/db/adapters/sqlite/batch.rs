//! SQLite transactional batch and dry-run execution.

use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{QueryResult, QueryType};

use super::connection::SqliteAdapter;
use super::queries::validate_sqlite_execution_guardrails;
use super::sql_text::{sqlite_query_type, strip_trailing_terminator};

enum BatchMode {
    Commit,
    Rollback,
}

impl SqliteAdapter {
    pub async fn execute_query_batch(
        &self,
        statements: &[String],
        cancel_token: Option<&CancellationToken>,
    ) -> Result<Vec<QueryResult>, AppError> {
        self.execute_transactional_batch(statements, cancel_token, BatchMode::Commit)
            .await
    }

    pub async fn dry_run_query_batch(
        &self,
        statements: &[String],
        cancel_token: Option<&CancellationToken>,
    ) -> Result<Vec<QueryResult>, AppError> {
        self.execute_transactional_batch(statements, cancel_token, BatchMode::Rollback)
            .await
    }

    async fn execute_transactional_batch(
        &self,
        statements: &[String],
        cancel_token: Option<&CancellationToken>,
        mode: BatchMode,
    ) -> Result<Vec<QueryResult>, AppError> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        if cancel_token.is_some_and(CancellationToken::is_cancelled) {
            return Err(AppError::Database("Query cancelled".into()));
        }
        for (idx, raw) in statements.iter().enumerate() {
            if strip_trailing_terminator(raw).trim().is_empty() {
                return Err(AppError::Validation(format!(
                    "Statement {} of {} is empty",
                    idx + 1,
                    statements.len()
                )));
            }
        }

        let (pool, read_only) = self.active_pool_with_mode().await?;
        for raw in statements {
            let stmt = strip_trailing_terminator(raw);
            let statement_type = sqlite_query_type(stmt);
            validate_sqlite_execution_guardrails(stmt, &statement_type, read_only)?;
        }
        let total = statements.len();
        let work = async {
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;

            let mut results = Vec::with_capacity(total);
            for (idx, raw) in statements.iter().enumerate() {
                let stmt = strip_trailing_terminator(raw);
                let start = std::time::Instant::now();
                let exec_result = sqlx::query(stmt).execute(&mut *tx).await;
                match exec_result {
                    Ok(result) => {
                        let rows_affected = result.rows_affected();
                        // Issue #1079 — commit path only; dry-run reports N-row
                        // impact as a preview rather than an error.
                        if matches!(mode, BatchMode::Commit) {
                            if let Err(err) =
                                crate::db::enforce_single_row_effect(idx, total, rows_affected)
                            {
                                let _ = tx.rollback().await;
                                return Err(err);
                            }
                        }
                        results.push(QueryResult {
                            columns: Vec::new(),
                            rows: Vec::new(),
                            total_count: rows_affected as i64,
                            execution_time_ms: start.elapsed().as_millis() as u64,
                            query_type: QueryType::Dml { rows_affected },
                        });
                    }
                    Err(error) => {
                        let _ = tx.rollback().await;
                        return Err(AppError::Database(format!(
                            "statement {} of {} failed: {}",
                            idx + 1,
                            total,
                            error
                        )));
                    }
                }
            }

            match mode {
                BatchMode::Commit => tx
                    .commit()
                    .await
                    .map_err(|e| AppError::Database(format!("commit failed: {}", e)))?,
                BatchMode::Rollback => tx
                    .rollback()
                    .await
                    .map_err(|e| AppError::Database(format!("rollback failed: {}", e)))?,
            }
            Ok::<Vec<QueryResult>, AppError>(results)
        };

        match cancel_token {
            Some(token) => tokio::select! {
                result = work => result,
                _ = token.cancelled() => Err(AppError::Database("Query cancelled".into())),
            },
            None => work.await,
        }
    }
}

#[cfg(test)]
#[path = "batch_tests.rs"]
mod tests;
