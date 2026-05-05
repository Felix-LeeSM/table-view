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

use super::ExportContext;

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

// ---------------------------------------------------------------- CSV

pub(super) fn write_csv<W: Write>(
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

pub(super) fn write_tsv<W: Write>(
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

pub(super) fn sanitize_tsv_cell(s: &str) -> String {
    // TSV has no escape convention; replace tab/CR/LF with single space.
    s.replace(['\t', '\r', '\n'], " ")
}

// ------------------------------------------------------------ SQL INSERT

pub(super) fn write_sql_insert<W: Write>(
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

pub(super) fn write_json_array<W: Write>(
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
