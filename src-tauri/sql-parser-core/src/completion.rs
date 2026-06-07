use serde::Serialize;

mod aliases;
mod compact;
#[cfg(test)]
mod completion_state_tests;
#[cfg(test)]
mod completion_tests;
mod context;
#[cfg(test)]
mod mssql_completion_tests;
mod token;
mod vocabulary;

use aliases::{resolve_alias, scan_aliases, scan_cte_columns};
use context::{completion_state, insert_columns_target, update_set_target};
use token::{completion_token_at, CompletionToken};
use vocabulary::{
    builtin_bind_identifiers, builtin_functions, builtin_keyword_deltas, builtin_keywords,
    builtin_shell_commands, postgresql_extension_pack,
};

pub use compact::complete_sql_compact;
pub use context::CompletionState;

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionRequest {
    pub text: String,
    pub cursor: CompletionCursorOffsets,
    pub dialect: String,
    pub shell: String,
    pub server_version: Option<String>,
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
    pub databases: Vec<SqlCompletionCatalogDatabase>,
    pub schemas: Vec<SqlCompletionCatalogSchema>,
    pub objects: Vec<SqlCompletionCatalogObject>,
    pub columns: Vec<SqlCompletionCatalogColumn>,
    pub functions: Vec<SqlCompletionCatalogFunction>,
    pub extensions: Vec<SqlCompletionCatalogExtension>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionCatalogDatabase {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionCatalogSchema {
    pub database: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionCatalogObject {
    pub kind: String,
    pub database: String,
    pub schema: String,
    pub name: String,
    pub qualified_name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionCatalogColumn {
    pub database: String,
    pub schema: String,
    pub table: String,
    pub name: String,
    pub qualified_table_name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionCatalogFunction {
    pub database: String,
    pub schema: String,
    pub name: String,
    pub qualified_name: String,
    pub arguments: Option<String>,
    pub return_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqlCompletionCatalogExtension {
    pub schema: String,
    pub name: String,
    pub version: String,
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
    pub completion_state: CompletionState,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_executable: Option<bool>,
}

pub fn complete_sql(request: SqlCompletionRequest) -> SqlCompletionCoreResult {
    let token = completion_token_at(&request.text, request.cursor);
    let state = if supports_sql_completion(&request.dialect) {
        completion_state(&request, &token)
    } else {
        CompletionState::Unsupported
    };
    let mut items = Vec::new();

    if supports_sql_completion(&request.dialect) {
        if let Some(qualifier) = &token.qualifier {
            let normalized_qualifier = normalize_identifier_path(qualifier);
            match state {
                CompletionState::RelationName => {
                    add_qualified_schemas(&mut items, &request, &normalized_qualifier, &token);
                    add_qualified_catalog_objects(
                        &mut items,
                        &request,
                        &normalized_qualifier,
                        &token,
                    );
                }
                CompletionState::FunctionRef => {
                    add_qualified_functions(&mut items, &request, &normalized_qualifier, &token);
                }
                CompletionState::DatabaseName
                | CompletionState::ShellMeta
                | CompletionState::Unsupported => {}
                _ => {
                    add_qualified_schemas(&mut items, &request, &normalized_qualifier, &token);
                    add_qualified_catalog_objects(
                        &mut items,
                        &request,
                        &normalized_qualifier,
                        &token,
                    );
                    add_qualified_columns(&mut items, &request, &normalized_qualifier, &token);
                    add_qualified_functions(&mut items, &request, &normalized_qualifier, &token);
                }
            }
        } else {
            match state {
                CompletionState::ShellMeta => {
                    add_meta_commands(&mut items, &request, &token.prefix)
                }
                CompletionState::RelationName => {
                    add_catalog_schemas(&mut items, &request, &token);
                    add_catalog_objects(&mut items, &request, &token);
                }
                CompletionState::DatabaseName => {
                    add_catalog_databases(&mut items, &request, &token);
                    if request.catalog.databases.is_empty() {
                        add_catalog_schemas(&mut items, &request, &token);
                    }
                }
                CompletionState::InsertColumns => {
                    add_target_columns(
                        &mut items,
                        &request,
                        insert_columns_target(&request.text, request.cursor).as_deref(),
                        &token,
                    );
                }
                CompletionState::UpdateSetTarget => {
                    add_target_columns(
                        &mut items,
                        &request,
                        update_set_target(&request.text, request.cursor).as_deref(),
                        &token,
                    );
                }
                CompletionState::ColumnRef => {
                    add_bind_identifiers(&mut items, &request, &token);
                    add_unqualified_columns(&mut items, &request, &token);
                }
                CompletionState::FunctionRef => {
                    add_bind_identifiers(&mut items, &request, &token);
                    add_functions(&mut items, &request, &token);
                    if token.quote.is_none() {
                        add_extension_pack_items(&mut items, &request, &token.prefix);
                    }
                }
                CompletionState::OrderByExpr => {
                    add_bind_identifiers(&mut items, &request, &token);
                    add_unqualified_columns(&mut items, &request, &token);
                    add_functions(&mut items, &request, &token);
                    if token.quote.is_none() {
                        add_extension_pack_items(&mut items, &request, &token.prefix);
                    }
                }
                CompletionState::StatementStart | CompletionState::SelectList => {
                    add_bind_identifiers(&mut items, &request, &token);
                    if token.quote.is_none() {
                        add_keywords(&mut items, &request, &token.prefix);
                    }
                    add_catalog_schemas(&mut items, &request, &token);
                    add_catalog_objects(&mut items, &request, &token);
                    add_unqualified_columns(&mut items, &request, &token);
                    add_functions(&mut items, &request, &token);
                    if token.quote.is_none() {
                        add_extension_pack_items(&mut items, &request, &token.prefix);
                    }
                }
                CompletionState::Unsupported => {}
            }
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
            completion_state: state,
        },
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
                runtime_executable: None,
            });
        }
    }

    for keyword in builtin_keyword_deltas(&request.dialect, request.server_version.as_deref()) {
        if matches_prefix(keyword, prefix) {
            items.push(CompletionItem {
                label: (*keyword).to_string(),
                kind: "keyword".to_string(),
                apply: Some((*keyword).to_string()),
                detail: Some(keyword_detail(&request.dialect)),
                boost: Some(13),
                runtime_executable: None,
            });
        }
    }

    for keyword in &request.vocabulary.keywords {
        if !request_keyword_is_available(
            &request.dialect,
            request.server_version.as_deref(),
            keyword,
        ) {
            continue;
        }
        if matches_prefix(keyword, prefix) {
            items.push(CompletionItem {
                label: keyword.clone(),
                kind: "keyword".to_string(),
                apply: Some(keyword.clone()),
                detail: Some(keyword_detail(&request.dialect)),
                boost: Some(10),
                runtime_executable: None,
            });
        }
    }
}

fn request_keyword_is_available(
    dialect: &str,
    server_version: Option<&str>,
    keyword: &str,
) -> bool {
    if dialect == "mariadb" && keyword.eq_ignore_ascii_case("RETURNING") {
        return vocabulary::mariadb_server_version_supports_returning(server_version);
    }
    true
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
                runtime_executable: Some(false),
            });
        }
    }
}

fn add_bind_identifiers(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    token: &CompletionToken,
) {
    if token.quote.is_some() || !token.prefix.starts_with(':') {
        return;
    }

    for bind in builtin_bind_identifiers(&request.dialect) {
        if matches_prefix(bind, &token.prefix) {
            items.push(CompletionItem {
                label: (*bind).to_string(),
                kind: "variable".to_string(),
                apply: Some((*bind).to_string()),
                detail: Some(format!(
                    "{} bind variable placeholder",
                    dialect_label(&request.dialect)
                )),
                boost: Some(55),
                runtime_executable: Some(false),
            });
        }
    }
}

fn add_catalog_schemas(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    token: &CompletionToken,
) {
    for schema in &request.catalog.schemas {
        if matches_prefix(&schema.name, &token.prefix) {
            items.push(CompletionItem {
                label: schema.name.clone(),
                kind: "schema".to_string(),
                apply: Some(apply_identifier(&schema.name, token)),
                detail: Some("catalog schema".to_string()),
                boost: Some(45),
                runtime_executable: None,
            });
        }
    }
}

fn add_catalog_databases(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    token: &CompletionToken,
) {
    for database in &request.catalog.databases {
        if matches_prefix(&database.name, &token.prefix) {
            items.push(CompletionItem {
                label: database.name.clone(),
                kind: "database".to_string(),
                apply: Some(apply_identifier(&database.name, token)),
                detail: Some("catalog database".to_string()),
                boost: Some(47),
                runtime_executable: None,
            });
        }
    }
}

fn add_qualified_schemas(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    qualifier: &str,
    token: &CompletionToken,
) {
    for schema in &request.catalog.schemas {
        if schema_matches_qualifier(schema, qualifier)
            && matches_prefix(&schema.name, &token.prefix)
        {
            items.push(CompletionItem {
                label: schema.name.clone(),
                kind: "schema".to_string(),
                apply: Some(apply_identifier(&schema.name, token)),
                detail: Some(schema.database.clone()),
                boost: Some(43),
                runtime_executable: None,
            });
        }
    }
}

fn add_catalog_objects(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    token: &CompletionToken,
) {
    for object in &request.catalog.objects {
        if object.kind != "table" && object.kind != "view" {
            continue;
        }
        if matches_prefix(&object.name, &token.prefix) {
            items.push(CompletionItem {
                label: object.name.clone(),
                kind: object.kind.clone(),
                apply: Some(apply_identifier(&object.name, token)),
                detail: Some(object.schema.clone()),
                boost: Some(40),
                runtime_executable: None,
            });
        }
        if token.quote.is_none() && matches_prefix(&object.qualified_name, &token.prefix) {
            items.push(CompletionItem {
                label: object.qualified_name.clone(),
                kind: object.kind.clone(),
                apply: Some(object.qualified_name.clone()),
                detail: Some(object.schema.clone()),
                boost: Some(35),
                runtime_executable: None,
            });
        }
    }
}

fn add_qualified_catalog_objects(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    qualifier: &str,
    token: &CompletionToken,
) {
    for object in &request.catalog.objects {
        if object.kind != "table" && object.kind != "view" {
            continue;
        }
        if catalog_object_matches_qualifier(object, qualifier)
            && matches_prefix(&object.name, &token.prefix)
        {
            items.push(CompletionItem {
                label: object.name.clone(),
                kind: object.kind.clone(),
                apply: Some(apply_identifier(&object.name, token)),
                detail: Some(object.schema.clone()),
                boost: Some(38),
                runtime_executable: None,
            });
        }
    }
}

fn add_unqualified_columns(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    token: &CompletionToken,
) {
    for column in &request.catalog.columns {
        if matches_prefix(&column.name, &token.prefix) {
            items.push(column_item(column, apply_identifier(&column.name, token)));
        }
    }
}

fn add_target_columns(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    target: Option<&str>,
    token: &CompletionToken,
) {
    let Some(target) = target else {
        add_unqualified_columns(items, request, token);
        return;
    };
    let normalized_target = normalize_identifier_path(target);
    for column in &request.catalog.columns {
        if !matches_prefix(&column.name, &token.prefix) {
            continue;
        }
        if catalog_column_matches_qualifier(column, &normalized_target) {
            items.push(column_item(column, apply_identifier(&column.name, token)));
        }
    }
}

fn add_qualified_columns(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    qualifier: &str,
    token: &CompletionToken,
) {
    let aliases = scan_aliases(&request.text);
    let resolved = resolve_alias(&aliases, qualifier).unwrap_or(qualifier);
    let cte_columns = scan_cte_columns(&request.text);
    for cte in &cte_columns {
        if !same_identifier(&cte.name, qualifier) {
            continue;
        }
        for column in &cte.columns {
            if matches_prefix(column, &token.prefix) {
                items.push(CompletionItem {
                    label: column.clone(),
                    kind: "column".to_string(),
                    apply: Some(apply_identifier(column, token)),
                    detail: Some(cte.name.clone()),
                    boost: Some(52),
                    runtime_executable: None,
                });
            }
        }
    }

    for column in &request.catalog.columns {
        if !matches_prefix(&column.name, &token.prefix) {
            continue;
        }
        if catalog_column_matches_qualifier(column, resolved) {
            items.push(column_item(column, apply_identifier(&column.name, token)));
        }
    }
}

fn column_item(column: &SqlCompletionCatalogColumn, apply: String) -> CompletionItem {
    CompletionItem {
        label: column.name.clone(),
        kind: "column".to_string(),
        apply: Some(apply),
        detail: Some(column.qualified_table_name.clone()),
        boost: Some(50),
        runtime_executable: None,
    }
}

fn add_functions(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    token: &CompletionToken,
) {
    if token.quote.is_none() {
        for function in builtin_functions(&request.dialect) {
            if matches_prefix(function, &token.prefix) {
                items.push(CompletionItem {
                    label: (*function).to_string(),
                    kind: "function".to_string(),
                    apply: Some((*function).to_string()),
                    detail: Some(function_detail(&request.dialect)),
                    boost: Some(22),
                    runtime_executable: None,
                });
            }
        }

        for function in &request.vocabulary.functions {
            if matches_prefix(function, &token.prefix) {
                items.push(CompletionItem {
                    label: function.clone(),
                    kind: "function".to_string(),
                    apply: Some(function.clone()),
                    detail: Some(function_detail(&request.dialect)),
                    boost: Some(20),
                    runtime_executable: None,
                });
            }
        }
    }

    for function in &request.catalog.functions {
        if matches_prefix(&function.name, &token.prefix) {
            items.push(catalog_function_item(
                function,
                apply_identifier(&function.name, token),
                30,
            ));
        }
    }
}

fn add_qualified_functions(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    qualifier: &str,
    token: &CompletionToken,
) {
    for function in &request.catalog.functions {
        if catalog_function_matches_qualifier(function, qualifier)
            && matches_prefix(&function.name, &token.prefix)
        {
            items.push(catalog_function_item(
                function,
                apply_identifier(&function.name, token),
                28,
            ));
        }
    }
}

fn catalog_function_item(
    function: &SqlCompletionCatalogFunction,
    apply: String,
    boost: i32,
) -> CompletionItem {
    let mut detail = function.qualified_name.clone();
    if let Some(return_type) = &function.return_type {
        detail.push_str(" -> ");
        detail.push_str(return_type);
    }
    CompletionItem {
        label: function.name.clone(),
        kind: "function".to_string(),
        apply: Some(apply),
        detail: Some(detail),
        boost: Some(boost),
        runtime_executable: None,
    }
}

fn add_extension_pack_items(
    items: &mut Vec<CompletionItem>,
    request: &SqlCompletionRequest,
    prefix: &str,
) {
    if request.dialect != "postgresql" {
        return;
    }

    for extension in &request.catalog.extensions {
        let Some(pack) = postgresql_extension_pack(&extension.name) else {
            continue;
        };
        for candidate in pack {
            if !matches_prefix(candidate.label, prefix) {
                continue;
            }
            items.push(CompletionItem {
                label: candidate.label.to_string(),
                kind: candidate.kind.to_string(),
                apply: Some(candidate.label.to_string()),
                detail: Some(format!(
                    "PostgreSQL extension {} {}",
                    extension.name, candidate.detail
                )),
                boost: Some(candidate.boost),
                runtime_executable: None,
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
    normalize_identifier_path(left).eq_ignore_ascii_case(&normalize_identifier_path(right))
}

fn schema_matches_qualifier(schema: &SqlCompletionCatalogSchema, qualifier: &str) -> bool {
    let parts = identifier_path_parts(qualifier);
    matches!(parts.as_slice(), [database] if schema.database.eq_ignore_ascii_case(database))
}

fn catalog_object_matches_qualifier(object: &SqlCompletionCatalogObject, qualifier: &str) -> bool {
    let parts = identifier_path_parts(qualifier);
    match parts.as_slice() {
        [schema] => object.schema.eq_ignore_ascii_case(schema),
        [database, schema] => {
            object.database.eq_ignore_ascii_case(database)
                && object.schema.eq_ignore_ascii_case(schema)
        }
        _ => false,
    }
}

fn catalog_column_matches_qualifier(column: &SqlCompletionCatalogColumn, qualifier: &str) -> bool {
    if same_identifier(&column.table, qualifier)
        || same_identifier(&column.qualified_table_name, qualifier)
    {
        return true;
    }

    let parts = identifier_path_parts(qualifier);
    matches!(
        parts.as_slice(),
        [database, schema, table]
            if column.database.eq_ignore_ascii_case(database)
                && column.schema.eq_ignore_ascii_case(schema)
                && column.table.eq_ignore_ascii_case(table)
    )
}

fn catalog_function_matches_qualifier(
    function: &SqlCompletionCatalogFunction,
    qualifier: &str,
) -> bool {
    let parts = identifier_path_parts(qualifier);
    match parts.as_slice() {
        [schema] => function.schema.eq_ignore_ascii_case(schema),
        [database, schema] => {
            function.database.eq_ignore_ascii_case(database)
                && function.schema.eq_ignore_ascii_case(schema)
        }
        _ => false,
    }
}

fn identifier_path_parts(identifier: &str) -> Vec<String> {
    normalize_identifier_path(identifier)
        .split('.')
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
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
    trimmed.to_string()
}

fn apply_identifier(identifier: &str, token: &CompletionToken) -> String {
    token.quote.map_or_else(
        || identifier.to_string(),
        |quote| quote_identifier(identifier, quote),
    )
}

fn quote_identifier(identifier: &str, quote: char) -> String {
    match quote {
        '`' => format!("`{}`", identifier.replace('`', "``")),
        '[' => format!("[{}]", identifier.replace(']', "]]")),
        _ => identifier.to_string(),
    }
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
    matches!(
        dialect,
        "postgresql" | "mysql" | "mariadb" | "sqlite" | "mssql" | "oracle"
    )
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
        "mssql" => "MSSQL",
        "oracle" => "Oracle",
        _ => "SQL",
    }
}

fn shell_detail(shell: &str) -> String {
    let mut detail = shell.to_string();
    detail.push_str(" command; not executable by Table View");
    detail
}
