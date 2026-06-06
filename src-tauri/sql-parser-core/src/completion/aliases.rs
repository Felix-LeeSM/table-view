use super::token::is_ident_char;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CteColumns {
    pub name: String,
    pub columns: Vec<String>,
}

pub(super) fn scan_aliases(text: &str) -> Vec<(String, String)> {
    let tokens = lexical_words_and_dots(text);
    let mut aliases = Vec::new();
    let mut i = 0usize;
    while i < tokens.len() {
        let token = tokens[i].to_ascii_lowercase();
        if token != "from" && token != "join" {
            i += 1;
            continue;
        }

        let Some((table_ref, next)) = read_table_ref(&tokens, i + 1) else {
            i += 1;
            continue;
        };
        push_alias(&mut aliases, &table_ref, &table_ref);
        if let Some(bare) = table_ref.rsplit('.').next() {
            push_alias(&mut aliases, bare, &table_ref);
        }

        let mut alias_idx = next;
        if tokens
            .get(alias_idx)
            .is_some_and(|t| t.eq_ignore_ascii_case("as"))
        {
            alias_idx += 1;
        }
        if let Some(alias) = tokens.get(alias_idx) {
            if is_alias_candidate(alias) {
                push_alias(&mut aliases, alias, &table_ref);
            }
        }
        i = alias_idx.saturating_add(1);
    }
    aliases
}

pub(super) fn scan_cte_columns(text: &str) -> Vec<CteColumns> {
    let lower = text.to_ascii_lowercase();
    let Some(with_pos) = lower.find("with") else {
        return Vec::new();
    };

    let mut ctes = Vec::new();
    let mut cursor = with_pos + "with".len();
    while cursor < text.len() {
        cursor = skip_whitespace(text, cursor);
        if lower[cursor..].starts_with("recursive") {
            cursor += "recursive".len();
            cursor = skip_whitespace(text, cursor);
        }

        let Some((name, after_name)) = read_identifier(text, cursor) else {
            break;
        };
        cursor = skip_whitespace(text, after_name);

        let mut explicit_columns = Vec::new();
        if text[cursor..].starts_with('(') {
            let Some(close) = find_matching_paren(text, cursor) else {
                break;
            };
            explicit_columns = split_identifier_list(&text[cursor + 1..close]);
            cursor = skip_whitespace(text, close + 1);
        }

        if !lower[cursor..].starts_with("as") {
            break;
        }
        cursor += "as".len();
        cursor = skip_whitespace(text, cursor);
        if !text[cursor..].starts_with('(') {
            break;
        }
        let Some(body_end) = find_matching_paren(text, cursor) else {
            break;
        };
        let body = &text[cursor + 1..body_end];
        let columns = if explicit_columns.is_empty() {
            select_list_columns(body)
        } else {
            explicit_columns
        };
        if !columns.is_empty() {
            ctes.push(CteColumns { name, columns });
        }

        cursor = skip_whitespace(text, body_end + 1);
        if !text[cursor..].starts_with(',') {
            break;
        }
        cursor += 1;
    }

    ctes
}

pub(super) fn resolve_alias<'a>(
    aliases: &'a [(String, String)],
    qualifier: &str,
) -> Option<&'a str> {
    let key = qualifier.to_ascii_lowercase();
    aliases
        .iter()
        .find(|(alias, _)| alias == &key)
        .map(|(_, table_ref)| table_ref.as_str())
}

fn push_alias(aliases: &mut Vec<(String, String)>, alias: &str, table_ref: &str) {
    let key = alias.to_ascii_lowercase();
    if aliases.iter().any(|(existing, _)| existing == &key) {
        return;
    }
    aliases.push((key, table_ref.to_string()));
}

fn read_table_ref(tokens: &[String], start: usize) -> Option<(String, usize)> {
    let first = tokens.get(start)?;
    if !is_alias_candidate(first) {
        return None;
    }
    if tokens.get(start + 1).is_some_and(|t| t == ".") {
        let second = tokens.get(start + 2)?;
        if is_alias_candidate(second) {
            let mut qualified = String::with_capacity(first.len() + second.len() + 1);
            qualified.push_str(first);
            qualified.push('.');
            qualified.push_str(second);
            return Some((qualified, start + 3));
        }
    }
    Some((first.clone(), start + 1))
}

fn lexical_words_and_dots(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if is_ident_char(ch) {
            current.push(ch);
            continue;
        }
        if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
        if ch == '.' {
            tokens.push(".".to_string());
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn is_alias_candidate(token: &str) -> bool {
    if token == "." {
        return false;
    }
    !matches!(
        token.to_ascii_lowercase().as_str(),
        "where"
            | "join"
            | "inner"
            | "left"
            | "right"
            | "full"
            | "cross"
            | "on"
            | "using"
            | "group"
            | "order"
            | "having"
            | "limit"
            | "offset"
            | "union"
            | "intersect"
            | "except"
            | "set"
            | "values"
    )
}

fn skip_whitespace(text: &str, mut cursor: usize) -> usize {
    while cursor < text.len() {
        let Some(ch) = text[cursor..].chars().next() else {
            break;
        };
        if !ch.is_whitespace() {
            break;
        }
        cursor += ch.len_utf8();
    }
    cursor
}

fn read_identifier(text: &str, start: usize) -> Option<(String, usize)> {
    let mut cursor = start;
    let mut value = String::new();
    while cursor < text.len() {
        let ch = text[cursor..].chars().next()?;
        if !(is_ident_char(ch) || ch == '.' || ch == '`' || ch == '"') {
            break;
        }
        value.push(ch);
        cursor += ch.len_utf8();
    }
    (!value.is_empty()).then_some((
        value.trim_matches('`').trim_matches('"').to_string(),
        cursor,
    ))
}

fn find_matching_paren(text: &str, open_pos: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (idx, ch) in text[open_pos..].char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(open_pos + idx);
                }
            }
            _ => {}
        }
    }
    None
}

fn split_identifier_list(input: &str) -> Vec<String> {
    input
        .split(',')
        .filter_map(|part| {
            let name = part.trim().trim_matches('`').trim_matches('"');
            (!name.is_empty()).then(|| name.to_string())
        })
        .collect()
}

fn select_list_columns(sql: &str) -> Vec<String> {
    let lower = sql.to_ascii_lowercase();
    let Some(select_pos) = lower.find("select") else {
        return Vec::new();
    };
    let Some(from_pos) = lower[select_pos + "select".len()..].find("from") else {
        return Vec::new();
    };
    let list = &sql[select_pos + "select".len()..select_pos + "select".len() + from_pos];
    list.split(',').filter_map(select_item_name).collect()
}

fn select_item_name(item: &str) -> Option<String> {
    let item = item.trim();
    if item.is_empty() || item == "*" {
        return None;
    }
    let lower = item.to_ascii_lowercase();
    if let Some(as_pos) = lower.rfind(" as ") {
        return last_name(&item[as_pos + 4..]);
    }
    last_name(item)
}

fn last_name(input: &str) -> Option<String> {
    input
        .split(|ch: char| !(is_ident_char(ch) || ch == '.' || ch == '`' || ch == '"'))
        .filter(|part| !part.is_empty())
        .next_back()
        .and_then(|part| part.rsplit('.').next())
        .map(|part| part.trim_matches('`').trim_matches('"').to_string())
        .filter(|part| !part.is_empty())
}
