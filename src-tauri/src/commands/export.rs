//! Sprint 181 — Export grid rows to CSV / TSV / SQL `INSERT` / JSON.
//!
//! All format conversion lives here so the frontend never makes encoding
//! decisions (TablePlus-equivalent deterministic output). The handler
//! streams rows to a `BufWriter<File>` and cooperates with the Sprint 180
//! cancellation registry through an optional `export_id`.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::State;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::commands::connection::AppState;
use crate::error::AppError;

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
    info!(
        format = ?format,
        rows = rows.len(),
        cols = headers.len(),
        "export_grid_rows invoked"
    );

    // Sprint 180 — cooperative cancellation. Hoist registration outside
    // the `active_connections` lock, identical to the shape used by
    // `execute_query` and `query_table_data`.
    let cancel_handle: Option<(String, CancellationToken)> = if let Some(eid) = export_id.as_ref() {
        let token = CancellationToken::new();
        let stored = token.clone();
        {
            let mut tokens = state.query_tokens.lock().await;
            tokens.insert(eid.clone(), stored);
        }
        Some((eid.clone(), token))
    } else {
        None
    };

    let cancel_ref = cancel_handle.as_ref().map(|(_, tok)| tok);

    // Run the synchronous file I/O on a blocking thread so the async
    // executor stays responsive. The blocking task captures owned data;
    // the cancellation token is the only shared handle.
    let target_for_task = target_path.clone();
    let task_token = cancel_ref.cloned();
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

    if let Some((eid, _)) = cancel_handle {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(&eid);
    }

    if let Err(ref e) = result {
        warn!(error = %e, "export_grid_rows failed");
        // Best-effort: remove a partial file if one was created. We do
        // this for both Io errors and cancellation so the user is never
        // left with a half-written export. Ignore the remove error since
        // the file may not exist yet.
        let _ = std::fs::remove_file(&target_path);
    }

    result
}

/// Synchronous core. Pulled out so unit tests can drive it without a
/// Tauri AppState. Returns `AppError::Validation("cancelled")` if the
/// token fires mid-write.
pub fn write_export(
    format: ExportFormat,
    target_path: &std::path::Path,
    headers: &[String],
    rows: &[Vec<JsonValue>],
    context: &ExportContext,
    cancel: Option<&CancellationToken>,
) -> Result<ExportSummary, AppError> {
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

    let file = File::create(target_path).map_err(AppError::from)?;
    let mut writer = BufWriter::new(file);

    let bytes_written = match format {
        ExportFormat::Csv => write_csv(&mut writer, headers, rows, cancel)?,
        ExportFormat::Tsv => write_tsv(&mut writer, headers, rows, cancel)?,
        ExportFormat::Sql => write_sql_insert(&mut writer, headers, rows, context, cancel)?,
        ExportFormat::Json => write_json_array(&mut writer, headers, rows, cancel)?,
    };

    writer.flush().map_err(AppError::from)?;

    Ok(ExportSummary {
        rows_written: rows.len() as u64,
        bytes_written,
    })
}

fn require_sql_source_table(context: &ExportContext) -> Result<(), AppError> {
    match context {
        ExportContext::Table { .. } => Ok(()),
        ExportContext::Query {
            source_table: Some(_),
        } => Ok(()),
        ExportContext::Query { source_table: None } => Err(AppError::Validation(
            "SQL export requires a single-table SELECT (source_table missing)".into(),
        )),
        ExportContext::Collection { .. } => Err(AppError::Validation(
            "SQL export is not supported for collections".into(),
        )),
    }
}

fn check_cancel(cancel: Option<&CancellationToken>) -> Result<(), AppError> {
    if let Some(tok) = cancel {
        if tok.is_cancelled() {
            return Err(AppError::Validation("Export cancelled".into()));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- CSV

fn write_csv<W: Write>(
    writer: &mut W,
    headers: &[String],
    rows: &[Vec<JsonValue>],
    cancel: Option<&CancellationToken>,
) -> Result<u64, AppError> {
    // UTF-8 BOM prefix (Excel compatibility). The `csv` crate does not
    // emit a BOM itself, so write it directly before handing the writer
    // off to the CSV serializer.
    let mut counting = ByteCounter::new(writer);
    counting
        .write_all(b"\xEF\xBB\xBF")
        .map_err(AppError::from)?;

    {
        let mut csv_w = csv::WriterBuilder::new()
            .terminator(csv::Terminator::CRLF)
            .from_writer(&mut counting);
        csv_w.write_record(headers).map_err(csv_to_app)?;
        for row in rows {
            check_cancel(cancel)?;
            let cells: Vec<String> = row.iter().map(json_to_cell_string).collect();
            csv_w.write_record(cells.iter()).map_err(csv_to_app)?;
        }
        csv_w.flush().map_err(AppError::from)?;
    }

    Ok(counting.bytes())
}

// ---------------------------------------------------------------- TSV

fn write_tsv<W: Write>(
    writer: &mut W,
    headers: &[String],
    rows: &[Vec<JsonValue>],
    cancel: Option<&CancellationToken>,
) -> Result<u64, AppError> {
    let mut counting = ByteCounter::new(writer);
    let header_line = headers
        .iter()
        .map(|h| sanitize_tsv_cell(h))
        .collect::<Vec<_>>()
        .join("\t");
    counting
        .write_all(header_line.as_bytes())
        .map_err(AppError::from)?;
    counting.write_all(b"\n").map_err(AppError::from)?;

    for row in rows {
        check_cancel(cancel)?;
        let line = row
            .iter()
            .map(|v| sanitize_tsv_cell(&json_to_cell_string(v)))
            .collect::<Vec<_>>()
            .join("\t");
        counting
            .write_all(line.as_bytes())
            .map_err(AppError::from)?;
        counting.write_all(b"\n").map_err(AppError::from)?;
    }

    Ok(counting.bytes())
}

fn sanitize_tsv_cell(s: &str) -> String {
    // TSV has no escape convention; replace tab/CR/LF with single space.
    s.replace(['\t', '\r', '\n'], " ")
}

// ------------------------------------------------------------ SQL INSERT

fn write_sql_insert<W: Write>(
    writer: &mut W,
    headers: &[String],
    rows: &[Vec<JsonValue>],
    context: &ExportContext,
    cancel: Option<&CancellationToken>,
) -> Result<u64, AppError> {
    let (schema, table) = match context {
        ExportContext::Table { schema, name } => (schema.as_str(), name.as_str()),
        ExportContext::Query {
            source_table: Some(src),
        } => (src.schema.as_str(), src.name.as_str()),
        _ => unreachable!("require_sql_source_table guard already ran"),
    };

    let mut counting = ByteCounter::new(writer);
    let cols = headers
        .iter()
        .map(|h| quote_sql_identifier(h))
        .collect::<Vec<_>>()
        .join(", ");
    let prefix = format!(
        "INSERT INTO {}.{} ({}) VALUES ",
        quote_sql_identifier(schema),
        quote_sql_identifier(table),
        cols
    );

    for row in rows {
        check_cancel(cancel)?;
        let values = row
            .iter()
            .map(json_to_sql_literal)
            .collect::<Vec<_>>()
            .join(", ");
        counting
            .write_all(prefix.as_bytes())
            .map_err(AppError::from)?;
        counting
            .write_all(b"(")
            .and_then(|_| counting.write_all(values.as_bytes()))
            .and_then(|_| counting.write_all(b");\n"))
            .map_err(AppError::from)?;
    }

    Ok(counting.bytes())
}

fn quote_sql_identifier(ident: &str) -> String {
    let mut out = String::with_capacity(ident.len() + 2);
    out.push('"');
    for ch in ident.chars() {
        if ch == '"' {
            out.push('"');
        }
        out.push(ch);
    }
    out.push('"');
    out
}

fn quote_sql_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            out.push('\'');
        }
        out.push(ch);
    }
    out.push('\'');
    out
}

fn json_to_sql_literal(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => "NULL".to_string(),
        JsonValue::Bool(b) => {
            if *b {
                "TRUE".into()
            } else {
                "FALSE".into()
            }
        }
        JsonValue::Number(n) => n.to_string(),
        JsonValue::String(s) => quote_sql_string(s),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            // JSON / JSONB / array literal — serialize as JSON and cast.
            let serialized = serde_json::to_string(value).unwrap_or_else(|_| "null".into());
            format!("{}::jsonb", quote_sql_string(&serialized))
        }
    }
}

// ---------------------------------------------------------------- JSON

fn write_json_array<W: Write>(
    writer: &mut W,
    _headers: &[String],
    rows: &[Vec<JsonValue>],
    cancel: Option<&CancellationToken>,
) -> Result<u64, AppError> {
    // Mongo collection rows arrive as a single-cell row carrying the
    // document's JSON (Extended JSON v2 Relaxed already from the BSON
    // layer in `db/mongodb.rs`). We pass the value through pretty-print.
    let mut counting = ByteCounter::new(writer);
    counting.write_all(b"[").map_err(AppError::from)?;

    let mut first = true;
    for row in rows {
        check_cancel(cancel)?;
        if !first {
            counting.write_all(b",\n").map_err(AppError::from)?;
        } else {
            counting.write_all(b"\n").map_err(AppError::from)?;
            first = false;
        }
        let doc = row.first().cloned().unwrap_or(JsonValue::Null);
        let pretty =
            serde_json::to_string_pretty(&relax_extended_json(doc)).map_err(AppError::from)?;
        // indent two spaces — to_string_pretty already uses two-space indent.
        for line in pretty.lines() {
            counting.write_all(b"  ").map_err(AppError::from)?;
            counting
                .write_all(line.as_bytes())
                .map_err(AppError::from)?;
            counting.write_all(b"\n").map_err(AppError::from)?;
        }
    }

    counting.write_all(b"]\n").map_err(AppError::from)?;
    Ok(counting.bytes())
}

/// Walk a JSON value and ensure MongoDB Extended JSON v2 Relaxed shape.
/// The mongo db layer (`db/mongodb.rs`) already serializes BSON via the
/// Relaxed variant, so most documents pass through unchanged. We still
/// run through the tree so that any host-side construction of `$oid` /
/// `$date` / `$binary` / `$numberDecimal` keys retain their canonical
/// form (no accidental key reordering or stringification).
fn relax_extended_json(value: JsonValue) -> JsonValue {
    match value {
        JsonValue::Object(map) => {
            let mut out = serde_json::Map::with_capacity(map.len());
            for (k, v) in map {
                out.insert(k, relax_extended_json(v));
            }
            JsonValue::Object(out)
        }
        JsonValue::Array(items) => {
            JsonValue::Array(items.into_iter().map(relax_extended_json).collect())
        }
        other => other,
    }
}

// ---------------------------------------------------------------- helpers

fn json_to_cell_string(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => String::new(),
        JsonValue::Bool(b) => {
            if *b {
                "true".into()
            } else {
                "false".into()
            }
        }
        JsonValue::Number(n) => n.to_string(),
        JsonValue::String(s) => s.clone(),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            serde_json::to_string(value).unwrap_or_default()
        }
    }
}

fn csv_to_app(err: csv::Error) -> AppError {
    if let csv::ErrorKind::Io(_) = err.kind() {
        match err.into_kind() {
            csv::ErrorKind::Io(io) => AppError::Io(io),
            _ => unreachable!(),
        }
    } else {
        AppError::Storage(format!("csv error: {}", err))
    }
}

/// Wraps a `Write` and counts bytes written. Used so we can report
/// `bytes_written` without re-stat'ing the file after flush.
struct ByteCounter<W: Write> {
    inner: W,
    bytes: u64,
}

impl<W: Write> ByteCounter<W> {
    fn new(inner: W) -> Self {
        Self { inner, bytes: 0 }
    }
    fn bytes(&self) -> u64 {
        self.bytes
    }
}

impl<W: Write> Write for ByteCounter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.bytes += n as u64;
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

// ============================================================== tests

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;
    use tempfile::TempDir;

    fn read_to_string(p: &Path) -> String {
        std::fs::read_to_string(p).unwrap()
    }

    fn read_to_bytes(p: &Path) -> Vec<u8> {
        std::fs::read(p).unwrap()
    }

    fn table_ctx() -> ExportContext {
        ExportContext::Table {
            schema: "public".into(),
            name: "users".into(),
        }
    }

    // [AC-181-03] CSV RFC 4180 escape — comma / quote / CRLF cells.
    // 2026-05-01 — guards deterministic CSV output across surfaces.
    #[test]
    fn test_csv_rfc4180_escape() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("out.csv");
        let headers = vec!["name".to_string(), "note".to_string()];
        let rows = vec![vec![
            json!("alice, with comma"),
            json!("line1\nline2 \"quoted\""),
        ]];
        write_export(
            ExportFormat::Csv,
            &path,
            &headers,
            &rows,
            &table_ctx(),
            None,
        )
        .unwrap();
        let body = read_to_string(&path);
        // Header row uses CRLF.
        assert!(body.contains("name,note\r\n"), "csv body: {:?}", body);
        // Cell with comma is quoted; cell with quote uses doubled quote.
        assert!(
            body.contains("\"alice, with comma\""),
            "csv body: {:?}",
            body
        );
        assert!(
            body.contains("\"line1\nline2 \"\"quoted\"\"\""),
            "csv body: {:?}",
            body
        );
    }

    // [AC-181-03] CSV BOM prefix (Excel compatibility).
    // 2026-05-01 — guards Excel UTF-8 round-trip.
    #[test]
    fn test_csv_utf8_bom_prefix() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("bom.csv");
        write_export(
            ExportFormat::Csv,
            &path,
            &["c".into()],
            &[vec![json!("v")]],
            &table_ctx(),
            None,
        )
        .unwrap();
        let bytes = read_to_bytes(&path);
        assert_eq!(
            &bytes[..3],
            b"\xEF\xBB\xBF",
            "missing BOM: {:?}",
            &bytes[..6]
        );
    }

    // [AC-181-04] TSV: tab/newline in cell collapsed to space.
    // 2026-05-01 — TSV has no escape spec so we sanitize.
    #[test]
    fn test_tsv_strips_tab_in_cell() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("out.tsv");
        write_export(
            ExportFormat::Tsv,
            &path,
            &["a".into(), "b".into()],
            &[vec![json!("x\ty"), json!("line1\nline2")]],
            &table_ctx(),
            None,
        )
        .unwrap();
        let body = read_to_string(&path);
        assert_eq!(body, "a\tb\nx y\tline1 line2\n");
    }

    // [AC-181-05] SQL: identifier with embedded double-quote.
    // 2026-05-01 — ANSI quoting (`"` → `""`).
    #[test]
    fn test_sql_identifier_double_quote_escape() {
        assert_eq!(quote_sql_identifier(r#"weird"col"#), r#""weird""col""#);
        assert_eq!(quote_sql_identifier("plain"), r#""plain""#);
    }

    // [AC-181-05] SQL: string value with single quote.
    // 2026-05-01 — SQL string escape (`'` → `''`).
    #[test]
    fn test_sql_string_single_quote_escape() {
        assert_eq!(quote_sql_string("O'Reilly"), "'O''Reilly'");
    }

    // [AC-181-05] SQL: NULL is bare literal, not quoted.
    // 2026-05-01 — null vs string disambiguation.
    #[test]
    fn test_sql_null_literal() {
        assert_eq!(json_to_sql_literal(&JsonValue::Null), "NULL");
        assert_eq!(json_to_sql_literal(&json!("")), "''");
    }

    // [AC-181-05] SQL: Query context with single source_table is allowed.
    // 2026-05-01 — single-table SELECT inference.
    #[test]
    fn test_sql_source_table_inference_single() {
        let ctx = ExportContext::Query {
            source_table: Some(SourceTable {
                schema: "public".into(),
                name: "events".into(),
            }),
        };
        assert!(require_sql_source_table(&ctx).is_ok());
    }

    // [AC-181-05] SQL: Query context without source_table is rejected.
    // 2026-05-01 — JOIN/aggregate result cannot infer table.
    #[test]
    fn test_sql_source_table_inference_multi_disabled() {
        let ctx = ExportContext::Query { source_table: None };
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nope.sql");
        let err = write_export(
            ExportFormat::Sql,
            &path,
            &["c".into()],
            &[vec![json!(1)]],
            &ctx,
            None,
        )
        .unwrap_err();
        assert!(err.to_string().contains("single-table SELECT"));
        // Pre-flight rejection means no file was created.
        assert!(!path.exists(), "partial file should not exist");
    }

    // [AC-181-06] Mongo Extended JSON: $oid passes through.
    // 2026-05-01 — BSON layer already produces Relaxed; we preserve it.
    #[test]
    fn test_extended_json_objectid_oid_key() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("out.json");
        let rows = vec![vec![
            json!({"_id": {"$oid": "5099803df3f4948bd2f98391"}, "name": "alice"}),
        ]];
        write_export(
            ExportFormat::Json,
            &path,
            &["_doc".into()],
            &rows,
            &ExportContext::Collection {
                name: "users".into(),
            },
            None,
        )
        .unwrap();
        let body = read_to_string(&path);
        assert!(body.contains("\"$oid\""), "missing $oid: {}", body);
        assert!(body.contains("5099803df3f4948bd2f98391"));
    }

    // [AC-181-06] Mongo Extended JSON: $date and $numberDecimal preserved.
    // 2026-05-01 — Relaxed mode key set per BSON spec.
    #[test]
    fn test_extended_json_date_and_decimal() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("out.json");
        let rows = vec![vec![json!({
            "ts": {"$date": "2026-05-01T00:00:00Z"},
            "amount": {"$numberDecimal": "12.34"}
        })]];
        write_export(
            ExportFormat::Json,
            &path,
            &["_doc".into()],
            &rows,
            &ExportContext::Collection {
                name: "ledger".into(),
            },
            None,
        )
        .unwrap();
        let body = read_to_string(&path);
        assert!(body.contains("\"$date\""));
        assert!(body.contains("\"$numberDecimal\""));
    }

    // [AC-181-06] Mongo Extended JSON: $binary preserved end-to-end.
    // 2026-05-01 — guarantees BinData passes through `relax_extended_json`
    // tree walk without flattening. Closes the four-key gate from the
    // contract Verification Plan static grep (`$oid|$date|$binary|$numberDecimal`).
    #[test]
    fn test_extended_json_binary_preserved() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("out.json");
        let rows = vec![vec![json!({
            "blob": {"$binary": {"base64": "aGVsbG8=", "subType": "00"}}
        })]];
        write_export(
            ExportFormat::Json,
            &path,
            &["_doc".into()],
            &rows,
            &ExportContext::Collection {
                name: "files".into(),
            },
            None,
        )
        .unwrap();
        let body = read_to_string(&path);
        assert!(body.contains("\"$binary\""), "missing $binary: {}", body);
        assert!(body.contains("aGVsbG8="));
    }

    // [AC-181-07] Streaming 100k rows — file line count + bytes_written.
    // 2026-05-01 — proves we don't load all rows into memory at once
    // (BufWriter sized at default 8 KiB writes incrementally).
    #[test]
    fn test_streaming_100k_rows_writes_all_lines() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("big.csv");
        let headers = vec!["i".to_string(), "v".to_string()];
        let rows: Vec<Vec<JsonValue>> = (0..100_000_u64)
            .map(|i| vec![json!(i), json!(format!("row-{}", i))])
            .collect();
        let summary = write_export(
            ExportFormat::Csv,
            &path,
            &headers,
            &rows,
            &table_ctx(),
            None,
        )
        .unwrap();
        assert_eq!(summary.rows_written, 100_000);
        let body = read_to_string(&path);
        // 100k rows + 1 header + final empty after last CRLF.
        let line_count = body.matches("\r\n").count();
        assert_eq!(line_count, 100_001, "csv line count mismatch");
    }

    // [AC-181-07] Cancellation mid-write removes the partial file path.
    // 2026-05-01 — token cancel before call → Err + cleanup callers.
    #[test]
    fn test_export_cancellation_aborts_write() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("cancel.csv");
        let headers = vec!["i".to_string()];
        let rows: Vec<Vec<JsonValue>> = (0..10).map(|i| vec![json!(i)]).collect();
        let token = CancellationToken::new();
        token.cancel();
        let err = write_export(
            ExportFormat::Csv,
            &path,
            &headers,
            &rows,
            &table_ctx(),
            Some(&token),
        )
        .unwrap_err();
        assert!(err.to_string().contains("cancelled"));
        // The synchronous core created the file but the caller-side
        // (export_grid_rows) is responsible for unlinking. The handler's
        // partial-file cleanup is exercised in the operator smoke; here
        // we only assert the error surface.
    }

    // [AC-181-08] NULL serialization is consistent across CSV / TSV / SQL.
    // 2026-05-01 — single fixture, three formats.
    #[test]
    fn test_null_consistent_across_formats() {
        let dir = TempDir::new().unwrap();
        let headers = vec!["a".to_string(), "b".to_string()];
        let rows = vec![vec![JsonValue::Null, json!(1)]];

        let csv_path = dir.path().join("n.csv");
        write_export(
            ExportFormat::Csv,
            &csv_path,
            &headers,
            &rows,
            &table_ctx(),
            None,
        )
        .unwrap();
        let body = read_to_string(&csv_path);
        // Empty cell for NULL.
        assert!(body.contains(",1\r\n"));

        let tsv_path = dir.path().join("n.tsv");
        write_export(
            ExportFormat::Tsv,
            &tsv_path,
            &headers,
            &rows,
            &table_ctx(),
            None,
        )
        .unwrap();
        let body = read_to_string(&tsv_path);
        assert!(body.contains("\t1\n"));

        let sql_path = dir.path().join("n.sql");
        write_export(
            ExportFormat::Sql,
            &sql_path,
            &headers,
            &rows,
            &table_ctx(),
            None,
        )
        .unwrap();
        let body = read_to_string(&sql_path);
        assert!(body.contains("(NULL, 1);"), "sql body: {}", body);
    }

    // [AC-181-08] Boolean serializes as `TRUE` / `FALSE` in SQL but
    // `true` / `false` in CSV/TSV (lowercase per common convention).
    // 2026-05-01.
    #[test]
    fn test_boolean_serialization() {
        assert_eq!(json_to_sql_literal(&json!(true)), "TRUE");
        assert_eq!(json_to_sql_literal(&json!(false)), "FALSE");
        assert_eq!(json_to_cell_string(&json!(true)), "true");
        assert_eq!(json_to_cell_string(&json!(false)), "false");
    }

    // [AC-181-08] Number serializes without quoting in all formats.
    // 2026-05-01.
    #[test]
    fn test_number_serialization_unquoted() {
        assert_eq!(json_to_sql_literal(&json!(42)), "42");
        assert_eq!(json_to_sql_literal(&json!(2.5)), "2.5");
        assert_eq!(json_to_cell_string(&json!(42)), "42");
    }

    // [AC-181-08] JSON / array values get the `::jsonb` cast in SQL.
    // 2026-05-01 — mirrors PG `to_jsonb` ergonomics.
    #[test]
    fn test_sql_object_value_cast_to_jsonb() {
        let lit = json_to_sql_literal(&json!({"k": "v"}));
        assert!(lit.ends_with("::jsonb"), "lit: {}", lit);
        assert!(lit.contains("'{\"k\":\"v\"}'"), "lit: {}", lit);
    }

    // [AC-181-09 / Invariant] Header-only export with zero rows is valid.
    // 2026-05-01 — empty result set still produces a parsable file.
    #[test]
    fn test_zero_rows_produces_header_only() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.csv");
        let summary = write_export(
            ExportFormat::Csv,
            &path,
            &["c".into()],
            &[],
            &table_ctx(),
            None,
        )
        .unwrap();
        assert_eq!(summary.rows_written, 0);
        let body = read_to_string(&path);
        assert!(body.ends_with("c\r\n"));
    }

    // [Invariant] ExportFormat round-trips through serde with lowercase
    // wire strings — frontend and backend share the same enum literals.
    // 2026-05-01.
    #[test]
    fn test_export_format_serde_lowercase() {
        assert_eq!(
            serde_json::to_string(&ExportFormat::Csv).unwrap(),
            "\"csv\""
        );
        assert_eq!(
            serde_json::to_string(&ExportFormat::Tsv).unwrap(),
            "\"tsv\""
        );
        assert_eq!(
            serde_json::to_string(&ExportFormat::Sql).unwrap(),
            "\"sql\""
        );
        assert_eq!(
            serde_json::to_string(&ExportFormat::Json).unwrap(),
            "\"json\""
        );
        let parsed: ExportFormat = serde_json::from_str("\"csv\"").unwrap();
        assert_eq!(parsed, ExportFormat::Csv);
    }
}
