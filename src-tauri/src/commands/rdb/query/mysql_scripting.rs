use crate::error::AppError;
use crate::models::DatabaseType;

#[derive(Clone, Copy)]
enum MysqlScriptingFeature {
    Delimiter,
    LoadData,
    StoredRoutine,
    ControlFlow,
    Call,
    NestedComment,
}

/// Cap the mutual recursion between `mysql_scripting_feature` and
/// `leading_executable_comment_feature`. MySQL executable comments
/// (`/*! ... */`) do not nest, so every real query resolves within a couple of
/// levels; a `/*!`-repeated payload otherwise adds one level per 3 bytes and
/// overflows the worker stack (#1557). At the cap we fail closed (treat the
/// input as an unsupported scripting feature) rather than pass it to execution.
const MAX_COMMENT_DEPTH: usize = 16;

pub(super) fn validate_mysql_scripting_boundary(
    sql: &str,
    db_type: &DatabaseType,
) -> Result<(), AppError> {
    if !matches!(db_type, DatabaseType::Mysql | DatabaseType::Mariadb) {
        return Ok(());
    }

    match mysql_scripting_feature(sql) {
        Some(MysqlScriptingFeature::Delimiter) => {
            Err(AppError::Unsupported(
                "DELIMITER is a mysql-client directive and is not supported in the query editor. Submit a single server SQL statement without DELIMITER; stored routine body parsing is not implemented.".into(),
            ))
        }
        Some(MysqlScriptingFeature::LoadData) => Err(AppError::Unsupported(
            "LOAD DATA is not supported in the query editor. Use an external MySQL client or import workflow; this app does not provide an explicit file-import confirmation path yet.".into(),
        )),
        Some(MysqlScriptingFeature::StoredRoutine) => Err(AppError::Unsupported(
            "MySQL stored routine and event bodies are not supported in the query editor. Use a dedicated MySQL client for CREATE PROCEDURE, CREATE FUNCTION, or CREATE EVENT scripts.".into(),
        )),
        Some(MysqlScriptingFeature::ControlFlow) => Err(AppError::Unsupported(
            "MySQL routine control-flow scripting is not supported in the query editor. Submit a single server SQL statement without IF/LOOP routine-body fragments.".into(),
        )),
        Some(MysqlScriptingFeature::Call) => Err(AppError::Unsupported(
            "MySQL-family CALL support is limited to a narrow routine name plus scalar literal, DEFAULT, NULL, boolean, or user-variable arguments. Function calls, expressions, subqueries, system variables, and routine body authoring are not supported in the query editor.".into(),
        )),
        Some(MysqlScriptingFeature::NestedComment) => Err(AppError::Unsupported(
            "MySQL executable comment nesting is too deep to analyze safely and is not supported in the query editor. Remove nested /*! ... */ comment layers and submit a single server SQL statement.".into(),
        )),
        None => Ok(()),
    }
}

pub(super) fn validate_mysql_scripting_boundary_batch(
    statements: &[String],
    db_type: &DatabaseType,
) -> Result<(), AppError> {
    for sql in statements {
        validate_mysql_scripting_boundary(sql, db_type)?;
    }
    Ok(())
}

fn mysql_scripting_feature(sql: &str) -> Option<MysqlScriptingFeature> {
    mysql_scripting_feature_at(sql, 0)
}

fn mysql_scripting_feature_at(sql: &str, depth: usize) -> Option<MysqlScriptingFeature> {
    if depth >= MAX_COMMENT_DEPTH {
        // Fail closed: refuse to keep unwinding a pathologically nested comment.
        return Some(MysqlScriptingFeature::NestedComment);
    }

    if let Some(feature) = leading_executable_comment_feature(sql, depth) {
        return Some(feature);
    }

    let words = leading_sql_words(sql, 2);
    if words.first().is_some_and(|word| word == "DELIMITER") {
        return Some(MysqlScriptingFeature::Delimiter);
    }
    if words.first().is_some_and(|word| word == "LOAD")
        && words.get(1).is_some_and(|word| word == "DATA")
    {
        return Some(MysqlScriptingFeature::LoadData);
    }
    if words.first().is_some_and(|word| word == "CREATE")
        && words
            .get(1)
            .is_some_and(|word| is_stored_routine_create_target(word))
    {
        return Some(MysqlScriptingFeature::StoredRoutine);
    }
    if words
        .first()
        .is_some_and(|word| is_routine_control_flow_word(word))
    {
        return Some(MysqlScriptingFeature::ControlFlow);
    }
    if words.first().is_some_and(|word| word == "CALL") && !is_narrow_call_statement(sql) {
        return Some(MysqlScriptingFeature::Call);
    }

    None
}

fn is_narrow_call_statement(sql: &str) -> bool {
    let bytes = sql.as_bytes();
    let keyword = match read_word(sql, skip_whitespace_and_comments(bytes, 0)) {
        Some(word) if word.word.eq_ignore_ascii_case("CALL") => word,
        _ => return true,
    };

    let mut index = skip_whitespace_and_comments(bytes, keyword.end);
    let name = match read_routine_name(sql, index) {
        Some(name) => name,
        None => return false,
    };
    index = skip_whitespace_and_comments(bytes, name.end);

    if bytes.get(index) != Some(&b'(') {
        return false;
    }
    let args = match read_call_arguments(sql, index + 1) {
        Some(args) => args,
        None => return false,
    };

    index = skip_whitespace_and_comments(bytes, args.end);
    if bytes.get(index) == Some(&b';') {
        index = skip_whitespace_and_comments(bytes, index + 1);
    }

    index >= bytes.len()
}

fn leading_executable_comment_feature(sql: &str, depth: usize) -> Option<MysqlScriptingFeature> {
    let bytes = sql.as_bytes();
    let mut index = 0;

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

        if bytes.get(index) == Some(&b'#') {
            index += 1;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }

        if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'*') {
            let close = find_block_comment_close(bytes, index + 2);
            if let Some(mut body_start) = executable_comment_body_start(bytes, index) {
                while body_start < bytes.len() && bytes[body_start].is_ascii_digit() {
                    body_start += 1;
                }
                let body_end = close.unwrap_or(bytes.len());
                if let Some(feature) =
                    mysql_scripting_feature_at(&sql[body_start..body_end], depth + 1)
                {
                    return Some(feature);
                }
            }
            if let Some(close_index) = close {
                index = close_index + 2;
                continue;
            }
            return None;
        }

        break;
    }

    None
}

fn executable_comment_body_start(bytes: &[u8], index: usize) -> Option<usize> {
    if bytes.get(index) == Some(&b'/')
        && bytes.get(index + 1) == Some(&b'*')
        && bytes.get(index + 2) == Some(&b'!')
    {
        return Some(index + 3);
    }
    if bytes.get(index) == Some(&b'/')
        && bytes.get(index + 1) == Some(&b'*')
        && matches!(bytes.get(index + 2), Some(b'M') | Some(b'm'))
        && bytes.get(index + 3) == Some(&b'!')
    {
        return Some(index + 4);
    }
    None
}

fn find_block_comment_close(bytes: &[u8], mut index: usize) -> Option<usize> {
    while index + 1 < bytes.len() {
        if bytes[index] == b'*' && bytes[index + 1] == b'/' {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn leading_sql_words(sql: &str, limit: usize) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut words = Vec::new();
    let mut index = 0;

    while words.len() < limit {
        index = skip_whitespace_and_comments(bytes, index);
        let Some(word) = read_word(sql, index) else {
            break;
        };
        index = word.end;
        words.push(word.word.to_ascii_uppercase());
    }

    words
}

struct Word<'a> {
    word: &'a str,
    end: usize,
}

fn read_word(sql: &str, start: usize) -> Option<Word<'_>> {
    let bytes = sql.as_bytes();
    if start >= bytes.len() || !is_word_start(bytes[start]) {
        return None;
    }

    let mut index = start + 1;
    while index < bytes.len() && is_word_continue(bytes[index]) {
        index += 1;
    }

    Some(Word {
        word: &sql[start..index],
        end: index,
    })
}

struct Span {
    end: usize,
}

fn read_routine_name(sql: &str, start: usize) -> Option<Span> {
    let bytes = sql.as_bytes();
    let mut index = start;
    let mut segment_count = 0;

    loop {
        let segment = match read_identifier_segment(sql, index) {
            Some(segment) => segment,
            None if segment_count > 0 => return Some(Span { end: index }),
            None => return None,
        };

        segment_count += 1;
        index = skip_whitespace_and_comments(bytes, segment.end);

        if bytes.get(index) != Some(&b'.') {
            return Some(Span { end: index });
        }
        index = skip_whitespace_and_comments(bytes, index + 1);
    }
}

fn read_identifier_segment(sql: &str, start: usize) -> Option<Span> {
    let bytes = sql.as_bytes();
    if bytes.get(start) == Some(&b'`') {
        return skip_backtick_identifier(bytes, start).map(|end| Span { end });
    }
    read_word(sql, start).map(|word| Span { end: word.end })
}

fn read_call_arguments(sql: &str, start: usize) -> Option<Span> {
    let bytes = sql.as_bytes();
    let mut index = skip_whitespace_and_comments(bytes, start);
    if bytes.get(index) == Some(&b')') {
        return Some(Span { end: index + 1 });
    }

    while index < bytes.len() {
        let arg_start = index;
        let mut quoted = false;

        while index < bytes.len() {
            match bytes[index] {
                b'\'' | b'"' => {
                    index = skip_quoted_string(bytes, index, bytes[index])?;
                    quoted = true;
                }
                b'`' => {
                    index = skip_backtick_identifier(bytes, index)?;
                }
                b',' | b')' => break,
                _ => index += 1,
            }
        }

        let arg = sql[arg_start..index].trim();
        if !is_narrow_call_argument(arg, quoted) {
            return None;
        }

        match bytes.get(index) {
            Some(b',') => {
                index = skip_whitespace_and_comments(bytes, index + 1);
                if bytes.get(index) == Some(&b')') {
                    return None;
                }
            }
            Some(b')') => return Some(Span { end: index + 1 }),
            _ => return None,
        }
    }

    None
}

fn skip_quoted_string(bytes: &[u8], start: usize, quote: u8) -> Option<usize> {
    let mut index = start + 1;
    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index += 2;
            continue;
        }
        if bytes[index] == quote {
            if bytes.get(index + 1) == Some(&quote) {
                index += 2;
                continue;
            }
            return Some(index + 1);
        }
        index += 1;
    }
    None
}

fn skip_backtick_identifier(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 1;
    while index < bytes.len() {
        if bytes[index] == b'`' {
            if bytes.get(index + 1) == Some(&b'`') {
                index += 2;
                continue;
            }
            return Some(index + 1);
        }
        index += 1;
    }
    None
}

fn is_narrow_call_argument(arg: &str, quoted: bool) -> bool {
    if arg.is_empty() {
        return false;
    }
    if quoted {
        return is_single_quoted_scalar(arg) || is_double_quoted_scalar(arg);
    }
    if matches_ignore_ascii_case(arg, &["DEFAULT", "NULL", "TRUE", "FALSE"]) {
        return true;
    }
    if is_user_variable(arg) {
        return true;
    }
    is_numeric_literal(arg)
}

fn is_single_quoted_scalar(arg: &str) -> bool {
    arg.as_bytes().first() == Some(&b'\'')
        && skip_quoted_string(arg.as_bytes(), 0, b'\'') == Some(arg.len())
}

fn is_double_quoted_scalar(arg: &str) -> bool {
    arg.as_bytes().first() == Some(&b'"')
        && skip_quoted_string(arg.as_bytes(), 0, b'"') == Some(arg.len())
}

fn matches_ignore_ascii_case(value: &str, candidates: &[&str]) -> bool {
    candidates
        .iter()
        .any(|candidate| value.eq_ignore_ascii_case(candidate))
}

fn is_user_variable(arg: &str) -> bool {
    let bytes = arg.as_bytes();
    if bytes.first() != Some(&b'@') || bytes.get(1) == Some(&b'@') {
        return false;
    }
    let Some(first) = bytes.get(1) else {
        return false;
    };
    if !is_word_start(*first) && *first != b'_' {
        return false;
    }
    bytes[2..]
        .iter()
        .all(|byte| is_word_continue(*byte) || *byte == b'_')
}

fn is_numeric_literal(arg: &str) -> bool {
    let bytes = arg.as_bytes();
    let mut index = 0;

    if matches!(bytes.get(index), Some(b'+') | Some(b'-')) {
        index += 1;
    }

    let mut digits_before_dot = 0;
    while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
        index += 1;
        digits_before_dot += 1;
    }

    let mut digits_after_dot = 0;
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
            index += 1;
            digits_after_dot += 1;
        }
    }

    if digits_before_dot == 0 && digits_after_dot == 0 {
        return false;
    }

    if matches!(bytes.get(index), Some(b'e') | Some(b'E')) {
        index += 1;
        if matches!(bytes.get(index), Some(b'+') | Some(b'-')) {
            index += 1;
        }
        let exponent_start = index;
        while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
            index += 1;
        }
        if index == exponent_start {
            return false;
        }
    }

    index == bytes.len()
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

        if bytes.get(index) == Some(&b'#') {
            index += 1;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }

        if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'*') {
            index += 2;
            if let Some(close_index) = find_block_comment_close(bytes, index) {
                index = close_index + 2;
                continue;
            }
            return bytes.len();
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

fn is_stored_routine_create_target(word: &str) -> bool {
    matches!(word, "PROCEDURE" | "FUNCTION" | "EVENT")
}

fn is_routine_control_flow_word(word: &str) -> bool {
    matches!(
        word,
        "DECLARE"
            | "IF"
            | "ELSEIF"
            | "ELSE"
            | "WHILE"
            | "LOOP"
            | "REPEAT"
            | "CASE"
            | "LEAVE"
            | "ITERATE"
            | "RETURN"
            | "SIGNAL"
            | "RESIGNAL"
            | "END"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_narrow_call_for_mysql_family() {
        assert!(validate_mysql_scripting_boundary(
            "CALL mysql_runtime_ping(872)",
            &DatabaseType::Mysql,
        )
        .is_ok());
        assert!(validate_mysql_scripting_boundary(
            "CALL mariadb_runtime_ping(DEFAULT)",
            &DatabaseType::Mariadb,
        )
        .is_ok());
        assert!(validate_mysql_scripting_boundary(
            "CALL `reporting`.`runtime_ping`('alice', NULL, TRUE, @user_id);",
            &DatabaseType::Mysql,
        )
        .is_ok());
    }

    #[test]
    fn rejects_unsupported_call_argument_forms_before_dispatch() {
        for sql in [
            "CALL refresh_user_stats(NOW())",
            "CALL refresh_user_stats(1 + 2)",
            "CALL refresh_user_stats((SELECT id FROM users))",
            "CALL refresh_user_stats(user_id)",
            "CALL refresh_user_stats(@@session_sql_mode)",
        ] {
            match validate_mysql_scripting_boundary(sql, &DatabaseType::Mysql) {
                Err(AppError::Unsupported(msg)) => {
                    assert!(msg.contains("CALL support is limited"), "{msg:?}")
                }
                other => panic!("Expected unsupported CALL argument form, got: {other:?}"),
            }
        }
    }

    #[test]
    fn rejects_pathological_nested_executable_comment_without_overflow() {
        // Regression for #1557: a `/*!`-repeated payload drove unbounded mutual
        // recursion between `mysql_scripting_feature` and
        // `leading_executable_comment_feature` (one level per 3 bytes), which
        // overflowed the worker stack (SIGABRT, whole-app crash). Run on a
        // deliberately small stack so a regression re-aborts the test process
        // here instead of only in production.
        let handle = std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                let sql = "/*!".repeat(40_000);
                validate_mysql_scripting_boundary(&sql, &DatabaseType::Mysql)
            })
            .expect("spawn worker");
        let result = handle
            .join()
            .expect("worker must not overflow the stack on deeply nested comments");
        assert!(
            matches!(result, Err(AppError::Unsupported(_))),
            "deeply nested executable comment must be rejected fail-closed, got: {result:?}",
        );
    }

    #[test]
    fn rejects_routine_scripting_before_dispatch() {
        for (sql, expected) in [
            (
                "DELIMITER //\nCREATE PROCEDURE p() SELECT 1 //",
                "DELIMITER",
            ),
            (
                "LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users",
                "LOAD DATA",
            ),
            ("CREATE PROCEDURE p() SELECT 1", "stored routine"),
            ("IF user_id IS NULL THEN SELECT 1", "control-flow"),
        ] {
            match validate_mysql_scripting_boundary(sql, &DatabaseType::Mysql) {
                Err(AppError::Unsupported(msg)) => {
                    assert!(msg.contains(expected), "expected {expected:?} in {msg:?}")
                }
                other => panic!("Expected Unsupported({expected}), got: {other:?}"),
            }
        }
    }
}
