use std::fs;

use table_view_lib::db::{DbAdapter, DuckdbAdapter};
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
                message.contains("<local-file>"),
                "missing redaction: {message}"
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

    for sql in [
        "SELECT * FROM read_csv_auto('people.csv')".to_string(),
        format!("SELECT * FROM read_text('{secret_path}')"),
        format!("SELECT * FROM read_blob('{secret_path}')"),
        format!("SELECT * FROM sniff_csv('{secret_path}')"),
        format!("SELECT * FROM glob('{secret_path}')"),
        format!("SELECT * FROM parquet_metadata('{secret_path}')"),
        format!("SELECT * FROM '{secret_path}'"),
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
}
