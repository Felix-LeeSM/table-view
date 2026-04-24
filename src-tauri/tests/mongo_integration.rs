//! MongoAdapter integration test (Sprints 65 + 66 + 72).
//!
//! Sprint 65 walks the catalog happy path:
//! `connect → ping → list_databases → list_collections → disconnect`.
//!
//! Sprint 66 adds the read-path coverage: seeding a small fixture
//! (`table_view_test.users`) with heterogeneous documents, invoking
//! `infer_collection_fields` and `find`, and verifying the expected column
//! shape + sentinel flattening before dropping the fixture.
//!
//! Sprint 72 (Phase 6 plan E-1) adds aggregate-pipeline coverage:
//!   * `test_mongo_adapter_aggregate_match_sort` — `$match` + `$sort` stage
//!     pair filters/orders the seeded users deterministically.
//!   * `test_mongo_adapter_aggregate_group_count` — `$group` with `$sum`
//!     returns a single count row whose `total` column reflects the seeded
//!     document count.
//!
//! When the MongoDB test container is not available the setup helper prints a
//! skip message and the test exits with status 0 — matching the existing
//! Postgres integration-test pattern (see `query_integration.rs`).

mod common;

use bson::{doc, Document};
use mongodb::options::{ClientOptions, Credential, ServerAddress};
use mongodb::Client;
use serde_json::Value;
use table_view_lib::db::{DbAdapter, DocumentAdapter, FindBody};
use table_view_lib::models::ConnectionConfig;

/// Build a raw mongodb `Client` from the shared test config so the
/// integration test can seed / drop fixture collections directly without
/// going through a trait method the adapter doesn't expose.
async fn seed_client(config: &ConnectionConfig) -> Client {
    let mut opts = ClientOptions::default();
    opts.hosts = vec![ServerAddress::Tcp {
        host: config.host.clone(),
        port: Some(config.port),
    }];
    opts.credential = Some(
        Credential::builder()
            .username(config.user.clone())
            .password(config.password.clone())
            .source(config.auth_source.clone())
            .build(),
    );
    opts.app_name = Some("table-view-tests".to_string());
    Client::with_options(opts).expect("mongodb client build (seed)")
}

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

/// Sprint 66 — infer + find happy path against a seeded fixture.
///
/// Seeds `table_view_test.users` with three documents:
///   1. `{ _id, name, age, profile: { city } }`
///   2. `{ _id, name, age }` (missing `profile` — enforces nullability)
///   3. `{ _id, name, tags: ["a", "b"] }` (array field; missing `age`)
///
/// Asserts:
/// - `infer_collection_fields` yields columns in the documented order
///   (`_id` first, then the union of observed fields) with missing-from-any
///   documents flagged nullable.
/// - `find` returns all three rows with the same column layout and the
///   nested/array fields flattened to the sentinel strings
///   `"{...}"` / `"[N items]"`.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_infer_and_find_on_seeded_collection() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    // Seed fixture via a sibling driver client — the adapter doesn't expose
    // insert APIs yet, and we want deterministic cleanup regardless of test
    // outcome.
    let config = common::test_config(table_view_lib::models::DatabaseType::Mongodb);
    let seed = seed_client(&config).await;
    let db = seed.database("table_view_test");
    let coll = db.collection::<Document>("users");

    // Idempotency: drop any leftover collection from a previous aborted run.
    let _ = coll.drop().await;

    let seeds = vec![
        doc! {
            "_id": 1,
            "name": "Ada",
            "age": 30,
            "profile": { "city": "London" },
        },
        doc! {
            "_id": 2,
            "name": "Grace",
            "age": 85,
        },
        doc! {
            "_id": 3,
            "name": "Alan",
            "tags": ["a", "b"],
        },
    ];
    coll.insert_many(seeds)
        .await
        .expect("seed insert_many should succeed");

    // ── infer_collection_fields ───────────────────────────────────────────
    let columns = adapter
        .infer_collection_fields("table_view_test", "users", 100)
        .await
        .expect("infer_collection_fields should succeed");

    let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names.first().copied(), Some("_id"), "_id must be first");
    assert!(names.contains(&"name"), "name column missing: {:?}", names);
    assert!(names.contains(&"age"), "age column missing: {:?}", names);
    assert!(
        names.contains(&"profile"),
        "profile column missing: {:?}",
        names
    );
    assert!(names.contains(&"tags"), "tags column missing: {:?}", names);

    // `_id` and `name` are present in every sample doc → not nullable.
    // `age`, `profile`, `tags` are each missing from at least one sample.
    let find_col = |n: &str| {
        columns
            .iter()
            .find(|c| c.name == n)
            .unwrap_or_else(|| panic!("column {n} missing in infer result"))
    };
    assert!(!find_col("_id").nullable, "_id must not be nullable");
    assert!(!find_col("name").nullable, "name must not be nullable");
    assert!(
        find_col("age").nullable,
        "age must be nullable (missing from doc 3)"
    );
    assert!(
        find_col("profile").nullable,
        "profile must be nullable (missing from docs 2 & 3)"
    );
    assert!(
        find_col("tags").nullable,
        "tags must be nullable (missing from docs 1 & 2)"
    );

    // ── find ─────────────────────────────────────────────────────────────
    let body = FindBody {
        sort: Some(doc! { "_id": 1 }),
        ..Default::default()
    };
    let result = adapter
        .find("table_view_test", "users", body)
        .await
        .expect("find should succeed");

    assert_eq!(result.rows.len(), 3, "expected 3 rows from find");
    assert_eq!(
        result.columns.first().map(|c| c.name.as_str()),
        Some("_id"),
        "find must return columns with _id first"
    );
    assert_eq!(
        result.raw_documents.len(),
        3,
        "raw_documents must mirror rows length"
    );

    // Locate column indices by name for sentinel assertions.
    let col_index = |name: &str| -> usize {
        result
            .columns
            .iter()
            .position(|c| c.name == name)
            .unwrap_or_else(|| panic!("column {name} missing in find columns"))
    };
    let profile_idx = col_index("profile");
    let tags_idx = col_index("tags");

    // Row 1 has profile=Document → sentinel "{...}".
    let row0 = &result.rows[0];
    assert_eq!(
        row0[profile_idx],
        Value::String("{...}".to_string()),
        "row 1 profile must be flattened to '{{...}}'"
    );
    // Row 1 has no tags → null.
    assert!(
        row0[tags_idx].is_null(),
        "row 1 tags must be null, got {:?}",
        row0[tags_idx]
    );

    // Row 3 has tags=["a","b"] → sentinel "[2 items]".
    let row2 = &result.rows[2];
    assert_eq!(
        row2[tags_idx],
        Value::String("[2 items]".to_string()),
        "row 3 tags must be flattened to '[2 items]'"
    );
    // Row 3 has no profile → null.
    assert!(
        row2[profile_idx].is_null(),
        "row 3 profile must be null, got {:?}",
        row2[profile_idx]
    );

    // total_count reflects the seeded cardinality (estimated on a fresh
    // fixture is deterministic in practice — 3 docs just inserted).
    assert!(
        result.total_count >= 3,
        "total_count must be at least 3, got {}",
        result.total_count
    );

    // ── cleanup ──────────────────────────────────────────────────────────
    coll.drop().await.expect("cleanup drop_collection");

    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 72 — `$match` + `$sort` pipeline returns a deterministic subset.
///
/// Seeds the same three-user fixture as the Sprint 66 test, then runs
/// `[{ $match: { age: { $gt: 25 } } }, { $sort: { _id: 1 } }]`. With the
/// seeded ages (Ada=30, Grace=85, Alan=no age), only Ada and Grace pass the
/// `$match`, and `$sort` pins `_id: 1` (Ada) first.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_aggregate_match_sort() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::test_config(table_view_lib::models::DatabaseType::Mongodb);
    let seed = seed_client(&config).await;
    let db = seed.database("table_view_test");
    let coll = db.collection::<Document>("users");

    // Idempotency.
    let _ = coll.drop().await;

    let seeds = vec![
        doc! { "_id": 1, "name": "Ada", "age": 30 },
        doc! { "_id": 2, "name": "Grace", "age": 85 },
        doc! { "_id": 3, "name": "Alan" },
    ];
    coll.insert_many(seeds)
        .await
        .expect("seed insert_many should succeed");

    let pipeline: Vec<Document> = vec![
        doc! { "$match": { "age": { "$gt": 25 } } },
        doc! { "$sort": { "_id": 1 } },
    ];

    let result = adapter
        .aggregate("table_view_test", "users", pipeline)
        .await
        .expect("aggregate should succeed");

    // Two documents match `age > 25` (Ada=30, Grace=85). Alan has no age.
    assert_eq!(
        result.rows.len(),
        2,
        "expected 2 rows from aggregate, got {}",
        result.rows.len()
    );
    assert_eq!(
        result.total_count, 2,
        "total_count must reflect aggregate output cardinality"
    );
    assert_eq!(
        result.raw_documents.len(),
        result.rows.len(),
        "raw_documents must mirror rows length"
    );

    // _id is forced to the leading column (see columns_from_docs contract).
    assert_eq!(
        result.columns.first().map(|c| c.name.as_str()),
        Some("_id"),
        "columns must lead with _id"
    );

    // `$sort: _id asc` → first raw document should have `_id: 1`.
    let first_id = result
        .raw_documents
        .first()
        .and_then(|d| d.get_i32("_id").ok())
        .expect("first raw document must contain _id");
    assert_eq!(first_id, 1, "first row after $sort must be _id=1 (Ada)");

    let second_id = result
        .raw_documents
        .get(1)
        .and_then(|d| d.get_i32("_id").ok())
        .expect("second raw document must contain _id");
    assert_eq!(second_id, 2, "second row after $sort must be _id=2 (Grace)");

    // cleanup
    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 72 — `$group` with `$sum` returns a single count row.
///
/// Seeds the same three-user fixture then runs
/// `[{ $group: { _id: null, total: { $sum: 1 } } }]`. The pipeline output is
/// a single synthetic document `{ _id: null, total: 3 }` — the grid must
/// expose `total` as a column and carry the integer value in row 0.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_aggregate_group_count() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::test_config(table_view_lib::models::DatabaseType::Mongodb);
    let seed = seed_client(&config).await;
    let db = seed.database("table_view_test");
    let coll = db.collection::<Document>("users");

    // Idempotency.
    let _ = coll.drop().await;

    let seeds = vec![
        doc! { "_id": 1, "name": "Ada", "age": 30 },
        doc! { "_id": 2, "name": "Grace", "age": 85 },
        doc! { "_id": 3, "name": "Alan" },
    ];
    coll.insert_many(seeds)
        .await
        .expect("seed insert_many should succeed");

    let pipeline: Vec<Document> = vec![doc! {
        "$group": { "_id": null, "total": { "$sum": 1 } }
    }];

    let result = adapter
        .aggregate("table_view_test", "users", pipeline)
        .await
        .expect("aggregate should succeed");

    assert_eq!(
        result.rows.len(),
        1,
        "$group with _id:null must collapse to a single row, got {}",
        result.rows.len()
    );
    assert_eq!(result.total_count, 1, "total_count must be 1");

    // `total` must surface as a column on the result.
    let total_idx = result
        .columns
        .iter()
        .position(|c| c.name == "total")
        .expect("aggregate result must expose 'total' column");

    // The row cell must equal the seeded document count (3). `flatten_cell`
    // routes BSON scalars through canonical extended JSON, which wraps
    // integer variants as `{"$numberInt": "N"}` (Int32) or
    // `{"$numberLong": "N"}` (Int64) depending on which variant the driver
    // returned. A bare JSON integer is also accepted in case a future server
    // version widens the representation further.
    let total_cell = &result.rows[0][total_idx];
    let parse_wrapped = |key: &str| -> Option<i64> {
        total_cell
            .get(key)
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
    };
    let total_value = total_cell
        .as_i64()
        .or_else(|| parse_wrapped("$numberInt"))
        .or_else(|| parse_wrapped("$numberLong"))
        .unwrap_or_else(|| panic!("unexpected total cell shape: {total_cell}"));
    assert_eq!(
        total_value, 3,
        "total must equal the seeded document count (3)"
    );

    // Also confirm the raw_documents carry the underlying BSON value.
    let raw_total = result
        .raw_documents
        .first()
        .expect("raw_documents must contain the grouped row")
        .get("total")
        .expect("raw document must contain 'total' field");
    // `$sum: 1` may yield Int32 or Int64 — accept either.
    let raw_total_i64 = raw_total
        .as_i32()
        .map(i64::from)
        .or_else(|| raw_total.as_i64())
        .unwrap_or_else(|| panic!("unexpected raw total variant: {raw_total:?}"));
    assert_eq!(raw_total_i64, 3, "raw total must equal seeded count");

    // cleanup
    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}
