use super::token::is_ident_char;

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
