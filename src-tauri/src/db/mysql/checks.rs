use std::collections::HashMap;

pub(super) fn build_check_map(
    column_names: &[String],
    clauses: impl IntoIterator<Item = String>,
) -> HashMap<String, Vec<String>> {
    let mut check_map = HashMap::new();
    for raw_clause in clauses {
        let clause = format_check_clause(&raw_clause);
        for column in column_names {
            if check_clause_references_column(&clause, column) {
                check_map
                    .entry(column.clone())
                    .or_insert_with(Vec::new)
                    .push(clause.clone());
            }
        }
    }
    check_map
}

pub(super) fn is_check_metadata_unavailable(err: &sqlx::Error) -> bool {
    let sqlx::Error::Database(db_err) = err else {
        return false;
    };

    if let Some(code) = db_err.code() {
        if matches!(code.as_ref(), "1109" | "1142" | "1044") {
            return true;
        }
    }

    let msg = db_err.message().to_ascii_lowercase();
    let mentions_check_metadata =
        msg.contains("check_constraints") || msg.contains("check constraints");
    mentions_check_metadata
        && (msg.contains("unknown table")
            || msg.contains("doesn't exist")
            || msg.contains("does not exist")
            || msg.contains("denied")
            || msg.contains("permission"))
}

fn format_check_clause(check_clause: &str) -> String {
    let trimmed = check_clause.trim();
    if trimmed.to_ascii_uppercase().starts_with("CHECK") {
        trimmed.to_string()
    } else {
        format!("CHECK ({trimmed})")
    }
}

fn check_clause_references_column(check_clause: &str, column: &str) -> bool {
    if column.is_empty() {
        return false;
    }

    let bytes = check_clause.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' => {
                i = skip_sql_string(bytes, i, bytes[i]);
            }
            b'`' => {
                let (identifier, next) = read_backtick_identifier(check_clause, i);
                if identifier.eq_ignore_ascii_case(column) {
                    return true;
                }
                i = next;
            }
            b'#' => {
                i = skip_line_comment(bytes, i);
            }
            b'-' if bytes.get(i + 1) == Some(&b'-') => {
                i = skip_line_comment(bytes, i + 2);
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i = skip_block_comment(bytes, i + 2);
            }
            b if is_identifier_start(b) => {
                let start = i;
                i += 1;
                while i < bytes.len() && is_identifier_part(bytes[i]) {
                    i += 1;
                }
                let token = &check_clause[start..i];
                if token.eq_ignore_ascii_case(column) && !token.eq_ignore_ascii_case("CHECK") {
                    return true;
                }
            }
            _ => {
                i += 1;
            }
        }
    }

    false
}

fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_' || byte == b'$'
}

fn is_identifier_part(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

fn skip_sql_string(bytes: &[u8], mut i: usize, quote: u8) -> usize {
    i += 1;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i = (i + 2).min(bytes.len());
            continue;
        }
        if bytes[i] == quote {
            if bytes.get(i + 1) == Some(&quote) {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i += 1;
    }
    i
}

fn read_backtick_identifier(check_clause: &str, mut i: usize) -> (String, usize) {
    let bytes = check_clause.as_bytes();
    i += 1;
    let mut segment_start = i;
    let mut out = String::new();
    while i < bytes.len() {
        if bytes[i] == b'`' {
            out.push_str(&check_clause[segment_start..i]);
            if bytes.get(i + 1) == Some(&b'`') {
                out.push('`');
                i += 2;
                segment_start = i;
                continue;
            }
            return (out, i + 1);
        }
        i += 1;
    }
    out.push_str(&check_clause[segment_start..i]);
    (out, i)
}

fn skip_line_comment(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len() && bytes[i] != b'\n' {
        i += 1;
    }
    i
}

fn skip_block_comment(bytes: &[u8], mut i: usize) -> usize {
    while i + 1 < bytes.len() {
        if bytes[i] == b'*' && bytes[i + 1] == b'/' {
            return i + 2;
        }
        i += 1;
    }
    bytes.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct StubDbError {
        code: Option<String>,
        message: String,
    }

    impl std::fmt::Display for StubDbError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(&self.message)
        }
    }

    impl std::error::Error for StubDbError {}

    impl sqlx::error::DatabaseError for StubDbError {
        fn message(&self) -> &str {
            &self.message
        }

        fn code(&self) -> Option<std::borrow::Cow<'_, str>> {
            self.code.as_deref().map(std::borrow::Cow::Borrowed)
        }

        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }

        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }

        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }

        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }

    fn make_db_error(code: Option<&str>, message: &str) -> sqlx::Error {
        sqlx::Error::Database(Box::new(StubDbError {
            code: code.map(ToString::to_string),
            message: message.to_string(),
        }))
    }

    #[test]
    fn build_check_map_assigns_bare_and_quoted_columns() {
        let columns = vec!["age".to_string(), "max_v".to_string()];
        let checks = build_check_map(
            &columns,
            [
                "age >= 0".to_string(),
                "CHECK (`age` <= `max_v`)".to_string(),
            ],
        );

        assert_eq!(checks["age"].len(), 2);
        assert_eq!(checks["max_v"].len(), 1);
        assert!(checks["age"][0].starts_with("CHECK"));
    }

    #[test]
    fn build_check_map_ignores_string_literals_and_comments() {
        let columns = vec!["status".to_string()];
        let checks = build_check_map(
            &columns,
            [
                "'status' <> ''".to_string(),
                "/* status */ 1 = 1".to_string(),
                "`status` IN ('open', 'closed')".to_string(),
            ],
        );

        assert_eq!(
            checks["status"],
            vec!["CHECK (`status` IN ('open', 'closed'))"]
        );
    }

    #[test]
    fn build_check_map_ignores_check_keyword_wrapper() {
        let columns = vec!["check".to_string()];
        let checks = build_check_map(&columns, ["age >= 0".to_string()]);

        assert!(checks.is_empty());
    }

    #[test]
    fn build_check_map_preserves_utf8_backtick_identifier() {
        let columns = vec!["상태".to_string()];
        let checks = build_check_map(&columns, ["`상태` IS NOT NULL".to_string()]);

        assert_eq!(checks["상태"], vec!["CHECK (`상태` IS NOT NULL)"]);
    }

    #[test]
    fn check_metadata_unavailable_matches_mysql_unknown_table() {
        let err = make_db_error(
            Some("1109"),
            "Unknown table 'CHECK_CONSTRAINTS' in information_schema",
        );

        assert!(is_check_metadata_unavailable(&err));
    }

    #[test]
    fn check_metadata_unavailable_matches_permission_denied() {
        let err = make_db_error(
            Some("1142"),
            "SELECT command denied to user for table 'CHECK_CONSTRAINTS'",
        );

        assert!(is_check_metadata_unavailable(&err));
    }

    #[test]
    fn check_metadata_unavailable_ignores_unrelated_errors() {
        let err = make_db_error(None, "network timeout while reading rows");

        assert!(!is_check_metadata_unavailable(&err));
        assert!(!is_check_metadata_unavailable(&sqlx::Error::PoolClosed));
    }
}
