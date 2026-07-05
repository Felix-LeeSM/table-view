//! Stage 1 (issue #1077, admin parity) — read a user-picked UTF-8 text file
//! (e.g. a `.sql` script) so the query editor can load it and run it through
//! the existing `execute_query` / Safe Mode / history pipeline. This is the
//! symmetric inverse of `export::write_text_file_export`; it deliberately
//! does NOT execute anything — the user reviews the loaded SQL and runs it
//! with the normal Run button, so destructive statements still hit the Safe
//! Mode confirm gate.

use std::path::{Path, PathBuf};

use tracing::{info, warn};

use crate::error::AppError;

/// Cap the in-memory import at 16 MiB. A dump larger than this belongs in a
/// streaming restore path (a future stage), not a single string loaded into
/// the webview editor — refuse rather than OOM.
const MAX_IMPORT_BYTES: u64 = 16 * 1024 * 1024;

#[tauri::command]
pub async fn read_text_file_import(source_path: PathBuf) -> Result<String, AppError> {
    read_text_file_import_inner(source_path).await
}

async fn read_text_file_import_inner(source_path: PathBuf) -> Result<String, AppError> {
    info!(source = ?source_path, "read_text_file_import invoked");

    let path_for_task = source_path.clone();
    let task = tauri::async_runtime::spawn_blocking(move || read_text_file(&path_for_task));

    let result = match task.await {
        Ok(inner) => inner,
        Err(join_err) => Err(AppError::Storage(format!(
            "read_text_file_import task join failed: {}",
            join_err
        ))),
    };

    if let Err(ref e) = result {
        warn!(error = %e, "read_text_file_import failed");
    }

    result
}

/// Synchronous core — pulled out so it is unit-testable without a Tauri
/// runtime, mirroring `export::write_text_file`.
pub fn read_text_file(source_path: &Path) -> Result<String, AppError> {
    read_text_file_capped(source_path, MAX_IMPORT_BYTES)
}

fn read_text_file_capped(source_path: &Path, max_bytes: u64) -> Result<String, AppError> {
    // ponytail: reuse the export path guard — absolute + rejects internal
    // app-state files. The same trust boundary applies to reads: never hand
    // the credential DB (or any internal state file) back to the webview.
    crate::storage::local::validate_export_target_path(source_path)?;

    let meta = std::fs::metadata(source_path).map_err(AppError::from)?;
    if !meta.is_file() {
        return Err(AppError::Validation(
            "Import source is not a regular file".into(),
        ));
    }
    if meta.len() > max_bytes {
        return Err(AppError::Validation(format!(
            "Import file is too large ({} bytes); the limit is {} bytes",
            meta.len(),
            max_bytes
        )));
    }

    // `read_to_string` fails with `InvalidData` on non-UTF-8 content, which is
    // the correct rejection for a text-file import.
    std::fs::read_to_string(source_path).map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    //! Test scenarios (8-principle subset):
    //!   - Happy: reads back a `.sql` file's UTF-8 content verbatim.
    //!   - 빈 입력: empty file → empty string (still Ok).
    //!   - 에러 복구: oversized file rejected before allocation.
    //!   - 상태/경로 검증: non-absolute path rejected; directory rejected.
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn reads_sql_file_content_verbatim() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("dump.sql");
        let body = "INSERT INTO t (a) VALUES (1);\nINSERT INTO t (a) VALUES (2);\n";
        std::fs::File::create(&path)
            .unwrap()
            .write_all(body.as_bytes())
            .unwrap();

        let got = read_text_file(&path).unwrap();
        assert_eq!(got, body);
    }

    #[test]
    fn empty_file_reads_as_empty_string() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.sql");
        std::fs::File::create(&path).unwrap();

        assert_eq!(read_text_file(&path).unwrap(), "");
    }

    #[test]
    fn oversized_file_is_rejected() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("big.sql");
        std::fs::File::create(&path)
            .unwrap()
            .write_all(b"SELECT 1; SELECT 2;")
            .unwrap();

        // Cap below the file size so the guard trips without writing 16 MiB.
        let err = read_text_file_capped(&path, 4).unwrap_err();
        assert!(
            matches!(err, AppError::Validation(_)),
            "expected Validation, got {err:?}"
        );
    }

    #[test]
    fn relative_path_is_rejected() {
        let err = read_text_file(Path::new("dump.sql")).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    }

    #[test]
    fn directory_is_rejected_as_not_a_file() {
        let dir = TempDir::new().unwrap();
        let err = read_text_file(dir.path()).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    }
}
