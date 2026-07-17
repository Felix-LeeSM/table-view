//! PostgreSQL cross-table value search (#1525) integration tests.
//!
//! Isolation follows the `query_integration.rs` convention: each test owns a
//! fresh adapter pool and a unique schema (`vs_{prefix}_{nanos}`), so parallel
//! nextest processes never touch the same relations. `serial` is an in-process
//! guard for local `cargo test` (one shared PG container), a no-op under the
//! per-process nextest CI lane.

mod common;

use table_view_lib::models::DatabaseType;

/// Unique schema name to avoid collisions across parallel test processes.
fn unique_schema(prefix: &str) -> String {
    format!(
        "vs_{}_{}",
        prefix,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}

/// #1525 remaining-matrix — text-type coverage beyond `text` / `character
/// varying` / `character`. `citext` is a contrib **extension** type, so
/// `information_schema.columns.data_type` reports it as `USER-DEFINED` with
/// `udt_name = 'citext'`. The pre-fix enumeration filter matched on
/// `data_type IN ('text','character varying','character')` only, so a citext
/// column was never enumerated and its cells were never scanned. This asserts
/// a citext cell is found — case-insensitively, matching the type's own
/// semantics (the search term differs in case from the stored value).
#[tokio::test]
#[serial_test::serial]
async fn test_search_values_matches_citext_column() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let schema = unique_schema("citext");
    let table = "notes";

    // citext is bundled with the official postgres image (postgresql-contrib).
    // CREATE EXTENSION is idempotent and DB-wide; the type lands in `public`.
    adapter
        .execute("CREATE EXTENSION IF NOT EXISTS citext")
        .await
        .expect("install citext extension");
    adapter
        .execute(&format!("CREATE SCHEMA \"{schema}\""))
        .await
        .expect("create schema");
    adapter
        .execute(&format!(
            "CREATE TABLE \"{schema}\".\"{table}\" (id INT PRIMARY KEY, label citext)"
        ))
        .await
        .expect("create table with a citext column");
    adapter
        .execute(&format!(
            "INSERT INTO \"{schema}\".\"{table}\" (id, label) VALUES (1, 'CaseSensitiveNeedle')"
        ))
        .await
        .expect("insert citext value");

    // Lowercase term vs. mixed-case stored value: also exercises ILIKE's
    // case-insensitive match on a citext column.
    let result = adapter
        .search_values(
            std::slice::from_ref(&schema),
            "casesensitiveneedle",
            None,
            10_000,
        )
        .await
        .expect("search_values should succeed");

    // Clean up before asserting so a failed assertion still drops the schema.
    adapter
        .execute(&format!("DROP SCHEMA \"{schema}\" CASCADE"))
        .await
        .expect("drop schema");
    adapter.disconnect_pool().await.unwrap();

    let matched = result
        .matches
        .iter()
        .find(|m| m.schema == schema && m.table == table && m.column == "label");
    assert!(
        matched.is_some(),
        "citext column must be enumerated and matched; got matches: {:?}",
        result.matches
    );
    assert_eq!(matched.unwrap().value, "CaseSensitiveNeedle");
}
