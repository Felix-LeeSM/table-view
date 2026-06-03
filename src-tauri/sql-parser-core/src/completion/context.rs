use super::token::{is_ident_char, CompletionToken};
use super::vocabulary::builtin_shell_commands;
use super::{CompletionCursorOffsets, SqlCompletionRequest};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CompletionContextKind {
    General,
    Relation,
    ShellMeta,
}

pub(super) fn completion_context_kind(
    request: &SqlCompletionRequest,
    token: &CompletionToken,
) -> CompletionContextKind {
    if is_shell_meta_command_context(request, token) {
        return CompletionContextKind::ShellMeta;
    }
    if is_relation_completion_context(&request.text, request.cursor) {
        return CompletionContextKind::Relation;
    }
    CompletionContextKind::General
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
        if is_ident_char(ch) || ch == '.' || ch == '`' {
            end = idx;
        } else {
            break;
        }
    }
    &input[..end]
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
