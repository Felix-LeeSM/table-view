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
    let quote = '`';
    if before.chars().filter(|ch| *ch == quote).count() % 2 == 0 {
        return None;
    }
    let quote_start = before.rfind(quote)?;
    let prefix = &before[quote_start + quote.len_utf8()..];
    if prefix
        .chars()
        .all(|ch| ch != quote && ch != '.' && ch != '\n' && ch != '\r')
    {
        return Some((quote_start, prefix.to_string(), quote));
    }
    None
}

fn scan_qualifier_start(before_dot: &str) -> usize {
    let mut start = before_dot.len();
    for (idx, ch) in before_dot.char_indices().rev() {
        if !(is_ident_char(ch) || ch == '.' || ch == '`') {
            break;
        }
        start = idx;
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
