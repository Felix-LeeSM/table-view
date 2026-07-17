//! Stage 1 CSV import (issue #1639, part of #1077 admin parity) — a
//! **read-only** parse/preview command. It streams a user-picked CSV file to
//! surface headers, an exact row count, and the first N rows so the frontend
//! mapping wizard (table columns <-> CSV headers) can preview the import.
//!
//! It deliberately performs **zero DB writes** — the commit path (INSERT of the
//! mapped rows) lands in a follow-up sub-issue (#1640). File-read guards mirror
//! `import_file.rs`: absolute path, regular file, and canonical app-data-dir
//! rejection (read-exfil confinement, #1106). Parsing reuses the already-present
//! `csv` crate (Cargo.toml). Unlike `import_file.rs` there is **no 16 MiB cap** —
//! the reader is streaming (one record in memory at a time), so a large CSV
//! previews fine; the size cap moves to the commit-stage batch (#1640).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::error::AppError;

/// Max rows returned in the preview payload. A file may hold millions of rows;
/// the mapping wizard only needs a sample to render the grid.
const PREVIEW_ROW_LIMIT: usize = 100;

/// Preview options passed from the frontend. `has_header` defaults to `true`
/// (the common case); `delimiter` defaults to `,` when omitted.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCsvOptions {
    #[serde(default = "default_true")]
    pub has_header: bool,
    /// Single-byte field delimiter. `None` => `,`.
    #[serde(default)]
    pub delimiter: Option<char>,
}

fn default_true() -> bool {
    true
}

impl Default for PreviewCsvOptions {
    fn default() -> Self {
        Self {
            has_header: true,
            delimiter: None,
        }
    }
}

/// Read-only preview payload. Column-mapping wizard renders `headers` against
/// the target table's columns and shows `preview_rows` in a grid; `row_count`
/// is the exact total (streamed, not the preview subset).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CsvPreview {
    pub headers: Vec<String>,
    pub row_count: usize,
    pub preview_rows: Vec<Vec<String>>,
}

#[tauri::command]
pub async fn preview_csv_import(
    window: tauri::Window,
    source_path: PathBuf,
    options: Option<PreviewCsvOptions>,
) -> Result<CsvPreview, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    let options = options.unwrap_or_default();
    info!(source = ?source_path, has_header = options.has_header, "preview_csv_import invoked");

    let path_for_task = source_path.clone();
    let task = tauri::async_runtime::spawn_blocking(move || preview_csv(&path_for_task, &options));

    let result = match task.await {
        Ok(inner) => inner,
        Err(join_err) => Err(AppError::Storage(format!(
            "preview_csv_import task join failed: {join_err}"
        ))),
    };

    if let Err(ref e) = result {
        warn!(error = %e, "preview_csv_import failed");
    }

    result
}

/// Synchronous core — pulled out so it is unit-testable without a Tauri
/// runtime, mirroring `import_file::read_text_file`.
pub fn preview_csv(
    source_path: &Path,
    options: &PreviewCsvOptions,
) -> Result<CsvPreview, AppError> {
    // Same file-read guards as `import_file::read_text_file_capped`, minus the
    // size cap (streaming reader, issue #1639 AC1).
    if !source_path.is_absolute() {
        return Err(AppError::Validation(
            "CSV import source path must be absolute".into(),
        ));
    }

    let meta = std::fs::metadata(source_path).map_err(AppError::from)?;
    if !meta.is_file() {
        return Err(AppError::Validation(
            "CSV import source is not a regular file".into(),
        ));
    }

    // Read-exfil confinement: a direct IPC call with an absolute path could
    // otherwise stream `<app_data_dir>/connections.json` (encrypted password
    // blob) or `.key` (master key) into the webview. Reject the whole app data
    // dir on the *canonical* path so a symlink cannot smuggle the target back
    // in (mirrors `import_file.rs` / DuckDB file analytics, #1106).
    let canonical = std::fs::canonicalize(source_path).map_err(AppError::from)?;
    crate::storage::local::reject_internal_app_data_path(&canonical)?;

    let delimiter = options.delimiter.unwrap_or(',');
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(options.has_header)
        .flexible(true)
        // ponytail: ASCII delimiter only (',', ';', '\t'); a multibyte char
        // truncates to its first byte — fine for Stage 1 CSV.
        .delimiter(delimiter as u8)
        .from_path(&canonical)
        .map_err(map_csv_err)?;

    let mut headers: Vec<String> = if options.has_header {
        reader
            .headers()
            .map_err(map_csv_err)?
            .iter()
            .map(str::to_owned)
            .collect()
    } else {
        Vec::new()
    };

    let mut preview_rows: Vec<Vec<String>> = Vec::new();
    let mut row_count = 0usize;
    let mut record = csv::StringRecord::new();
    // Streaming: one record in memory at a time. Full scan for an exact row
    // count is O(rows) time / O(1) memory.
    // ponytail: exact count via full scan; switch to a sampled estimate if
    // huge-file preview latency ever bites (the #1640 commit path can revisit).
    while reader.read_record(&mut record).map_err(map_csv_err)? {
        row_count += 1;
        if !options.has_header && headers.is_empty() {
            headers = (1..=record.len()).map(|i| format!("Column {i}")).collect();
        }
        if preview_rows.len() < PREVIEW_ROW_LIMIT {
            preview_rows.push(record.iter().map(str::to_owned).collect());
        }
    }

    Ok(CsvPreview {
        headers,
        row_count,
        preview_rows,
    })
}

/// CSV parse failures (malformed record, non-UTF-8 content) are user-input
/// problems — surface them as `Validation`, not an opaque `Storage` error.
fn map_csv_err(err: csv::Error) -> AppError {
    AppError::Validation(format!("CSV parse error: {err}"))
}

#[cfg(test)]
mod tests {
    //! Test scenarios (issue #1639, 2026-07-17). File-read guards mirror
    //! `import_file.rs` (absolute / regular-file / app-data-dir) with the size
    //! cap intentionally dropped (streaming reader, AC1):
    //!   - Happy: header + preview rows + exact row count.
    //!   - 빈 입력: empty file -> empty preview (still Ok).
    //!   - 상태/경로 검증: relative path rejected; directory rejected.
    //!   - 보안: a file inside the app data dir is refused (read-exfil, #1106).
    //!
    //! Plus behavioural coverage: no-header column synthesis, preview cap vs.
    //! full row count, and a non-comma delimiter.
    use super::*;
    use serial_test::serial;
    use std::io::Write;
    use tempfile::TempDir;

    fn write(dir: &TempDir, name: &str, body: &[u8]) -> PathBuf {
        let path = dir.path().join(name);
        std::fs::File::create(&path)
            .unwrap()
            .write_all(body)
            .unwrap();
        path
    }

    // Guard mirror #1 (happy) — parses the header row and preview rows verbatim
    // and reports the exact data-row count.
    #[test]
    fn parses_header_and_preview_rows() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "people.csv", b"id,name\n1,ada\n2,alan\n");

        let preview = preview_csv(&path, &PreviewCsvOptions::default()).unwrap();
        assert_eq!(preview.headers, vec!["id", "name"]);
        assert_eq!(preview.row_count, 2);
        assert_eq!(
            preview.preview_rows,
            vec![vec!["1", "ada"], vec!["2", "alan"]]
        );
    }

    // Guard mirror #2 (빈 입력) — empty file previews as empty, still Ok.
    #[test]
    fn empty_file_previews_as_empty() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "empty.csv", b"");

        let preview = preview_csv(&path, &PreviewCsvOptions::default()).unwrap();
        assert!(preview.headers.is_empty());
        assert_eq!(preview.row_count, 0);
        assert!(preview.preview_rows.is_empty());
    }

    // Guard mirror #3 (상대경로) — a non-absolute path is rejected.
    #[test]
    fn relative_path_is_rejected() {
        let err = preview_csv(Path::new("people.csv"), &PreviewCsvOptions::default()).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    }

    // Guard mirror #4 (경로 검증) — a directory is rejected as not a file.
    #[test]
    fn directory_is_rejected_as_not_a_file() {
        let dir = TempDir::new().unwrap();
        let err = preview_csv(dir.path(), &PreviewCsvOptions::default()).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    }

    // Guard mirror #5 (보안) — a file resolving inside the app data dir must be
    // refused (read-exfil confinement, #1106).
    #[test]
    #[serial]
    fn internal_app_data_file_is_rejected() {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());

        let secret = write(&dir, "connections.json", b"[]");
        let result = preview_csv(&secret, &PreviewCsvOptions::default());
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");

        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "app-data-dir file must be refused, got {result:?}"
        );
    }

    // No-header mode synthesizes `Column N` names from the first record width so
    // the mapping wizard still has column handles.
    #[test]
    fn no_header_synthesizes_column_names() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "raw.csv", b"1,ada\n2,alan\n");

        let opts = PreviewCsvOptions {
            has_header: false,
            delimiter: None,
        };
        let preview = preview_csv(&path, &opts).unwrap();
        assert_eq!(preview.headers, vec!["Column 1", "Column 2"]);
        assert_eq!(preview.row_count, 2);
        assert_eq!(preview.preview_rows.first().unwrap(), &vec!["1", "ada"]);
    }

    // Row count reflects the whole (streamed) file while preview_rows is capped
    // at PREVIEW_ROW_LIMIT.
    #[test]
    fn row_count_counts_all_but_preview_is_capped() {
        let dir = TempDir::new().unwrap();
        let mut body = String::from("id\n");
        let total = PREVIEW_ROW_LIMIT + 50;
        for i in 0..total {
            body.push_str(&format!("{i}\n"));
        }
        let path = write(&dir, "big.csv", body.as_bytes());

        let preview = preview_csv(&path, &PreviewCsvOptions::default()).unwrap();
        assert_eq!(preview.row_count, total);
        assert_eq!(preview.preview_rows.len(), PREVIEW_ROW_LIMIT);
    }

    // A non-comma delimiter (semicolon) is honoured.
    #[test]
    fn honours_custom_delimiter() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "semi.csv", b"id;name\n1;ada\n");

        let opts = PreviewCsvOptions {
            has_header: true,
            delimiter: Some(';'),
        };
        let preview = preview_csv(&path, &opts).unwrap();
        assert_eq!(preview.headers, vec!["id", "name"]);
        assert_eq!(preview.preview_rows, vec![vec!["1", "ada"]]);
    }
}
