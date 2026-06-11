use crate::error::AppError;
use crate::models::DatabaseType;

#[derive(Clone, Copy)]
enum MysqlScriptingFeature {
    Delimiter,
    LoadData,
    StoredRoutine,
    ControlFlow,
}

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
    if let Some(feature) = leading_executable_comment_feature(sql) {
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

    None
}

fn leading_executable_comment_feature(sql: &str) -> Option<MysqlScriptingFeature> {
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
                if let Some(feature) = mysql_scripting_feature(&sql[body_start..body_end]) {
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
