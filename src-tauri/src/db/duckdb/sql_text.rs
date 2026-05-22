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
    let first = first_sql_word(sql).unwrap_or_default();
    match first {
        "SELECT" | "WITH" | "VALUES" | "SHOW" | "DESCRIBE" | "DESC" | "SUMMARIZE" | "EXPLAIN"
        | "PRAGMA" => QueryType::Select,
        "INSERT" | "UPDATE" | "DELETE" | "MERGE" => QueryType::Dml { rows_affected: 0 },
        _ => QueryType::Ddl,
    }
}

pub(super) fn first_sql_word(sql: &str) -> Option<&'static str> {
    let stripped = strip_leading_comments(sql);
    let words = leading_sql_words(stripped, 1);
    let word = words.first()?.as_str();
    match word {
        "SELECT" => Some("SELECT"),
        "WITH" => Some("WITH"),
        "VALUES" => Some("VALUES"),
        "SHOW" => Some("SHOW"),
        "DESCRIBE" => Some("DESCRIBE"),
        "DESC" => Some("DESC"),
        "SUMMARIZE" => Some("SUMMARIZE"),
        "EXPLAIN" => Some("EXPLAIN"),
        "PRAGMA" => Some("PRAGMA"),
        "INSERT" => Some("INSERT"),
        "UPDATE" => Some("UPDATE"),
        "DELETE" => Some("DELETE"),
        "MERGE" => Some("MERGE"),
        "INSTALL" => Some("INSTALL"),
        "LOAD" => Some("LOAD"),
        "COPY" => Some("COPY"),
        _ => None,
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
    if contains_string_table_reference(stripped) {
        return Err(AppError::Unsupported(
            "DuckDB CSV/Parquet/JSON local file replacement scans are not supported in this runtime slice".into(),
        ));
    }

    if contains_prefixed_function_call(&upper, "READ_")
        || contains_quoted_prefixed_function_call(&upper, "READ_")
    {
        return Err(AppError::Unsupported(
            "DuckDB CSV/Parquet/JSON local file access functions are not supported in this runtime slice".into(),
        ));
    }

    for function in [
        "GLOB",
        "SNIFF_CSV",
        "PARQUET_METADATA",
        "PARQUET_SCHEMA",
        "PARQUET_FILE_METADATA",
        "PARQUET_KV_METADATA",
    ] {
        if contains_function_call(&upper, function)
            || contains_quoted_function_call(&upper, function)
        {
            return Err(AppError::Unsupported(
                "DuckDB CSV/Parquet/JSON local file access functions are not supported in this runtime slice".into(),
            ));
        }
    }
    Ok(())
}

fn contains_string_table_reference(sql: &str) -> bool {
    let bytes = sql.as_bytes();
    let mut index = 0;
    let mut previous_word = String::new();

    while index < bytes.len() {
        index = skip_whitespace_and_comments(bytes, index);
        if index >= bytes.len() {
            break;
        }

        match bytes[index] {
            b'\'' => {
                if matches!(previous_word.as_str(), "FROM" | "JOIN") {
                    return true;
                }
                index = skip_sql_string(bytes, index);
            }
            byte if is_word_start(byte) => {
                let start = index;
                index += 1;
                while index < bytes.len() && is_word_continue(bytes[index]) {
                    index += 1;
                }
                previous_word = sql[start..index].to_ascii_uppercase();
            }
            _ => {
                index += 1;
            }
        }
    }

    false
}

fn contains_quoted_prefixed_function_call(sql: &str, prefix: &str) -> bool {
    let mut start = 0;
    while let Some(offset) = sql[start..].find('"') {
        let idx = start + offset;
        let name_start = idx + 1;
        if !sql[name_start..].starts_with(prefix) {
            start = name_start;
            continue;
        }

        let Some(relative_end) = sql[name_start..].find('"') else {
            break;
        };
        let end = name_start + relative_end;
        if sql[name_start..end].chars().all(is_identifier_char) && is_followed_by_call(sql, end + 1)
        {
            return true;
        }
        start = end + 1;
    }
    false
}

fn contains_prefixed_function_call(sql: &str, prefix: &str) -> bool {
    let mut start = 0;
    while let Some(offset) = sql[start..].find(prefix) {
        let idx = start + offset;
        let before_ok = idx == 0
            || sql[..idx]
                .chars()
                .next_back()
                .is_none_or(|ch| !is_identifier_char(ch));
        if !before_ok {
            start = idx + prefix.len();
            continue;
        }

        let mut after_idx = idx + prefix.len();
        while after_idx < sql.len() {
            let Some(ch) = sql[after_idx..].chars().next() else {
                break;
            };
            if !is_identifier_char(ch) {
                break;
            }
            after_idx += ch.len_utf8();
        }

        let mut chars = sql[after_idx..].chars();
        for ch in &mut chars {
            if ch.is_whitespace() {
                continue;
            }
            if ch == '(' {
                return true;
            }
            break;
        }
        start = after_idx;
    }
    false
}

fn contains_quoted_function_call(sql: &str, function: &str) -> bool {
    let quoted = format!("\"{function}\"");
    let mut start = 0;
    while let Some(offset) = sql[start..].find(&quoted) {
        let idx = start + offset;
        if is_followed_by_call(sql, idx + quoted.len()) {
            return true;
        }
        start = idx + quoted.len();
    }
    false
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

fn is_followed_by_call(sql: &str, index: usize) -> bool {
    let mut chars = sql[index..].chars();
    for ch in &mut chars {
        if ch.is_whitespace() {
            continue;
        }
        return ch == '(';
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

fn is_word_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic()
}

fn is_word_continue(byte: u8) -> bool {
    is_word_start(byte) || byte.is_ascii_digit() || byte == b'_'
}

fn is_identifier_char(ch: char) -> bool {
    ch == '_' || ch == '$' || ch.is_ascii_alphanumeric()
}
