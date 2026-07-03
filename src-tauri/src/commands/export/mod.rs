//! Sprint 181 — Export grid rows to CSV / TSV / SQL `INSERT` / JSON.
//!
//! All format conversion lives here so the frontend never makes encoding
//! decisions (TablePlus-equivalent deterministic output). The handler
//! streams rows to a `BufWriter<File>` and cooperates with the Sprint 180
//! cancellation registry through an optional `export_id`.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::State;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::commands::connection::AppState;
use crate::commands::{register_cancel_token, release_cancel_token};
use crate::db::RdbAdapter;
use crate::error::AppError;

mod dump_writers;
mod grid_writers;

use dump_writers::{pg_value_to_sql_literal, qualified_pg_table, quote_pg_identifier};
use grid_writers::{
    require_sql_source_table, write_csv, write_json_array, write_sql_insert, write_tsv,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Csv,
    Tsv,
    Sql,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceTable {
    pub schema: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ExportContext {
    Table { schema: String, name: String },
    Collection { name: String },
    Query { source_table: Option<SourceTable> },
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportSummary {
    pub rows_written: u64,
    pub bytes_written: u64,
}

#[tauri::command]
pub async fn export_grid_rows(
    state: State<'_, AppState>,
    format: ExportFormat,
    target_path: PathBuf,
    headers: Vec<String>,
    rows: Vec<Vec<JsonValue>>,
    context: ExportContext,
    export_id: Option<String>,
) -> Result<ExportSummary, AppError> {
    export_grid_rows_inner(
        state.inner(),
        format,
        target_path,
        headers,
        rows,
        context,
        export_id.as_deref(),
    )
    .await
}

/// Sprint 237 P5 (2026-05-08) — handler body hoisted from
/// `export_grid_rows` so unit tests can drive the cancel-token register
/// → spawn_blocking → token release contract via `&AppState` without
/// needing a `tauri::State`.
async fn export_grid_rows_inner(
    state: &AppState,
    format: ExportFormat,
    target_path: PathBuf,
    headers: Vec<String>,
    rows: Vec<Vec<JsonValue>>,
    context: ExportContext,
    export_id: Option<&str>,
) -> Result<ExportSummary, AppError> {
    info!(
        format = ?format,
        rows = rows.len(),
        cols = headers.len(),
        "export_grid_rows invoked"
    );

    // Sprint 180 — cooperative cancellation. Sprint 237 P5+ hoist 이후
    // commands/mod.rs 의 공통 헬퍼 사용 — `execute_query` /
    // `query_table_data` 와 동일 lifecycle.
    let cancel_handle = register_cancel_token(state, export_id).await;
    let task_token = cancel_handle.as_ref().map(|(_, tok)| tok.clone());

    // Run the synchronous file I/O on a blocking thread so the async
    // executor stays responsive. The blocking task captures owned data;
    // the cancellation token is the only shared handle.
    let target_for_task = target_path.clone();
    let task = tauri::async_runtime::spawn_blocking(move || {
        write_export(
            format,
            &target_for_task,
            &headers,
            &rows,
            &context,
            task_token.as_ref(),
        )
    });

    let result = match task.await {
        Ok(inner) => inner,
        Err(join_err) => Err(AppError::Storage(format!(
            "export task join failed: {}",
            join_err
        ))),
    };

    release_cancel_token(state, &cancel_handle).await;

    if let Err(ref e) = result {
        // Issue #1094 — no target cleanup here. `write_export` writes to a
        // temp sibling and only renames on success, so a failed/cancelled
        // export leaves the original `target_path` untouched (removing it
        // here would destroy a pre-existing file the user still has).
        warn!(error = %e, "export_grid_rows failed");
    }

    result
}

/// Synchronous core. Pulled out so unit tests can drive it without a
/// Tauri AppState. Returns `AppError::Validation("cancelled")` if the
/// token fires mid-write.
pub fn write_export(
    format: ExportFormat,
    target_path: &Path,
    headers: &[String],
    rows: &[Vec<JsonValue>],
    context: &ExportContext,
    cancel: Option<&CancellationToken>,
) -> Result<ExportSummary, AppError> {
    // Issue #1094 — reject relative / internal-state target paths before any
    // filesystem work.
    crate::storage::local::validate_export_target_path(target_path)?;

    // Pre-flight: SQL format requires a single-table source. Reject
    // before opening the file so no partial artifact is created.
    if matches!(format, ExportFormat::Sql) {
        require_sql_source_table(context)?;
    }
    if matches!(format, ExportFormat::Json) && !matches!(context, ExportContext::Collection { .. })
    {
        return Err(AppError::Validation(
            "JSON export is only supported for collections".into(),
        ));
    }

    let bytes_written = atomic_write(target_path, |writer| match format {
        ExportFormat::Csv => write_csv(writer, headers, rows, cancel),
        ExportFormat::Tsv => write_tsv(writer, headers, rows, cancel),
        ExportFormat::Sql => write_sql_insert(writer, headers, rows, context, cancel),
        ExportFormat::Json => write_json_array(writer, headers, rows, cancel),
    })?;

    Ok(ExportSummary {
        rows_written: rows.len() as u64,
        bytes_written,
    })
}

/// Issue #1094 — atomic file replace. Writes the body to a temp sibling in the
/// **same directory** as `target` (rename is only atomic within one
/// filesystem), fsyncs, then renames over `target`. On any failure — including
/// a cancellation mid-write — the temp file is removed and `target` is left
/// untouched, so a failed export can never destroy a pre-existing file. Mirrors
/// `storage::local_files::save_json_atomic`.
fn atomic_write<F>(target: &Path, write_body: F) -> Result<u64, AppError>
where
    F: FnOnce(&mut BufWriter<File>) -> Result<u64, AppError>,
{
    let temp_path = temp_sibling_path(target)?;

    let write_result = (|| {
        let file = File::create(&temp_path).map_err(AppError::from)?;
        let mut writer = BufWriter::new(file);
        let bytes = write_body(&mut writer)?;
        writer.flush().map_err(AppError::from)?;
        writer.get_ref().sync_all().map_err(AppError::from)?;
        Ok(bytes)
    })();

    match write_result {
        Ok(bytes) => match std::fs::rename(&temp_path, target) {
            Ok(()) => Ok(bytes),
            Err(e) => {
                let _ = std::fs::remove_file(&temp_path);
                Err(AppError::from(e))
            }
        },
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(e)
        }
    }
}

/// A unique temp path in the same directory as `target` (pid + nanos, matching
/// `save_json_atomic`). Same-dir placement keeps the final `rename` atomic.
fn temp_sibling_path(target: &Path) -> Result<PathBuf, AppError> {
    let parent = target
        .parent()
        .ok_or_else(|| AppError::Validation("Export target path has no parent directory".into()))?;
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("export");
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    Ok(parent.join(format!("{file_name}.tmp.{}.{}", std::process::id(), nanos)))
}

// =============================================== text file (Sprint 192)

/// AC-192-02 — Sprint 192. 단순 UTF-8 text content 한 덩어리를
/// `target_path` 에 기록한다. `export_grid_rows` 의 row-streaming
/// 인프라가 과한 (DDL string 은 한 string 으로 들어와 streaming /
/// cancellation 이 의미 없음) 시나리오 — migration export, query
/// snippet export 등 -를 위한 minimal sibling.
///
/// 실패 시 부분 파일이 남지 않도록 best-effort cleanup. 반환값은
/// `ExportSummary { rows_written: 0, bytes_written: <len> }` —
/// rows_written 은 row-단위가 아니므로 0 sentinel.
#[tauri::command]
pub async fn write_text_file_export(
    target_path: PathBuf,
    content: String,
) -> Result<ExportSummary, AppError> {
    write_text_file_export_inner(target_path, content).await
}

/// Sprint 237 P5 (2026-05-08) — handler body hoisted from the Tauri
/// command wrapper. AppState 의존이 없어 시그니처에 state 파라미터가
/// 없다 — spawn_blocking + best-effort cleanup 만 단위 테스트로 노출.
async fn write_text_file_export_inner(
    target_path: PathBuf,
    content: String,
) -> Result<ExportSummary, AppError> {
    info!(
        bytes = content.len(),
        target = ?target_path,
        "write_text_file_export invoked"
    );

    let target_for_task = target_path.clone();
    let task =
        tauri::async_runtime::spawn_blocking(move || write_text_file(&target_for_task, &content));

    let result = match task.await {
        Ok(inner) => inner,
        Err(join_err) => Err(AppError::Storage(format!(
            "write_text_file_export task join failed: {}",
            join_err
        ))),
    };

    if let Err(ref e) = result {
        // Issue #1094 — `write_text_file` writes to a temp sibling and only
        // renames on success, so no target cleanup is needed (and removing
        // it would destroy a pre-existing file).
        warn!(error = %e, "write_text_file_export failed");
    }

    result
}

/// Synchronous core. Pulled out so unit tests can drive it without a
/// Tauri AppState — symmetrical to `write_export`.
pub fn write_text_file(target_path: &Path, content: &str) -> Result<ExportSummary, AppError> {
    // Issue #1094 — same path guard + atomic replace as `write_export`.
    crate::storage::local::validate_export_target_path(target_path)?;
    let bytes_written = atomic_write(target_path, |writer| {
        writer
            .write_all(content.as_bytes())
            .map_err(AppError::from)?;
        Ok(content.len() as u64)
    })?;
    Ok(ExportSummary {
        rows_written: 0,
        bytes_written,
    })
}

// =============================================== schema dump (Sprint 192)

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportInclude {
    /// CREATE TABLE / INDEX / FK only — no row data.
    Ddl,
    /// `INSERT … VALUES` only — rows from streaming cursor.
    Dml,
    /// DDL header + DML body.
    Both,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSchemaDumpOptions {
    pub include: ExportInclude,
    /// PG cursor `FETCH FORWARD N` 의 N. 1차 권장값 1000 (메모리 vs IPC
    /// trade-off — 너무 작으면 cursor RTT, 너무 크면 batch 한 묶음이
    /// receiver 에서 tied up).
    pub batch_size: u32,
}

/// 호출자가 미리 결정한 (schema, table, column_names) entry. column_names
/// 는 source order — `serde_json::Map` 의 key order 가 alphabetical 일
/// 수 있으므로 source order 가 별도 입력으로 필요 (`row_to_json` lookup).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDumpTable {
    pub schema: String,
    pub table: String,
    pub column_names: Vec<String>,
}

/// AC-192-05 — Sprint 192 통합. Schema/Database dump (DDL + DML) 을
/// 한 .sql 파일로 streaming 출력. PG only — MySQL/SQLite adapter 는 Phase
/// 9 합류 시 `RdbAdapter::stream_table_rows` 의 default `Unsupported` 가
/// 자동 reject.
///
/// Flow:
///  1. `query_tokens` 에 `export_id` 등록 (Sprint 180 패턴 reuse).
///  2. tokio `BufWriter<File>` 으로 target file 생성.
///  3. `include in {ddl, both}` → `ddl_header` 기록.
///  4. `include in {dml, both}` → `tables` 순회하며 각 테이블에 대해
///     `RdbAdapter::stream_table_rows` 발사. mpsc channel 로 batch
///     수신 → `INSERT INTO "s"."t" (cols) VALUES (...);` 한 줄/row 로
///     formatting. multi-row VALUES 는 1차 미적용 — restore 분리 가독성.
///  5. flush + summary 반환. 에러 시 partial file 제거.
///
/// Cancellation: 매 table loop / batch loop 의 시작에서 `token.is_cancelled()`
/// 체크 + 채널 receiver drop 으로 `stream_table_rows` 도 자동 abort.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn export_schema_dump(
    state: State<'_, AppState>,
    connection_id: String,
    target_path: PathBuf,
    ddl_header: String,
    ddl_footer: String,
    tables: Vec<ExportDumpTable>,
    options: ExportSchemaDumpOptions,
    export_id: Option<String>,
) -> Result<ExportSummary, AppError> {
    export_schema_dump_inner(
        state.inner(),
        &connection_id,
        target_path,
        &ddl_header,
        &ddl_footer,
        &tables,
        &options,
        export_id.as_deref(),
    )
    .await
}

/// Sprint 237 P5 (2026-05-08) — handler body hoisted from
/// `export_schema_dump` so the cancel-token register → run_schema_dump
/// dispatch → token release contract can be unit-tested without
/// `tauri::State`.
#[allow(clippy::too_many_arguments)]
async fn export_schema_dump_inner(
    state: &AppState,
    connection_id: &str,
    target_path: PathBuf,
    ddl_header: &str,
    ddl_footer: &str,
    tables: &[ExportDumpTable],
    options: &ExportSchemaDumpOptions,
    export_id: Option<&str>,
) -> Result<ExportSummary, AppError> {
    info!(
        target = ?target_path,
        connection = %connection_id,
        include = ?options.include,
        tables = tables.len(),
        "export_schema_dump invoked"
    );

    // 1. cancel registration — Sprint 237 P5+ 공통 헬퍼.
    let cancel_handle = register_cancel_token(state, export_id).await;
    let cancel_owned: Option<CancellationToken> = cancel_handle.as_ref().map(|(_, t)| t.clone());

    // 2. dump 본체.
    let result = run_schema_dump(
        state,
        connection_id,
        &target_path,
        ddl_header,
        ddl_footer,
        tables,
        options,
        cancel_owned.as_ref(),
    )
    .await;

    // 3. token cleanup — Sprint 237 P5+ 공통 헬퍼.
    release_cancel_token(state, &cancel_handle).await;

    // 4. Issue #1094 — `run_schema_dump` writes to a temp sibling and only
    //    renames on success, so no target cleanup is needed here.
    if let Err(ref e) = result {
        warn!(error = %e, "export_schema_dump failed");
    }

    result
}

#[allow(clippy::too_many_arguments)]
async fn run_schema_dump(
    state: &AppState,
    connection_id: &str,
    target_path: &Path,
    ddl_header: &str,
    ddl_footer: &str,
    tables: &[ExportDumpTable],
    options: &ExportSchemaDumpOptions,
    cancel: Option<&CancellationToken>,
) -> Result<ExportSummary, AppError> {
    // Issue #1094 — validate the untrusted target and reject a 0 batch before
    // touching the filesystem.
    crate::storage::local::validate_export_target_path(target_path)?;
    if options.batch_size == 0 {
        return Err(AppError::Validation(
            "export_schema_dump: batch_size must be > 0".into(),
        ));
    }

    // Issue #1094 — stream the dump into a temp sibling and rename over the
    // target only once the whole dump succeeds. A failed/cancelled dump leaves
    // any pre-existing file untouched; only the temp file is removed.
    let temp_path = temp_sibling_path(target_path)?;
    let result = stream_schema_dump(
        state,
        connection_id,
        &temp_path,
        ddl_header,
        ddl_footer,
        tables,
        options,
        cancel,
    )
    .await;

    match result {
        Ok(summary) => match tokio::fs::rename(&temp_path, target_path).await {
            Ok(()) => Ok(summary),
            Err(e) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                Err(AppError::from(e))
            }
        },
        Err(e) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            Err(e)
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn stream_schema_dump(
    state: &AppState,
    connection_id: &str,
    write_path: &Path,
    ddl_header: &str,
    ddl_footer: &str,
    tables: &[ExportDumpTable],
    options: &ExportSchemaDumpOptions,
    cancel: Option<&CancellationToken>,
) -> Result<ExportSummary, AppError> {
    use tokio::io::AsyncWriteExt;

    let file = tokio::fs::File::create(write_path)
        .await
        .map_err(AppError::from)?;
    let mut writer = tokio::io::BufWriter::new(file);
    let mut bytes_written: u64 = 0;
    let mut rows_written: u64 = 0;

    let include_ddl = matches!(options.include, ExportInclude::Ddl | ExportInclude::Both);
    let include_dml = matches!(options.include, ExportInclude::Dml | ExportInclude::Both);

    if include_ddl && !ddl_header.is_empty() {
        writer
            .write_all(ddl_header.as_bytes())
            .await
            .map_err(AppError::from)?;
        bytes_written += ddl_header.len() as u64;
        if !ddl_header.ends_with('\n') {
            writer.write_all(b"\n").await.map_err(AppError::from)?;
            bytes_written += 1;
        }
    }

    if include_dml && !tables.is_empty() {
        // Issue #1087 — clone the adapter `Arc` under a short lock and drop
        // the guard before the dump. The `Arc` keeps the adapter alive for
        // the whole stream, but `active_connections` is free the instant the
        // dump starts, so other commands on this (or any) connection are no
        // longer serialised behind the export.
        let adapter = state.active_adapter(connection_id).await.ok_or_else(|| {
            AppError::Database(format!(
                "Connection {} not found in active_connections",
                connection_id
            ))
        })?;
        let rdb: &dyn RdbAdapter = adapter.as_rdb()?;

        for entry in tables {
            if let Some(t) = cancel {
                if t.is_cancelled() {
                    return Err(AppError::Database("Operation cancelled".into()));
                }
            }
            if entry.column_names.is_empty() {
                // 빈 테이블 (column 없음) — DDL 만 유효. dump skip.
                continue;
            }

            let qualified = qualified_pg_table(&entry.schema, &entry.table);
            let column_list = entry
                .column_names
                .iter()
                .map(|n| quote_pg_identifier(n))
                .collect::<Vec<_>>()
                .join(", ");

            let header = format!("\n-- ---------- Data: {qualified} ----------\n");
            writer
                .write_all(header.as_bytes())
                .await
                .map_err(AppError::from)?;
            bytes_written += header.len() as u64;

            // mpsc(2) — sender 가 2 batch 까지 buffer 후 receiver await.
            let (sender, mut receiver) = tokio::sync::mpsc::channel::<Vec<Vec<JsonValue>>>(2);

            let stream_fut = rdb.stream_table_rows(
                &entry.schema,
                &entry.table,
                options.batch_size,
                &entry.column_names,
                sender,
                cancel,
            );

            let drain_fut = async {
                let mut local_rows: u64 = 0;
                let mut local_bytes: u64 = 0;
                while let Some(batch) = receiver.recv().await {
                    if let Some(t) = cancel {
                        if t.is_cancelled() {
                            return Err(AppError::Database("Operation cancelled".into()));
                        }
                    }
                    for row in &batch {
                        let values = row
                            .iter()
                            .map(pg_value_to_sql_literal)
                            .collect::<Vec<_>>()
                            .join(", ");
                        let line =
                            format!("INSERT INTO {qualified} ({column_list}) VALUES ({values});\n");
                        writer
                            .write_all(line.as_bytes())
                            .await
                            .map_err(AppError::from)?;
                        local_bytes += line.len() as u64;
                    }
                    local_rows += batch.len() as u64;
                }
                Ok::<(u64, u64), AppError>((local_rows, local_bytes))
            };

            // try_join: stream 과 drain 이 concurrent. 한쪽 에러면 모두 abort.
            let (_stream_total, (drain_rows, drain_bytes)) =
                tokio::try_join!(stream_fut, drain_fut)?;

            rows_written += drain_rows;
            bytes_written += drain_bytes;
        }
    }

    // Sprint 192 — DML 끝난 뒤 BIGSERIAL sequence next value 를 row max
    // 로 reset 하는 setval 줄. include in {dml, both} + footer 비어있지
    // 않을 때만 의미 있음. include == "ddl" 인 경우 호출자가 빈 string
    // 을 넘긴다.
    if !ddl_footer.is_empty() {
        let prefix = b"\n-- ---------- Sequence resets ----------\n";
        writer.write_all(prefix).await.map_err(AppError::from)?;
        bytes_written += prefix.len() as u64;
        writer
            .write_all(ddl_footer.as_bytes())
            .await
            .map_err(AppError::from)?;
        bytes_written += ddl_footer.len() as u64;
        if !ddl_footer.ends_with('\n') {
            writer.write_all(b"\n").await.map_err(AppError::from)?;
            bytes_written += 1;
        }
    }

    writer.flush().await.map_err(AppError::from)?;
    // fsync the temp file before the caller renames it into place (Issue #1094).
    writer.get_ref().sync_all().await.map_err(AppError::from)?;

    Ok(ExportSummary {
        rows_written,
        bytes_written,
    })
}

// ============================================================== tests

#[cfg(test)]
mod tests;
