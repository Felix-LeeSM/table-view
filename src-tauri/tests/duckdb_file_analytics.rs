use std::fs;

use table_view_lib::db::{DbAdapter, DuckdbAdapter, RdbAdapter};
use table_view_lib::error::AppError;
use table_view_lib::models::{ConnectionConfig, DatabaseType, FileAnalyticsSourceKind};
use tempfile::TempDir;

fn duckdb_config(path: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "duckdb-file-analytics".to_string(),
        name: "DuckDB file analytics".to_string(),
        db_type: DatabaseType::Duckdb,
        host: String::new(),
        port: 0,
        user: String::new(),
        password: String::new(),
        database: path.to_string(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
        trust_server_certificate: None,
    }
}

fn seed_database(path: &std::path::Path) {
    let conn = duckdb::Connection::open(path).unwrap();
    conn.execute("SELECT 1", []).unwrap();
}

async fn connected_fixture() -> (TempDir, DuckdbAdapter) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("fixture.duckdb");
    seed_database(&db_path);

    let adapter = DuckdbAdapter::new();
    adapter
        .connect(&duckdb_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    (dir, adapter)
}

fn write_parquet(path: &std::path::Path) {
    let conn = duckdb::Connection::open_in_memory().unwrap();
    let sql = format!(
        "COPY (SELECT 1 AS id, 'Ada' AS name UNION ALL SELECT 2, 'Bob') TO '{}' (FORMAT PARQUET)",
        path.to_string_lossy().replace('\'', "''")
    );
    conn.execute(&sql, []).unwrap();
}

#[tokio::test]
async fn duckdb_file_analytics_previews_and_queries_csv_without_exposing_path() {
    let (dir, adapter) = connected_fixture().await;
    let csv_path = dir.path().join("people.csv");
    fs::write(&csv_path, "id,name\n1,Ada\n2,Bob\n").unwrap();
    let csv_path = csv_path.to_str().unwrap();

    let source = adapter
        .register_file_analytics_source(csv_path)
        .await
        .unwrap();
    assert_eq!(source.file_name, "people.csv");
    assert_eq!(source.kind, FileAnalyticsSourceKind::Csv);
    assert!(!serde_json::to_string(&source).unwrap().contains(csv_path));

    let preview = adapter
        .preview_file_analytics_source(&source.id, Some(2))
        .await
        .unwrap();
    assert_eq!(
        preview.executed_sql,
        format!("SELECT * FROM \"{}\" LIMIT 2", source.alias)
    );
    assert_eq!(preview.result.total_count, 2);
    assert_eq!(preview.result.rows[0][1], serde_json::json!("Ada"));
    assert!(!serde_json::to_string(&preview).unwrap().contains(csv_path));

    let query = adapter
        .execute_file_analytics_query(
            &source.id,
            &format!(
                "SELECT name FROM \"{}\" WHERE id = 2 ORDER BY name",
                source.alias
            ),
        )
        .await
        .unwrap();
    assert_eq!(query.result.rows, vec![vec![serde_json::json!("Bob")]]);
    assert!(!serde_json::to_string(&query).unwrap().contains(csv_path));
}

#[tokio::test]
async fn duckdb_file_analytics_lists_source_metadata_and_clears_session_sources() {
    let (dir, adapter) = connected_fixture().await;
    let csv_path = dir.path().join("people.csv");
    fs::write(&csv_path, "id,name\n1,Ada\n2,Bob\n").unwrap();
    let csv_path = csv_path.to_str().unwrap();

    let source = adapter
        .register_file_analytics_source(csv_path)
        .await
        .unwrap();
    let metadata = adapter.list_file_analytics_source_metadata().await.unwrap();

    assert_eq!(metadata.len(), 1);
    assert_eq!(metadata[0].source.id, source.id);
    assert_eq!(metadata[0].source.alias, source.alias);
    assert_eq!(metadata[0].source.file_name, "people.csv");
    assert_eq!(metadata[0].columns[0].name, "id");
    assert_eq!(metadata[0].columns[1].name, "name");
    assert_eq!(
        metadata[0].preview_sql,
        format!("SELECT * FROM \"{}\" LIMIT 100", source.alias)
    );
    assert!(!serde_json::to_string(&metadata).unwrap().contains(csv_path));

    adapter.clear_file_analytics_sources().await.unwrap();
    assert!(adapter
        .list_file_analytics_source_metadata()
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn duckdb_file_analytics_requires_the_registered_source_alias() {
    let (dir, adapter) = connected_fixture().await;
    let csv_path = dir.path().join("people.csv");
    fs::write(&csv_path, "id,name\n1,Ada\n").unwrap();
    let source = adapter
        .register_file_analytics_source(csv_path.to_str().unwrap())
        .await
        .unwrap();
    adapter
        .execute_sql("CREATE TABLE sink (id INTEGER)", None)
        .await
        .unwrap();

    for sql in [
        "VALUES (1)".to_string(),
        "SELECT 1".to_string(),
        format!("SELECT 1 AS \"{}\"", source.alias),
        "SELECT * FROM sink".to_string(),
    ] {
        let unscoped = adapter.execute_file_analytics_query(&source.id, &sql).await;
        assert!(
            matches!(unscoped, Err(AppError::Unsupported(_))),
            "{sql} should require the registered source alias, got {unscoped:?}"
        );
    }

    let scoped = adapter
        .execute_file_analytics_query(&source.id, &format!("SELECT * FROM \"{}\"", source.alias))
        .await
        .unwrap();
    assert_eq!(scoped.result.rows[0][1], serde_json::json!("Ada"));

    let mixed_db_table = adapter
        .execute_file_analytics_query(
            &source.id,
            &format!("SELECT sink.id FROM sink JOIN \"{}\" ON true", source.alias),
        )
        .await;
    assert!(
        matches!(mixed_db_table, Err(AppError::Database(_))),
        "file analytics must not read existing database tables, got {mixed_db_table:?}"
    );
}

#[tokio::test]
async fn duckdb_file_analytics_global_query_uses_registered_aliases_without_source_id() {
    let (dir, adapter) = connected_fixture().await;
    let csv_path = dir.path().join("people.csv");
    fs::write(&csv_path, "id,name\n1,Ada\n2,Bob\n").unwrap();
    let csv_path = csv_path.to_str().unwrap().to_string();
    let source = adapter
        .register_file_analytics_source(&csv_path)
        .await
        .unwrap();

    let result = adapter
        .execute_sql(
            &format!(
                "SELECT name FROM \"{}\" WHERE id = 2 ORDER BY name",
                source.alias
            ),
            None,
        )
        .await
        .unwrap();

    assert_eq!(result.rows, vec![vec![serde_json::json!("Bob")]]);
    assert!(!serde_json::to_string(&result).unwrap().contains(&csv_path));

    let normal_duckdb_query = adapter.execute_sql("SELECT 1 AS ok", None).await.unwrap();
    assert_eq!(normal_duckdb_query.rows, vec![vec![serde_json::json!(1)]]);
}

#[tokio::test]
async fn duckdb_file_analytics_global_query_keeps_file_boundaries_blocked() {
    let (dir, adapter) = connected_fixture().await;
    let csv_path = dir.path().join("people.csv");
    fs::write(&csv_path, "id,name\n1,Ada\n").unwrap();
    let secret_path = dir.path().join("secret.csv");
    fs::write(&secret_path, "id,name\n9,Hidden\n").unwrap();
    let secret_path = secret_path.to_str().unwrap().to_string();
    let secret_path_sql = secret_path.replace('\'', "''");
    let source = adapter
        .register_file_analytics_source(csv_path.to_str().unwrap())
        .await
        .unwrap();

    for sql in [
        "INSTALL httpfs".to_string(),
        "FORCE INSTALL httpfs".to_string(),
        "LOAD httpfs".to_string(),
        "SELECT install_extension('httpfs')".to_string(),
        "SELECT load_extension('httpfs')".to_string(),
        format!("COPY \"{}\" TO '{secret_path_sql}'", source.alias),
        format!("ATTACH '{secret_path_sql}' AS external_db"),
        "DETACH external_db".to_string(),
        format!("CREATE TABLE copied AS SELECT * FROM \"{}\"", source.alias),
        format!(
            "INSERT INTO missing_sink SELECT * FROM \"{}\"",
            source.alias
        ),
        format!(
            "WITH rows AS (SELECT * FROM \"{}\") INSERT INTO missing_sink SELECT * FROM rows",
            source.alias
        ),
        format!(
            "WITH rows AS (SELECT * FROM \"{}\") SELECT * FROM rows",
            source.alias
        ),
        format!(
            "UPDATE \"{}\" SET name = 'Mutated' WHERE id = 1",
            source.alias
        ),
        format!("DELETE FROM \"{}\"", source.alias),
        format!(
            "SELECT * FROM \"{}\" JOIN read_csv_auto('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN read_parquet('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN read_json_auto('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN read_ndjson_auto('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN read_text('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN read_blob('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN sniff_csv('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN glob('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN parquet_metadata('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN parquet_schema('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN parquet_file_metadata('{secret_path_sql}') ON true",
            source.alias
        ),
        format!(
            "SELECT * FROM \"{}\" JOIN '{secret_path_sql}' ON true",
            source.alias
        ),
        format!("SELECT * FROM '{secret_path_sql}'"),
        format!("SELECT * FROM read_csv_auto('{secret_path_sql}')"),
    ] {
        let blocked = adapter.execute_sql(&sql, None).await;
        assert!(
            matches!(blocked, Err(AppError::Unsupported(_))),
            "{sql} should stay blocked, got {blocked:?}"
        );
    }

    let redacted = adapter
        .execute_sql(
            &format!(
                "SELECT CAST('{secret_path_sql}' AS INTEGER) FROM \"{}\"",
                source.alias
            ),
            None,
        )
        .await;
    match redacted {
        Err(AppError::Database(message)) => {
            assert!(!message.contains(&secret_path), "leaked path: {message}");
            assert!(
                message.contains("<local-file>"),
                "missing redacted path marker: {message}"
            );
        }
        other => panic!("Expected redacted driver error, got {other:?}"),
    }

    let source_still_readable = adapter
        .execute_sql(&format!("SELECT * FROM \"{}\"", source.alias), None)
        .await
        .unwrap();
    assert_eq!(source_still_readable.rows[0][1], serde_json::json!("Ada"));
}

#[tokio::test]
async fn duckdb_file_analytics_global_query_blocks_registered_alias_write_collisions() {
    let (dir, adapter) = connected_fixture().await;
    let csv_path = dir.path().join("people.csv");
    fs::write(&csv_path, "id,name\n1,Ada\n").unwrap();
    adapter
        .execute_sql(
            r#"CREATE TABLE "file_00000001" (id INTEGER, name TEXT)"#,
            None,
        )
        .await
        .unwrap();
    adapter
        .execute_sql(
            r#"INSERT INTO "file_00000001" VALUES (10, 'Persistent')"#,
            None,
        )
        .await
        .unwrap();
    let source = adapter
        .register_file_analytics_source(csv_path.to_str().unwrap())
        .await
        .unwrap();
    assert_eq!(source.alias, "file_00000001");

    for sql in [
        format!(
            "UPDATE \"{}\" SET name = 'Mutated' WHERE id = 10",
            source.alias
        ),
        format!("INSERT INTO \"{}\" VALUES (11, 'Inserted')", source.alias),
        format!(
            "CREATE OR REPLACE TABLE \"{}\" AS SELECT 99 AS id, 'Replaced' AS name",
            source.alias
        ),
        format!("ALTER TABLE \"{}\" ADD COLUMN leaked INTEGER", source.alias),
        format!(
            "CREATE TABLE IF NOT EXISTS \"{}\" (id INTEGER, name TEXT)",
            source.alias
        ),
        format!(
            "CREATE INDEX file_analytics_collision_idx ON \"{}\"(id)",
            source.alias
        ),
    ] {
        let blocked = adapter.execute_sql(&sql, None).await;
        assert!(
            matches!(blocked, Err(AppError::Unsupported(_))),
            "{sql} should block registered file alias writes, got {blocked:?}"
        );
    }

    let routed = adapter
        .execute_sql(&format!("SELECT name FROM \"{}\"", source.alias), None)
        .await
        .unwrap();
    assert_eq!(routed.rows, vec![vec![serde_json::json!("Ada")]]);

    adapter.clear_file_analytics_sources().await.unwrap();
    let persistent = adapter
        .execute_sql(r#"SELECT name FROM "file_00000001" ORDER BY id"#, None)
        .await
        .unwrap();
    assert_eq!(persistent.rows, vec![vec![serde_json::json!("Persistent")]]);
}

#[tokio::test]
async fn duckdb_file_analytics_supports_json_ndjson_and_parquet_sources() {
    let (dir, adapter) = connected_fixture().await;
    let json_path = dir.path().join("people.json");
    let ndjson_path = dir.path().join("events.ndjson");
    let parquet_path = dir.path().join("people.parquet");
    fs::write(
        &json_path,
        r#"[{"id":1,"name":"Ada"},{"id":2,"name":"Bob"}]"#,
    )
    .unwrap();
    fs::write(
        &ndjson_path,
        "{\"id\":1,\"kind\":\"open\"}\n{\"id\":2,\"kind\":\"close\"}\n",
    )
    .unwrap();
    write_parquet(&parquet_path);

    let json = adapter
        .register_file_analytics_source(json_path.to_str().unwrap())
        .await
        .unwrap();
    let ndjson = adapter
        .register_file_analytics_source(ndjson_path.to_str().unwrap())
        .await
        .unwrap();
    let parquet = adapter
        .register_file_analytics_source(parquet_path.to_str().unwrap())
        .await
        .unwrap();

    assert_eq!(json.kind, FileAnalyticsSourceKind::Json);
    assert_eq!(ndjson.kind, FileAnalyticsSourceKind::Ndjson);
    assert_eq!(parquet.kind, FileAnalyticsSourceKind::Parquet);

    let json_preview = adapter
        .preview_file_analytics_source(&json.id, Some(1))
        .await
        .unwrap();
    let ndjson_preview = adapter
        .preview_file_analytics_source(&ndjson.id, Some(1))
        .await
        .unwrap();
    let parquet_preview = adapter
        .preview_file_analytics_source(&parquet.id, Some(1))
        .await
        .unwrap();

    assert_eq!(json_preview.result.rows[0][1], serde_json::json!("Ada"));
    assert_eq!(ndjson_preview.result.rows[0][1], serde_json::json!("open"));
    assert_eq!(parquet_preview.result.rows[0][1], serde_json::json!("Ada"));
}

#[tokio::test]
async fn duckdb_file_analytics_rejects_unsupported_and_oversized_inputs() {
    let (dir, adapter) = connected_fixture().await;
    let unsupported_path = dir.path().join("notes.txt");
    fs::write(&unsupported_path, "not analytics").unwrap();

    let unsupported = adapter
        .register_file_analytics_source(unsupported_path.to_str().unwrap())
        .await;
    assert!(matches!(unsupported, Err(AppError::Unsupported(_))));

    let oversized_path = dir.path().join("huge.csv");
    let file = fs::File::create(&oversized_path).unwrap();
    file.set_len(101 * 1024 * 1024).unwrap();

    let oversized = adapter
        .register_file_analytics_source(oversized_path.to_str().unwrap())
        .await;
    match oversized {
        Err(AppError::Validation(message)) => assert!(message.contains("exceeds")),
        other => panic!("Expected oversized validation error, got: {other:?}"),
    }

    let csv_path = dir.path().join("mutable.csv");
    fs::write(&csv_path, "id,name\n1,Ada\n").unwrap();
    let source = adapter
        .register_file_analytics_source(csv_path.to_str().unwrap())
        .await
        .unwrap();
    fs::File::create(&csv_path)
        .unwrap()
        .set_len(101 * 1024 * 1024)
        .unwrap();

    let stale_source = adapter
        .preview_file_analytics_source(&source.id, Some(1))
        .await;
    match stale_source {
        Err(AppError::Validation(message)) => assert!(message.contains("exceeds")),
        other => panic!("Expected stale oversized source validation error, got: {other:?}"),
    }
}

#[tokio::test]
async fn duckdb_file_analytics_redacts_paths_from_driver_errors() {
    let (dir, adapter) = connected_fixture().await;
    let csv_path = dir.path().join("gone.csv");
    fs::write(&csv_path, "id,name\n1,Ada\n").unwrap();
    let csv_path_str = csv_path.to_str().unwrap().to_string();
    let source = adapter
        .register_file_analytics_source(&csv_path_str)
        .await
        .unwrap();
    fs::remove_file(&csv_path).unwrap();

    let result = adapter
        .preview_file_analytics_source(&source.id, Some(1))
        .await;
    match result {
        Err(error) => {
            let message = error.to_string();
            assert!(!message.contains(&csv_path_str), "leaked path: {message}");
            assert!(
                message.contains("<local-file>") || message.contains("does not exist"),
                "missing safe local-file failure: {message}"
            );
        }
        Ok(_) => panic!("Expected missing file preview to fail"),
    }
}

#[tokio::test]
async fn duckdb_file_analytics_keeps_raw_file_functions_blocked() {
    let (dir, adapter) = connected_fixture().await;
    let csv_path = dir.path().join("people.csv");
    fs::write(&csv_path, "id,name\n1,Ada\n").unwrap();
    let secret_path = dir.path().join("secret.txt");
    fs::write(&secret_path, "sensitive").unwrap();
    let secret_path = secret_path.to_str().unwrap().replace('\'', "''");
    let source = adapter
        .register_file_analytics_source(csv_path.to_str().unwrap())
        .await
        .unwrap();
    adapter
        .execute_sql("CREATE TABLE sink (id INTEGER)", None)
        .await
        .unwrap();

    for sql in [
        "SELECT * FROM read_csv_auto('people.csv')".to_string(),
        format!("SELECT * FROM \"read_csv_auto\"('{secret_path}')"),
        format!("SELECT * FROM read_text('{secret_path}')"),
        format!("SELECT * FROM read_text/*comment*/('{secret_path}')"),
        format!("SELECT * FROM \"read_text\"('{secret_path}')"),
        format!("SELECT * FROM \"read_text\"/*comment*/('{secret_path}')"),
        format!("SELECT * FROM read_blob('{secret_path}')"),
        format!("SELECT * FROM sniff_csv('{secret_path}')"),
        format!("SELECT * FROM glob('{secret_path}')"),
        format!("SELECT * FROM glob/*comment*/('{secret_path}')"),
        format!("SELECT * FROM \"glob\"('{secret_path}')"),
        format!("SELECT * FROM \"glob\"/*comment*/('{secret_path}')"),
        format!("SELECT * FROM parquet_metadata('{secret_path}')"),
        format!("SELECT * FROM '{secret_path}'"),
        "WITH rows AS (SELECT 1 AS id) INSERT INTO sink SELECT id FROM rows".to_string(),
    ] {
        let raw_read = adapter.execute_file_analytics_query(&source.id, &sql).await;
        assert!(
            matches!(raw_read, Err(AppError::Unsupported(_))),
            "{sql} should be blocked, got {raw_read:?}"
        );
    }

    let write = adapter
        .execute_file_analytics_query(&source.id, &format!("DELETE FROM \"{}\"", source.alias))
        .await;
    assert!(matches!(write, Err(AppError::Unsupported(_))));

    let count = adapter
        .execute_sql("SELECT COUNT(*) FROM sink", None)
        .await
        .unwrap();
    assert_eq!(count.rows, vec![vec![serde_json::json!(0)]]);
}
