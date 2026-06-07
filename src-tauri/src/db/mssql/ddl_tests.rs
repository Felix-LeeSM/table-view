use crate::error::AppError;
use crate::models::{
    AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnDefinition, ConstraintDefinition,
    CreateIndexRequest, CreateTableRequest, DropConstraintRequest,
};

use super::MssqlAdapter;

fn column(name: &str, data_type: &str) -> ColumnDefinition {
    ColumnDefinition {
        name: name.into(),
        data_type: data_type.into(),
        nullable: false,
        default_value: None,
        comment: None,
        is_identity: false,
    }
}

fn assert_validation<T: std::fmt::Debug>(result: Result<T, AppError>, needle: &str) {
    assert!(
        matches!(result, Err(AppError::Validation(ref message)) if message.contains(needle)),
        "expected validation containing {needle:?}, got {result:?}"
    );
}

#[tokio::test]
async fn create_table_preview_uses_bracket_quoted_tsql() {
    let req = CreateTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        name: "users".into(),
        columns: vec![
            ColumnDefinition {
                is_identity: true,
                ..column("id", "INT")
            },
            ColumnDefinition {
                nullable: true,
                default_value: Some("N'active'".into()),
                ..column("status", "NVARCHAR(32)")
            },
        ],
        primary_key: Some(vec!["id".into()]),
        preview_only: true,
        table_comment: None,
        expected_database: None,
    };

    let sql = MssqlAdapter::new().create_table(&req).await.unwrap().sql;

    assert_eq!(
        sql,
        "CREATE TABLE [dbo].[users] ([id] INT IDENTITY(1,1) NOT NULL, [status] NVARCHAR(32) DEFAULT N'active', PRIMARY KEY ([id]))"
    );
}

#[tokio::test]
async fn create_table_rejects_comments_and_unknown_pk_columns() {
    let mut req = CreateTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        name: "users".into(),
        columns: vec![column("id", "INT")],
        primary_key: Some(vec!["missing".into()]),
        preview_only: true,
        table_comment: None,
        expected_database: None,
    };

    assert_validation(MssqlAdapter::new().create_table(&req).await, "not declared");

    req.primary_key = None;
    req.table_comment = Some("internal".into());
    assert!(matches!(
        MssqlAdapter::new().create_table(&req).await,
        Err(AppError::Unsupported(message)) if message.contains("Table comments")
    ));
}

#[tokio::test]
async fn index_preview_supports_default_unique_and_rejects_unmapped_types() {
    let req = CreateIndexRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        index_name: "idx_users_email".into(),
        columns: vec!["email".into()],
        index_type: "btree".into(),
        is_unique: true,
        preview_only: true,
        expected_database: None,
    };

    let sql = MssqlAdapter::new().create_index(&req).await.unwrap().sql;

    assert_eq!(
        sql,
        "CREATE UNIQUE INDEX [idx_users_email] ON [dbo].[users] ([email])"
    );

    let mut invalid = req;
    invalid.index_type = "hash".into();
    assert_validation(
        MssqlAdapter::new().create_index(&invalid).await,
        "index type",
    );
}

#[tokio::test]
async fn constraint_preview_covers_fk_actions_unique_check_and_drop() {
    let fk = AddConstraintRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "orders".into(),
        constraint_name: "fk_orders_user".into(),
        definition: ConstraintDefinition::ForeignKey {
            columns: vec!["user_id".into()],
            reference_table: "users".into(),
            reference_columns: vec!["id".into()],
            on_delete: Some("CASCADE".into()),
            on_update: Some("NO ACTION".into()),
        },
        preview_only: true,
        expected_database: None,
    };

    let sql = MssqlAdapter::new().add_constraint(&fk).await.unwrap().sql;
    assert_eq!(
        sql,
        "ALTER TABLE [dbo].[orders] ADD CONSTRAINT [fk_orders_user] FOREIGN KEY ([user_id]) REFERENCES [users] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION"
    );

    let unique = AddConstraintRequest {
        constraint_name: "uq_users_email".into(),
        definition: ConstraintDefinition::Unique {
            columns: vec!["email".into()],
        },
        ..fk.clone()
    };
    assert_eq!(
        MssqlAdapter::new()
            .add_constraint(&unique)
            .await
            .unwrap()
            .sql,
        "ALTER TABLE [dbo].[orders] ADD CONSTRAINT [uq_users_email] UNIQUE ([email])"
    );

    let check = AddConstraintRequest {
        constraint_name: "ck_users_age".into(),
        definition: ConstraintDefinition::Check {
            expression: "age >= 0".into(),
        },
        ..fk
    };
    assert_eq!(
        MssqlAdapter::new()
            .add_constraint(&check)
            .await
            .unwrap()
            .sql,
        "ALTER TABLE [dbo].[orders] ADD CONSTRAINT [ck_users_age] CHECK (age >= 0)"
    );

    let drop_req = DropConstraintRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "orders".into(),
        constraint_name: "fk_orders_user".into(),
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        MssqlAdapter::new()
            .drop_constraint(&drop_req)
            .await
            .unwrap()
            .sql,
        "ALTER TABLE [dbo].[orders] DROP CONSTRAINT [fk_orders_user]"
    );
}

#[tokio::test]
async fn alter_table_preview_emits_tsql_statement_chain() {
    let req = AlterTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        changes: vec![
            ColumnChange::Add {
                name: "nickname".into(),
                data_type: "NVARCHAR(100)".into(),
                nullable: true,
                default_value: None,
            },
            ColumnChange::Modify {
                name: "email".into(),
                new_data_type: Some("NVARCHAR(255)".into()),
                new_nullable: Some(false),
                new_default_value: None,
                using_expression: None,
            },
            ColumnChange::Drop {
                name: "legacy".into(),
            },
        ],
        preview_only: true,
        expected_database: None,
    };

    let sql = MssqlAdapter::new().alter_table(&req).await.unwrap().sql;

    assert_eq!(
        sql,
        "ALTER TABLE [dbo].[users] ADD [nickname] NVARCHAR(100); ALTER TABLE [dbo].[users] ALTER COLUMN [email] NVARCHAR(255) NOT NULL; ALTER TABLE [dbo].[users] DROP COLUMN [legacy]"
    );
}

#[tokio::test]
async fn non_preview_requires_open_connection_after_sql_build() {
    let req = CreateIndexRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        index_name: "idx_users_email".into(),
        columns: vec!["email".into()],
        index_type: "btree".into(),
        is_unique: false,
        preview_only: false,
        expected_database: None,
    };

    let err = MssqlAdapter::new().create_index(&req).await.unwrap_err();

    assert!(matches!(err, AppError::Connection(message) if message.contains("not open")));
}
