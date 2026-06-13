use crate::models::QueryType;

pub(super) fn strip_trailing_terminator(sql: &str) -> &str {
    sql.trim_end_matches(|c: char| c == ';' || c.is_whitespace())
}

pub(super) fn sqlite_query_type(sql: &str) -> QueryType {
    let stripped = strip_leading_comments(sql);
    let verb = first_sql_word(stripped, 0)
        .map(|(word, _)| word)
        .unwrap_or_default();
    let verb = if verb == "WITH" {
        sqlite_with_main_verb(stripped).unwrap_or_else(|| "UNKNOWN".to_string())
    } else {
        verb
    };

    match verb.as_str() {
        "SELECT" | "VALUES" | "PRAGMA" | "EXPLAIN" => QueryType::Select,
        "INSERT" | "UPDATE" | "DELETE" | "REPLACE" => QueryType::Dml { rows_affected: 0 },
        _ => QueryType::Ddl,
    }
}

pub(super) fn sqlite_invokes_load_extension(sql: &str) -> bool {
    let bytes = sql.as_bytes();
    let mut idx = 0;
    while idx < bytes.len() {
        match bytes[idx] {
            b'\'' => {
                idx = skip_quoted(bytes, idx, bytes[idx]).unwrap_or(bytes.len());
            }
            b'"' | b'`' => {
                let Some((identifier, end)) = read_quoted_identifier(bytes, idx, bytes[idx]) else {
                    return false;
                };
                if is_load_extension_call(sql, &identifier, end) {
                    return true;
                }
                idx = end;
            }
            b'[' => {
                let Some((identifier, end)) = read_bracket_identifier(bytes, idx) else {
                    return false;
                };
                if is_load_extension_call(sql, &identifier, end) {
                    return true;
                }
                idx = end;
            }
            b'-' if bytes.get(idx + 1) == Some(&b'-') => {
                idx += 2;
                while idx < bytes.len() && bytes[idx] != b'\n' {
                    idx += 1;
                }
            }
            b'/' if bytes.get(idx + 1) == Some(&b'*') => {
                idx += 2;
                while idx + 1 < bytes.len() {
                    if bytes[idx] == b'*' && bytes[idx + 1] == b'/' {
                        idx += 2;
                        break;
                    }
                    idx += 1;
                }
            }
            byte if is_word_start(byte) => {
                let start = idx;
                idx += 1;
                while idx < bytes.len() && is_word_continue(bytes[idx]) {
                    idx += 1;
                }
                if sql[start..idx].eq_ignore_ascii_case("load_extension") {
                    let next = skip_sql_whitespace_and_comments(sql, idx);
                    if bytes.get(next) == Some(&b'(') {
                        return true;
                    }
                }
            }
            _ => idx += 1,
        }
    }
    false
}

fn is_load_extension_call(sql: &str, identifier: &[u8], end: usize) -> bool {
    if !ascii_eq_ignore_case(identifier, b"load_extension") {
        return false;
    }
    let next = skip_sql_whitespace_and_comments(sql, end);
    sql.as_bytes().get(next) == Some(&b'(')
}

fn read_quoted_identifier(bytes: &[u8], start: usize, quote: u8) -> Option<(Vec<u8>, usize)> {
    let mut value = Vec::new();
    let mut idx = start + 1;
    while idx < bytes.len() {
        if bytes[idx] == quote {
            if bytes.get(idx + 1) == Some(&quote) {
                value.push(quote);
                idx += 2;
                continue;
            }
            return Some((value, idx + 1));
        }
        value.push(bytes[idx]);
        idx += 1;
    }
    None
}

fn read_bracket_identifier(bytes: &[u8], start: usize) -> Option<(Vec<u8>, usize)> {
    let mut value = Vec::new();
    let mut idx = start + 1;
    while idx < bytes.len() {
        if bytes[idx] == b']' {
            if bytes.get(idx + 1) == Some(&b']') {
                value.push(b']');
                idx += 2;
                continue;
            }
            return Some((value, idx + 1));
        }
        value.push(bytes[idx]);
        idx += 1;
    }
    None
}

fn ascii_eq_ignore_case(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .all(|(l, r)| l.eq_ignore_ascii_case(r))
}

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

fn sqlite_with_main_verb(sql: &str) -> Option<String> {
    let (_, mut idx) = first_sql_word(sql, 0)?;

    if let Some((word, next)) = first_sql_word(sql, idx) {
        if word == "RECURSIVE" {
            idx = next;
        }
    }

    loop {
        idx = skip_sql_identifier(sql, idx)?;
        idx = skip_sql_whitespace_and_comments(sql, idx);
        if sql.as_bytes().get(idx) == Some(&b'(') {
            idx = skip_balanced_parentheses(sql, idx)?;
        }

        let (as_word, after_as) = first_sql_word(sql, idx)?;
        if as_word != "AS" {
            return None;
        }
        idx = after_as;

        let saved = idx;
        if let Some((word, after_word)) = first_sql_word(sql, idx) {
            if word == "MATERIALIZED" {
                idx = after_word;
            } else if word == "NOT" {
                if let Some((materialized, after_materialized)) = first_sql_word(sql, after_word) {
                    if materialized == "MATERIALIZED" {
                        idx = after_materialized;
                    } else {
                        idx = saved;
                    }
                } else {
                    idx = saved;
                }
            }
        }

        idx = skip_sql_whitespace_and_comments(sql, idx);
        if sql.as_bytes().get(idx) != Some(&b'(') {
            return None;
        }
        idx = skip_balanced_parentheses(sql, idx)?;
        idx = skip_sql_whitespace_and_comments(sql, idx);

        if sql.as_bytes().get(idx) == Some(&b',') {
            idx += 1;
            continue;
        }

        return first_sql_word(sql, idx).map(|(word, _)| word);
    }
}

fn first_sql_word(sql: &str, start: usize) -> Option<(String, usize)> {
    let bytes = sql.as_bytes();
    let mut idx = skip_sql_whitespace_and_comments(sql, start);
    if idx >= bytes.len() || !is_word_start(bytes[idx]) {
        return None;
    }
    let start = idx;
    idx += 1;
    while idx < bytes.len() && is_word_continue(bytes[idx]) {
        idx += 1;
    }
    Some((sql[start..idx].to_ascii_uppercase(), idx))
}

fn skip_sql_identifier(sql: &str, start: usize) -> Option<usize> {
    let bytes = sql.as_bytes();
    let idx = skip_sql_whitespace_and_comments(sql, start);
    match bytes.get(idx).copied()? {
        b'"' | b'`' => skip_quoted(bytes, idx, bytes[idx]),
        b'[' => {
            let mut i = idx + 1;
            while i < bytes.len() {
                if bytes[i] == b']' {
                    return Some(i + 1);
                }
                i += 1;
            }
            None
        }
        byte if is_word_start(byte) => {
            let mut i = idx + 1;
            while i < bytes.len() && is_word_continue(bytes[i]) {
                i += 1;
            }
            Some(i)
        }
        _ => None,
    }
}

fn skip_balanced_parentheses(sql: &str, start: usize) -> Option<usize> {
    let bytes = sql.as_bytes();
    if bytes.get(start) != Some(&b'(') {
        return None;
    }

    let mut depth = 0usize;
    let mut idx = start;
    while idx < bytes.len() {
        match bytes[idx] {
            b'\'' => idx = skip_quoted(bytes, idx, b'\'')?,
            b'"' | b'`' => idx = skip_quoted(bytes, idx, bytes[idx])?,
            b'[' => {
                idx += 1;
                while idx < bytes.len() && bytes[idx] != b']' {
                    idx += 1;
                }
                if idx >= bytes.len() {
                    return None;
                }
                idx += 1;
            }
            b'-' if bytes.get(idx + 1) == Some(&b'-') => {
                idx += 2;
                while idx < bytes.len() && bytes[idx] != b'\n' {
                    idx += 1;
                }
            }
            b'/' if bytes.get(idx + 1) == Some(&b'*') => {
                idx += 2;
                while idx + 1 < bytes.len() {
                    if bytes[idx] == b'*' && bytes[idx + 1] == b'/' {
                        idx += 2;
                        break;
                    }
                    idx += 1;
                }
            }
            b'(' => {
                depth += 1;
                idx += 1;
            }
            b')' => {
                depth = depth.checked_sub(1)?;
                idx += 1;
                if depth == 0 {
                    return Some(idx);
                }
            }
            _ => idx += 1,
        }
    }
    None
}

fn skip_quoted(bytes: &[u8], start: usize, quote: u8) -> Option<usize> {
    let mut idx = start + 1;
    while idx < bytes.len() {
        if bytes[idx] == quote {
            if bytes.get(idx + 1) == Some(&quote) {
                idx += 2;
                continue;
            }
            return Some(idx + 1);
        }
        idx += 1;
    }
    None
}

fn skip_sql_whitespace_and_comments(sql: &str, start: usize) -> usize {
    let bytes = sql.as_bytes();
    let mut idx = start;
    loop {
        while idx < bytes.len() && bytes[idx].is_ascii_whitespace() {
            idx += 1;
        }
        if bytes.get(idx) == Some(&b'-') && bytes.get(idx + 1) == Some(&b'-') {
            idx += 2;
            while idx < bytes.len() && bytes[idx] != b'\n' {
                idx += 1;
            }
            continue;
        }
        if bytes.get(idx) == Some(&b'/') && bytes.get(idx + 1) == Some(&b'*') {
            idx += 2;
            while idx + 1 < bytes.len() {
                if bytes[idx] == b'*' && bytes[idx + 1] == b'/' {
                    idx += 2;
                    break;
                }
                idx += 1;
            }
            continue;
        }
        break;
    }
    idx
}

fn is_word_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_word_continue(byte: u8) -> bool {
    is_word_start(byte) || byte.is_ascii_digit() || byte == b'$'
}
