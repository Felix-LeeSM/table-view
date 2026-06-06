use super::CompletionCursorOffsets;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CompletionToken {
    pub prefix: String,
    pub qualifier: Option<String>,
    pub quote: Option<char>,
    pub from_utf16: usize,
    pub from_utf8: usize,
}

pub(super) fn completion_token_at(text: &str, cursor: CompletionCursorOffsets) -> CompletionToken {
    let cursor_utf8 = valid_cursor_utf8(text, cursor.utf8);
    let before = &text[..cursor_utf8];
    let mut from_utf8 = cursor_utf8;
    let mut quote = None;
    let mut prefix;

    if let Some((quoted_from_utf8, quoted_prefix, quoted_quote)) = quoted_identifier_prefix(before)
    {
        from_utf8 = quoted_from_utf8;
        prefix = quoted_prefix;
        quote = Some(quoted_quote);
    } else {
        for (idx, ch) in before.char_indices().rev() {
            if !is_ident_char(ch) {
                break;
            }
            from_utf8 = idx;
        }

        if from_utf8 == cursor_utf8 {
            for (idx, ch) in before.char_indices().rev() {
                if !is_operator_char(ch) {
                    break;
                }
                from_utf8 = idx;
            }
        }

        if from_utf8 > 0 && text[..from_utf8].ends_with(':') {
            let colon_utf8 = from_utf8 - 1;
            if !text[..colon_utf8].ends_with(':') {
                from_utf8 = colon_utf8;
            }
        }

        prefix = text[from_utf8..cursor_utf8].to_string();
    }

    let mut qualifier = None;
    if from_utf8 > 0 && text[..from_utf8].ends_with('.') {
        let dot_utf8 = from_utf8 - 1;
        let qualifier_start = scan_qualifier_start(&text[..dot_utf8]);
        if qualifier_start < dot_utf8 {
            qualifier = Some(text[qualifier_start..dot_utf8].to_string());
        } else if is_command_prefix_at_line_start(text, dot_utf8) {
            from_utf8 = dot_utf8;
            prefix = text[from_utf8..cursor_utf8].to_string();
        }
    } else if from_utf8 > 0 && text[..from_utf8].ends_with('\\') {
        let slash_utf8 = from_utf8 - 1;
        if is_command_prefix_at_line_start(text, slash_utf8) {
            from_utf8 = slash_utf8;
            prefix = text[from_utf8..cursor_utf8].to_string();
        }
    }

    let replace_utf16 = utf16_len(&text[from_utf8..cursor_utf8]);
    CompletionToken {
        prefix,
        qualifier,
        quote,
        from_utf16: cursor.utf16.saturating_sub(replace_utf16),
        from_utf8,
    }
}

pub(super) fn is_ident_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '$'
}

fn is_operator_char(ch: char) -> bool {
    matches!(
        ch,
        '+' | '-'
            | '*'
            | '/'
            | '<'
            | '>'
            | '='
            | '~'
            | '!'
            | '@'
            | '#'
            | '%'
            | ':'
            | '^'
            | '&'
            | '|'
            | '`'
            | '?'
    )
}

fn valid_cursor_utf8(text: &str, requested: usize) -> usize {
    let mut cursor = requested.min(text.len());
    while cursor > 0 && !text.is_char_boundary(cursor) {
        cursor -= 1;
    }
    cursor
}

fn quoted_identifier_prefix(before: &str) -> Option<(usize, String, char)> {
    quoted_identifier_prefix_for(before, '`', '`')
        .or_else(|| quoted_identifier_prefix_for(before, '[', ']'))
}

fn quoted_identifier_prefix_for(
    before: &str,
    open: char,
    close: char,
) -> Option<(usize, String, char)> {
    let quote_start = if open == close {
        unmatched_same_quote_start(before, open)?
    } else {
        before.rfind(open)?
    };
    let prefix = &before[quote_start + open.len_utf8()..];
    if prefix
        .chars()
        .all(|ch| ch != open && ch != close && ch != '.' && ch != '\n' && ch != '\r')
    {
        return Some((quote_start, prefix.to_string(), open));
    }
    None
}

fn unmatched_same_quote_start(before: &str, quote: char) -> Option<usize> {
    let mut open_start = None;
    for (idx, ch) in before.char_indices() {
        if ch != quote {
            continue;
        }
        open_start = if open_start.is_some() {
            None
        } else {
            Some(idx)
        };
    }
    open_start
}

fn scan_qualifier_start(before_dot: &str) -> usize {
    let mut cursor = before_dot.len();
    let mut start = cursor;
    while cursor > 0 {
        let Some((idx, ch)) = before_dot[..cursor].char_indices().next_back() else {
            break;
        };
        if ch == ']' {
            let Some(open_idx) = before_dot[..idx].rfind('[') else {
                break;
            };
            start = open_idx;
            cursor = open_idx;
            continue;
        }
        if is_ident_char(ch) || matches!(ch, '.' | '`') {
            start = idx;
            cursor = idx;
            continue;
        }
        break;
    }
    start
}

fn is_command_prefix_at_line_start(text: &str, prefix_utf8: usize) -> bool {
    text[..prefix_utf8]
        .rsplit_once('\n')
        .map_or(&text[..prefix_utf8], |(_, line)| line)
        .chars()
        .all(char::is_whitespace)
}

fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cursor_at_end(text: &str) -> CompletionCursorOffsets {
        CompletionCursorOffsets {
            utf16: text.chars().map(char::len_utf16).sum(),
            utf8: text.len(),
        }
    }

    #[test]
    fn backtick_identifier_prefix_requires_unclosed_quote() {
        let open = completion_token_at("SELECT * FROM `User", cursor_at_end("SELECT * FROM `User"));
        assert_eq!(open.prefix, "User");
        assert_eq!(open.quote, Some('`'));

        let closed = completion_token_at(
            "SELECT * FROM `UserAccounts`",
            cursor_at_end("SELECT * FROM `UserAccounts`"),
        );
        assert_eq!(closed.quote, None);

        let closed_non_ident = completion_token_at(
            "SELECT * FROM `Order Details!`",
            cursor_at_end("SELECT * FROM `Order Details!`"),
        );
        assert_eq!(closed_non_ident.quote, None);
    }

    #[test]
    fn bracket_identifier_prefix_allows_unclosed_mssql_quote() {
        let token = completion_token_at(
            "SELECT * FROM [Order",
            cursor_at_end("SELECT * FROM [Order"),
        );
        assert_eq!(token.prefix, "Order");
        assert_eq!(token.quote, Some('['));
    }
}
