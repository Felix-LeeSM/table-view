use super::token::{is_ident_char, CompletionToken};
use super::vocabulary::{builtin_functions, builtin_shell_commands, postgresql_extension_pack};
use super::{CompletionCursorOffsets, SqlCompletionRequest};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum CompletionState {
    StatementStart,
    SelectList,
    RelationName,
    DatabaseName,
    ColumnRef,
    FunctionRef,
    InsertColumns,
    UpdateSetTarget,
    OrderByExpr,
    ShellMeta,
    Unsupported,
}

pub(super) fn completion_state(
    request: &SqlCompletionRequest,
    token: &CompletionToken,
) -> CompletionState {
    if is_shell_meta_command_context(request, token) {
        return CompletionState::ShellMeta;
    }
    if insert_columns_target(&request.text, request.cursor).is_some() {
        return CompletionState::InsertColumns;
    }
    if update_set_target(&request.text, request.cursor).is_some() {
        return CompletionState::UpdateSetTarget;
    }
    if is_order_by_context(&request.text, request.cursor, token) {
        return CompletionState::OrderByExpr;
    }
    if is_database_completion_context(&request.text, request.cursor) {
        return CompletionState::DatabaseName;
    }
    if is_relation_completion_context(&request.text, request.cursor) {
        return CompletionState::RelationName;
    }
    if is_statement_start_context(&request.text, token) {
        return CompletionState::StatementStart;
    }
    if is_function_ref_context(request, token) {
        return CompletionState::FunctionRef;
    }
    if token.qualifier.is_some() || is_column_ref_context(&request.text, request.cursor, token) {
        return CompletionState::ColumnRef;
    }
    CompletionState::SelectList
}

fn is_shell_meta_command_context(request: &SqlCompletionRequest, token: &CompletionToken) -> bool {
    if request.shell == "none" || token.quote.is_some() {
        return false;
    }

    let line_prefix =
        current_line_prefix(before_cursor(&request.text, request.cursor)).trim_start();
    if line_prefix.is_empty() || line_prefix.chars().any(char::is_whitespace) {
        return false;
    }

    let normalized_prefix = line_prefix.to_ascii_lowercase();
    builtin_shell_commands(&request.shell)
        .iter()
        .any(|command| {
            let command = command.to_ascii_lowercase();
            command.starts_with(&normalized_prefix)
                && (line_prefix.starts_with('\\')
                    || line_prefix.starts_with('.')
                    || line_prefix.starts_with('?')
                    || normalized_prefix.len() >= 2)
        })
}

fn is_relation_completion_context(text: &str, cursor: CompletionCursorOffsets) -> bool {
    let raw_before = before_cursor(text, cursor);
    let before = raw_before.trim_end();
    let before_relation_token = if raw_before.len() == before.len() {
        trim_identifier_path_suffix(before).trim_end()
    } else {
        before
    };
    let Some(keyword) = trailing_word(before_relation_token) else {
        return false;
    };

    matches!(
        keyword.to_ascii_uppercase().as_str(),
        "FROM" | "JOIN" | "UPDATE" | "INTO"
    )
}

fn is_database_completion_context(text: &str, cursor: CompletionCursorOffsets) -> bool {
    let raw_before = before_cursor(text, cursor);
    let before = raw_before.trim_end();
    let before_database_token = if raw_before.len() == before.len() {
        trim_identifier_path_suffix(before).trim_end()
    } else {
        before
    };
    let Some(keyword) = trailing_word(before_database_token) else {
        return false;
    };

    keyword.eq_ignore_ascii_case("USE")
}

pub(super) fn insert_columns_target(text: &str, cursor: CompletionCursorOffsets) -> Option<String> {
    let before = before_cursor(text, cursor);
    let lower = before.to_ascii_lowercase();
    let insert_pos = lower.rfind("insert")?;
    let tail = &before[insert_pos..];
    let lower_tail = tail.to_ascii_lowercase();
    if !lower_tail.starts_with("insert") {
        return None;
    }
    let into_pos = lower_tail.find("into")?;
    let after_into = &tail[into_pos + "into".len()..];
    let open_pos = after_into.rfind('(')?;
    if after_into[open_pos + 1..].contains(')') {
        return None;
    }
    let target_part = after_into[..open_pos].trim();
    if target_part.is_empty()
        || target_part.to_ascii_lowercase().contains(" values")
        || target_part.to_ascii_lowercase().contains(" select")
    {
        return None;
    }
    last_identifier_path(target_part)
}

pub(super) fn update_set_target(text: &str, cursor: CompletionCursorOffsets) -> Option<String> {
    let before = before_cursor(text, cursor);
    let lower = before.to_ascii_lowercase();
    let update_pos = lower.rfind("update")?;
    let tail = &before[update_pos + "update".len()..];
    let lower_tail = tail.to_ascii_lowercase();
    let set_pos = lower_tail.rfind(" set")?;
    if lower_tail[set_pos + " set".len()..].contains('=') {
        return None;
    }
    let target_part = tail[..set_pos].trim();
    last_identifier_path(target_part)
}

fn is_statement_start_context(text: &str, token: &CompletionToken) -> bool {
    text[..token.from_utf8.min(text.len())].trim().is_empty()
}

fn is_order_by_context(
    text: &str,
    cursor: CompletionCursorOffsets,
    token: &CompletionToken,
) -> bool {
    let before_token = &text[..token.from_utf8.min(text.len())];
    let before_cursor = before_cursor(text, cursor);
    let lower = before_token.to_ascii_lowercase();
    let Some(order_pos) = lower.rfind("order") else {
        return false;
    };
    let after_order = before_cursor[order_pos..].to_ascii_lowercase();
    after_order.contains("order by")
        && !after_order.contains(" limit ")
        && !after_order.contains(" offset ")
}

fn is_column_ref_context(
    text: &str,
    _cursor: CompletionCursorOffsets,
    token: &CompletionToken,
) -> bool {
    let before_token = &text[..token.from_utf8.min(text.len())];
    let lower = before_token.to_ascii_lowercase();
    [" where ", " on ", " group by ", " having "]
        .iter()
        .any(|needle| lower.contains(needle))
}

fn is_function_ref_context(request: &SqlCompletionRequest, token: &CompletionToken) -> bool {
    if token.quote.is_some() || token.prefix.is_empty() {
        return false;
    }

    if let Some(qualifier) = &token.qualifier {
        let qualifier = normalize_identifier_path(qualifier);
        return request.catalog.functions.iter().any(|function| {
            function_matches_qualifier(function, &qualifier)
                && matches_prefix(&function.name, &token.prefix)
        });
    }

    builtin_functions(&request.dialect)
        .iter()
        .any(|function| matches_prefix(function, &token.prefix))
        || request
            .vocabulary
            .functions
            .iter()
            .any(|function| matches_prefix(function, &token.prefix))
        || request
            .catalog
            .functions
            .iter()
            .any(|function| matches_prefix(&function.name, &token.prefix))
        || request.catalog.extensions.iter().any(|extension| {
            postgresql_extension_pack(&extension.name).is_some_and(|pack| {
                pack.iter()
                    .any(|candidate| matches_prefix(candidate.label, &token.prefix))
            })
        })
}

fn before_cursor(text: &str, cursor: CompletionCursorOffsets) -> &str {
    let mut cursor_utf8 = cursor.utf8.min(text.len());
    while cursor_utf8 > 0 && !text.is_char_boundary(cursor_utf8) {
        cursor_utf8 -= 1;
    }
    &text[..cursor_utf8]
}

fn current_line_prefix(before_cursor: &str) -> &str {
    before_cursor
        .rsplit_once('\n')
        .map_or(before_cursor, |(_, line)| line)
}

fn trim_identifier_path_suffix(input: &str) -> &str {
    let mut end = input.len();
    while end > 0 {
        let Some((idx, ch)) = input[..end].char_indices().next_back() else {
            break;
        };
        if is_ident_char(ch) || ch == '.' || ch == '`' || ch == '[' || ch == ']' {
            end = idx;
        } else {
            break;
        }
    }
    &input[..end]
}

fn last_identifier_path(input: &str) -> Option<String> {
    let mut end = input.len();
    while end > 0 {
        let Some((idx, ch)) = input[..end].char_indices().next_back() else {
            break;
        };
        if ch.is_whitespace() {
            end = idx;
            continue;
        }
        break;
    }

    let mut start = end;
    while start > 0 {
        let Some((idx, ch)) = input[..start].char_indices().next_back() else {
            break;
        };
        if !(is_ident_char(ch) || ch == '.' || ch == '`' || ch == '"' || ch == '[' || ch == ']') {
            break;
        }
        start = idx;
    }

    (start < end).then(|| input[start..end].trim_matches('"').to_string())
}

fn function_matches_qualifier(
    function: &super::SqlCompletionCatalogFunction,
    qualifier: &str,
) -> bool {
    let parts: Vec<&str> = qualifier
        .split('.')
        .filter(|part| !part.is_empty())
        .collect();
    match parts.as_slice() {
        [schema] => function.schema.eq_ignore_ascii_case(schema),
        [database, schema] => {
            function.database.eq_ignore_ascii_case(database)
                && function.schema.eq_ignore_ascii_case(schema)
        }
        _ => false,
    }
}

fn normalize_identifier_path(identifier: &str) -> String {
    identifier
        .split('.')
        .map(normalize_identifier_part)
        .collect::<Vec<_>>()
        .join(".")
}

fn normalize_identifier_part(part: &str) -> String {
    let trimmed = part.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('`') && trimmed.ends_with('`') {
        return trimmed[1..trimmed.len() - 1].replace("``", "`");
    }
    if trimmed.len() >= 2 && trimmed.starts_with('[') && trimmed.ends_with(']') {
        return trimmed[1..trimmed.len() - 1].replace("]]", "]");
    }
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        return trimmed[1..trimmed.len() - 1].replace("\"\"", "\"");
    }
    trimmed.to_string()
}

fn matches_prefix(candidate: &str, prefix: &str) -> bool {
    prefix.is_empty()
        || candidate
            .to_ascii_lowercase()
            .starts_with(&prefix.to_ascii_lowercase())
}

fn trailing_word(input: &str) -> Option<&str> {
    let mut end = input.len();
    while end > 0 {
        let Some((idx, ch)) = input[..end].char_indices().next_back() else {
            break;
        };
        if ch.is_ascii_alphabetic() {
            break;
        }
        end = idx;
    }

    let mut start = end;
    while start > 0 {
        let Some((idx, ch)) = input[..start].char_indices().next_back() else {
            break;
        };
        if !ch.is_ascii_alphabetic() {
            break;
        }
        start = idx;
    }

    (start < end).then_some(&input[start..end])
}
