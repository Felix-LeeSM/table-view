//! Pool-backed SQLite DDL cases — the restriction messages and the execution
//! path, driven through a real database file so the strings the mapper matches
//! are the engine's rather than the author's.

use super::*;
use crate::models::{
    ConnectionConfig, CreateTablePlanIndex, CreateTablePlanRequest, DatabaseType, SslMode,
};
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
        ssl_mode: SslMode::Prefer,
        ca_cert_path: None,
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

    // Fill the pool to `SQLITE_POOL_MAX_CONNECTIONS` and let every connection
    // read the table, so each caches the pre-ADD schema. They are released
    // *before* the ADD on purpose: sqlx's idle queue is FIFO, so the ADD takes
    // the front connection and returns it to the back, and the DROP is then
    // guaranteed a different connection — one that never saw the ADD. Releasing
    // them after the ADD instead would let the DROP pick the ADD's own
    // connection back up, and the test would pass with the refresh removed.
    // The loop reads the pool constant rather than repeating its value: raising
    // the pool without filling it leaves a spare permit, `pool.begin()` never
    // parks, and this guard would silently stop discriminating.
    let pool = adapter.active_pool().await.unwrap();
    let mut warm = Vec::new();
    for _ in 0..crate::db::adapters::sqlite::connection::SQLITE_POOL_MAX_CONNECTIONS {
        let mut conn = pool.acquire().await.unwrap();
        sqlx::query("SELECT * FROM users")
            .fetch_all(&mut *conn)
            .await
            .unwrap();
        warm.push(conn);
    }
    drop(warm);

    let mut add = add_column_req("users", column("locale", "TEXT", true));
    add.preview_only = false;
    adapter.add_column(&add).await.unwrap();

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

/// How long the fixture writer keeps the file's lock. Far under the 5s
/// `busy_timeout` sqlx sets by default, so a runner that waits has room to
/// spare on a loaded machine, while a runner that fails fast returns in
/// microseconds and misses the window by orders of magnitude.
const CONTENDED_HOLD: std::time::Duration = std::time::Duration::from_millis(200);

/// Regression (#2129): the DDL runner opened its transaction deferred, so the
/// write lock was only requested once a statement ran — after the runner's own
/// schema-refresh read had already put the connection in a read transaction.
/// SQLite refuses to run the busy handler for that read-to-write upgrade
/// (it could deadlock), so `busy_timeout` was dead on this path and any
/// concurrent writer turned a legal DDL into an instant "database is locked".
#[tokio::test]
async fn structured_ddl_waits_out_a_concurrent_writer() {
    let (dir, adapter) = connected(USERS, false).await;
    let release =
        crate::db::adapters::sqlite::connection::hold_write_lock(&dir.path().join("ddl.sqlite"))
            .await;

    let mut add = add_column_req("users", column("locale", "TEXT", true));
    add.preview_only = false;
    let ddl = adapter.clone();
    let started = std::time::Instant::now();
    let running = tokio::spawn(async move { ddl.add_column(&add).await });

    tokio::time::sleep(CONTENDED_HOLD).await;
    release.send(()).expect("release the contending writer");
    let result = running.await.expect("DDL task");
    let waited = started.elapsed();

    result.expect("DDL must wait for the lock, not fail fast");
    assert!(
        waited >= CONTENDED_HOLD,
        "DDL returned Ok in {waited:?}, before the contending writer let go — \
         the fixture never held the lock, so this proves nothing"
    );
    assert!(adapter
        .get_table_columns("main", "users")
        .await
        .unwrap()
        .iter()
        .any(|c| c.name == "locale"));
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
    // Each `expected` needle must be advice this module wrote. A needle that
    // also appears in the driver text appended afterwards would pass with the
    // matching arm deleted, which is how these assertions used to read.
    let cases: [(&str, &[&str], &str, &[&str]); 9] = [
        (
            "primary key",
            &["CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)"],
            "id",
            &[
                "Cannot drop column \"id\"",
                "belongs to the table's PRIMARY KEY",
                "recreate the table without the column",
            ],
        ),
        (
            "unique",
            &["CREATE TABLE t (id INTEGER, email TEXT UNIQUE)"],
            "email",
            &[
                "Cannot drop column \"email\"",
                "a UNIQUE constraint covers it",
                "recreate the table without the column",
            ],
        ),
        (
            "index",
            &[
                "CREATE TABLE t (id INTEGER, name TEXT)",
                "CREATE INDEX ix_name ON t(name)",
            ],
            "name",
            &[
                "Cannot drop column \"name\"",
                "index \"ix_name\" still indexes it",
                "Drop or redefine index \"ix_name\" first.",
            ],
        ),
        (
            "view",
            &[
                "CREATE TABLE t (id INTEGER, name TEXT)",
                "CREATE VIEW v_name AS SELECT name FROM t",
            ],
            "name",
            &[
                "Cannot drop column \"name\"",
                "view \"v_name\" still selects it",
                "Drop or redefine view \"v_name\" first.",
            ],
        ),
        (
            "trigger",
            &[
                "CREATE TABLE t (id INTEGER, name TEXT)",
                "CREATE TRIGGER tg_name AFTER INSERT ON t BEGIN SELECT NEW.name; END",
            ],
            "name",
            &[
                "Cannot drop column \"name\"",
                "trigger \"tg_name\" still reads it",
                "Drop or redefine trigger \"tg_name\" first.",
            ],
        ),
        (
            // The `error in table …` arm, first of its two engine texts:
            // `no such column: <col>`, driven here by a generated column and
            // by the CHECK case below.
            "generated column",
            &["CREATE TABLE t (id INTEGER, name TEXT, tag TEXT GENERATED ALWAYS AS (name || 'x') VIRTUAL)"],
            "name",
            &[
                "Cannot drop column \"name\"",
                "a definition in table \"t\" still references it",
                "Remove or redefine it in table \"t\" first",
                "FOREIGN KEY",
            ],
        ),
        (
            // Same arm, same engine text, other definition: a CHECK over the
            // dropped column. The remedy names CHECK as one of three blockers,
            // so one case drives it rather than leaving that word unbacked.
            "check constraint",
            &["CREATE TABLE t (id INTEGER, name TEXT, CHECK (length(name) > 0))"],
            "name",
            &[
                "Cannot drop column \"name\"",
                "a definition in table \"t\" still references it",
                "Remove or redefine it in table \"t\" first",
                "CHECK",
            ],
        ),
        (
            // Same arm, other engine text: `unknown column "<col>" in foreign
            // key definition`. The FOREIGN KEY the remedy names is the one in
            // the altered table. A *child* table's FK into the dropped column
            // does not reach this arm: an FK's parent column is a PRIMARY KEY
            // or UNIQUE column, whose own arm fires first, and when it is
            // neither (SQLite does not require it) the drop simply succeeds.
            // All three shapes were run against 3.46.0 while writing this.
            "foreign key clause",
            &[
                "CREATE TABLE other (x TEXT PRIMARY KEY)",
                "CREATE TABLE t (id INTEGER, name TEXT, FOREIGN KEY(name) REFERENCES other(x))",
            ],
            "name",
            &[
                "Cannot drop column \"name\"",
                "a definition in table \"t\" still references it",
                "Remove or redefine it in table \"t\" first",
            ],
        ),
        (
            "last column",
            &["CREATE TABLE t (name TEXT)"],
            "name",
            &[
                "Cannot drop column \"name\"",
                "it is the table's only column",
                "Drop the table instead.",
            ],
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

    // Both defaults the advice names by hand must actually reach the engine and
    // come back through this arm — otherwise the sentence advertises a case the
    // adapter rejects earlier, or one SQLite accepts.
    for default in ["CURRENT_TIMESTAMP", "(datetime('now'))"] {
        let (_dir, adapter) = connected(setup, false).await;
        let mut non_constant = column("created_at", "TEXT", true);
        non_constant.default_value = Some(default.to_string());
        let mut req = add_column_req("t", non_constant);
        req.preview_only = false;

        let message = database_error(adapter.add_column(&req).await);

        assert!(message.contains("\"created_at\""), "{default}: {message}");
        assert!(
            message.contains("the DEFAULT must be a constant"),
            "{default}: {message}"
        );
    }
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
                    name: "name".to_string(),
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
        // `alter_table`'s Drop leg targets a different column than the direct
        // `drop_column` below on purpose — identical expectations here would
        // make the two delegations indistinguishable, which is the one thing
        // this test exists to catch.
        "ALTER TABLE \"users\" DROP COLUMN \"name\"",
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

// --------------------------------------------------------------------------
// create_table_plan — all or nothing
// --------------------------------------------------------------------------

fn plan_req(indexes: Vec<CreateTablePlanIndex>) -> CreateTablePlanRequest {
    CreateTablePlanRequest {
        connection_id: CONNECTION.to_string(),
        schema: "main".to_string(),
        name: "people".to_string(),
        columns: vec![column("name", "TEXT", true)],
        primary_key: None,
        table_comment: None,
        indexes,
        constraints: Vec::new(),
        preview_only: false,
        expected_database: None,
    }
}

fn plan_index(index_name: &str, index_type: &str) -> CreateTablePlanIndex {
    CreateTablePlanIndex {
        index_name: index_name.to_string(),
        columns: vec!["name".to_string()],
        index_type: index_type.to_string(),
        is_unique: false,
    }
}

async fn table_exists(adapter: &SqliteAdapter, table: &str) -> bool {
    adapter
        .list_tables("main")
        .await
        .unwrap()
        .iter()
        .any(|listed| listed.name == table)
}

/// The plan runs as one unit. Before #1804 a plan carrying any index row was
/// refused outright, so nothing this path does may leave a table behind that
/// its own plan never finished.
#[tokio::test]
async fn a_plan_whose_index_fails_to_build_creates_nothing() {
    let (_dir, adapter) = connected(USERS, false).await;

    // `hash` reaches here from the Create Table dialog: its index-method
    // dropdown offers the PostgreSQL list to every engine.
    let result = adapter
        .create_table_plan(&plan_req(vec![plan_index("idx_people_name", "hash")]))
        .await;

    match result {
        Err(AppError::Validation(message)) => {
            assert!(message.contains("idx_people_name"), "{message}");
            assert!(message.contains("B-tree"), "{message}");
        }
        other => panic!("expected the plan to be refused before it ran: {other:?}"),
    }
    assert!(!table_exists(&adapter, "people").await);
}

/// The failure a preview cannot predict: the index name is legal but already
/// taken in the file. The CREATE TABLE must go back with it.
#[tokio::test]
async fn a_plan_whose_index_fails_to_execute_rolls_the_table_back() {
    let (_dir, adapter) = connected(
        &[
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
            "CREATE INDEX idx_taken ON users(name)",
        ],
        false,
    )
    .await;

    let result = adapter
        .create_table_plan(&plan_req(vec![plan_index("idx_taken", "btree")]))
        .await;

    let message = database_error(result);
    assert!(message.contains("idx_taken"), "{message}");
    assert!(message.contains("already exists"), "{message}");
    assert!(
        !table_exists(&adapter, "people").await,
        "the table must not outlive its failed plan"
    );
}

#[tokio::test]
async fn a_plan_whose_statements_all_succeed_applies_table_and_indexes() {
    let (_dir, adapter) = connected(USERS, false).await;

    let result = adapter
        .create_table_plan(&plan_req(vec![plan_index("idx_people_name", "btree")]))
        .await
        .unwrap();

    assert_eq!(
        result.sql,
        "CREATE TABLE \"people\" (\"name\" TEXT);\n\
         CREATE INDEX \"idx_people_name\" ON \"people\" (\"name\")"
    );
    assert!(table_exists(&adapter, "people").await);
    assert!(adapter
        .get_table_indexes("main", "people")
        .await
        .unwrap()
        .iter()
        .any(|index| index.name == "idx_people_name"));
}

/// Preview stays a preview: the plan text comes back and the file is untouched.
#[tokio::test]
async fn a_plan_preview_writes_nothing() {
    let (_dir, adapter) = connected(USERS, false).await;
    let mut req = plan_req(vec![plan_index("idx_people_name", "btree")]);
    req.preview_only = true;

    let result = adapter.create_table_plan(&req).await.unwrap();

    assert!(result.sql.contains("CREATE INDEX"), "{}", result.sql);
    assert!(!table_exists(&adapter, "people").await);
}

/// Fail-open across statement kinds. SQLite reuses the `error in <kind> <name>`
/// opener whenever a schema change makes some other object stop re-parsing, and
/// the DROP COLUMN advice is applied to every failed DDL statement — so the
/// mapper must require the ` after drop column` marker as well. Here a RENAME
/// trips a view that was already broken; dressing that as a dependency of a
/// column the user never touched would name `v1: no such table: main.t2` as the
/// blocking view and send them to fix it.
#[tokio::test]
async fn a_rename_that_breaks_another_object_is_not_dressed_as_a_drop_column_restriction() {
    let (_dir, adapter) = connected(
        &[
            "CREATE TABLE t1 (a TEXT)",
            "CREATE TABLE t2 (b TEXT)",
            "CREATE VIEW v1 AS SELECT a, b FROM t1, t2",
            "DROP TABLE t2",
        ],
        false,
    )
    .await;

    let mut req = rename_table_req("t1", "t3");
    req.preview_only = false;

    let message = database_error(adapter.rename_table(&req).await);

    assert!(message.contains("error in view v1"), "{message}");
    assert!(message.starts_with("SQLite DDL failed:"), "{message}");
    assert!(!message.contains("Cannot drop"), "{message}");
    assert!(!message.contains("still selects it"), "{message}");
}
