use table_view_lib::db::mysql::MysqlAdapter;
use table_view_lib::models::{
    AddConstraintRequest, ColumnDefinition, ConstraintDefinition, CreateIndexRequest,
    CreateTableRequest,
};

#[tokio::test]
async fn mariadb_adapter_uses_mysql_family_bounded_ddl_preview() {
    let adapter = MysqlAdapter::new_mariadb();

    let table = adapter
        .create_table(&CreateTableRequest {
            connection_id: "c".into(),
            schema: "shop".into(),
            name: "orders".into(),
            columns: vec![
                ColumnDefinition {
                    name: "id".into(),
                    data_type: "BIGINT".into(),
                    nullable: false,
                    default_value: None,
                    is_identity: true,
                    comment: None,
                },
                ColumnDefinition {
                    name: "user_id".into(),
                    data_type: "BIGINT".into(),
                    nullable: false,
                    default_value: None,
                    is_identity: false,
                    comment: None,
                },
                ColumnDefinition {
                    name: "code".into(),
                    data_type: "VARCHAR(64)".into(),
                    nullable: false,
                    default_value: None,
                    is_identity: false,
                    comment: None,
                },
            ],
            primary_key: Some(vec!["id".into()]),
            table_comment: None,
            preview_only: true,
            expected_database: None,
        })
        .await
        .unwrap();
    assert_eq!(
        table.sql,
        "CREATE TABLE `shop`.`orders` (`id` BIGINT AUTO_INCREMENT NOT NULL, `user_id` BIGINT NOT NULL, `code` VARCHAR(64) NOT NULL, PRIMARY KEY (`id`))"
    );

    let index = adapter
        .create_index(&CreateIndexRequest {
            connection_id: "c".into(),
            schema: "shop".into(),
            table: "orders".into(),
            index_name: "uq_orders_code".into(),
            columns: vec!["code".into()],
            is_unique: true,
            index_type: "btree".into(),
            preview_only: true,
            expected_database: None,
        })
        .await
        .unwrap();
    assert_eq!(
        index.sql,
        "CREATE UNIQUE INDEX `uq_orders_code` USING BTREE ON `shop`.`orders` (`code`)"
    );

    let fk = adapter
        .add_constraint(&AddConstraintRequest {
            connection_id: "c".into(),
            schema: "shop".into(),
            table: "orders".into(),
            constraint_name: "fk_orders_user".into(),
            definition: ConstraintDefinition::ForeignKey {
                columns: vec!["user_id".into()],
                reference_table: "users".into(),
                reference_columns: vec!["id".into()],
                on_delete: Some("CASCADE".into()),
                on_update: None,
            },
            preview_only: true,
            expected_database: None,
        })
        .await
        .unwrap();
    assert_eq!(
        fk.sql,
        "ALTER TABLE `shop`.`orders` ADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE"
    );
}
