use std::fs;
use std::path::Path;
use std::time::Instant;

use duckdb::Connection;

use crate::error::AppError;
use crate::models::{
    FileAnalyticsPreview, FileAnalyticsQueryResponse, FileAnalyticsSource, FileAnalyticsSourceKind,
    QueryResult, QueryType,
};

use super::connection::{
    open_file_analytics_connection, run_blocking, DuckdbAdapter, DuckdbConnectionSettings,
    RegisteredFileAnalyticsSource,
};
use super::queries::{collect_rows, duckdb_query_columns};
use super::sql_text::{
    first_sql_word, quote_identifier, strip_trailing_terminator, validate_supported_sql,
};

mod json;

const TEXT_FILE_LIMIT_BYTES: u64 = 100 * 1024 * 1024;
const PARQUET_FILE_LIMIT_BYTES: u64 = 512 * 1024 * 1024;
const DEFAULT_PREVIEW_LIMIT: u32 = 1_000;
const MAX_PREVIEW_LIMIT: u32 = 10_000;

struct ValidatedFileSource {
    path: String,
    file_name: String,
    kind: FileAnalyticsSourceKind,
    size_bytes: u64,
}

impl DuckdbAdapter {
    pub async fn register_file_analytics_source(
        &self,
        path: &str,
    ) -> Result<FileAnalyticsSource, AppError> {
        let validated = validate_local_file_source(path)?;
        self.store_file_analytics_source(
            validated.path,
            validated.file_name,
            validated.kind,
            validated.size_bytes,
        )
        .await
    }

    pub async fn preview_file_analytics_source(
        &self,
        source_id: &str,
        limit: Option<u32>,
    ) -> Result<FileAnalyticsPreview, AppError> {
        let source = self.get_file_analytics_source(source_id).await?;
        let settings = self.active_settings().await?;
        let limit = normalize_preview_limit(limit)?;
        let redactions = redaction_needles(&settings, &source);
        let source_for_work = source.clone();

        let result = run_blocking(move || {
            let conn = open_file_analytics_connection(&settings)?;
            create_source_view(&conn, &source_for_work)?;
            disable_external_access(&conn)?;
            let executed_sql = format!(
                "SELECT * FROM {} LIMIT {limit}",
                quote_identifier(&source_for_work.public.alias)
            );
            let result = execute_select_query(&conn, &executed_sql, Instant::now())?;
            Ok(FileAnalyticsPreview {
                source: source_for_work.public,
                result,
                executed_sql,
            })
        })
        .await;

        result.map_err(|error| redact_app_error(error, &redactions))
    }

    pub async fn execute_file_analytics_query(
        &self,
        source_id: &str,
        sql: &str,
    ) -> Result<FileAnalyticsQueryResponse, AppError> {
        let sql = strip_trailing_terminator(sql).to_string();
        validate_file_analytics_sql(&sql)?;
        let source = self.get_file_analytics_source(source_id).await?;
        let settings = self.active_settings().await?;
        let mut redactions = redaction_needles(&settings, &source);
        redactions.extend(sql_path_literals(&sql));
        let source_for_work = source.clone();

        let result = run_blocking(move || {
            let conn = open_file_analytics_connection(&settings)?;
            create_source_view(&conn, &source_for_work)?;
            disable_external_access(&conn)?;
            let result = execute_select_query(&conn, &sql, Instant::now())?;
            Ok(FileAnalyticsQueryResponse {
                source: source_for_work.public,
                result,
                executed_sql: sql,
            })
        })
        .await;

        result.map_err(|error| redact_app_error(error, &redactions))
    }
}

fn validate_local_file_source(path: &str) -> Result<ValidatedFileSource, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "Local file path cannot be empty".into(),
        ));
    }

    let path_ref = Path::new(trimmed);
    if !path_ref.is_absolute() {
        return Err(AppError::Validation(
            "Local file path must be absolute".into(),
        ));
    }

    let kind = source_kind(path_ref)?;
    let metadata = fs::metadata(path_ref)
        .map_err(|_| AppError::Validation("Local file does not exist or cannot be read".into()))?;
    if !metadata.is_file() {
        return Err(AppError::Validation(
            "Local file path must point to a file".into(),
        ));
    }
    let size_bytes = metadata.len();
    let limit = size_limit(kind);
    if size_bytes > limit {
        return Err(AppError::Validation(format!(
            "Local {} file exceeds {} byte limit",
            source_kind_label(kind),
            limit
        )));
    }

    let canonical_path = fs::canonicalize(path_ref)
        .map_err(|_| AppError::Validation("Local file does not exist or cannot be read".into()))?;
    let canonical_path = canonical_path
        .to_str()
        .ok_or_else(|| AppError::Validation("Local file path must be valid UTF-8".into()))?
        .to_string();
    let file_name = path_ref
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Validation("Local file name must be valid UTF-8".into()))?
        .to_string();

    Ok(ValidatedFileSource {
        path: canonical_path,
        file_name,
        kind,
        size_bytes,
    })
}

fn source_kind(path: &Path) -> Result<FileAnalyticsSourceKind, AppError> {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("csv") => Ok(FileAnalyticsSourceKind::Csv),
        Some("parquet") => Ok(FileAnalyticsSourceKind::Parquet),
        Some("json") => Ok(FileAnalyticsSourceKind::Json),
        Some("ndjson") => Ok(FileAnalyticsSourceKind::Ndjson),
        _ => Err(AppError::Unsupported(
            "DuckDB file analytics supports .csv, .parquet, .json, and .ndjson files".into(),
        )),
    }
}

fn size_limit(kind: FileAnalyticsSourceKind) -> u64 {
    match kind {
        FileAnalyticsSourceKind::Parquet => PARQUET_FILE_LIMIT_BYTES,
        FileAnalyticsSourceKind::Csv
        | FileAnalyticsSourceKind::Json
        | FileAnalyticsSourceKind::Ndjson => TEXT_FILE_LIMIT_BYTES,
    }
}

fn source_kind_label(kind: FileAnalyticsSourceKind) -> &'static str {
    match kind {
        FileAnalyticsSourceKind::Csv => "CSV",
        FileAnalyticsSourceKind::Parquet => "Parquet",
        FileAnalyticsSourceKind::Json => "JSON",
        FileAnalyticsSourceKind::Ndjson => "NDJSON",
    }
}

fn normalize_preview_limit(limit: Option<u32>) -> Result<u32, AppError> {
    match limit.unwrap_or(DEFAULT_PREVIEW_LIMIT) {
        0 => Err(AppError::Validation(
            "Preview limit must be greater than 0".into(),
        )),
        value if value > MAX_PREVIEW_LIMIT => Err(AppError::Validation(format!(
            "Preview limit cannot exceed {MAX_PREVIEW_LIMIT}"
        ))),
        value => Ok(value),
    }
}

fn validate_file_analytics_sql(sql: &str) -> Result<(), AppError> {
    if sql.trim().is_empty() {
        return Err(AppError::Validation("SQL query cannot be empty".into()));
    }
    validate_supported_sql(sql)?;
    match first_sql_word(sql) {
        Some("SELECT" | "WITH" | "VALUES") => Ok(()),
        _ => Err(AppError::Unsupported(
            "DuckDB file analytics supports read-only SELECT queries".into(),
        )),
    }
}

fn create_source_view(
    conn: &Connection,
    source: &RegisteredFileAnalyticsSource,
) -> Result<(), AppError> {
    if matches!(
        source.public.kind,
        FileAnalyticsSourceKind::Json | FileAnalyticsSourceKind::Ndjson
    ) {
        return json::create_json_source_table(conn, source);
    }
    let sql = format!(
        "CREATE OR REPLACE TEMP TABLE {} AS SELECT * FROM {}",
        quote_identifier(&source.public.alias),
        source_read_function(source)
    );
    conn.execute(&sql, [])
        .map_err(|error| AppError::Database(error.to_string()))?;
    Ok(())
}

fn disable_external_access(conn: &Connection) -> Result<(), AppError> {
    conn.execute("SET enable_external_access = false", [])
        .map(|_| ())
        .map_err(|error| AppError::Database(error.to_string()))
}

fn source_read_function(source: &RegisteredFileAnalyticsSource) -> String {
    let path = quote_sql_string(&source.path);
    match source.public.kind {
        FileAnalyticsSourceKind::Csv => format!("read_csv_auto({path})"),
        FileAnalyticsSourceKind::Parquet => format!("read_parquet({path})"),
        FileAnalyticsSourceKind::Json => format!("read_json_auto({path})"),
        FileAnalyticsSourceKind::Ndjson => format!("read_ndjson_auto({path})"),
    }
}

fn quote_sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn execute_select_query(
    conn: &Connection,
    sql: &str,
    start: Instant,
) -> Result<QueryResult, AppError> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|error| AppError::Database(error.to_string()))?;
    let mut rows = stmt
        .query([])
        .map_err(|error| AppError::Database(error.to_string()))?;
    let statement = rows.as_ref();
    let column_count = statement.map(|stmt| stmt.column_count()).unwrap_or(0);
    let columns = statement
        .map(|stmt| duckdb_query_columns(stmt, column_count))
        .unwrap_or_default();
    let rows = collect_rows(&mut rows, column_count)?;
    let total_count = rows.len() as i64;

    Ok(QueryResult {
        columns,
        rows,
        total_count,
        execution_time_ms: start.elapsed().as_millis() as u64,
        query_type: QueryType::Select,
    })
}

fn redaction_needles(
    settings: &DuckdbConnectionSettings,
    source: &RegisteredFileAnalyticsSource,
) -> Vec<String> {
    vec![settings.path.clone(), source.path.clone()]
}

fn sql_path_literals(sql: &str) -> Vec<String> {
    let mut literals = Vec::new();
    let bytes = sql.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] != b'\'' {
            index += 1;
            continue;
        }

        let start = index;
        index += 1;
        let mut value = String::new();
        while index < bytes.len() {
            if bytes[index] == b'\'' {
                index += 1;
                if bytes.get(index) == Some(&b'\'') {
                    value.push('\'');
                    index += 1;
                    continue;
                }
                break;
            }
            value.push(bytes[index] as char);
            index += 1;
        }

        if Path::new(&value).is_absolute() {
            literals.push(value);
            literals.push(sql[start..index.min(sql.len())].to_string());
        }
    }

    literals
}

fn redact_app_error(error: AppError, needles: &[String]) -> AppError {
    match error {
        AppError::Connection(message) => AppError::Connection(redact_text(&message, needles)),
        AppError::Storage(message) => AppError::Storage(redact_text(&message, needles)),
        AppError::Encryption(message) => AppError::Encryption(redact_text(&message, needles)),
        AppError::Validation(message) => AppError::Validation(redact_text(&message, needles)),
        AppError::NotFound(message) => AppError::NotFound(redact_text(&message, needles)),
        AppError::Database(message) => AppError::Database(redact_text(&message, needles)),
        AppError::Unsupported(message) => AppError::Unsupported(redact_text(&message, needles)),
        AppError::Window(message) => AppError::Window(redact_text(&message, needles)),
        other => other,
    }
}

fn redact_text(message: &str, needles: &[String]) -> String {
    needles
        .iter()
        .filter(|needle| !needle.is_empty())
        .fold(message.to_string(), |acc, needle| {
            acc.replace(needle, "<local-file>")
        })
}
