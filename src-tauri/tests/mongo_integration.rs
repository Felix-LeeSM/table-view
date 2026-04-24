//! MongoAdapter integration test (Sprint 65).
//!
//! Walks through the happy path supported by Sprint 65's MongoAdapter:
//! `connect → ping → list_databases → list_collections → disconnect`.
//! When the MongoDB test container is not available the setup helper
//! prints a skip message and this test exits with status 0 — matching the
//! existing Postgres integration-test pattern (see `query_integration.rs`).

mod common;

use table_view_lib::db::{DbAdapter, DocumentAdapter};

/// Happy path: the adapter can connect, ping, enumerate databases and
/// collections, then disconnect cleanly.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_connect_ping_list_disconnect_happy_path() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    // Ping after connect should succeed.
    adapter.ping().await.expect("ping should succeed");

    // list_databases must at least return the administrative DBs that ship
    // with MongoDB out of the box (`admin`, `config`, `local`). We assert
    // presence of `admin` as a minimal, stable signal.
    let databases = adapter
        .list_databases()
        .await
        .expect("list_databases should succeed");
    println!(
        "list_databases returned {} entries: {:?}",
        databases.len(),
        databases.iter().map(|n| &n.name).collect::<Vec<_>>()
    );
    assert!(
        !databases.is_empty(),
        "expected at least one database from list_databases"
    );
    assert!(
        databases.iter().any(|d| d.name == "admin"),
        "expected `admin` in list_databases, got: {:?}",
        databases.iter().map(|n| &n.name).collect::<Vec<_>>()
    );

    // list_collections against the `admin` database should succeed even if
    // the collection list is empty on a fresh instance.
    let collections = adapter
        .list_collections("admin")
        .await
        .expect("list_collections should succeed");
    println!(
        "list_collections(admin) returned {} entries",
        collections.len()
    );

    // Validate empty-name guard.
    let err = adapter
        .list_collections("")
        .await
        .expect_err("list_collections(\"\") should reject");
    let msg = err.to_string();
    assert!(
        msg.contains("Database name"),
        "unexpected validation message: {msg}"
    );

    // Clean disconnect must succeed and must leave the adapter in a state
    // where subsequent calls fail with a Connection error.
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
    let post_disconnect = adapter.ping().await;
    assert!(
        post_disconnect.is_err(),
        "ping after disconnect should fail"
    );
}

/// Sanity: a fresh adapter with no connection attempted must surface a
/// Connection error on `ping`, not panic. This guarantee holds with or
/// without a running container, so the test always runs.
#[tokio::test]
async fn test_mongo_adapter_ping_without_connect_returns_error() {
    use table_view_lib::db::mongodb::MongoAdapter;

    let adapter = MongoAdapter::new();
    assert!(
        adapter.ping().await.is_err(),
        "ping without connect must error"
    );
}
