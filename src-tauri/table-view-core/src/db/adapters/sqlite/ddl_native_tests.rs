use super::*;

// --------------------------------------------------------------------------
// Request builders
// --------------------------------------------------------------------------

const CONNECTION: &str = "sqlite-ddl";

fn drop_table_req(table: &str) -> DropTableRequest {
    DropTableRequest {
        connection_id: CONNECTION.to_string(),
        schema: "main".to_string(),
        table: table.to_string(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    }
}

fn rename_table_req(table: &str, new_name: &str) -> RenameTableRequest {
    RenameTableRequest {
        connection_id: CONNECTION.to_string(),
        schema: "main".to_string(),
        table: table.to_string(),
        new_name: new_name.to_string(),
        preview_only: true,
        expected_database: None,
    }
}

fn column(name: &str, data_type: &str, nullable: bool) -> ColumnDefinition {
    ColumnDefinition {
        name: name.to_string(),
        data_type: data_type.to_string(),
        nullable,
        default_value: None,
        comment: None,
        is_identity: false,
    }
}

fn add_column_req(table: &str, col: ColumnDefinition) -> AddColumnRequest {
    AddColumnRequest {
        connection_id: CONNECTION.to_string(),
        schema: "main".to_string(),
        table: table.to_string(),
        column: col,
        check_expression: None,
        preview_only: true,
        expected_database: None,
    }
}

fn drop_column_req(table: &str, column_name: &str) -> DropColumnRequest {
    DropColumnRequest {
        connection_id: CONNECTION.to_string(),
        schema: "main".to_string(),
        table: table.to_string(),
        column_name: column_name.to_string(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    }
}

fn alter_table_req(table: &str, changes: Vec<ColumnChange>) -> AlterTableRequest {
    AlterTableRequest {
        connection_id: CONNECTION.to_string(),
        schema: "main".to_string(),
        table: table.to_string(),
        changes,
        preview_only: true,
        expected_database: None,
    }
}

fn create_index_req(table: &str, index_name: &str, columns: &[&str]) -> CreateIndexRequest {
    CreateIndexRequest {
        connection_id: CONNECTION.to_string(),
        schema: "main".to_string(),
        table: table.to_string(),
        index_name: index_name.to_string(),
        columns: columns.iter().map(|c| c.to_string()).collect(),
        index_type: "btree".to_string(),
        is_unique: false,
        preview_only: true,
        expected_database: None,
    }
}

fn drop_index_req(index_name: &str) -> DropIndexRequest {
    DropIndexRequest {
        connection_id: CONNECTION.to_string(),
        schema: "main".to_string(),
        index_name: index_name.to_string(),
        table: "users".to_string(),
        if_exists: false,
        preview_only: true,
        expected_database: None,
    }
}

// --------------------------------------------------------------------------
// SQL emission — pure builders
// --------------------------------------------------------------------------

#[test]
fn emits_native_statements_with_quoted_identifiers() {
    assert_eq!(
        build_drop_table_sql(&drop_table_req("users")).unwrap(),
        "DROP TABLE \"users\""
    );
    assert_eq!(
        build_rename_table_sql(&rename_table_req("users", "people")).unwrap(),
        "ALTER TABLE \"users\" RENAME TO \"people\""
    );
    assert_eq!(
        build_add_column_statement(&add_column_req("users", column("nickname", "TEXT", true)))
            .unwrap()
            .sql,
        "ALTER TABLE \"users\" ADD COLUMN \"nickname\" TEXT"
    );
    assert_eq!(
        build_drop_column_statement(&drop_column_req("users", "nickname"))
            .unwrap()
            .sql,
        "ALTER TABLE \"users\" DROP COLUMN \"nickname\""
    );
    assert_eq!(
        build_drop_index_sql(&drop_index_req("idx_users_email")).unwrap(),
        "DROP INDEX \"idx_users_email\""
    );
}

#[test]
fn add_column_carries_not_null_and_default() {
    let mut col = column("status", "TEXT", false);
    col.default_value = Some("'new'".to_string());

    let statement = build_add_column_statement(&add_column_req("users", col)).unwrap();

    assert_eq!(
        statement.sql,
        "ALTER TABLE \"users\" ADD COLUMN \"status\" TEXT NOT NULL DEFAULT 'new'"
    );
    // The runner needs the column name to build the ADD COLUMN restriction
    // message — SQLite's own text never names it.
    assert_eq!(statement.column.as_deref(), Some("status"));
}

#[test]
fn create_index_emits_unique_and_column_list_without_an_index_method() {
    let mut req = create_index_req("users", "idx_users_email_name", &["email", "name"]);
    req.is_unique = true;

    assert_eq!(
        build_create_index_sql(&req).unwrap(),
        "CREATE UNIQUE INDEX \"idx_users_email_name\" ON \"users\" (\"email\", \"name\")"
    );
}

#[test]
fn drop_index_honours_if_exists() {
    let mut req = drop_index_req("idx_users_email");
    req.if_exists = true;

    assert_eq!(
        build_drop_index_sql(&req).unwrap(),
        "DROP INDEX IF EXISTS \"idx_users_email\""
    );
}

#[test]
fn alter_table_emits_one_statement_per_change() {
    let statements = build_alter_table_statements(&alter_table_req(
        "users",
        vec![
            ColumnChange::Add {
                name: "nickname".to_string(),
                data_type: "TEXT".to_string(),
                nullable: true,
                default_value: None,
            },
            ColumnChange::Drop {
                name: "legacy".to_string(),
            },
        ],
    ))
    .unwrap();

    let sql: Vec<&str> = statements.iter().map(|s| s.sql.as_str()).collect();
    assert_eq!(
        sql,
        vec![
            "ALTER TABLE \"users\" ADD COLUMN \"nickname\" TEXT",
            "ALTER TABLE \"users\" DROP COLUMN \"legacy\"",
        ]
    );
}

// --------------------------------------------------------------------------
// The rebuild boundary — what stays refused
// --------------------------------------------------------------------------

#[test]
fn alter_table_refuses_in_place_column_modification_and_names_the_column() {
    let result = build_alter_table_statements(&alter_table_req(
        "users",
        vec![ColumnChange::Modify {
            name: "email".to_string(),
            new_data_type: Some("INTEGER".to_string()),
            new_nullable: None,
            new_default_value: None,
            using_expression: None,
            new_comment: None,
        }],
    ));

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("\"email\""), "{message}");
            assert!(message.contains("rebuild"), "{message}");
        }
        other => panic!("expected an unsupported rebuild boundary, got {other:?}"),
    }
}

/// A `Modify` anywhere in the batch blocks the whole `ALTER TABLE`, so the
/// supported changes beside it are never applied on their own.
#[test]
fn alter_table_refuses_the_whole_batch_when_one_change_needs_a_rebuild() {
    let result = build_alter_table_statements(&alter_table_req(
        "users",
        vec![
            ColumnChange::Drop {
                name: "legacy".to_string(),
            },
            ColumnChange::Modify {
                name: "email".to_string(),
                new_data_type: Some("INTEGER".to_string()),
                new_nullable: None,
                new_default_value: None,
                using_expression: None,
                new_comment: None,
            },
        ],
    ));

    assert!(
        matches!(result, Err(AppError::Unsupported(_))),
        "{result:?}"
    );
}

#[test]
fn alter_table_requires_at_least_one_change() {
    let result = build_alter_table_statements(&alter_table_req("users", vec![]));

    assert!(matches!(result, Err(AppError::Validation(_))), "{result:?}");
}

#[test]
fn add_column_refuses_a_check_constraint() {
    let mut req = add_column_req("users", column("age", "INTEGER", true));
    req.check_expression = Some("age > 0".to_string());

    let result = build_add_column_statement(&req);

    assert!(
        matches!(&result, Err(AppError::Unsupported(message)) if message.contains("CHECK")),
        "{result:?}"
    );
}

/// SQLite has no `CASCADE`. Emitting the statement without it would run a
/// different operation than the one requested, so both cascade paths refuse.
#[test]
fn cascade_is_refused_rather_than_silently_dropped() {
    let mut drop_table = drop_table_req("users");
    drop_table.cascade = true;
    let mut drop_column = drop_column_req("users", "email");
    drop_column.cascade = true;

    for result in [
        build_drop_table_sql(&drop_table).map(|_| ()),
        build_drop_column_statement(&drop_column).map(|_| ()),
    ] {
        assert!(
            matches!(&result, Err(AppError::Unsupported(message)) if message.contains("CASCADE")),
            "{result:?}"
        );
    }
}

#[test]
fn index_methods_other_than_the_btree_default_are_refused() {
    let mut gin = create_index_req("users", "idx_users_email", &["email"]);
    gin.index_type = "gin".to_string();
    let mut empty = create_index_req("users", "idx_users_email", &["email"]);
    empty.index_type = String::new();

    assert!(
        matches!(build_create_index_sql(&gin), Err(AppError::Validation(_))),
        "a non-btree method must be refused, not silently dropped"
    );
    assert!(build_create_index_sql(&empty).is_ok());
}

#[test]
fn index_requires_at_least_one_column() {
    let result = build_create_index_sql(&create_index_req("users", "idx_users_none", &[]));

    assert!(matches!(result, Err(AppError::Validation(_))), "{result:?}");
}

/// The internal bookkeeping objects stay out of reach on every entry point
/// that names an existing object.
#[test]
fn reserved_sqlite_objects_are_out_of_reach() {
    let results = [
        build_drop_table_sql(&drop_table_req("sqlite_sequence")).map(|_| ()),
        build_rename_table_sql(&rename_table_req("sqlite_stat1", "stats")).map(|_| ()),
        build_rename_table_sql(&rename_table_req("users", "sqlite_users")).map(|_| ()),
        build_drop_index_sql(&drop_index_req("sqlite_autoindex_users_1")).map(|_| ()),
        build_add_column_statement(&add_column_req(
            "sqlite_sequence",
            column("extra", "TEXT", true),
        ))
        .map(|_| ()),
        build_drop_column_statement(&drop_column_req("sqlite_sequence", "seq")).map(|_| ()),
        build_alter_table_statements(&alter_table_req(
            "sqlite_sequence",
            vec![ColumnChange::Drop {
                name: "seq".to_string(),
            }],
        ))
        .map(|_| ()),
        build_create_index_sql(&create_index_req("sqlite_sequence", "idx_seq", &["seq"]))
            .map(|_| ()),
    ];

    for result in results {
        assert!(
            matches!(&result, Err(AppError::Validation(message)) if message.contains("sqlite_")),
            "{result:?}"
        );
    }
}

/// SQLite exposes one namespace. Every entry point rejects any other, so a
/// stale `schema` from a multi-schema engine cannot silently target `main`.
#[test]
fn non_main_namespaces_are_refused_on_every_entry_point() {
    let namespace = "public".to_string();
    let mut drop_table = drop_table_req("users");
    drop_table.schema = namespace.clone();
    let mut rename = rename_table_req("users", "people");
    rename.schema = namespace.clone();
    let mut add = add_column_req("users", column("nickname", "TEXT", true));
    add.schema = namespace.clone();
    let mut drop_column = drop_column_req("users", "email");
    drop_column.schema = namespace.clone();
    let mut alter = alter_table_req(
        "users",
        vec![ColumnChange::Drop {
            name: "email".to_string(),
        }],
    );
    alter.schema = namespace.clone();
    let mut create_index = create_index_req("users", "idx_users_email", &["email"]);
    create_index.schema = namespace.clone();
    let mut drop_index = drop_index_req("idx_users_email");
    drop_index.schema = namespace;

    let results = [
        build_drop_table_sql(&drop_table).map(|_| ()),
        build_rename_table_sql(&rename).map(|_| ()),
        build_add_column_statement(&add).map(|_| ()),
        build_drop_column_statement(&drop_column).map(|_| ()),
        build_alter_table_statements(&alter).map(|_| ()),
        build_create_index_sql(&create_index).map(|_| ()),
        build_drop_index_sql(&drop_index).map(|_| ()),
    ];

    for result in results {
        assert!(
            matches!(&result, Err(AppError::Validation(message)) if message.contains("main")),
            "{result:?}"
        );
    }
}

/// The statement-breakout guard the create-table path already applies reaches
/// the new entry points too, because they share `build_column_definition`.
#[test]
fn add_column_rejects_statement_escape_fragments() {
    let result = build_add_column_statement(&add_column_req(
        "users",
        column("evil", "TEXT; DROP TABLE users", true),
    ));

    assert!(
        matches!(&result, Err(AppError::Validation(message)) if message.contains("statement terminators")),
        "{result:?}"
    );
}

// Pool-backed cases live in a sibling file: this one stays a pure-builder suite
// and the request helpers above are shared with it through `use super::*`.
#[cfg(test)]
#[path = "ddl_native_live_tests.rs"]
mod live;
