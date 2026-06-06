use serde_json::{json, Value};

use super::super::catalog::{
    mssql_columns_from_rows, mssql_constraints_from_rows, mssql_indexes_from_rows,
};

#[test]
fn catalog_row_mappers_preserve_columns_indexes_and_constraints() {
    let columns = mssql_columns_from_rows(
        vec![
            vec![
                json!("id"),
                json!("int"),
                json!(4),
                Value::Null,
                Value::Null,
                json!(false),
                Value::Null,
                json!("identifier"),
            ],
            vec![
                json!("email"),
                json!("nvarchar"),
                json!(640),
                Value::Null,
                Value::Null,
                json!("1"),
                json!("N''"),
                json!(""),
            ],
            vec![Value::Null],
        ],
        vec![vec![json!("id")], vec![Value::Null]],
        vec![
            vec![
                json!("email"),
                json!("dbo"),
                json!("profiles"),
                json!("email"),
            ],
            vec![Value::Null],
        ],
        vec![
            vec![json!("email"), json!("email LIKE N'%@example.com'")],
            vec![Value::Null, json!("ignored")],
        ],
    );

    assert_eq!(columns.len(), 2);
    assert_eq!(columns[0].name, "id");
    assert_eq!(columns[0].data_type, "int");
    assert!(columns[0].is_primary_key);
    assert_eq!(columns[0].comment.as_deref(), Some("identifier"));
    assert_eq!(columns[1].data_type, "nvarchar(320)");
    assert!(columns[1].nullable);
    assert!(columns[1].is_foreign_key);
    assert_eq!(
        columns[1].fk_reference.as_deref(),
        Some("dbo.profiles(email)")
    );
    assert_eq!(
        columns[1].check_clauses,
        vec!["email LIKE N'%@example.com'"]
    );

    let indexes = mssql_indexes_from_rows(vec![
        vec![
            json!("pk_users"),
            json!("id"),
            json!("CLUSTERED"),
            json!(true),
            json!(true),
        ],
        vec![
            json!("idx_users_email"),
            json!("email"),
            json!("NONCLUSTERED"),
            json!("0"),
            json!("0"),
        ],
        vec![Value::Null],
    ]);
    assert_eq!(indexes.len(), 2);
    assert_eq!(indexes[0].name, "idx_users_email");
    assert_eq!(indexes[0].columns, vec!["email"]);
    assert_eq!(indexes[0].index_type, "nonclustered");
    assert!(!indexes[0].is_unique);
    assert!(indexes[1].is_primary);

    let constraints = mssql_constraints_from_rows(vec![
        vec![
            json!("pk_users"),
            json!("PRIMARY_KEY_CONSTRAINT"),
            json!("id"),
            Value::Null,
            Value::Null,
        ],
        vec![
            json!("pk_users"),
            json!("PRIMARY_KEY_CONSTRAINT"),
            json!("id"),
            Value::Null,
            Value::Null,
        ],
        vec![
            json!("fk_users_profile"),
            json!("FOREIGN KEY"),
            json!("email"),
            json!("profiles"),
            json!("email"),
        ],
        vec![
            json!("fk_users_profile"),
            json!("FOREIGN KEY"),
            json!("email"),
            json!("profiles"),
            json!("email"),
        ],
        vec![
            json!("ck_users_email"),
            json!("CHECK"),
            Value::Null,
            Value::Null,
            Value::Null,
        ],
        vec![Value::Null],
    ]);

    assert_eq!(constraints.len(), 3);
    assert_eq!(constraints[0].name, "ck_users_email");
    assert_eq!(constraints[1].columns, vec!["email"]);
    assert_eq!(constraints[1].reference_table.as_deref(), Some("profiles"));
    assert_eq!(
        constraints[1].reference_columns.as_ref().unwrap(),
        &vec!["email".to_string()]
    );
    assert_eq!(constraints[2].columns, vec!["id"]);
}
