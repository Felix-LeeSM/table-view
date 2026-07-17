//! CSV import (issue #1639 preview + #1640 commit, part of #1077 admin parity).
//!
//! Stage 1 (`preview_csv_import`) streams a user-picked CSV to surface headers,
//! an exact row count, and the first N rows so the frontend mapping wizard
//! (table columns <-> CSV headers) can preview the import.
//!
//! Stage 2 (`build_csv_import_statements`, #1640) turns the confirmed mapping
//! into one single-row `INSERT INTO "s"."t" (cols) VALUES (..)` statement per
//! CSV row. It still performs **zero DB writes** itself: the frontend feeds the
//! whole statement list to the existing `execute_query_batch` command in a
//! single call, so the atomic BEGIN/COMMIT/ROLLBACK, the #1112 Safe Mode gate,
//! the #1529 read-only gate, history, and cancel all come for free (same reuse
//! principle as `.sql` import routing through Run, #1373).
//!
//! One row per statement (not a multi-row `VALUES (..),(..)`) is deliberate:
//! `PostgresAdapter::execute_query_batch` runs `enforce_single_row_effect` on
//! every statement (postgres/queries.rs, #1079 grid-commit guard), so a
//! statement affecting more than one row rolls the transaction back. Sending
//! every row as its own single-row INSERT inside one `execute_query_batch` call
//! keeps the whole import in one transaction (all-or-nothing) while satisfying
//! that guard. The commit path is PostgreSQL-only for now (PG-dialect quoting);
//! other engines return `AppError::Unsupported`.
//!
//! File-read guards mirror `import_file.rs`: absolute path, regular file, and
//! canonical app-data-dir rejection (read-exfil confinement, #1106). Parsing
//! reuses the already-present `csv` crate (Cargo.toml). Unlike `import_file.rs`
//! there is **no 16 MiB cap** — the reader is streaming (one record in memory at
//! a time), so a large CSV previews fine.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::{info, warn};

use crate::commands::connection::AppState;
use crate::commands::export::{quote_sql_identifier, quote_sql_string};
use crate::error::AppError;
use crate::models::DatabaseType;

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
    let canonical = canonicalize_csv_source(source_path)?;
    let mut reader = csv_reader(&canonical, options.has_header, options.delimiter)?;

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

/// Shared file-read guards (mirrors `import_file::read_text_file_capped`, minus
/// the size cap — streaming reader, #1639 AC1). Returns the canonical path.
///
/// Read-exfil confinement: a direct IPC call with an absolute path could
/// otherwise stream `<app_data_dir>/connections.json` (encrypted password blob)
/// or `.key` (master key) into the webview. The whole app data dir is rejected
/// on the *canonical* path so a symlink cannot smuggle the target back in
/// (mirrors `import_file.rs` / DuckDB file analytics, #1106).
fn canonicalize_csv_source(source_path: &Path) -> Result<PathBuf, AppError> {
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
    let canonical = std::fs::canonicalize(source_path).map_err(AppError::from)?;
    crate::storage::local::reject_internal_app_data_path(&canonical)?;
    Ok(canonical)
}

/// Build a `csv::Reader` over the canonical path with the caller's header +
/// delimiter options. ponytail: ASCII delimiter only (`,`, `;`, `\t`) — casting
/// a `char` to `u8` keeps only the low 8 bits of the Unicode scalar value (so a
/// multibyte delimiter is silently mangled), which is fine for CSV import.
fn csv_reader(
    canonical: &Path,
    has_header: bool,
    delimiter: Option<char>,
) -> Result<csv::Reader<std::fs::File>, AppError> {
    csv::ReaderBuilder::new()
        .has_headers(has_header)
        .flexible(true)
        .delimiter(delimiter.unwrap_or(',') as u8)
        .from_path(canonical)
        .map_err(map_csv_err)
}

// ------------------------------------------------------- Stage 2 commit (#1640)

/// Commit-stage options. Extends the preview options (`has_header`,
/// `delimiter`) with the tri-state NULL toggle.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportOptions {
    #[serde(default = "default_true")]
    pub has_header: bool,
    /// Single-byte field delimiter. `None` => `,`.
    #[serde(default)]
    pub delimiter: Option<char>,
    /// Tri-state NULL policy (ADR 0009). A CSV cell is always a string, so an
    /// empty field is ambiguous: `true` (default, the common CSV convention)
    /// maps an empty field to SQL `NULL`; `false` maps it to an empty string
    /// literal `''`. A non-empty field is always a quoted string literal.
    #[serde(default = "default_true")]
    pub empty_as_null: bool,
}

impl Default for CsvImportOptions {
    fn default() -> Self {
        Self {
            has_header: true,
            delimiter: None,
            empty_as_null: true,
        }
    }
}

/// One target-column <- CSV-column mapping entry. `source_index` is a
/// zero-based index into each parsed CSV record (the frontend resolves it from
/// the header it picked), so duplicate header names stay unambiguous.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvColumnMapping {
    /// Target table column name.
    pub column: String,
    /// Zero-based CSV record index feeding this column.
    pub source_index: usize,
}

/// PG-first gate (#1640). The generated SQL uses PostgreSQL/ANSI double-quoted
/// identifiers and untyped string literals coerced by the target column type;
/// other dialects (MySQL backticks, etc.) are a follow-up, so a non-PG
/// connection is refused up front rather than emitting invalid SQL.
pub fn ensure_pg_for_csv_import(kind: DatabaseType) -> Result<(), AppError> {
    match kind {
        DatabaseType::Postgresql => Ok(()),
        other => Err(AppError::Unsupported(format!(
            "CSV row import commit is PostgreSQL-only; {other:?} is not supported"
        ))),
    }
}

/// Read every data record (no cap — the whole file is materialised for the
/// commit) as raw string cells. ponytail: no row cap on commit; a multi-million
/// row atomic import holds every INSERT statement in memory — a streaming/COPY
/// path is the upgrade if that ceiling ever bites.
pub fn read_csv_records(
    canonical: &Path,
    options: &CsvImportOptions,
) -> Result<Vec<Vec<String>>, AppError> {
    let mut reader = csv_reader(canonical, options.has_header, options.delimiter)?;
    let mut records: Vec<Vec<String>> = Vec::new();
    let mut record = csv::StringRecord::new();
    while reader.read_record(&mut record).map_err(map_csv_err)? {
        records.push(record.iter().map(str::to_owned).collect());
    }
    Ok(records)
}

/// Pure INSERT builder — no I/O, no connection, so it is exhaustively
/// unit-testable. Emits one single-row `INSERT INTO "schema"."table" ("c1", ...)
/// VALUES (..)` per record (see the module doc for why one row per statement).
/// Identifier and string-literal quoting reuse the SQL-export writer helpers so
/// the two paths never drift (#1640 AC1). A row shorter than a mapped index is
/// treated as an empty cell (NULL / '' per `empty_as_null`).
pub fn build_csv_insert_statements(
    schema: &str,
    table: &str,
    mapping: &[CsvColumnMapping],
    records: &[Vec<String>],
    empty_as_null: bool,
) -> Result<Vec<String>, AppError> {
    if mapping.is_empty() {
        return Err(AppError::Validation(
            "CSV import requires at least one mapped column".into(),
        ));
    }
    let qualified = format!(
        "{}.{}",
        quote_sql_identifier(schema),
        quote_sql_identifier(table)
    );
    let columns = mapping
        .iter()
        .map(|m| quote_sql_identifier(&m.column))
        .collect::<Vec<_>>()
        .join(", ");
    let prefix = format!("INSERT INTO {qualified} ({columns}) VALUES ");

    let statements = records
        .iter()
        .map(|record| {
            let cells = mapping
                .iter()
                .map(|m| {
                    let cell = record.get(m.source_index).map(String::as_str).unwrap_or("");
                    if cell.is_empty() && empty_as_null {
                        "NULL".to_string()
                    } else {
                        quote_sql_string(cell)
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");
            format!("{prefix}({cells})")
        })
        .collect();
    Ok(statements)
}

async fn build_csv_import_statements_inner(
    state: &AppState,
    connection_id: &str,
    source_path: &Path,
    schema: &str,
    table: &str,
    mapping: Vec<CsvColumnMapping>,
    options: CsvImportOptions,
) -> Result<Vec<String>, AppError> {
    let kind = state
        .active_adapter(connection_id)
        .await
        .map(|adapter| adapter.kind())
        .ok_or_else(|| AppError::NotFound(format!("Connection not found: {connection_id}")))?;
    ensure_pg_for_csv_import(kind)?;

    // File read + string building move off the async runtime thread (a large
    // import can materialise many MB), matching `preview_csv_import`.
    let source = source_path.to_path_buf();
    let schema = schema.to_string();
    let table = table.to_string();
    let task = tauri::async_runtime::spawn_blocking(move || {
        let canonical = canonicalize_csv_source(&source)?;
        let records = read_csv_records(&canonical, &options)?;
        build_csv_insert_statements(&schema, &table, &mapping, &records, options.empty_as_null)
    });
    match task.await {
        Ok(inner) => inner,
        Err(join_err) => Err(AppError::Storage(format!(
            "build_csv_import_statements task join failed: {join_err}"
        ))),
    }
}

/// Stage 2 (#1640) — turn the confirmed column mapping into batched INSERT
/// statements. Read-only itself (parses the CSV, emits SQL strings); the actual
/// write happens when the frontend feeds the result to `execute_query_batch`,
/// which owns the atomic transaction + Safe Mode / read-only gates + history +
/// cancel. PostgreSQL-only.
// The frontend invoke supplies each field by name, so a flat signature reads
// more directly than a wrapper struct (matches `execute_query`'s style).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn build_csv_import_statements(
    window: tauri::Window,
    state: State<'_, AppState>,
    connection_id: String,
    source_path: PathBuf,
    schema: String,
    table: String,
    mapping: Vec<CsvColumnMapping>,
    options: Option<CsvImportOptions>,
) -> Result<Vec<String>, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    let options = options.unwrap_or_default();
    info!(
        source = ?source_path,
        schema = %schema,
        table = %table,
        mapped = mapping.len(),
        "build_csv_import_statements invoked"
    );

    let result = build_csv_import_statements_inner(
        state.inner(),
        &connection_id,
        &source_path,
        &schema,
        &table,
        mapping,
        options,
    )
    .await;

    if let Err(ref e) = result {
        warn!(error = %e, "build_csv_import_statements failed");
    }
    result
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

    // ── Stage 2 commit builder (#1640) ────────────────────────────────────
    //
    // The pure `build_csv_insert_statements` owns the SQL shape (one single-row
    // INSERT per record — see module doc). The atomic BEGIN/COMMIT/ROLLBACK
    // belongs to `execute_query_batch` and is covered by the docker PG
    // integration round-trip / rollback tests (query_integration). Scenarios:
    // one statement per row, tri-state NULL toggle, injection-safe quoting,
    // short rows, empty input, no-mapping guard, and the PG-only engine gate.

    use crate::commands::test_util::state_with;
    use crate::db::testing::StubRdbAdapter;
    use crate::db::ActiveAdapter;

    fn mapping(pairs: &[(&str, usize)]) -> Vec<CsvColumnMapping> {
        pairs
            .iter()
            .map(|(column, source_index)| CsvColumnMapping {
                column: (*column).to_string(),
                source_index: *source_index,
            })
            .collect()
    }

    // Happy path — one single-row INSERT per record (the #1079 single-row guard
    // forbids multi-row statements), target column order drives the column list,
    // and both identifiers are double-quoted.
    #[test]
    fn builds_one_insert_per_row() {
        let records = vec![
            vec!["1".to_string(), "ada".to_string()],
            vec!["2".to_string(), "alan".to_string()],
        ];
        let stmts = build_csv_insert_statements(
            "public",
            "people",
            &mapping(&[("id", 0), ("name", 1)]),
            &records,
            true,
        )
        .unwrap();
        assert_eq!(
            stmts.len(),
            2,
            "one statement per row for the single-row guard"
        );
        assert_eq!(
            stmts[0],
            "INSERT INTO \"public\".\"people\" (\"id\", \"name\") VALUES ('1', 'ada')"
        );
        assert_eq!(
            stmts[1],
            "INSERT INTO \"public\".\"people\" (\"id\", \"name\") VALUES ('2', 'alan')"
        );
    }

    // Tri-state NULL (ADR 0009): an empty cell is SQL NULL when `empty_as_null`,
    // otherwise an empty string literal. A non-empty cell is always a literal.
    #[test]
    fn empty_cell_tri_state_toggle() {
        let records = vec![vec!["".to_string(), "x".to_string()]];
        let map = mapping(&[("a", 0), ("b", 1)]);

        let as_null = build_csv_insert_statements("s", "t", &map, &records, true).unwrap();
        assert!(
            as_null[0].ends_with("VALUES (NULL, 'x')"),
            "got {}",
            as_null[0]
        );

        let as_empty = build_csv_insert_statements("s", "t", &map, &records, false).unwrap();
        assert!(
            as_empty[0].ends_with("VALUES ('', 'x')"),
            "got {}",
            as_empty[0]
        );
    }

    // Injection safety — single quotes in a cell and in an identifier are
    // doubled by the reused export writer helpers, so the literal cannot escape.
    #[test]
    fn quotes_escape_injection() {
        let records = vec![vec!["a'); DROP TABLE users;--".to_string()]];
        let stmts =
            build_csv_insert_statements("pub\"lic", "t", &mapping(&[("c'ol", 0)]), &records, true)
                .unwrap();
        assert_eq!(
            stmts[0],
            "INSERT INTO \"pub\"\"lic\".\"t\" (\"c'ol\") VALUES ('a''); DROP TABLE users;--')"
        );
    }

    // A record shorter than a mapped index yields an empty cell for the missing
    // column (NULL under the default toggle), never a panic.
    #[test]
    fn short_row_fills_missing_cell() {
        let records = vec![vec!["1".to_string()]];
        let stmts =
            build_csv_insert_statements("s", "t", &mapping(&[("a", 0), ("b", 5)]), &records, true)
                .unwrap();
        assert!(stmts[0].ends_with("VALUES ('1', NULL)"), "got {}", stmts[0]);
    }

    // Zero data rows -> zero statements (the caller must not dispatch an empty
    // batch); no mapping -> a Validation error.
    #[test]
    fn empty_records_and_no_mapping() {
        let empty =
            build_csv_insert_statements("s", "t", &mapping(&[("a", 0)]), &[], true).unwrap();
        assert!(empty.is_empty());

        let err =
            build_csv_insert_statements("s", "t", &[], &[vec!["x".into()]], true).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    }

    // Engine gate — PostgreSQL passes, every other engine is refused up front.
    #[test]
    fn engine_gate_is_pg_only() {
        assert!(ensure_pg_for_csv_import(DatabaseType::Postgresql).is_ok());
        for other in [
            DatabaseType::Mysql,
            DatabaseType::Mariadb,
            DatabaseType::Sqlite,
            DatabaseType::Mongodb,
        ] {
            let label = format!("{other:?}");
            assert!(
                matches!(
                    ensure_pg_for_csv_import(other),
                    Err(AppError::Unsupported(_))
                ),
                "{label} must be Unsupported"
            );
        }
    }

    // Dispatch: an unknown connection short-circuits to NotFound before any
    // file read.
    #[tokio::test]
    async fn build_inner_unknown_connection_is_notfound() {
        let state = AppState::new();
        let err = build_csv_import_statements_inner(
            &state,
            "absent",
            Path::new("/tmp/x.csv"),
            "s",
            "t",
            mapping(&[("a", 0)]),
            CsvImportOptions::default(),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
    }

    // Dispatch: a live non-PG RDB connection is refused with Unsupported before
    // the file is opened (mirrors `pg_search_values`' PG-only gate).
    #[tokio::test]
    async fn build_inner_non_pg_is_unsupported() {
        let stub = StubRdbAdapter {
            kind_value: DatabaseType::Mysql,
            ..Default::default()
        };
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(stub))).await;
        let err = build_csv_import_statements_inner(
            &state,
            "c",
            Path::new("/tmp/x.csv"),
            "s",
            "t",
            mapping(&[("a", 0)]),
            CsvImportOptions::default(),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Unsupported(_)), "got {err:?}");
    }

    // Dispatch happy path: a PG connection reads the temp CSV and returns the
    // batched INSERT (end-to-end through the spawn_blocking file read).
    #[tokio::test]
    async fn build_inner_pg_reads_file_and_builds() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "people.csv", b"id,name\n1,ada\n2,alan\n");
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))).await;
        let stmts = build_csv_import_statements_inner(
            &state,
            "c",
            &path,
            "public",
            "people",
            mapping(&[("id", 0), ("name", 1)]),
            CsvImportOptions::default(),
        )
        .await
        .unwrap();
        assert_eq!(
            stmts.len(),
            2,
            "two CSV data rows -> two single-row INSERTs"
        );
        assert_eq!(
            stmts[0],
            "INSERT INTO \"public\".\"people\" (\"id\", \"name\") VALUES ('1', 'ada')"
        );
        assert_eq!(
            stmts[1],
            "INSERT INTO \"public\".\"people\" (\"id\", \"name\") VALUES ('2', 'alan')"
        );
    }
}
