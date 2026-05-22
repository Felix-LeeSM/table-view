use crate::error::AppError;
use crate::models::QueryType;

fn strip_leading_comments(sql: &str) -> &str {
    let mut s = sql.trim_start();
    loop {
        if s.starts_with("--") {
            if let Some(idx) = s.find('\n') {
                s = s[idx + 1..].trim_start();
            } else {
                return "";
            }
        } else if s.starts_with("/*") {
            if let Some(idx) = s.find("*/") {
                s = s[idx + 2..].trim_start();
            } else {
                return "";
            }
        } else {
            break;
        }
    }
    s
}

pub(super) fn strip_trailing_terminator(sql: &str) -> &str {
    sql.trim_end_matches(|c: char| c == ';' || c.is_whitespace())
}

pub(super) fn quote_identifier(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

pub(super) fn duckdb_query_type(sql: &str) -> QueryType {
    let words = leading_sql_words(sql, 2);
    let first = words.first().map(String::as_str).unwrap_or_default();
    match first {
        "SELECT" | "WITH" | "VALUES" | "SHOW" | "DESCRIBE" | "DESC" | "SUMMARIZE" | "EXPLAIN"
        | "PRAGMA" => QueryType::Select,
        "INSERT" | "UPDATE" | "DELETE" | "MERGE" => QueryType::Dml { rows_affected: 0 },
        _ => QueryType::Ddl,
    }
}

pub(super) fn validate_supported_sql(sql: &str) -> Result<(), AppError> {
    let stripped = strip_leading_comments(sql);
    let words = leading_sql_words(stripped, 2);
    match words.first().map(String::as_str) {
        Some("INSTALL" | "LOAD") => {
            return Err(AppError::Unsupported(
                "DuckDB extension install/load is not supported in this runtime slice".into(),
            ));
        }
        Some("COPY") => {
            return Err(AppError::Unsupported(
                "DuckDB COPY file import/export is not supported in this runtime slice".into(),
            ));
        }
        _ => {}
    }

    let upper = stripped.to_ascii_uppercase();
    for function in [
        "READ_CSV",
        "READ_CSV_AUTO",
        "READ_PARQUET",
        "READ_JSON",
        "READ_JSON_AUTO",
    ] {
        if contains_function_call(&upper, function) {
            return Err(AppError::Unsupported(
                "DuckDB CSV/Parquet/JSON analytics shortcuts are not supported in this runtime slice"
                    .into(),
            ));
        }
    }
    Ok(())
}

fn contains_function_call(sql: &str, function: &str) -> bool {
    let mut start = 0;
    while let Some(offset) = sql[start..].find(function) {
        let idx = start + offset;
        let before_ok = idx == 0
            || sql[..idx]
                .chars()
                .next_back()
                .is_none_or(|ch| !is_identifier_char(ch));
        let after_idx = idx + function.len();
        let mut chars = sql[after_idx..].chars();
        let mut after_ok = false;
        for ch in &mut chars {
            if ch.is_whitespace() {
                continue;
            }
            after_ok = ch == '(';
            break;
        }
        if before_ok && after_ok {
            return true;
        }
        start = after_idx;
    }
    false
}

fn leading_sql_words(sql: &str, limit: usize) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut words = Vec::new();
    let mut index = 0;

    while words.len() < limit {
        index = skip_whitespace_and_comments(bytes, index);
        if index >= bytes.len() || !is_word_start(bytes[index]) {
            break;
        }

        let start = index;
        index += 1;
        while index < bytes.len() && is_word_continue(bytes[index]) {
            index += 1;
        }
        words.push(sql[start..index].to_ascii_uppercase());
    }

    words
}

fn skip_whitespace_and_comments(bytes: &[u8], mut index: usize) -> usize {
    while index < bytes.len() {
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }

        if bytes.get(index) == Some(&b'-') && bytes.get(index + 1) == Some(&b'-') {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }

        if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'*') {
            index += 2;
            while index + 1 < bytes.len() {
                if bytes[index] == b'*' && bytes[index + 1] == b'/' {
                    index += 2;
                    break;
                }
                index += 1;
            }
            continue;
        }

        break;
    }

    index
}

fn is_word_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic()
}

fn is_word_continue(byte: u8) -> bool {
    is_word_start(byte) || byte.is_ascii_digit() || byte == b'_'
}

fn is_identifier_char(ch: char) -> bool {
    ch == '_' || ch == '$' || ch.is_ascii_alphanumeric()
}
