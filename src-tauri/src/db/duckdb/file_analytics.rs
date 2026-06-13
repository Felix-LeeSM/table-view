use std::fs;
use std::path::Path;
use std::time::Instant;

use duckdb::Connection;

use crate::error::AppError;
use crate::models::{
    FileAnalyticsPreview, FileAnalyticsQueryResponse, FileAnalyticsSource, FileAnalyticsSourceKind,
    FileAnalyticsSourceMetadata, QueryColumn, QueryResult, QueryType,
};

use super::connection::{
    open_file_analytics_connection, run_blocking, DuckdbAdapter, RegisteredFileAnalyticsSource,
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

    pub async fn list_file_analytics_source_metadata(
        &self,
    ) -> Result<Vec<FileAnalyticsSourceMetadata>, AppError> {
        let settings = self.active_settings().await?;
        let sources = self.list_registered_file_analytics_sources().await?;
        let mut metadata = Vec::with_capacity(sources.len());

        for source in sources {
            let source = refresh_registered_file_source(&source)?;
            let redactions = redaction_needles(&settings.path, &source);
            let source_for_work = source.clone();
            let item = run_blocking(move || {
                let conn = open_file_analytics_connection()?;
                create_source_view(&conn, &source_for_work)?;
                disable_external_access(&conn)?;
                let preview_sql = format!(
                    "SELECT * FROM {} LIMIT 100",
                    quote_identifier(&source_for_work.public.alias)
                );
                let columns = source_shape_columns(&conn, &source_for_work.public.alias)?;
                Ok(FileAnalyticsSourceMetadata {
                    source: source_for_work.public,
                    columns,
                    preview_sql,
                })
            })
            .await
            .map_err(|error| redact_app_error(error, &redactions))?;
            metadata.push(item);
        }

        Ok(metadata)
    }

    pub async fn clear_file_analytics_sources(&self) -> Result<(), AppError> {
        self.clear_registered_file_analytics_sources().await
    }

    pub async fn preview_file_analytics_source(
        &self,
        source_id: &str,
        limit: Option<u32>,
    ) -> Result<FileAnalyticsPreview, AppError> {
        let source = self.get_file_analytics_source(source_id).await?;
        let settings = self.active_settings().await?;
        let limit = normalize_preview_limit(limit)?;
        let source = refresh_registered_file_source(&source)?;
        let redactions = redaction_needles(&settings.path, &source);
        let source_for_work = source.clone();

        let result = run_blocking(move || {
            let conn = open_file_analytics_connection()?;
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
        let source = self.get_file_analytics_source(source_id).await?;
        let settings = self.active_settings().await?;
        let source = refresh_registered_file_source(&source)?;
        validate_file_analytics_sql(&sql, &source.public.alias)?;
        let mut redactions = redaction_needles(&settings.path, &source);
        redactions.extend(sql_path_literals(&sql));
        let source_for_work = source.clone();

        let result = run_blocking(move || {
            let conn = open_file_analytics_connection()?;
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

    pub(super) async fn execute_file_analytics_global_query(
        &self,
        sql: &str,
        start: Instant,
    ) -> Result<Option<QueryResult>, AppError> {
        let sources = self.list_registered_file_analytics_sources().await?;
        let referenced_sources = sources
            .into_iter()
            .filter(|source| references_source_alias(sql, &source.public.alias))
            .map(|source| refresh_registered_file_source(&source))
            .collect::<Result<Vec<_>, _>>()?;
        if referenced_sources.is_empty() {
            return Ok(None);
        }
        if !matches!(first_sql_word(sql), Some("SELECT")) {
            return Err(AppError::Unsupported(
                "DuckDB file analytics supports read-only SELECT queries".into(),
            ));
        }

        let settings = self.active_settings().await?;
        let mut redactions = vec![settings.path];
        redactions.extend(referenced_sources.iter().map(|source| source.path.clone()));
        redactions.extend(sql_path_literals(sql));
        let sql = sql.to_string();

        let result = run_blocking(move || {
            let conn = open_file_analytics_connection()?;
            for source in &referenced_sources {
                create_source_view(&conn, source)?;
            }
            disable_external_access(&conn)?;
            execute_select_query(&conn, &sql, start)
        })
        .await;

        result
            .map(Some)
            .map_err(|error| redact_app_error(error, &redactions))
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

fn validate_file_analytics_sql(sql: &str, source_alias: &str) -> Result<(), AppError> {
    if sql.trim().is_empty() {
        return Err(AppError::Validation("SQL query cannot be empty".into()));
    }
    validate_supported_sql(sql)?;
    match first_sql_word(sql) {
        Some("SELECT") => {}
        _ => Err(AppError::Unsupported(
            "DuckDB file analytics supports read-only SELECT queries".into(),
        ))?,
    }
    if !references_source_alias(sql, source_alias) {
        return Err(AppError::Unsupported(
            "DuckDB file analytics queries must read from the registered source alias".into(),
        ));
    }
    Ok(())
}

fn references_source_alias(sql: &str, source_alias: &str) -> bool {
    let bytes = sql.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        index = skip_whitespace_and_comments(bytes, index);
        if index >= bytes.len() {
            break;
        }

        match bytes[index] {
            b'\'' => index = skip_sql_string(bytes, index),
            b'"' => index = skip_quoted_identifier(bytes, index).1,
            byte if is_word_start(byte) => {
                let start = index;
                index += 1;
                while index < bytes.len() && is_word_continue(bytes[index]) {
                    index += 1;
                }
                let word = sql[start..index].to_ascii_uppercase();
                if matches!(word.as_str(), "FROM" | "JOIN")
                    && table_reference_contains_alias(sql, index, source_alias)
                {
                    return true;
                }
            }
            _ => index += 1,
        }
    }

    false
}

fn table_reference_contains_alias(sql: &str, start: usize, source_alias: &str) -> bool {
    let bytes = sql.as_bytes();
    let mut index = skip_whitespace_and_comments(bytes, start);
    if index >= bytes.len() || bytes[index] == b'(' {
        return false;
    }

    if let Some((word, next_index)) = read_word(sql, index) {
        if word.eq_ignore_ascii_case("LATERAL") {
            index = skip_whitespace_and_comments(bytes, next_index);
        }
    }

    loop {
        index = skip_whitespace_and_comments(bytes, index);
        if index >= bytes.len() {
            return false;
        }

        let (identifier, next_index, quoted) = match bytes[index] {
            b'"' => {
                let (identifier, next_index) = skip_quoted_identifier(bytes, index);
                (identifier, next_index, true)
            }
            byte if is_word_start(byte) => {
                let Some((identifier, next_index)) = read_word(sql, index) else {
                    return false;
                };
                (identifier, next_index, false)
            }
            _ => return false,
        };

        let matches_alias = if quoted {
            identifier == source_alias
        } else {
            identifier.eq_ignore_ascii_case(source_alias)
        };
        if matches_alias {
            return true;
        }

        index = skip_whitespace_and_comments(bytes, next_index);
        if bytes.get(index) != Some(&b'.') {
            return false;
        }
        index += 1;
    }
}

fn read_word(sql: &str, start: usize) -> Option<(String, usize)> {
    let bytes = sql.as_bytes();
    if !bytes.get(start).copied().is_some_and(is_word_start) {
        return None;
    }
    let mut index = start + 1;
    while index < bytes.len() && is_word_continue(bytes[index]) {
        index += 1;
    }
    Some((sql[start..index].to_string(), index))
}

fn skip_whitespace_and_comments(bytes: &[u8], mut index: usize) -> usize {
    loop {
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if bytes.get(index..index + 2) == Some(b"--") {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if bytes.get(index..index + 2) == Some(b"/*") {
            index += 2;
            while index + 1 < bytes.len() && bytes.get(index..index + 2) != Some(b"*/") {
                index += 1;
            }
            index = (index + 2).min(bytes.len());
            continue;
        }
        return index;
    }
}

fn skip_sql_string(bytes: &[u8], mut index: usize) -> usize {
    index += 1;
    while index < bytes.len() {
        if bytes[index] == b'\'' {
            index += 1;
            if bytes.get(index) == Some(&b'\'') {
                index += 1;
                continue;
            }
            break;
        }
        index += 1;
    }
    index
}

fn skip_quoted_identifier(bytes: &[u8], mut index: usize) -> (String, usize) {
    let mut identifier = String::new();
    index += 1;
    while index < bytes.len() {
        if bytes[index] == b'"' {
            index += 1;
            if bytes.get(index) == Some(&b'"') {
                identifier.push('"');
                index += 1;
                continue;
            }
            break;
        }
        identifier.push(bytes[index] as char);
        index += 1;
    }
    (identifier, index)
}

fn is_word_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_word_continue(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn refresh_registered_file_source(
    source: &RegisteredFileAnalyticsSource,
) -> Result<RegisteredFileAnalyticsSource, AppError> {
    let validated = validate_local_file_source(&source.path)?;
    if validated.path != source.path || validated.kind != source.public.kind {
        return Err(AppError::Validation(
            "Local file source changed since registration".into(),
        ));
    }

    let mut refreshed = source.clone();
    refreshed.public.file_name = validated.file_name;
    refreshed.public.size_bytes = validated.size_bytes;
    Ok(refreshed)
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

fn source_shape_columns(
    conn: &Connection,
    source_alias: &str,
) -> Result<Vec<QueryColumn>, AppError> {
    let shape_sql = format!("SELECT * FROM {} LIMIT 0", quote_identifier(source_alias));
    let mut stmt = conn
        .prepare(&shape_sql)
        .map_err(|error| AppError::Database(error.to_string()))?;
    let rows = stmt
        .query([])
        .map_err(|error| AppError::Database(error.to_string()))?;
    let statement = rows.as_ref();
    let column_count = statement.map(|stmt| stmt.column_count()).unwrap_or(0);
    Ok(statement
        .map(|stmt| duckdb_query_columns(stmt, column_count))
        .unwrap_or_default())
}

fn redaction_needles(settings_path: &str, source: &RegisteredFileAnalyticsSource) -> Vec<String> {
    vec![settings_path.to_string(), source.path.clone()]
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
