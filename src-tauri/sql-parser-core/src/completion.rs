use serde::Serialize;

mod compact;
#[cfg(test)]
mod completion_tests;

pub use compact::complete_sql_compact;

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionRequest {
    pub text: String,
    pub cursor: CompletionCursorOffsets,
    pub dialect: String,
    pub shell: String,
    pub vocabulary: SqlCompletionVocabulary,
    pub catalog: SqlCompletionCatalogSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CompletionCursorOffsets {
    pub utf16: usize,
    pub utf8: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionVocabulary {
    pub keywords: Vec<String>,
    pub functions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionCatalogSnapshot {
    pub revision: String,
    pub objects: Vec<SqlCompletionCatalogObject>,
    pub columns: Vec<SqlCompletionCatalogColumn>,
    pub functions: Vec<SqlCompletionCatalogFunction>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionCatalogObject {
    pub kind: String,
    pub schema: String,
    pub name: String,
    pub qualified_name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionCatalogColumn {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub qualified_table_name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionCatalogFunction {
    pub schema: String,
    pub name: String,
    pub qualified_name: String,
    pub arguments: Option<String>,
    pub return_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlCompletionCoreResult {
    pub items: Vec<CompletionItem>,
    pub replace_range: CompletionReplaceRange,
    pub incomplete: bool,
    pub metadata: CompletionResultMetadata,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionReplaceRange {
    pub from: CompletionCursorOffsets,
    pub to: CompletionCursorOffsets,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionResultMetadata {
    pub engine: &'static str,
    pub dialect: String,
    pub shell: String,
    pub catalog_revision: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub label: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<i32>,
}

pub fn complete_sql(request: SqlCompletionRequest) -> SqlCompletionCoreResult {
    let token = completion_token_at(&request.text, request.cursor);
    let mut items = Vec::new();

    if request.dialect == "postgresql" {
        if let Some(qualifier) = &token.qualifier {
            add_qualified_columns(&mut items, &request, qualifier, &token.prefix);
        } else {
            add_keywords(&mut items, &request, &token.prefix);
            add_catalog_objects(&mut items, &request, &token.prefix);
            add_unqualified_columns(&mut items, &request, &token.prefix);
            add_functions(&mut items, &request, &token.prefix);
        }
    }

    dedupe_items(&mut items);

    SqlCompletionCoreResult {
        items,
        replace_range: CompletionReplaceRange {
            from: CompletionCursorOffsets {
                utf16: token.from_utf16,
                utf8: token.from_utf8,
            },
            to: request.cursor,
        },
        incomplete: false,
        metadata: CompletionResultMetadata {
            engine: "wasm",
            dialect: request.dialect,
            shell: request.shell,
            catalog_revision: request.catalog.revision,
        },
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompletionToken {
    prefix: String,
    qualifier: Option<String>,
    from_utf16: usize,
    from_utf8: usize,
}

fn completion_token_at(text: &str, cursor: CompletionCursorOffsets) -> CompletionToken {
    let cursor_utf8 = valid_cursor_utf8(text, cursor.utf8);
    let before = &text[..cursor_utf8];
    let mut from_utf8 = cursor_utf8;

    for (idx, ch) in before.char_indices().rev() {
        if !is_ident_char(ch) {
            break;
        }
        from_utf8 = idx;
    }

    let prefix = text[from_utf8..cursor_utf8].to_string();
    let mut qualifier = None;
    if from_utf8 > 0 && text[..from_utf8].ends_with('.') {
        let dot_utf8 = from_utf8 - 1;
        let qualifier_start = scan_qualifier_start(&text[..dot_utf8]);
        if qualifier_start < dot_utf8 {
            qualifier = Some(text[qualifier_start..dot_utf8].to_string());
        }
    }

    let prefix_utf16 = utf16_len(&prefix);
    CompletionToken {
        prefix,
        qualifier,
        from_utf16: cursor.cursor_utf16_saturating_sub(prefix_utf16),
        from_utf8,
    }
}

trait CursorUtf16SaturatingSub {
    fn cursor_utf16_saturating_sub(self, rhs: usize) -> usize;
}

impl CursorUtf16SaturatingSub for CompletionCursorOffsets {
    fn cursor_utf16_saturating_sub(self, rhs: usize) -> usize {
        self.utf16.saturating_sub(rhs)
    }
}

fn valid_cursor_utf8(text: &str, requested: usize) -> usize {
    let mut cursor = requested.min(text.len());
    while cursor > 0 && !text.is_char_boundary(cursor) {
        cursor -= 1;
    }
    cursor
}

fn scan_qualifier_start(before_dot: &str) -> usize {
    let mut start = before_dot.len();
    for (idx, ch) in before_dot.char_indices().rev() {
        if !(is_ident_char(ch) || ch == '.') {
            break;
        }
        start = idx;
    }
    start
}

fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

fn is_ident_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '$'
}

fn add_keywords(items: &mut Vec<CompletionItem>, request: &SqlCompletionRequest, prefix: &str) {
    for keyword in &request.vocabulary.keywords {
        if matches_prefix(keyword, prefix) {
            items.push(CompletionItem {
                label: keyword.clone(),
                kind: "keyword".to_string(),
                apply: Some(keyword.clone()),
                detail: Some("PostgreSQL keyword".to_string()),
                boost: Some(10),
            });
        }
    }
}

fn add_catalog_objects(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    prefix: &str,
) {
    for object in &request.catalog.objects {
        if object.kind != "table" && object.kind != "view" {
            continue;
        }
        if matches_prefix(&object.name, prefix) {
            items.push(CompletionItem {
                label: object.name.clone(),
                kind: object.kind.clone(),
                apply: Some(object.name.clone()),
                detail: Some(object.schema.clone()),
                boost: Some(40),
            });
        }
        if matches_prefix(&object.qualified_name, prefix) {
            items.push(CompletionItem {
                label: object.qualified_name.clone(),
                kind: object.kind.clone(),
                apply: Some(object.qualified_name.clone()),
                detail: Some(object.schema.clone()),
                boost: Some(35),
            });
        }
    }
}

fn add_unqualified_columns(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    prefix: &str,
) {
    for column in &request.catalog.columns {
        if matches_prefix(&column.name, prefix) {
            items.push(column_item(column));
        }
    }
}

fn add_qualified_columns(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    qualifier: &str,
    prefix: &str,
) {
    let aliases = scan_aliases(&request.text);
    let resolved = resolve_alias(&aliases, qualifier).unwrap_or(qualifier);

    for column in &request.catalog.columns {
        if !matches_prefix(&column.name, prefix) {
            continue;
        }
        if same_identifier(&column.table, resolved)
            || same_identifier(&column.qualified_table_name, resolved)
        {
            items.push(column_item(column));
        }
    }
}

fn column_item(column: &SqlCompletionCatalogColumn) -> CompletionItem {
    CompletionItem {
        label: column.name.clone(),
        kind: "column".to_string(),
        apply: Some(column.name.clone()),
        detail: Some(column.qualified_table_name.clone()),
        boost: Some(50),
    }
}

fn add_functions(items: &mut Vec<CompletionItem>, request: &SqlCompletionRequest, prefix: &str) {
    for function in &request.vocabulary.functions {
        if matches_prefix(function, prefix) {
            items.push(CompletionItem {
                label: function.clone(),
                kind: "function".to_string(),
                apply: Some(function.clone()),
                detail: Some("PostgreSQL function".to_string()),
                boost: Some(20),
            });
        }
    }

    for function in &request.catalog.functions {
        if matches_prefix(&function.name, prefix) {
            let mut detail = function.qualified_name.clone();
            if let Some(return_type) = &function.return_type {
                detail.push_str(" -> ");
                detail.push_str(return_type);
            }
            items.push(CompletionItem {
                label: function.name.clone(),
                kind: "function".to_string(),
                apply: Some(function.name.clone()),
                detail: Some(detail),
                boost: Some(30),
            });
        }
    }
}

fn matches_prefix(candidate: &str, prefix: &str) -> bool {
    prefix.is_empty()
        || candidate
            .to_ascii_lowercase()
            .starts_with(&prefix.to_ascii_lowercase())
}

fn same_identifier(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn dedupe_items(items: &mut Vec<CompletionItem>) {
    let mut seen: Vec<(String, String, String)> = Vec::new();
    items.retain(|item| {
        let key = (
            item.kind.clone(),
            item.label.to_ascii_lowercase(),
            item.detail.clone().unwrap_or_default().to_ascii_lowercase(),
        );
        if seen.iter().any(|existing| existing == &key) {
            return false;
        }
        seen.push(key);
        true
    });
}

fn scan_aliases(text: &str) -> Vec<(String, String)> {
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

fn push_alias(aliases: &mut Vec<(String, String)>, alias: &str, table_ref: &str) {
    let key = alias.to_ascii_lowercase();
    if aliases.iter().any(|(existing, _)| existing == &key) {
        return;
    }
    aliases.push((key, table_ref.to_string()));
}

fn resolve_alias<'a>(aliases: &'a [(String, String)], qualifier: &str) -> Option<&'a str> {
    let key = qualifier.to_ascii_lowercase();
    aliases
        .iter()
        .find(|(alias, _)| alias == &key)
        .map(|(_, table_ref)| table_ref.as_str())
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
