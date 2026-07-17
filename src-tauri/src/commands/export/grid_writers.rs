//! Format-specific writers for grid-row export — CSV, TSV, SQL `INSERT`,
//! JSON array. Hoisted out of `commands/export/mod.rs` (Sprint 213, P5
//! step 2b) so the entry module is just types + Tauri commands. The
//! writer signatures stay private (`pub(super)`) — only the
//! `write_export` orchestrator in mod.rs (and the test module) calls
//! them.

use std::io::Write;

use serde_json::Value as JsonValue;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

use super::{ExportContext, ExportFormat};

pub(super) fn require_sql_source_table(context: &ExportContext) -> Result<(), AppError> {
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

pub(super) fn check_cancel(cancel: Option<&CancellationToken>) -> Result<(), AppError> {
    if let Some(tok) = cancel {
        if tok.is_cancelled() {
            return Err(AppError::Validation("Export cancelled".into()));
        }
    }
    Ok(())
}

// ------------------------------------------------------ streaming state

/// Issue #1443 — per-format streaming writer state shared by the single-shot
/// `write_export` path and the chunked-session IPC path (`export/session.rs`).
/// Both compose `begin` → `write_rows`* → `finish`, so the two entry points
/// emit byte-identical output by construction.
pub(super) struct GridStreamState {
    format: ExportFormat,
    /// Precomputed `INSERT INTO … VALUES ` prefix (SQL format only).
    sql_prefix: String,
    /// JSON array separator state — true until the first row is written.
    json_first: bool,
    /// Issue #1638 — headers for the tabular JSON branch (table/query
    /// context). `Some` selects the array-of-objects writer that keys each
    /// row by `headers`; `None` keeps the Mongo collection writer that
    /// treats `row.first()` as the whole document. Non-JSON formats leave
    /// this `None`.
    json_headers: Option<Vec<String>>,
}

impl GridStreamState {
    /// Write the format preamble (CSV BOM + header record / TSV header line /
    /// JSON `[`) and capture per-format state. Returns bytes written.
    pub(super) fn begin<W: Write>(
        writer: &mut W,
        format: ExportFormat,
        headers: &[String],
        context: &ExportContext,
    ) -> Result<(Self, u64), AppError> {
        let mut counting = ByteCounter::new(writer);
        let mut sql_prefix = String::new();
        match format {
            ExportFormat::Csv => {
                // UTF-8 BOM prefix (Excel compatibility). The `csv` crate does
                // not emit a BOM itself, so write it directly before handing
                // the writer off to the CSV serializer.
                counting
                    .write_all(b"\xEF\xBB\xBF")
                    .map_err(AppError::from)?;
                let mut csv_w = csv::WriterBuilder::new()
                    .terminator(csv::Terminator::CRLF)
                    .from_writer(&mut counting);
                csv_w.write_record(headers).map_err(csv_to_app)?;
                csv_w.flush().map_err(AppError::from)?;
            }
            ExportFormat::Tsv => {
                let header_line = headers
                    .iter()
                    .map(|h| sanitize_tsv_cell(h))
                    .collect::<Vec<_>>()
                    .join("\t");
                counting
                    .write_all(header_line.as_bytes())
                    .map_err(AppError::from)?;
                counting.write_all(b"\n").map_err(AppError::from)?;
            }
            ExportFormat::Sql => {
                let (schema, table) = match context {
                    ExportContext::Table { schema, name } => (schema.as_str(), name.as_str()),
                    ExportContext::Query {
                        source_table: Some(src),
                    } => (src.schema.as_str(), src.name.as_str()),
                    // `require_sql_source_table` preflight already rejected
                    // these; keep a defensive error instead of unreachable!()
                    // since the session path calls `begin` from a command.
                    _ => {
                        return Err(AppError::Validation(
                            "SQL export requires a single-table SELECT (source_table missing)"
                                .into(),
                        ))
                    }
                };
                let cols = headers
                    .iter()
                    .map(|h| quote_sql_identifier(h))
                    .collect::<Vec<_>>()
                    .join(", ");
                sql_prefix = format!(
                    "INSERT INTO {}.{} ({}) VALUES ",
                    quote_sql_identifier(schema),
                    quote_sql_identifier(table),
                    cols
                );
            }
            ExportFormat::Json => {
                counting.write_all(b"[").map_err(AppError::from)?;
            }
        }
        // Issue #1638 — table/query JSON exports the tabular array-of-objects
        // shape (headers as keys); collection JSON keeps the document
        // passthrough. Captured here since `write_rows` has no `context`.
        let json_headers = if matches!(format, ExportFormat::Json)
            && !matches!(context, ExportContext::Collection { .. })
        {
            Some(headers.to_vec())
        } else {
            None
        };
        Ok((
            Self {
                format,
                sql_prefix,
                json_first: true,
                json_headers,
            },
            counting.bytes(),
        ))
    }

    /// Append a batch of rows in the session's format. Returns bytes written.
    /// Checks `cancel` per row, mirroring the pre-#1443 single-shot writers.
    pub(super) fn write_rows<W: Write>(
        &mut self,
        writer: &mut W,
        rows: &[Vec<JsonValue>],
        cancel: Option<&CancellationToken>,
    ) -> Result<u64, AppError> {
        let mut counting = ByteCounter::new(writer);
        match self.format {
            ExportFormat::Csv => {
                let mut csv_w = csv::WriterBuilder::new()
                    .terminator(csv::Terminator::CRLF)
                    .from_writer(&mut counting);
                for row in rows {
                    check_cancel(cancel)?;
                    let cells: Vec<String> = row.iter().map(json_to_cell_string).collect();
                    csv_w.write_record(cells.iter()).map_err(csv_to_app)?;
                }
                csv_w.flush().map_err(AppError::from)?;
            }
            ExportFormat::Tsv => {
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
            }
            ExportFormat::Sql => {
                for row in rows {
                    check_cancel(cancel)?;
                    let values = row
                        .iter()
                        .map(json_to_sql_literal)
                        .collect::<Vec<_>>()
                        .join(", ");
                    counting
                        .write_all(self.sql_prefix.as_bytes())
                        .map_err(AppError::from)?;
                    counting
                        .write_all(b"(")
                        .and_then(|_| counting.write_all(values.as_bytes()))
                        .and_then(|_| counting.write_all(b");\n"))
                        .map_err(AppError::from)?;
                }
            }
            ExportFormat::Json => {
                // Collection rows arrive as a single-cell row carrying the
                // document's JSON (Extended JSON v2 Relaxed already from the
                // BSON layer in `db/mongodb.rs`); pretty-print pass-through.
                // Issue #1638 — table/query rows instead become an object
                // keyed by `json_headers` (source order preserved via
                // serde_json's `preserve_order` feature). Both share the same
                // `[`/`]\n` framing + 2-space indent so the two shapes stay
                // visually consistent and byte-identical across the
                // single-shot and chunked paths.
                for row in rows {
                    check_cancel(cancel)?;
                    if !self.json_first {
                        counting.write_all(b",\n").map_err(AppError::from)?;
                    } else {
                        counting.write_all(b"\n").map_err(AppError::from)?;
                        self.json_first = false;
                    }
                    let value = match &self.json_headers {
                        Some(headers) => tabular_json_object(headers, row),
                        None => {
                            relax_extended_json(row.first().cloned().unwrap_or(JsonValue::Null))
                        }
                    };
                    let pretty = serde_json::to_string_pretty(&value).map_err(AppError::from)?;
                    // indent two spaces — to_string_pretty already uses
                    // two-space indent.
                    for line in pretty.lines() {
                        counting.write_all(b"  ").map_err(AppError::from)?;
                        counting
                            .write_all(line.as_bytes())
                            .map_err(AppError::from)?;
                        counting.write_all(b"\n").map_err(AppError::from)?;
                    }
                }
            }
        }
        Ok(counting.bytes())
    }

    /// Write the format epilogue (JSON `]`). Returns bytes written.
    pub(super) fn finish<W: Write>(&mut self, writer: &mut W) -> Result<u64, AppError> {
        match self.format {
            ExportFormat::Json => {
                writer.write_all(b"]\n").map_err(AppError::from)?;
                Ok(2)
            }
            _ => Ok(0),
        }
    }
}

pub(super) fn sanitize_tsv_cell(s: &str) -> String {
    // TSV has no escape convention; replace tab/CR/LF with single space.
    s.replace(['\t', '\r', '\n'], " ")
}

// ------------------------------------------------------------ SQL INSERT

pub(super) fn quote_sql_identifier(ident: &str) -> String {
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

pub(super) fn quote_sql_string(s: &str) -> String {
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

pub(super) fn json_to_sql_literal(value: &JsonValue) -> String {
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

/// Issue #1638 — build one tabular export row as a JSON object keyed by
/// `headers`. serde_json is compiled with `preserve_order`, so the
/// resulting `Map` keeps header (source) order rather than alphabetizing.
/// A short row is padded with `null` for the missing trailing columns;
/// extra cells beyond `headers` are dropped (headers define the schema).
fn tabular_json_object(headers: &[String], row: &[JsonValue]) -> JsonValue {
    let mut obj = serde_json::Map::with_capacity(headers.len());
    for (i, header) in headers.iter().enumerate() {
        obj.insert(
            header.clone(),
            row.get(i).cloned().unwrap_or(JsonValue::Null),
        );
    }
    JsonValue::Object(obj)
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

pub(super) fn json_to_cell_string(value: &JsonValue) -> String {
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
