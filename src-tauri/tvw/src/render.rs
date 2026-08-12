//! [`QueryResult`] → the three output formats ADR 0061 fixes.
//!
//! Every format is chosen by `--format` alone. Nothing here reads the terminal,
//! `$TERM`, `isatty` or the locale, because ADR 0061 rejected TTY-dependent
//! output: "같은 명령이 환경마다 다른 출력이면 CI 디버깅 함정".

use comfy_table::{presets, ContentArrangement, Table};
use serde_json::{json, Value};
use table_view_core::models::QueryResult;

use crate::{CliError, Format};

/// Rendered stdout for a result. Ends in a newline when it is not empty.
pub fn render(result: &QueryResult, format: Format) -> Result<String, CliError> {
    // A statement with no result set (DML/DDL) has no columns. Emitting a
    // header-only table or a bare CSV header would look like an empty result
    // set rather than the absence of one; `run` reports the row count on stderr
    // instead, so stdout stays a clean data channel for a pipe.
    if result.columns.is_empty() {
        return match format {
            // Through the same writer as a result set, so `--format json` has
            // one shape: an empty document here and a pretty-printed one there
            // would make the data, not the flag, decide the output.
            Format::Json => json(result),
            Format::Table | Format::Csv => Ok(String::new()),
        };
    }

    match format {
        Format::Table => Ok(table(result)),
        Format::Json => json(result),
        Format::Csv => csv(result),
    }
}

fn table(result: &QueryResult) -> String {
    let mut table = Table::new();
    table.load_preset(presets::ASCII_FULL_CONDENSED);
    // The default already is `Disabled`; stating it means a future comfy-table
    // default of `Dynamic` cannot start folding columns to the terminal width.
    table.set_content_arrangement(ContentArrangement::Disabled);
    table.set_header(
        result
            .columns
            .iter()
            .map(|c| c.name.clone())
            .collect::<Vec<_>>(),
    );
    for row in &result.rows {
        table.add_row(row.iter().map(display).collect::<Vec<_>>());
    }
    format!("{table}\n")
}

fn json(result: &QueryResult) -> Result<String, CliError> {
    // Rows stay positional arrays rather than becoming objects keyed by column
    // name. `SELECT 1, 1` returns two columns with the same name on PostgreSQL
    // and MySQL alike, and an object would silently drop one of them.
    let columns: Vec<Value> = result
        .columns
        .iter()
        .map(|c| json!({ "name": c.name, "type": c.data_type }))
        .collect();
    let document = json!({ "columns": columns, "rows": result.rows });
    serde_json::to_string_pretty(&document)
        .map(|text| format!("{text}\n"))
        .map_err(|e| CliError::failed(format!("could not serialise the result as JSON: {e}")))
}

fn csv(result: &QueryResult) -> Result<String, CliError> {
    // LF, not the crate's default CRLF: the format has to be byte-identical on
    // every platform for a snapshot or a `diff` in CI to mean anything.
    let mut writer = csv::WriterBuilder::new()
        .terminator(csv::Terminator::Any(b'\n'))
        .from_writer(Vec::new());
    let header: Vec<&str> = result.columns.iter().map(|c| c.name.as_str()).collect();
    let mut write = |record: Vec<String>| -> Result<(), CliError> {
        writer
            .write_record(&record)
            .map_err(|e| CliError::failed(format!("could not write CSV: {e}")))
    };
    write(header.iter().map(|name| (*name).to_string()).collect())?;
    for row in &result.rows {
        write(row.iter().map(csv_field).collect())?;
    }
    let bytes = writer
        .into_inner()
        .map_err(|e| CliError::failed(format!("could not flush CSV: {e}")))?;
    String::from_utf8(bytes)
        .map_err(|e| CliError::failed(format!("CSV output was not valid UTF-8: {e}")))
}

/// Cell text for the table format.
///
/// `NULL` is spelled out because a blank cell in a bordered table is
/// indistinguishable from an empty string, and the two are a documented
/// distinction in this product (ADR 0009, null vs empty string).
fn display(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::String(text) => text.clone(),
        other => compact(other),
    }
}

/// Cell text for CSV.
///
/// NULL and the empty string both become an empty field: RFC 4180 has no null,
/// and `QuoteStyle::Necessary` quotes neither. That is the app's own CSV export
/// behaviour (`json_to_cell_string` in
/// `src-tauri/src/commands/export/grid_writers.rs`), and the two surfaces of one
/// product should not disagree about it. `--format json` keeps the distinction
/// (`null` against `""`) for a caller that needs it.
fn csv_field(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => compact(other),
    }
}

/// Numbers keep the exact token the driver sent — `table-view-core` builds
/// `serde_json` with `arbitrary_precision`, so a NUMERIC(38,10) survives here
/// instead of being rounded through `f64`.
fn compact(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use table_view_core::models::{ColumnCategory, QueryColumn, QueryType};

    fn column(name: &str, data_type: &str, category: ColumnCategory) -> QueryColumn {
        QueryColumn {
            name: name.to_string(),
            data_type: data_type.to_string(),
            category,
        }
    }

    /// One result exercising every branch the formatters have: a NULL, an empty
    /// string, a value holding the CSV delimiters, a wide-glyph string, a
    /// number that `f64` cannot hold, and a nested JSON object.
    fn fixture() -> QueryResult {
        QueryResult {
            columns: vec![
                column("id", "int4", ColumnCategory::Int),
                column("name", "text", ColumnCategory::Text),
                column("amount", "numeric", ColumnCategory::Float),
                column("meta", "jsonb", ColumnCategory::Object),
            ],
            rows: vec![
                vec![json!(1), json!("표"), json!(12.5), json!({ "tag": "a" })],
                vec![json!(2), Value::Null, Value::Null, json!([1, 2])],
                vec![json!(3), json!("a,b \"quoted\""), json!(""), Value::Null],
            ],
            total_count: 3,
            // Deliberately non-zero: no format may let it reach stdout, or the
            // output would differ between two runs of the same query.
            execution_time_ms: 42,
            query_type: QueryType::Select,
            truncated: false,
        }
    }

    fn empty_result(query_type: QueryType) -> QueryResult {
        QueryResult {
            columns: vec![],
            rows: vec![],
            total_count: 0,
            execution_time_ms: 7,
            query_type,
            truncated: false,
        }
    }

    #[test]
    fn test_render_table_output_is_pinned() {
        // One literal per line so the column padding — which is what a width
        // regression would move — is visible inside the quotes. The wide-glyph
        // row is the one that matters: `표` is one char and two display
        // columns, and a formatter counting chars would misalign it.
        assert_eq!(
            render(&fixture(), Format::Table).expect("table render"),
            concat!(
                "+----+--------------+--------+-------------+\n",
                "| id | name         | amount | meta        |\n",
                "+==========================================+\n",
                "| 1  | 표           | 12.5   | {\"tag\":\"a\"} |\n",
                "| 2  | NULL         | NULL   | [1,2]       |\n",
                "| 3  | a,b \"quoted\" |        | NULL        |\n",
                "+----+--------------+--------+-------------+\n",
            )
        );
    }

    #[test]
    fn test_render_json_output_is_pinned() {
        assert_eq!(
            render(&fixture(), Format::Json).expect("json render"),
            r#"{
  "columns": [
    {
      "name": "id",
      "type": "int4"
    },
    {
      "name": "name",
      "type": "text"
    },
    {
      "name": "amount",
      "type": "numeric"
    },
    {
      "name": "meta",
      "type": "jsonb"
    }
  ],
  "rows": [
    [
      1,
      "표",
      12.5,
      {
        "tag": "a"
      }
    ],
    [
      2,
      null,
      null,
      [
        1,
        2
      ]
    ],
    [
      3,
      "a,b \"quoted\"",
      "",
      null
    ]
  ]
}
"#
        );
    }

    #[test]
    fn test_render_csv_output_is_pinned() {
        assert_eq!(
            render(&fixture(), Format::Csv).expect("csv render"),
            concat!(
                "id,name,amount,meta\n",
                "1,표,12.5,\"{\"\"tag\"\":\"\"a\"\"}\"\n",
                "2,,,\"[1,2]\"\n",
                "3,\"a,b \"\"quoted\"\"\",,\n",
            )
        );
    }

    #[test]
    fn test_render_never_leaks_execution_time_into_stdout() {
        // `QueryResult` serialises `executionTimeMs` by default. Handing the
        // struct straight to `serde_json` would make every run's output differ.
        for format in [Format::Table, Format::Json, Format::Csv] {
            let output = render(&fixture(), format).expect("render");
            assert!(
                !output.contains("42") && !output.contains("executionTime"),
                "{format:?} leaked the timing field: {output}"
            );
        }
    }

    #[test]
    fn test_render_statement_without_a_result_set_emits_no_phantom_row() {
        let dml = empty_result(QueryType::Dml { rows_affected: 3 });
        assert_eq!(render(&dml, Format::Table).expect("table"), "");
        assert_eq!(render(&dml, Format::Csv).expect("csv"), "");
        // Pretty-printed like every other `--format json` output: the flag
        // decides the shape, the result does not.
        assert_eq!(
            render(&dml, Format::Json).expect("json"),
            "{\n  \"columns\": [],\n  \"rows\": []\n}\n"
        );
    }

    #[test]
    fn test_csv_collapses_null_into_empty_but_table_and_json_keep_it() {
        // ADR 0009 makes null-vs-empty-string a product distinction, so record
        // where each format stands rather than leaving it to be discovered.
        let result = fixture();

        let csv = render(&result, Format::Csv).expect("csv");
        let row = csv.lines().nth(3).expect("the third data row");
        assert!(
            row.ends_with(",,"),
            "CSV should end on an empty `amount` and an empty NULL `meta`: {row}"
        );

        let table = render(&result, Format::Table).expect("table");
        assert!(
            table.contains("| NULL"),
            "the table format spells NULL out: {table}"
        );

        let json = render(&result, Format::Json).expect("json");
        assert!(json.contains("null"), "JSON keeps the null: {json}");
        assert!(
            json.contains(r#""""#),
            "JSON keeps the empty string: {json}"
        );
    }

    #[test]
    fn test_render_json_keeps_a_precision_that_f64_would_round() {
        // `table-view-core` enables serde_json's `arbitrary_precision`, and the
        // formatters must not undo it by going through a float.
        let mut result = empty_result(QueryType::Select);
        result.columns = vec![column("big", "numeric", ColumnCategory::Float)];
        let exact: Value = serde_json::from_str("0.1000000000000000000000001").expect("parse");
        result.rows = vec![vec![exact]];

        assert!(render(&result, Format::Json)
            .expect("json")
            .contains("0.1000000000000000000000001"));
        assert!(render(&result, Format::Csv)
            .expect("csv")
            .contains("0.1000000000000000000000001"));
        assert!(render(&result, Format::Table)
            .expect("table")
            .contains("0.1000000000000000000000001"));
    }
}
