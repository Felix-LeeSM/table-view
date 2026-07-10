//! Issue #1443 — chunked-session IPC for grid export.
//!
//! The single-shot `export_grid_rows` command serializes the whole result
//! into one IPC payload (~500MB for 1M×20), freezing the webview main
//! thread and tripling memory. This module keeps the same writers and
//! guards but splits the entry point into `begin` → `chunk`* → `finish`
//! commands so only one chunk crosses the IPC boundary at a time. The
//! frontend (`src/lib/tauri/export.ts`) picks this path above
//! `EXPORT_IPC_CHUNK_ROWS`; smaller exports stay on the single-shot
//! command.
//!
//! Guards preserved from the single-shot path:
//! - `validate_export_target_path` (+ `reject_internal_app_data_path`,
//!   is_absolute) runs in `begin` before any filesystem work (Issue #1094).
//! - The body streams into a temp sibling; `finish` renames over the
//!   target only on success. Any chunk failure / cancel / abort removes
//!   the temp file and leaves a pre-existing target untouched.
//! - `#1269` cancel — `begin` registers `export_id` in the shared
//!   query-token registry; `cancel_query(export_id)` makes the next
//!   row write fail with "Export cancelled", which cleans up the session.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

use serde_json::Value as JsonValue;
use tauri::State;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::info;

use crate::commands::connection::AppState;
use crate::commands::{register_cancel_token, release_cancel_token};
use crate::error::AppError;

use super::grid_writers::GridStreamState;
use super::{preflight_format, temp_sibling_path, ExportContext, ExportFormat, ExportSummary};

/// In-flight chunked grid exports, managed as Tauri state (see `lib.rs`).
/// Keyed by a per-session UUID so concurrent exports never collide.
#[derive(Default)]
pub struct ExportSessionRegistry {
    sessions: Mutex<HashMap<String, GridExportSession>>,
}

struct GridExportSession {
    target_path: PathBuf,
    temp_path: PathBuf,
    writer: BufWriter<File>,
    stream: GridStreamState,
    rows_written: u64,
    bytes_written: u64,
    cancel_handle: Option<(String, CancellationToken)>,
}

#[tauri::command]
pub async fn export_grid_begin(
    state: State<'_, AppState>,
    registry: State<'_, ExportSessionRegistry>,
    format: ExportFormat,
    target_path: PathBuf,
    headers: Vec<String>,
    context: ExportContext,
    export_id: Option<String>,
) -> Result<String, AppError> {
    export_grid_begin_inner(
        state.inner(),
        registry.inner(),
        format,
        target_path,
        headers,
        context,
        export_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn export_grid_chunk(
    state: State<'_, AppState>,
    registry: State<'_, ExportSessionRegistry>,
    session_id: String,
    rows: Vec<Vec<JsonValue>>,
) -> Result<(), AppError> {
    export_grid_chunk_inner(state.inner(), registry.inner(), &session_id, rows).await
}

#[tauri::command]
pub async fn export_grid_finish(
    state: State<'_, AppState>,
    registry: State<'_, ExportSessionRegistry>,
    session_id: String,
) -> Result<ExportSummary, AppError> {
    export_grid_finish_inner(state.inner(), registry.inner(), &session_id).await
}

#[tauri::command]
pub async fn export_grid_abort(
    state: State<'_, AppState>,
    registry: State<'_, ExportSessionRegistry>,
    session_id: String,
) -> Result<(), AppError> {
    export_grid_abort_inner(state.inner(), registry.inner(), &session_id).await
}

/// Validate the target, open the temp sibling, write the format preamble,
/// register the cancel token, and park the session in the registry.
async fn export_grid_begin_inner(
    state: &AppState,
    registry: &ExportSessionRegistry,
    format: ExportFormat,
    target_path: PathBuf,
    headers: Vec<String>,
    context: ExportContext,
    export_id: Option<&str>,
) -> Result<String, AppError> {
    info!(
        format = ?format,
        cols = headers.len(),
        target = ?target_path,
        "export_grid_begin invoked"
    );

    // Issue #1094 — reject relative / internal-state target paths and any
    // format/context mismatch before touching the filesystem or the token
    // registry (keeps a rejected begin side-effect free).
    crate::storage::local::validate_export_target_path(&target_path)?;
    preflight_format(format, &context)?;

    let temp_path = temp_sibling_path(&target_path)?;
    let cancel_handle = register_cancel_token(state, export_id).await;

    // Open the temp sibling and write the format preamble. On any failure,
    // remove the temp file and release the just-registered token so a failed
    // begin leaves no session, no orphan file, and no dangling cancel token.
    let opened = (|| -> Result<(BufWriter<File>, GridStreamState, u64), AppError> {
        let file = File::create(&temp_path).map_err(AppError::from)?;
        let mut writer = BufWriter::new(file);
        let (stream, bytes) = GridStreamState::begin(&mut writer, format, &headers, &context)?;
        Ok((writer, stream, bytes))
    })();

    let (writer, stream, bytes_written) = match opened {
        Ok(parts) => parts,
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            release_cancel_token(state, &cancel_handle).await;
            return Err(e);
        }
    };

    let session_id = uuid::Uuid::new_v4().to_string();
    let session = GridExportSession {
        target_path,
        temp_path,
        writer,
        stream,
        rows_written: 0,
        bytes_written,
        cancel_handle,
    };
    registry
        .sessions
        .lock()
        .await
        .insert(session_id.clone(), session);
    Ok(session_id)
}

/// Append one IPC chunk of rows to the session's temp file. Any failure
/// (including a `#1269` cancel — `GridStreamState::write_rows` checks the
/// token per row) tears the session down: temp removed, token released,
/// session forgotten.
async fn export_grid_chunk_inner(
    state: &AppState,
    registry: &ExportSessionRegistry,
    session_id: &str,
    rows: Vec<Vec<JsonValue>>,
) -> Result<(), AppError> {
    // Take the session out of the map for the duration of the write so a
    // concurrent chunk on the same id can't interleave; re-insert on success.
    let mut session = {
        let mut guard = registry.sessions.lock().await;
        guard
            .remove(session_id)
            .ok_or_else(|| AppError::Validation("Unknown export session".into()))?
    };

    let token = session.cancel_handle.as_ref().map(|(_, t)| t.clone());
    let write_result = session
        .stream
        .write_rows(&mut session.writer, &rows, token.as_ref());

    match write_result {
        Ok(bytes) => {
            session.bytes_written += bytes;
            session.rows_written += rows.len() as u64;
            registry
                .sessions
                .lock()
                .await
                .insert(session_id.to_string(), session);
            Ok(())
        }
        Err(e) => {
            teardown_session(state, session).await;
            Err(e)
        }
    }
}

/// Write the epilogue, fsync, and atomically rename the temp sibling over
/// the target. On failure — including a cancel fired before finish — the
/// temp is removed and the target left untouched.
async fn export_grid_finish_inner(
    state: &AppState,
    registry: &ExportSessionRegistry,
    session_id: &str,
) -> Result<ExportSummary, AppError> {
    let mut session = {
        let mut guard = registry.sessions.lock().await;
        guard
            .remove(session_id)
            .ok_or_else(|| AppError::Validation("Unknown export session".into()))?
    };

    // #1269 — a Stop-button cancel between chunks aborts the export: drop the
    // partial temp instead of renaming it over a pre-existing target.
    if let Some((_, tok)) = &session.cancel_handle {
        if tok.is_cancelled() {
            teardown_session(state, session).await;
            return Err(AppError::Validation("Export cancelled".into()));
        }
    }

    let finalize = (|| -> Result<(), AppError> {
        let extra = session.stream.finish(&mut session.writer)?;
        session.bytes_written += extra;
        session.writer.flush().map_err(AppError::from)?;
        // fsync the temp file before renaming it into place (Issue #1094).
        session
            .writer
            .get_ref()
            .sync_all()
            .map_err(AppError::from)?;
        Ok(())
    })();

    if let Err(e) = finalize {
        teardown_session(state, session).await;
        return Err(e);
    }

    let GridExportSession {
        target_path,
        temp_path,
        writer,
        stream,
        rows_written,
        bytes_written,
        cancel_handle,
    } = session;
    // Close the file handle before the rename.
    drop(writer);
    drop(stream);

    let renamed = std::fs::rename(&temp_path, &target_path);
    release_cancel_token(state, &cancel_handle).await;
    match renamed {
        Ok(()) => Ok(ExportSummary {
            rows_written,
            bytes_written,
        }),
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(AppError::from(e))
        }
    }
}

/// Drop the session, remove its temp file, and release the cancel token.
/// Idempotent — an unknown/already-cleaned session is Ok(()) so the
/// frontend can fire-and-forget it from error paths.
async fn export_grid_abort_inner(
    state: &AppState,
    registry: &ExportSessionRegistry,
    session_id: &str,
) -> Result<(), AppError> {
    let session = registry.sessions.lock().await.remove(session_id);
    if let Some(session) = session {
        teardown_session(state, session).await;
    }
    Ok(())
}

/// Close the session's file, remove its temp sibling, and release the cancel
/// token. A pre-existing `target_path` is never touched — only the temp file.
async fn teardown_session(state: &AppState, session: GridExportSession) {
    let GridExportSession {
        temp_path,
        writer,
        cancel_handle,
        ..
    } = session;
    drop(writer);
    let _ = std::fs::remove_file(&temp_path);
    release_cancel_token(state, &cancel_handle).await;
}

// ============================================================== tests

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::export::write_export;
    use serde_json::json;
    use std::path::Path;
    use tempfile::TempDir;

    fn table_ctx() -> ExportContext {
        ExportContext::Table {
            schema: "public".into(),
            name: "users".into(),
        }
    }

    fn collection_ctx() -> ExportContext {
        ExportContext::Collection {
            name: "orders".into(),
        }
    }

    fn sample_rows(n: usize) -> Vec<Vec<JsonValue>> {
        (0..n)
            .map(|i| vec![json!(i as i64), json!(format!("name-{i}, \"q\""))])
            .collect()
    }

    fn doc_rows(n: usize) -> Vec<Vec<JsonValue>> {
        (0..n)
            .map(|i| vec![json!({"_id": {"$oid": format!("{:024x}", i)}, "n": i})])
            .collect()
    }

    fn dir_file_names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[allow(clippy::too_many_arguments)]
    async fn drive_session(
        state: &AppState,
        registry: &ExportSessionRegistry,
        format: ExportFormat,
        path: PathBuf,
        headers: Vec<String>,
        chunks: Vec<Vec<Vec<JsonValue>>>,
        ctx: ExportContext,
        export_id: Option<&str>,
    ) -> Result<ExportSummary, AppError> {
        let sid =
            export_grid_begin_inner(state, registry, format, path, headers, ctx, export_id).await?;
        for chunk in chunks {
            export_grid_chunk_inner(state, registry, &sid, chunk).await?;
        }
        export_grid_finish_inner(state, registry, &sid).await
    }

    // [#1443 AC3] 포맷/결과 동일성 — session 경로는 단발 write_export 와
    // byte-identical 해야 한다 (빈 chunk / 불균등 chunk 포함).
    #[tokio::test]
    async fn session_output_is_byte_identical_to_single_shot_per_format() {
        let cases: Vec<(ExportFormat, ExportContext, Vec<Vec<JsonValue>>)> = vec![
            (ExportFormat::Csv, table_ctx(), sample_rows(7)),
            (ExportFormat::Tsv, table_ctx(), sample_rows(7)),
            (ExportFormat::Sql, table_ctx(), sample_rows(7)),
            (ExportFormat::Json, collection_ctx(), doc_rows(7)),
            // zero-row boundary — header/`[]` only.
            (ExportFormat::Csv, table_ctx(), vec![]),
            (ExportFormat::Json, collection_ctx(), vec![]),
        ];
        for (format, ctx, rows) in cases {
            let dir = TempDir::new().unwrap();
            let headers = vec!["id".to_string(), "name".to_string()];
            let single = dir.path().join("single.out");
            write_export(format, &single, &headers, &rows, &ctx, None).unwrap();

            let state = AppState::new();
            let registry = ExportSessionRegistry::default();
            let sess = dir.path().join("session.out");
            // uneven chunks incl. an empty one: 3 + 0 + rest
            let mut chunks: Vec<Vec<Vec<JsonValue>>> = vec![
                rows.iter().take(3).cloned().collect(),
                vec![],
                rows.iter().skip(3).cloned().collect(),
            ];
            chunks.retain(|_| true);
            let summary = drive_session(
                &state,
                &registry,
                format,
                sess.clone(),
                headers.clone(),
                chunks,
                ctx.clone(),
                None,
            )
            .await
            .unwrap();

            let single_bytes = std::fs::read(&single).unwrap();
            let session_bytes = std::fs::read(&sess).unwrap();
            assert_eq!(
                single_bytes, session_bytes,
                "byte mismatch for {:?}",
                format
            );
            assert_eq!(summary.rows_written, rows.len() as u64);
            assert_eq!(summary.bytes_written, session_bytes.len() as u64);
            // no temp siblings left behind
            assert_eq!(
                dir_file_names(dir.path()),
                vec!["session.out".to_string(), "single.out".to_string()]
            );
        }
    }

    // [#1443 / #1269] cancel mid-session — chunk 는 에러로 abort 되고 temp
    // 제거 + token release + 기존 target 파일 보존.
    #[tokio::test]
    async fn cancel_between_chunks_cleans_temp_releases_token_and_keeps_target() {
        let state = AppState::new();
        let registry = ExportSessionRegistry::default();
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("out.csv");
        std::fs::write(&target, "OLD CONTENT").unwrap();

        let sid = export_grid_begin_inner(
            &state,
            &registry,
            ExportFormat::Csv,
            target.clone(),
            vec!["id".into(), "name".into()],
            table_ctx(),
            Some("exp-cancel"),
        )
        .await
        .unwrap();
        export_grid_chunk_inner(&state, &registry, &sid, sample_rows(2))
            .await
            .unwrap();

        // Stop button — cancel_query(export_id) equivalent.
        state
            .query_tokens
            .lock()
            .await
            .get("exp-cancel")
            .unwrap()
            .cancel();

        let res = export_grid_chunk_inner(&state, &registry, &sid, sample_rows(2)).await;
        assert!(matches!(res, Err(AppError::Validation(_))), "{res:?}");

        // temp removed, target untouched, token released, session gone.
        assert_eq!(dir_file_names(dir.path()), vec!["out.csv".to_string()]);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "OLD CONTENT");
        assert!(!state.query_tokens.lock().await.contains_key("exp-cancel"));
        let after = export_grid_chunk_inner(&state, &registry, &sid, sample_rows(1)).await;
        assert!(matches!(after, Err(AppError::Validation(_))));
    }

    // [#1443] cancel 후 finish — rename 없이 temp 정리, target 보존.
    #[tokio::test]
    async fn finish_after_cancel_cleans_temp_and_keeps_target() {
        let state = AppState::new();
        let registry = ExportSessionRegistry::default();
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("out.csv");
        std::fs::write(&target, "OLD CONTENT").unwrap();

        let sid = export_grid_begin_inner(
            &state,
            &registry,
            ExportFormat::Csv,
            target.clone(),
            vec!["id".into(), "name".into()],
            table_ctx(),
            Some("exp-cancel-finish"),
        )
        .await
        .unwrap();
        state
            .query_tokens
            .lock()
            .await
            .get("exp-cancel-finish")
            .unwrap()
            .cancel();

        let res = export_grid_finish_inner(&state, &registry, &sid).await;
        assert!(matches!(res, Err(AppError::Validation(_))), "{res:?}");
        assert_eq!(dir_file_names(dir.path()), vec!["out.csv".to_string()]);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "OLD CONTENT");
        assert!(!state
            .query_tokens
            .lock()
            .await
            .contains_key("exp-cancel-finish"));
    }

    // [#1443] abort — temp 제거 + token release, 미지 세션 abort 는 Ok.
    #[tokio::test]
    async fn abort_cleans_temp_and_token_and_is_idempotent() {
        let state = AppState::new();
        let registry = ExportSessionRegistry::default();
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("out.tsv");

        let sid = export_grid_begin_inner(
            &state,
            &registry,
            ExportFormat::Tsv,
            target.clone(),
            vec!["id".into(), "name".into()],
            table_ctx(),
            Some("exp-abort"),
        )
        .await
        .unwrap();
        export_grid_chunk_inner(&state, &registry, &sid, sample_rows(2))
            .await
            .unwrap();

        export_grid_abort_inner(&state, &registry, &sid)
            .await
            .unwrap();
        assert!(dir_file_names(dir.path()).is_empty());
        assert!(!target.exists());
        assert!(!state.query_tokens.lock().await.contains_key("exp-abort"));
        // idempotent
        export_grid_abort_inner(&state, &registry, &sid)
            .await
            .unwrap();
    }

    // [#1443 / #1094] begin 은 path 가드를 파일 작업 전에 태운다 — 상대
    // 경로 reject 시 temp 도 세션도 token 도 없어야 한다.
    #[tokio::test]
    async fn begin_rejects_relative_path_without_side_effects() {
        let state = AppState::new();
        let registry = ExportSessionRegistry::default();
        let res = export_grid_begin_inner(
            &state,
            &registry,
            ExportFormat::Csv,
            PathBuf::from("relative/out.csv"),
            vec!["id".into()],
            table_ctx(),
            Some("exp-rel"),
        )
        .await;
        assert!(matches!(res, Err(AppError::Validation(_))));
        assert!(state.query_tokens.lock().await.is_empty());
        assert!(registry.sessions.lock().await.is_empty());
    }

    // [#1443] JSON + Table ctx preflight 는 단발 경로와 동일하게 reject.
    #[tokio::test]
    async fn begin_rejects_json_with_table_context() {
        let state = AppState::new();
        let registry = ExportSessionRegistry::default();
        let dir = TempDir::new().unwrap();
        let res = export_grid_begin_inner(
            &state,
            &registry,
            ExportFormat::Json,
            dir.path().join("out.json"),
            vec!["id".into()],
            table_ctx(),
            None,
        )
        .await;
        assert!(matches!(res, Err(AppError::Validation(_))));
        assert!(dir_file_names(dir.path()).is_empty());
    }

    // [#1443] 미지 session id — chunk/finish 는 Validation 에러.
    #[tokio::test]
    async fn chunk_and_finish_reject_unknown_session() {
        let state = AppState::new();
        let registry = ExportSessionRegistry::default();
        let chunk = export_grid_chunk_inner(&state, &registry, "nope", sample_rows(1)).await;
        assert!(matches!(chunk, Err(AppError::Validation(_))));
        let finish = export_grid_finish_inner(&state, &registry, "nope").await;
        assert!(matches!(finish, Err(AppError::Validation(_))));
    }

    // [#1443] export_id 없는 세션은 token registry 를 건드리지 않는다.
    #[tokio::test]
    async fn session_without_export_id_skips_token_registration() {
        let state = AppState::new();
        let registry = ExportSessionRegistry::default();
        let dir = TempDir::new().unwrap();
        drive_session(
            &state,
            &registry,
            ExportFormat::Csv,
            dir.path().join("out.csv"),
            vec!["id".into(), "name".into()],
            vec![sample_rows(1)],
            table_ctx(),
            None,
        )
        .await
        .unwrap();
        assert!(state.query_tokens.lock().await.is_empty());
    }
}
