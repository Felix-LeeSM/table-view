use serde::Serialize;

mod aliases;
mod compact;
#[cfg(test)]
mod completion_tests;
mod token;
mod vocabulary;

use aliases::{resolve_alias, scan_aliases};
use token::completion_token_at;
use vocabulary::{builtin_functions, builtin_keywords, builtin_shell_commands};

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

    if supports_sql_completion(&request.dialect) {
        if let Some(qualifier) = &token.qualifier {
            add_qualified_columns(&mut items, &request, qualifier, &token.prefix);
        } else {
            add_meta_commands(&mut items, &request, &token.prefix);
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

trait CursorUtf16SaturatingSub {
    fn cursor_utf16_saturating_sub(self, rhs: usize) -> usize;
}

impl CursorUtf16SaturatingSub for CompletionCursorOffsets {
    fn cursor_utf16_saturating_sub(self, rhs: usize) -> usize {
        self.utf16.saturating_sub(rhs)
    }
}

fn add_keywords(items: &mut Vec<CompletionItem>, request: &SqlCompletionRequest, prefix: &str) {
    for keyword in builtin_keywords(&request.dialect) {
        if matches_prefix(keyword, prefix) {
            items.push(CompletionItem {
                label: (*keyword).to_string(),
                kind: "keyword".to_string(),
                apply: Some((*keyword).to_string()),
                detail: Some(keyword_detail(&request.dialect)),
                boost: Some(12),
            });
        }
    }

    for keyword in &request.vocabulary.keywords {
        if matches_prefix(keyword, prefix) {
            items.push(CompletionItem {
                label: keyword.clone(),
                kind: "keyword".to_string(),
                apply: Some(keyword.clone()),
                detail: Some(keyword_detail(&request.dialect)),
                boost: Some(10),
            });
        }
    }
}

fn add_meta_commands(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    prefix: &str,
) {
    for command in builtin_shell_commands(&request.shell) {
        if matches_prefix(command, prefix) {
            items.push(CompletionItem {
                label: (*command).to_string(),
                kind: "meta-command".to_string(),
                apply: Some((*command).to_string()),
                detail: Some(shell_detail(&request.shell)),
                boost: Some(60),
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
    for function in builtin_functions(&request.dialect) {
        if matches_prefix(function, prefix) {
            items.push(CompletionItem {
                label: (*function).to_string(),
                kind: "function".to_string(),
                apply: Some((*function).to_string()),
                detail: Some(function_detail(&request.dialect)),
                boost: Some(22),
            });
        }
    }

    for function in &request.vocabulary.functions {
        if matches_prefix(function, prefix) {
            items.push(CompletionItem {
                label: function.clone(),
                kind: "function".to_string(),
                apply: Some(function.clone()),
                detail: Some(function_detail(&request.dialect)),
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

fn supports_sql_completion(dialect: &str) -> bool {
    matches!(dialect, "postgresql" | "mysql" | "mariadb" | "sqlite")
}

fn keyword_detail(dialect: &str) -> String {
    let mut detail = dialect_label(dialect).to_string();
    detail.push_str(" keyword");
    detail
}

fn function_detail(dialect: &str) -> String {
    let mut detail = dialect_label(dialect).to_string();
    detail.push_str(" function");
    detail
}

fn dialect_label(dialect: &str) -> &'static str {
    match dialect {
        "postgresql" => "PostgreSQL",
        "mysql" => "MySQL",
        "mariadb" => "MariaDB",
        "sqlite" => "SQLite",
        _ => "SQL",
    }
}

fn shell_detail(shell: &str) -> String {
    let mut detail = shell.to_string();
    detail.push_str(" command");
    detail
}
