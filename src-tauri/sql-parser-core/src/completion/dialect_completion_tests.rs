use super::super::*;

fn empty_vocabulary_request(dialect: &str, shell: &str, text: &str) -> SqlCompletionRequest {
    SqlCompletionRequest {
        text: text.to_string(),
        cursor: CompletionCursorOffsets {
            utf16: text.len(),
            utf8: text.len(),
        },
        dialect: dialect.to_string(),
        shell: shell.to_string(),
        server_version: None,
        vocabulary: SqlCompletionVocabulary {
            keywords: vec![],
            functions: vec![],
        },
        catalog: SqlCompletionCatalogSnapshot {
            revision: "rev-1".to_string(),
            schemas: vec![],
            objects: vec![],
            columns: vec![],
            functions: vec![],
            extensions: vec![],
        },
    }
}

fn mssql_catalog_request(text: &str) -> SqlCompletionRequest {
    let mut req = empty_vocabulary_request("mssql", "none", text);
    req.catalog.schemas = vec![SqlCompletionCatalogSchema {
        name: "dbo".to_string(),
    }];
    req.catalog.objects = vec![SqlCompletionCatalogObject {
        kind: "table".to_string(),
        schema: "dbo".to_string(),
        name: "UserAccounts".to_string(),
        qualified_name: "dbo.UserAccounts".to_string(),
    }];
    req.catalog.columns = vec![SqlCompletionCatalogColumn {
        schema: "dbo".to_string(),
        table: "UserAccounts".to_string(),
        name: "id".to_string(),
        qualified_table_name: "dbo.UserAccounts".to_string(),
    }];
    req.catalog.functions = vec![SqlCompletionCatalogFunction {
        schema: "dbo".to_string(),
        name: "refresh_user_stats".to_string(),
        qualified_name: "dbo.refresh_user_stats".to_string(),
        arguments: None,
        return_type: None,
    }];
    req
}

fn labels(result: &SqlCompletionCoreResult) -> Vec<String> {
    result.items.iter().map(|item| item.label.clone()).collect()
}

fn assert_builtin_completion_contains(dialect: &str, shell: &str, text: &str, label: &str) {
    let result = complete_sql(empty_vocabulary_request(dialect, shell, text));
    let result_labels = labels(&result);

    assert!(
        result_labels.contains(&label.to_string()),
        "{dialect}/{shell} completion for {text:?} did not contain {label:?}; got {result_labels:?}"
    );
}

#[test]
fn mssql_reference_vocabulary_smoke() {
    assert_builtin_completion_contains("mssql", "none", "TO", "TOP");
    assert_builtin_completion_contains("mssql", "none", "OUT", "OUTPUT");
    assert_builtin_completion_contains("mssql", "none", "MER", "MERGE");
    assert_builtin_completion_contains("mssql", "none", "NV", "NVARCHAR");
    assert_builtin_completion_contains("mssql", "none", "UNIQUE", "UNIQUEIDENTIFIER");
    assert_builtin_completion_contains("mssql", "none", "GET", "GETDATE");
    assert_builtin_completion_contains("mssql", "none", "NEW", "NEWID");
    assert_builtin_completion_contains("mssql", "none", "OBJECT", "OBJECT_ID");
    assert_builtin_completion_contains("mssql", "none", "SCOPE", "SCOPE_IDENTITY");

    let result = complete_sql(empty_vocabulary_request("mssql", "none", "TO"));
    let top = result
        .items
        .iter()
        .find(|item| item.label == "TOP")
        .expect("MSSQL TOP keyword candidate");
    assert_eq!(top.detail.as_deref(), Some("SQL Server keyword"));
}

#[test]
fn mssql_bracket_identifier_context_applies_catalog_relation_with_brackets() {
    let result = complete_sql(mssql_catalog_request("SELECT * FROM [User"));
    let table = result
        .items
        .iter()
        .find(|item| item.label == "UserAccounts")
        .expect("MSSQL table candidate from bracket prefix");

    assert_eq!(table.kind, "table");
    assert_eq!(table.apply.as_deref(), Some("[UserAccounts]"));
    assert_eq!(
        result.replace_range.from,
        CompletionCursorOffsets {
            utf16: 14,
            utf8: 14
        }
    );
}

#[test]
fn mssql_catalog_routine_suggestions_are_not_marked_runtime_executable() {
    let result = complete_sql(mssql_catalog_request("SELECT dbo.refresh"));
    let routine = result
        .items
        .iter()
        .find(|item| item.label == "refresh_user_stats")
        .expect("MSSQL catalog routine candidate");

    assert_eq!(routine.kind, "function");
    assert_eq!(routine.detail.as_deref(), Some("dbo.refresh_user_stats"));
    assert_eq!(routine.runtime_executable, None);
}

#[test]
fn oracle_reference_sql_vocabulary_smoke() {
    assert_builtin_completion_contains("oracle", "none", "ROW", "ROWNUM");
    assert_builtin_completion_contains("oracle", "none", "MER", "MERGE");
    assert_builtin_completion_contains("oracle", "none", "MIN", "MINUS");
    assert_builtin_completion_contains("oracle", "none", "CONNECT", "CONNECT BY");
    assert_builtin_completion_contains("oracle", "none", "START", "START WITH");
    assert_builtin_completion_contains("oracle", "none", "SEQ", "SEQUENCE");
    assert_builtin_completion_contains("oracle", "none", "SYN", "SYNONYM");
    assert_builtin_completion_contains("oracle", "none", "PACK", "PACKAGE");
    assert_builtin_completion_contains("oracle", "none", "VARCHAR", "VARCHAR2");
    assert_builtin_completion_contains("oracle", "none", "NUM", "NUMBER");
    assert_builtin_completion_contains("oracle", "none", "SYSD", "SYSDATE");
    assert_builtin_completion_contains("oracle", "none", "SYST", "SYSTIMESTAMP");
    assert_builtin_completion_contains("oracle", "none", "NV", "NVL");
    assert_builtin_completion_contains("oracle", "none", "TO_C", "TO_CHAR");
    assert_builtin_completion_contains("oracle", "none", "TO_D", "TO_DATE");
    assert_builtin_completion_contains("oracle", "none", "TO_N", "TO_NUMBER");

    let result = complete_sql(empty_vocabulary_request("oracle", "none", "NV"));
    let nvl = result
        .items
        .iter()
        .find(|item| item.label == "NVL")
        .expect("Oracle NVL function candidate");
    assert_eq!(nvl.detail.as_deref(), Some("Oracle function"));
}
