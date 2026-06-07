use super::{
    complete_sql, CompletionCursorOffsets, SqlCompletionCatalogColumn,
    SqlCompletionCatalogDatabase, SqlCompletionCatalogExtension, SqlCompletionCatalogFunction,
    SqlCompletionCatalogObject, SqlCompletionCatalogSchema, SqlCompletionCatalogSnapshot,
    SqlCompletionCoreResult, SqlCompletionRequest, SqlCompletionVocabulary,
};

#[allow(clippy::too_many_arguments)]
pub fn complete_sql_compact(
    text: &str,
    cursor_utf16: usize,
    cursor_utf8: usize,
    dialect: &str,
    shell: &str,
    server_version: &str,
    catalog_revision: &str,
    keywords: &str,
    vocabulary_functions: &str,
    databases: &str,
    schemas: &str,
    objects: &str,
    columns: &str,
    catalog_functions: &str,
    extensions: &str,
) -> SqlCompletionCoreResult {
    complete_sql(SqlCompletionRequest {
        text: text.to_string(),
        cursor: CompletionCursorOffsets {
            utf16: cursor_utf16,
            utf8: cursor_utf8,
        },
        dialect: dialect.to_string(),
        shell: shell.to_string(),
        server_version: empty_to_none(server_version),
        vocabulary: SqlCompletionVocabulary {
            keywords: split_lines(keywords),
            functions: split_lines(vocabulary_functions),
        },
        catalog: SqlCompletionCatalogSnapshot {
            revision: catalog_revision.to_string(),
            databases: parse_databases(databases),
            schemas: parse_schemas(schemas),
            objects: parse_objects(objects),
            columns: parse_columns(columns),
            functions: parse_functions(catalog_functions),
            extensions: parse_extensions(extensions),
        },
    })
}

fn split_lines(input: &str) -> Vec<String> {
    input
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn parse_schemas(input: &str) -> Vec<SqlCompletionCatalogSchema> {
    input
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let mut fields = line.split('\t');
            Some(SqlCompletionCatalogSchema {
                name: fields.next()?.to_string(),
                database: fields.next().unwrap_or_default().to_string(),
            })
        })
        .collect()
}

fn parse_databases(input: &str) -> Vec<SqlCompletionCatalogDatabase> {
    input
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| SqlCompletionCatalogDatabase {
            name: line.to_string(),
        })
        .collect()
}

fn parse_objects(input: &str) -> Vec<SqlCompletionCatalogObject> {
    input
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            Some(SqlCompletionCatalogObject {
                kind: fields.next()?.to_string(),
                schema: fields.next()?.to_string(),
                name: fields.next()?.to_string(),
                qualified_name: fields.next()?.to_string(),
                database: fields.next().unwrap_or_default().to_string(),
            })
        })
        .collect()
}

fn parse_columns(input: &str) -> Vec<SqlCompletionCatalogColumn> {
    input
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            Some(SqlCompletionCatalogColumn {
                schema: fields.next()?.to_string(),
                table: fields.next()?.to_string(),
                name: fields.next()?.to_string(),
                qualified_table_name: fields.next()?.to_string(),
                database: fields.next().unwrap_or_default().to_string(),
            })
        })
        .collect()
}

fn parse_functions(input: &str) -> Vec<SqlCompletionCatalogFunction> {
    input
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            Some(SqlCompletionCatalogFunction {
                schema: fields.next()?.to_string(),
                name: fields.next()?.to_string(),
                qualified_name: fields.next()?.to_string(),
                arguments: empty_to_none(fields.next()?),
                return_type: empty_to_none(fields.next()?),
                database: fields.next().unwrap_or_default().to_string(),
            })
        })
        .collect()
}

fn parse_extensions(input: &str) -> Vec<SqlCompletionCatalogExtension> {
    input
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            Some(SqlCompletionCatalogExtension {
                schema: fields.next()?.to_string(),
                name: fields.next()?.to_string(),
                version: fields.next()?.to_string(),
            })
        })
        .collect()
}

fn empty_to_none(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}
