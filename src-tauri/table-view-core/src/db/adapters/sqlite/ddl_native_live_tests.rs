//! Pool-backed SQLite DDL cases — the restriction messages and the execution
//! path, driven through a real database file so the strings the mapper matches
//! are the engine's rather than the author's.

use super::*;
use crate::models::{ConnectionConfig, DatabaseType};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

fn sqlite_config(path: &str, read_only: bool) -> ConnectionConfig {
    ConnectionConfig {
        id: CONNECTION.to_string(),
        name: "SQLite DDL".to_string(),
        db_type: DatabaseType::Sqlite,
        host: String::new(),
        port: 0,
        user: String::new(),
        password: String::new(),
        database: path.to_string(),
        read_only,
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
        trust_server_certificate: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    }
}

/// A connected adapter over a fresh file seeded with `setup`, plus the
/// `TempDir` the caller must hold for the file to outlive the test body.
async fn connected(setup: &[&str], read_only: bool) -> (tempfile::TempDir, SqliteAdapter) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ddl.sqlite");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();
    for statement in setup {
        sqlx::query(statement).execute(&pool).await.unwrap();
    }
    pool.close().await;

    let adapter = SqliteAdapter::new();
    adapter
        .connect_pool(&sqlite_config(path.to_str().unwrap(), read_only))
        .await
        .unwrap();
    (dir, adapter)
}

const USERS: &[&str] = &[
    "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, note TEXT)",
    "INSERT INTO users (id, email, name, note) VALUES (1, 'a@example.test', 'A', 'n')",
];

fn database_error(result: Result<SchemaChangeResult, AppError>) -> String {
    match result {
        Err(AppError::Database(message)) => message,
        other => panic!("expected AppError::Database, got {other:?}"),
    }
}

#[tokio::test]
async fn native_ddl_round_trip_applies_to_a_writable_file() {
    let (_dir, adapter) = connected(USERS, false).await;

    let mut add = add_column_req("users", column("nickname", "TEXT", true));
    add.preview_only = false;
    adapter.add_column(&add).await.unwrap();

    let mut index = create_index_req("users", "idx_users_nickname", &["nickname"]);
    index.preview_only = false;
    adapter.create_index(&index).await.unwrap();

    let mut drop_note = drop_column_req("users", "note");
    drop_note.preview_only = false;
    adapter.drop_column(&drop_note).await.unwrap();

    let mut rename = rename_table_req("users", "people");
    rename.preview_only = false;
    adapter.rename_table(&rename).await.unwrap();

    let columns = adapter.get_table_columns("main", "people").await.unwrap();
    let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    assert!(names.contains(&"nickname"), "{names:?}");
    assert!(!names.contains(&"note"), "{names:?}");

    let mut drop_index = drop_index_req("idx_users_nickname");
    drop_index.preview_only = false;
    adapter.drop_index(&drop_index).await.unwrap();
    assert!(adapter
        .get_table_indexes("main", "people")
        .await
        .unwrap()
        .iter()
        .all(|index| index.name != "idx_users_nickname"));

    let mut drop_table = drop_table_req("people");
    drop_table.preview_only = false;
    adapter.drop_table(&drop_table).await.unwrap();
    assert!(adapter
        .list_tables("main")
        .await
        .unwrap()
        .iter()
        .all(|table| table.name != "people"));
}

/// Regression: the adapter pool hands out several connections, each with its
/// own cached schema. Adding a column and dropping it in the same session lands
/// the two statements on different connections, and without the schema refresh
/// in `run_ddl_or_preview` the drop fails with `no such column` on a column
/// that plainly exists.
#[tokio::test]
async fn a_column_added_in_this_session_can_be_dropped_again() {
    let (_dir, adapter) = connected(USERS, false).await;

    // Force the pool to hold several live connections, each with its own cached
    // schema, so the add and the drop cannot both land on the same one. A
    // single-connection pool never reproduces this.
    let pool = adapter.active_pool().await.unwrap();
    let mut warm = Vec::new();
    for _ in 0..4 {
        let mut conn = pool.acquire().await.unwrap();
        sqlx::query("SELECT * FROM users")
            .fetch_all(&mut *conn)
            .await
            .unwrap();
        warm.push(conn);
    }

    let mut add = add_column_req("users", column("locale", "TEXT", true));
    add.preview_only = false;
    adapter.add_column(&add).await.unwrap();
    drop(warm);

    let mut drop = drop_column_req("users", "locale");
    drop.preview_only = false;
    adapter.drop_column(&drop).await.unwrap();

    assert!(adapter
        .get_table_columns("main", "users")
        .await
        .unwrap()
        .iter()
        .all(|c| c.name != "locale"));
}

/// `preview_only` returns the SQL without touching the file — the same
/// preview/confirm contract `create_table` already honours.
#[tokio::test]
async fn preview_returns_sql_without_mutating_the_file() {
    let (_dir, adapter) = connected(USERS, false).await;

    let preview = adapter.drop_table(&drop_table_req("users")).await.unwrap();

    assert_eq!(preview.sql, "DROP TABLE \"users\"");
    assert!(adapter
        .list_tables("main")
        .await
        .unwrap()
        .iter()
        .any(|table| table.name == "users"));
}

/// AC — a read-only file refuses every newly opened entry point. Preview is
/// still allowed there (it writes nothing), so each case runs with
/// `preview_only = false`.
#[tokio::test]
async fn read_only_file_refuses_every_native_entry_point() {
    let (_dir, adapter) = connected(USERS, true).await;

    let mut drop_table = drop_table_req("users");
    drop_table.preview_only = false;
    let mut rename = rename_table_req("users", "people");
    rename.preview_only = false;
    let mut add = add_column_req("users", column("nickname", "TEXT", true));
    add.preview_only = false;
    let mut drop_column = drop_column_req("users", "note");
    drop_column.preview_only = false;
    let mut alter = alter_table_req(
        "users",
        vec![ColumnChange::Drop {
            name: "note".to_string(),
        }],
    );
    alter.preview_only = false;
    let mut create_index = create_index_req("users", "idx_users_name", &["name"]);
    create_index.preview_only = false;
    let mut drop_index = drop_index_req("idx_users_name");
    drop_index.preview_only = false;

    let results = vec![
        adapter.drop_table(&drop_table).await,
        adapter.rename_table(&rename).await,
        adapter.add_column(&add).await,
        adapter.drop_column(&drop_column).await,
        adapter.alter_table(&alter).await,
        adapter.create_index(&create_index).await,
        adapter.drop_index(&drop_index).await,
    ];

    assert_eq!(results.len(), 7, "every opened entry point must be covered");
    for result in results {
        match result {
            Err(AppError::Unsupported(message)) => {
                assert!(message.contains("read-only SQLite connection"), "{message}")
            }
            other => panic!("read-only file must refuse the write: {other:?}"),
        }
    }

    // The refusal is a refusal, not a silent no-op that reports success.
    let columns = adapter.get_table_columns("main", "users").await.unwrap();
    assert!(columns.iter().any(|c| c.name == "note"));
}

/// A mid-batch failure rolls the whole `ALTER TABLE` back. SQLite applies one
/// alteration per statement, so without the transaction the first change would
/// stick while the second failed.
#[tokio::test]
async fn a_failed_change_rolls_back_the_earlier_ones() {
    let (_dir, adapter) = connected(USERS, false).await;

    let mut alter = alter_table_req(
        "users",
        vec![
            ColumnChange::Drop {
                name: "note".to_string(),
            },
            // `email` carries a UNIQUE constraint, so SQLite refuses it.
            ColumnChange::Drop {
                name: "email".to_string(),
            },
        ],
    );
    alter.preview_only = false;

    let message = database_error(adapter.alter_table(&alter).await);
    assert!(message.contains("UNIQUE"), "{message}");

    let names: Vec<String> = adapter
        .get_table_columns("main", "users")
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert!(
        names.iter().any(|n| n == "note"),
        "the first change must have rolled back: {names:?}"
    );
}

/// Every `DROP COLUMN` restriction arm, driven through real SQLite so the
/// strings the mapper matches are the engine's, not the author's.
#[tokio::test]
async fn drop_column_restrictions_surface_the_column_and_the_blocking_object() {
    let cases: [(&str, &[&str], &str, &[&str]); 6] = [
        (
            "primary key",
            &["CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)"],
            "id",
            &["\"id\"", "PRIMARY KEY"],
        ),
        (
            "unique",
            &["CREATE TABLE t (id INTEGER, email TEXT UNIQUE)"],
            "email",
            &["\"email\"", "UNIQUE"],
        ),
        (
            "index",
            &[
                "CREATE TABLE t (id INTEGER, name TEXT)",
                "CREATE INDEX ix_name ON t(name)",
            ],
            "name",
            &["index", "\"ix_name\""],
        ),
        (
            "view",
            &[
                "CREATE TABLE t (id INTEGER, name TEXT)",
                "CREATE VIEW v_name AS SELECT name FROM t",
            ],
            "name",
            &["view", "\"v_name\""],
        ),
        (
            "trigger",
            &[
                "CREATE TABLE t (id INTEGER, name TEXT)",
                "CREATE TRIGGER tg_name AFTER INSERT ON t BEGIN SELECT NEW.name; END",
            ],
            "name",
            &["trigger", "\"tg_name\""],
        ),
        (
            "last column",
            &["CREATE TABLE t (name TEXT)"],
            "name",
            &["\"name\"", "only column"],
        ),
    ];

    for (label, setup, column_name, expected) in cases {
        let (_dir, adapter) = connected(setup, false).await;
        let mut req = drop_column_req("t", column_name);
        req.preview_only = false;

        let message = database_error(adapter.drop_column(&req).await);

        for needle in expected {
            assert!(
                message.contains(needle),
                "{label}: {needle} missing: {message}"
            );
        }
        // The driver text survives beside the advice, so a diagnosis is never
        // traded away for a friendlier sentence.
        assert!(message.contains("SQLite:"), "{label}: {message}");
    }
}

/// The `ADD COLUMN` restrictions this adapter can reach. SQLite enforces both
/// only once the table holds rows, which is why they cannot be decided from the
/// request alone and are mapped after the failure instead.
#[tokio::test]
async fn add_column_restrictions_name_the_column_and_the_remedy() {
    let setup: &[&str] = &[
        "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)",
        "INSERT INTO t (id, name) VALUES (1, 'a')",
    ];

    let (_dir, adapter) = connected(setup, false).await;
    let mut not_null = add_column_req("t", column("status", "TEXT", false));
    not_null.preview_only = false;
    let message = database_error(adapter.add_column(&not_null).await);
    assert!(message.contains("\"status\""), "{message}");
    assert!(message.contains("DEFAULT"), "{message}");

    let (_dir2, adapter2) = connected(setup, false).await;
    let mut non_constant = column("created_at", "TEXT", true);
    non_constant.default_value = Some("CURRENT_TIMESTAMP".to_string());
    let mut req = add_column_req("t", non_constant);
    req.preview_only = false;
    let message = database_error(adapter2.add_column(&req).await);
    assert!(message.contains("\"created_at\""), "{message}");
    assert!(message.contains("constant"), "{message}");
}

/// On an empty table SQLite accepts both statements above, so the mapper must
/// not be replaced by an upfront rejection: it would block a legal change.
#[tokio::test]
async fn the_same_add_column_succeeds_while_the_table_is_empty() {
    let (_dir, adapter) = connected(
        &["CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)"],
        false,
    )
    .await;
    let mut req = add_column_req("t", column("status", "TEXT", false));
    req.preview_only = false;

    adapter.add_column(&req).await.unwrap();

    assert!(adapter
        .get_table_columns("main", "t")
        .await
        .unwrap()
        .iter()
        .any(|c| c.name == "status"));
}

/// Fail-open: a failure that is not one of the mapped restrictions keeps its
/// driver text instead of being dressed up as one.
#[tokio::test]
async fn unmapped_failures_keep_the_driver_text() {
    let (_dir, adapter) = connected(USERS, false).await;
    let mut req = drop_table_req("missing_table");
    req.preview_only = false;

    let message = database_error(adapter.drop_table(&req).await);

    assert!(message.contains("no such table"), "{message}");
    assert!(message.contains("missing_table"), "{message}");
}

/// The seven opened operations must reach the builders through the wired
/// `RdbAdapter` methods, not only through the inherent ones the rest of this
/// file calls — `mod.rs` is where a delegation can silently stay stubbed. The
/// two constraint methods must still refuse there.
#[tokio::test]
async fn the_wired_trait_methods_delegate_to_the_native_builders() {
    use crate::db::RdbAdapter;
    use crate::models::{AddConstraintRequest, ConstraintDefinition, DropConstraintRequest};

    let (_dir, adapter) = connected(USERS, false).await;

    let previews = vec![
        RdbAdapter::drop_table(&adapter, &drop_table_req("users")).await,
        RdbAdapter::rename_table(&adapter, &rename_table_req("users", "people")).await,
        RdbAdapter::alter_table(
            &adapter,
            &alter_table_req(
                "users",
                vec![ColumnChange::Drop {
                    name: "note".to_string(),
                }],
            ),
        )
        .await,
        RdbAdapter::add_column(
            &adapter,
            &add_column_req("users", column("nickname", "TEXT", true)),
        )
        .await,
        RdbAdapter::drop_column(&adapter, &drop_column_req("users", "note")).await,
        RdbAdapter::create_index(
            &adapter,
            &create_index_req("users", "idx_users_name", &["name"]),
        )
        .await,
        RdbAdapter::drop_index(&adapter, &drop_index_req("idx_users_name")).await,
    ];

    assert_eq!(
        previews.len(),
        7,
        "every opened entry point must be covered"
    );
    let expected = [
        "DROP TABLE \"users\"",
        "ALTER TABLE \"users\" RENAME TO \"people\"",
        "ALTER TABLE \"users\" DROP COLUMN \"note\"",
        "ALTER TABLE \"users\" ADD COLUMN \"nickname\" TEXT",
        "ALTER TABLE \"users\" DROP COLUMN \"note\"",
        "CREATE INDEX \"idx_users_name\" ON \"users\" (\"name\")",
        "DROP INDEX \"idx_users_name\"",
    ];
    for (result, sql) in previews.into_iter().zip(expected) {
        assert_eq!(result.unwrap().sql, sql);
    }

    let add_constraint = RdbAdapter::add_constraint(
        &adapter,
        &AddConstraintRequest {
            connection_id: CONNECTION.to_string(),
            schema: "main".to_string(),
            table: "users".to_string(),
            constraint_name: "users_email_unique".to_string(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["email".to_string()],
            },
            preview_only: true,
            expected_database: None,
        },
    )
    .await;
    let drop_constraint = RdbAdapter::drop_constraint(
        &adapter,
        &DropConstraintRequest {
            connection_id: CONNECTION.to_string(),
            schema: "main".to_string(),
            table: "users".to_string(),
            constraint_name: "users_email_unique".to_string(),
            preview_only: true,
            expected_database: None,
        },
    )
    .await;

    for (result, feature) in [
        (add_constraint, "constraint creation"),
        (drop_constraint, "constraint drop"),
    ] {
        match result {
            Err(AppError::Unsupported(message)) => {
                assert!(message.contains(feature), "{message}");
                assert!(message.contains("rebuild"), "{message}");
            }
            other => panic!("{feature} must stay refused: {other:?}"),
        }
    }
}
