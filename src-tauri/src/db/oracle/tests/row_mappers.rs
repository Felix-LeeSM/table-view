use serde_json::{json, Value};

use super::super::metadata::{
    oracle_columns_from_rows, oracle_constraints_from_rows, oracle_indexes_from_rows,
};

#[test]
fn metadata_row_mappers_preserve_columns_indexes_and_constraints() {
    let columns = oracle_columns_from_rows(
        vec![
            vec![
                json!("ID"),
                json!("NUMBER"),
                Value::Null,
                json!(10),
                json!(0),
                json!("N"),
                Value::Null,
            ],
            vec![
                json!("EMAIL"),
                json!("VARCHAR2"),
                json!(320),
                Value::Null,
                Value::Null,
                json!("Y"),
                json!("'n/a'"),
            ],
            vec![Value::Null],
        ],
        vec![vec![json!("ID")], vec![Value::Null]],
        vec![
            vec![
                json!("EMAIL"),
                json!("APP"),
                json!("PROFILES"),
                json!("EMAIL"),
            ],
            vec![Value::Null],
        ],
        vec![
            vec![json!("EMAIL"), json!("EMAIL LIKE '%@example.com'")],
            vec![Value::Null, json!("ignored")],
        ],
    );

    assert_eq!(columns.len(), 2);
    assert_eq!(columns[0].name, "ID");
    assert_eq!(columns[0].data_type, "NUMBER(10,0)");
    assert!(columns[0].is_primary_key);
    assert!(!columns[0].nullable);
    assert_eq!(columns[1].data_type, "VARCHAR2(320)");
    assert!(columns[1].nullable);
    assert!(columns[1].is_foreign_key);
    assert_eq!(
        columns[1].fk_reference.as_deref(),
        Some("APP.PROFILES(EMAIL)")
    );
    assert_eq!(columns[1].check_clauses, vec!["EMAIL LIKE '%@example.com'"]);

    let indexes = oracle_indexes_from_rows(vec![
        vec![
            json!("PK_USERS"),
            json!("ID"),
            json!("NORMAL"),
            json!("UNIQUE"),
            json!(1),
        ],
        vec![
            json!("IDX_USERS_EMAIL"),
            json!("EMAIL"),
            json!("BITMAP"),
            json!("NONUNIQUE"),
            json!(0),
        ],
        vec![Value::Null],
    ]);
    assert_eq!(indexes.len(), 2);
    assert_eq!(indexes[0].name, "IDX_USERS_EMAIL");
    assert_eq!(indexes[0].index_type, "bitmap");
    assert!(!indexes[0].is_unique);
    assert!(indexes[1].is_primary);

    let constraints = oracle_constraints_from_rows(vec![
        vec![
            json!("PK_USERS"),
            json!("P"),
            json!("ID"),
            Value::Null,
            Value::Null,
        ],
        vec![
            json!("PK_USERS"),
            json!("P"),
            json!("ID"),
            Value::Null,
            Value::Null,
        ],
        vec![
            json!("FK_USERS_PROFILE"),
            json!("R"),
            json!("EMAIL"),
            json!("PROFILES"),
            json!("EMAIL"),
        ],
        vec![
            json!("FK_USERS_PROFILE"),
            json!("R"),
            json!("EMAIL"),
            json!("PROFILES"),
            json!("EMAIL"),
        ],
        vec![
            json!("CK_USERS_EMAIL"),
            json!("C"),
            Value::Null,
            Value::Null,
            Value::Null,
        ],
        vec![Value::Null],
    ]);

    assert_eq!(constraints.len(), 3);
    assert_eq!(constraints[0].constraint_type, "CHECK");
    assert_eq!(constraints[1].columns, vec!["EMAIL"]);
    assert_eq!(constraints[1].reference_table.as_deref(), Some("PROFILES"));
    assert_eq!(
        constraints[1].reference_columns.as_ref().unwrap(),
        &vec!["EMAIL".to_string()]
    );
    assert_eq!(constraints[2].columns, vec!["ID"]);
}
