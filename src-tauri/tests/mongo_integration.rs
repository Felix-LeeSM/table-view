//! MongoAdapter integration test (Sprints 65 + 66 + 72 + 80).
//!
//! Sprint 65 walks the catalog happy path:
//! `connect → ping → list_databases → list_collections → disconnect`.
//!
//! Sprint 66 adds the read-path coverage: seeding a small fixture
//! (a per-test `table_view_test.users_*` collection) with heterogeneous
//! documents, invoking `infer_collection_fields` and `find`, and verifying
//! the expected column shape + sentinel flattening before dropping the
//! fixture.
//!
//! Isolation note (#1240): CI runs these via `cargo nextest`, which executes
//! each test in its OWN process. `#[serial_test::serial]` is an in-process
//! lock and therefore does NOT serialise tests across nextest processes — so
//! every test that touches Mongo must own a unique collection name. The
//! Sprint 66/72 read-path tests originally shared `table_view_test.users`,
//! which let one test's idempotency `drop()` empty another's freshly seeded
//! fixture mid-flight (flaky "$group ... got 0 rows"). Each read-path test
//! now uses a dedicated `users_*` collection like the mutate/index tests.
//!
//! Sprint 72 (Phase 6 plan E-1) adds aggregate-pipeline coverage:
//!   * `test_mongo_adapter_aggregate_match_sort` — `$match` + `$sort` stage
//!     pair filters/orders the seeded users deterministically.
//!   * `test_mongo_adapter_aggregate_group_count` — `$group` with `$sum`
//!     returns a single count row whose `total` column reflects the seeded
//!     document count.
//!
//! Sprint 80 (Phase 6 plan F-1) adds write-path coverage against
//! per-test collections under `table_view_test.mutate_*` so the read-path
//! fixtures above are never touched:
//!   * `test_mongo_adapter_insert_roundtrip` / `_update_applies_set` /
//!     `_delete_removes_document` — happy paths.
//!   * `test_mongo_adapter_update_rejects_id_in_patch` / `_missing_id_*` —
//!     Validation + NotFound error paths.
//!
//! When the MongoDB test container is not available the setup helper prints a
//! skip message and the test exits with status 0 — matching the existing
//! Postgres integration-test pattern (see `query_integration.rs`).

mod common;

use bson::{doc, oid::ObjectId, Bson, Document};
use mongodb::options::{ClientOptions, Credential, ServerAddress};
use mongodb::Client;
use serde_json::Value;
use table_view_lib::db::{
    BulkWriteOp, CreateMongoIndexRequest, DbAdapter, DocumentAdapter, DocumentId, FindBody,
    MongoIndexCollation, MongoIndexDirection, MongoIndexField,
};
use table_view_lib::error::AppError;
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
    // Sprint 237 P5+ (2026-05-08) — testcontainers의 Mongo image는 auth
    // 비활성이라 user 가 빈 문자열로 들어온다. credential 을 무조건
    // set 하면 SCRAM 인증 시도로 `Authentication failed` 가 나므로,
    // user 가 비어있을 때만 익명 연결.
    if !config.user.is_empty() {
        opts.credential = Some(
            Credential::builder()
                .username(config.user.clone())
                .password(config.password.clone())
                .source(config.auth_source.clone())
                .build(),
        );
    }
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
        .list_collections("admin", None)
        .await
        .expect("list_collections should succeed");
    println!(
        "list_collections(admin) returned {} entries",
        collections.len()
    );

    // Sprint 237 P5+ (2026-05-08) — empty-name guard 는
    // `db::mongodb::schema::tests::list_collections_rejects_empty_db_name`
    // 에서 결정적으로 검증된다. 통합 테스트에서는 setup 이 default_db
    // 를 셋팅하므로 빈 string 이 fallback 분기로 흘러 Ok([]) 가 정당
    // 결과. 환경 독립성을 위해 이 검증은 unit-level 에 위임.

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
/// Seeds `table_view_test.users_infer_find` with three documents:
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
    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let db = seed.database("table_view_test");
    let coll = db.collection::<Document>("users_infer_find");

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
        .infer_collection_fields("table_view_test", "users_infer_find", 100, None)
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
        .find("table_view_test", "users_infer_find", body, None)
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

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let db = seed.database("table_view_test");
    let coll = db.collection::<Document>("users_agg_match_sort");

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
        .aggregate(
            "table_view_test",
            "users_agg_match_sort",
            pipeline,
            None,
            None,
        )
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

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let db = seed.database("table_view_test");
    let coll = db.collection::<Document>("users_agg_group_count");

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
        .aggregate(
            "table_view_test",
            "users_agg_group_count",
            pipeline,
            None,
            None,
        )
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

// ── Sprint 80 (Phase 6 plan F-1) — mutate coverage ────────────────────────
//
// Each test uses its own collection name under `table_view_test` so the
// read-path fixtures above remain untouched and parallel-safe collection
// access is explicit. Per #1240, `#[serial_test::serial]` is an in-process
// lock and does NOT serialise across `cargo nextest` processes (the CI lane),
// so it cannot guard the shared MongoDB container cross-process — the unique
// per-test collection name above is what provides that isolation. `serial` is
// kept only as an in-process ordering guard for local `cargo test` runs.

/// Seed a single document into the per-test collection and return the
/// driver-assigned `_id` as a `Bson`. Drops the collection first so
/// re-runs after an aborted test always start from a clean slate.
async fn seed_one_doc(seed: &Client, collection: &str, document: Document) -> Bson {
    let coll = seed
        .database("table_view_test")
        .collection::<Document>(collection);
    // Idempotent setup.
    let _ = coll.drop().await;
    let res = coll
        .insert_one(document)
        .await
        .expect("seed insert_one should succeed");
    res.inserted_id
}

/// Sprint 80 — `insert_document` round-trip.
///
/// `adapter.insert_document` inserts a single document then `adapter.find`
/// confirms exactly one row is visible in the target collection. The
/// returned `DocumentId` must be a recognisable variant (`ObjectId` when
/// the server autogenerates the id).
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_insert_roundtrip() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("mutate_roundtrip");

    // Idempotency — drop any leftovers before we touch the fixture.
    let _ = coll.drop().await;

    let inserted_id = adapter
        .insert_document(
            "table_view_test",
            "mutate_roundtrip",
            doc! { "name": "alice", "age": 30_i32 },
        )
        .await
        .expect("insert_document should succeed");

    match &inserted_id {
        DocumentId::ObjectId(hex) => {
            assert_eq!(hex.len(), 24, "ObjectId hex must be 24 characters: {hex}");
        }
        other => panic!("expected DocumentId::ObjectId, got {other:?}"),
    }

    // Use the adapter's find to verify the document is visible through the
    // same read path the frontend will consume.
    let find_result = adapter
        .find(
            "table_view_test",
            "mutate_roundtrip",
            FindBody::default(),
            None,
        )
        .await
        .expect("find should succeed");
    assert_eq!(
        find_result.rows.len(),
        1,
        "expected exactly one row after insert"
    );

    // Confirm via the seed client that `name` / `age` survived the round-trip.
    let stored = coll
        .find_one(doc! {})
        .await
        .expect("find_one should succeed")
        .expect("seeded document must exist");
    assert_eq!(
        stored.get_str("name").expect("name present"),
        "alice",
        "inserted name must survive round-trip"
    );
    assert_eq!(
        stored.get_i32("age").expect("age present"),
        30,
        "inserted age must survive round-trip"
    );

    // cleanup
    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 80 — `update_document` wraps the patch with `$set`.
///
/// Seeds a document with a known ObjectId, calls `update_document` with a
/// `{ name: "new" }` patch, and confirms the post-update document reflects
/// the change while other fields remain intact.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_update_applies_set() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;

    let oid = ObjectId::new();
    let inserted_id = seed_one_doc(
        &seed,
        "mutate_update",
        doc! { "_id": oid, "name": "old", "age": 1_i32 },
    )
    .await;

    match inserted_id {
        Bson::ObjectId(o) => assert_eq!(o, oid),
        other => panic!("expected ObjectId from seed, got {other:?}"),
    }

    adapter
        .update_document(
            "table_view_test",
            "mutate_update",
            DocumentId::ObjectId(oid.to_hex()),
            doc! { "name": "new" },
        )
        .await
        .expect("update_document should succeed");

    let coll = seed
        .database("table_view_test")
        .collection::<Document>("mutate_update");
    let after = coll
        .find_one(doc! { "_id": oid })
        .await
        .expect("find_one should succeed")
        .expect("updated document must exist");
    assert_eq!(
        after.get_str("name").expect("name present"),
        "new",
        "$set must have updated the name field"
    );
    // `$set` is a partial update — other fields must remain intact.
    assert_eq!(
        after.get_i32("age").expect("age present"),
        1,
        "unrelated fields must not be touched by $set"
    );

    // cleanup
    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 80 — `update_document` rejects `_id` in the patch.
///
/// The adapter must guard against identity mutation before any network
/// round-trip. This test exercises the guard with a patch containing a
/// fresh `_id`; the result must be `AppError::Validation`.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_update_rejects_id_in_patch() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;

    let oid = ObjectId::new();
    let _ = seed_one_doc(
        &seed,
        "mutate_reject_id",
        doc! { "_id": oid, "name": "keep" },
    )
    .await;

    let err = adapter
        .update_document(
            "table_view_test",
            "mutate_reject_id",
            DocumentId::ObjectId(oid.to_hex()),
            doc! { "_id": ObjectId::new(), "name": "changed" },
        )
        .await
        .expect_err("patch with _id must be rejected");

    match err {
        AppError::Validation(msg) => assert!(
            msg.contains("patch must not contain _id"),
            "unexpected message: {msg}"
        ),
        other => panic!("expected Validation error, got {other:?}"),
    }

    // The document must be untouched on this failure path.
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("mutate_reject_id");
    let untouched = coll
        .find_one(doc! { "_id": oid })
        .await
        .expect("find_one should succeed")
        .expect("original document must still exist");
    assert_eq!(
        untouched.get_str("name").expect("name present"),
        "keep",
        "rejected update must not have modified the document"
    );

    // cleanup
    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 80 — `update_document` on an unknown `_id` returns NotFound.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_update_on_missing_id_returns_not_found() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;

    // Ensure the collection exists but does NOT contain the target id.
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("mutate_missing_update");
    let _ = coll.drop().await;
    coll.insert_one(doc! { "_id": ObjectId::new(), "name": "other" })
        .await
        .expect("seed insert should succeed");

    let missing = ObjectId::new();
    let err = adapter
        .update_document(
            "table_view_test",
            "mutate_missing_update",
            DocumentId::ObjectId(missing.to_hex()),
            doc! { "name": "changed" },
        )
        .await
        .expect_err("update against a missing id must fail");

    match err {
        AppError::NotFound(msg) => assert!(
            msg.contains("not found"),
            "unexpected NotFound message: {msg}"
        ),
        other => panic!("expected NotFound error, got {other:?}"),
    }

    // cleanup
    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 80 — `delete_document` removes the target document.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_delete_removes_document() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;

    let oid = ObjectId::new();
    let _ = seed_one_doc(
        &seed,
        "mutate_delete",
        doc! { "_id": oid, "name": "to-delete" },
    )
    .await;

    adapter
        .delete_document(
            "table_view_test",
            "mutate_delete",
            DocumentId::ObjectId(oid.to_hex()),
        )
        .await
        .expect("delete_document should succeed");

    let coll = seed
        .database("table_view_test")
        .collection::<Document>("mutate_delete");
    let gone = coll
        .find_one(doc! { "_id": oid })
        .await
        .expect("find_one should succeed");
    assert!(
        gone.is_none(),
        "document must be gone after delete_document"
    );

    // cleanup
    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 80 — `delete_document` on an unknown `_id` returns NotFound.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_delete_on_missing_id_returns_not_found() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;

    let coll = seed
        .database("table_view_test")
        .collection::<Document>("mutate_missing_delete");
    let _ = coll.drop().await;
    // Seed an unrelated document so the collection exists but the target
    // id is genuinely absent.
    coll.insert_one(doc! { "_id": ObjectId::new(), "name": "other" })
        .await
        .expect("seed insert should succeed");

    let missing = ObjectId::new();
    let err = adapter
        .delete_document(
            "table_view_test",
            "mutate_missing_delete",
            DocumentId::ObjectId(missing.to_hex()),
        )
        .await
        .expect_err("delete against a missing id must fail");

    match err {
        AppError::NotFound(msg) => assert!(
            msg.contains("not found"),
            "unexpected NotFound message: {msg}"
        ),
        other => panic!("expected NotFound error, got {other:?}"),
    }

    // cleanup
    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

// ── Sprint 308 (2026-05-14) — A1 dispatch surface integration ─────────────
//
// 작성 이유: A1 mongosh 파서가 dispatch 할 6 신규 method 가 실 mongo
// (testcontainers) 에 대해 의도된 wire shape + side-effect 를 보장하는지
// 검증한다. 각 method 가 자체 collection 을 쓰므로 read-path 픽스처와
// 충돌 없이 직렬 실행. happy path + boundary case (`insert_many([])`,
// `bulk_write([])`) 까지 한 묶음으로 검증.

/// Sprint 308 — `insert_many` returns N inserted ids and the find round-trip
/// observes exactly N rows.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_insert_many_returns_ids() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("sprint308_insert_many");
    let _ = coll.drop().await;

    let docs = vec![
        doc! { "name": "alice", "tag": "x" },
        doc! { "name": "bob", "tag": "y" },
        doc! { "name": "carol", "tag": "x" },
        doc! { "name": "dave", "tag": "z" },
        doc! { "name": "eve", "tag": "y" },
    ];
    let n = docs.len();

    let ids = adapter
        .insert_many("table_view_test", "sprint308_insert_many", docs)
        .await
        .expect("insert_many should succeed");
    assert_eq!(ids.len(), n, "inserted_ids length must match input");
    for id in &ids {
        match id {
            DocumentId::ObjectId(hex) => assert_eq!(hex.len(), 24),
            other => panic!("expected DocumentId::ObjectId, got {other:?}"),
        }
    }

    let find_result = adapter
        .find(
            "table_view_test",
            "sprint308_insert_many",
            FindBody::default(),
            None,
        )
        .await
        .expect("find should succeed");
    assert_eq!(find_result.rows.len(), n);

    // Sprint 308 boundary case — empty input short-circuits without a
    // driver round-trip and returns an empty vec.
    let empty = adapter
        .insert_many("table_view_test", "sprint308_insert_many", Vec::new())
        .await
        .expect("insert_many([]) should succeed");
    assert!(empty.is_empty(), "empty input must short-circuit");

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 308 — `count_documents` returns the exact match count and
/// `estimated_document_count` returns at least the same value.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_count_and_estimated_counts() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("sprint308_counts");
    let _ = coll.drop().await;

    // Seed 5 docs with two different `tag` values to differentiate the
    // filter from the unfiltered count.
    let docs = vec![
        doc! { "name": "alice", "tag": "x" },
        doc! { "name": "bob", "tag": "x" },
        doc! { "name": "carol", "tag": "y" },
        doc! { "name": "dave", "tag": "x" },
        doc! { "name": "eve", "tag": "y" },
    ];
    let _ = adapter
        .insert_many("table_view_test", "sprint308_counts", docs)
        .await
        .expect("insert_many should succeed");

    // Unfiltered exact count must be 5.
    let total = adapter
        .count_documents("table_view_test", "sprint308_counts", Document::new(), None)
        .await
        .expect("count_documents should succeed");
    assert_eq!(total, 5);

    // Filtered exact count must be 3 (`tag == "x"`).
    let tag_x = adapter
        .count_documents(
            "table_view_test",
            "sprint308_counts",
            doc! { "tag": "x" },
            None,
        )
        .await
        .expect("count_documents (filter) should succeed");
    assert_eq!(tag_x, 3);

    // Estimated count is metadata-based — should be at least the actual
    // total but may be larger immediately after the bulk insert because
    // Mongo's metadata cache lags. Assert the "≥" floor instead of
    // strict equality so the test is not flaky across container versions.
    let est = adapter
        .estimated_document_count("table_view_test", "sprint308_counts", None)
        .await
        .expect("estimated_document_count should succeed");
    assert!(
        est >= 5,
        "estimated_document_count must be at least seeded total, got {est}"
    );

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 308 — `distinct` returns the unique value set for a field
/// (post-filter) and `find_one` returns a single matching DocumentRow.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_distinct_and_find_one() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("sprint308_distinct");
    let _ = coll.drop().await;

    let docs = vec![
        doc! { "name": "alice", "tag": "x" },
        doc! { "name": "bob", "tag": "y" },
        doc! { "name": "carol", "tag": "x" },
        doc! { "name": "dave", "tag": "z" },
        doc! { "name": "eve", "tag": "y" },
    ];
    let _ = adapter
        .insert_many("table_view_test", "sprint308_distinct", docs)
        .await
        .expect("insert_many should succeed");

    // distinct over all docs — three unique tags { x, y, z }.
    let values = adapter
        .distinct(
            "table_view_test",
            "sprint308_distinct",
            "tag",
            Document::new(),
            None,
        )
        .await
        .expect("distinct should succeed");
    let mut got: Vec<String> = values
        .into_iter()
        .filter_map(|v| match v {
            Value::String(s) => Some(s),
            _ => None,
        })
        .collect();
    got.sort();
    assert_eq!(got, vec!["x", "y", "z"]);

    // find_one against a specific name returns a DocumentRow whose
    // columns include `_id`/`name`/`tag` and whose row length matches.
    let row = adapter
        .find_one(
            "table_view_test",
            "sprint308_distinct",
            doc! { "name": "alice" },
            None,
        )
        .await
        .expect("find_one should succeed")
        .expect("alice must exist");
    assert_eq!(row.columns.len(), row.row.len(), "columns/row width match");
    let names: Vec<&str> = row.columns.iter().map(|c| c.name.as_str()).collect();
    assert!(names.contains(&"_id"), "_id column must be present");
    assert!(names.contains(&"name"), "name column must be present");

    // find_one with no match → Ok(None).
    let none = adapter
        .find_one(
            "table_view_test",
            "sprint308_distinct",
            doc! { "name": "nobody" },
            None,
        )
        .await
        .expect("find_one with no match should succeed");
    assert!(none.is_none(), "no-match find_one must be None");

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 308 — `bulk_write` runs a heterogeneous mix of ops and the
/// aggregate counters reflect the per-op outcomes. Also exercises the
/// empty-input short-circuit.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_bulk_write_aggregate_counters() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("sprint308_bulk_write");
    let _ = coll.drop().await;

    // Pre-seed two docs so the update + delete ops have a target.
    let oid_to_update = ObjectId::new();
    let oid_to_delete = ObjectId::new();
    coll.insert_many(vec![
        doc! { "_id": oid_to_update, "name": "alice", "version": 1_i32 },
        doc! { "_id": oid_to_delete, "name": "bob", "version": 1_i32 },
    ])
    .await
    .expect("seed insert_many should succeed");

    // Empty input short-circuits to BulkWriteResult::default().
    let empty = adapter
        .bulk_write("table_view_test", "sprint308_bulk_write", Vec::new())
        .await
        .expect("bulk_write([]) should succeed");
    assert_eq!(empty.inserted_count, 0);
    assert_eq!(empty.matched_count, 0);
    assert_eq!(empty.modified_count, 0);
    assert_eq!(empty.deleted_count, 0);
    assert!(empty.upserted_ids.is_empty());

    // Heterogeneous bulk-write: insertOne, updateOne, deleteOne.
    //
    // bulk_write is only available on MongoDB 8.0+. testcontainers'
    // default Mongo image may not satisfy this — surface the failure as
    // a SKIP rather than a hard error so the suite stays green on older
    // server versions.
    let ops = vec![
        BulkWriteOp::InsertOne {
            document: doc! { "name": "carol", "version": 1_i32 },
        },
        BulkWriteOp::UpdateOne {
            filter: doc! { "_id": oid_to_update },
            update: doc! { "$set": { "version": 2_i32 } },
            upsert: false,
        },
        BulkWriteOp::DeleteOne {
            filter: doc! { "_id": oid_to_delete },
        },
    ];

    let result = match adapter
        .bulk_write("table_view_test", "sprint308_bulk_write", ops)
        .await
    {
        Ok(r) => r,
        Err(AppError::Database(msg))
            if msg.contains("bulk write feature is only supported")
                || msg.contains("bulk_write is only supported") =>
        {
            // testcontainers' default Mongo image ships an older server
            // version that does not yet expose the unified `bulk_write`
            // command (8.0+). Treat that as a SKIP rather than failing the
            // suite so the rest of the Sprint 308 surface stays gated by
            // this single scenario.
            eprintln!("Skipping bulk_write op-mix assertion: {msg}");
            coll.drop().await.expect("cleanup drop_collection");
            adapter
                .disconnect()
                .await
                .expect("disconnect should succeed");
            return;
        }
        Err(other) => panic!("bulk_write should succeed, got {other:?}"),
    };

    // One insert, one update (match + modify), one delete → counters.
    assert_eq!(result.inserted_count, 1);
    assert_eq!(result.matched_count, 1);
    assert_eq!(result.modified_count, 1);
    assert_eq!(result.deleted_count, 1);
    assert!(result.upserted_ids.is_empty());

    // Verify the post-bulkWrite collection state matches expectations.
    let final_count = adapter
        .count_documents(
            "table_view_test",
            "sprint308_bulk_write",
            Document::new(),
            None,
        )
        .await
        .expect("count_documents should succeed");
    assert_eq!(final_count, 2);

    let updated = coll
        .find_one(doc! { "_id": oid_to_update })
        .await
        .expect("find_one should succeed")
        .expect("updated doc must exist");
    assert_eq!(updated.get_i32("version").expect("version field"), 2);

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

// ── Sprint 351 (2026-05-15) — Mongo index CRUD integration ────────────────
//
// 작성 이유: Mongo index CRUD trait method (`create_collection_index` /
// `drop_collection_index`) 가 실제 mongod 에 대해 의도된 wire shape (unique,
// TTL, partialFilterExpression, compound + collation) 을 round-trip 하는지
// 검증. 각 테스트가 `table_view_test.idx_*` 자체 collection 을 써서
// read-path 픽스처와 충돌 없이 직렬 실행. 컨테이너가 없으면 setup helper
// 가 None → early return → 통과 (기존 skip-on-no-container 패턴 답습).

/// Sprint 351 — unique single-field index round-trip.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_create_index_unique_roundtrip() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("idx_unique");
    let _ = coll.drop().await;
    coll.insert_one(doc! { "email": "a@example.com" })
        .await
        .expect("seed insert should succeed");

    let request = CreateMongoIndexRequest {
        name: None,
        fields: vec![MongoIndexField {
            name: "email".into(),
            direction: MongoIndexDirection::Asc,
        }],
        unique: Some(true),
        sparse: None,
        expire_after_seconds: None,
        partial_filter_expression: None,
        collation: None,
    };
    let result = adapter
        .create_collection_index("table_view_test", "idx_unique", request)
        .await
        .expect("create_collection_index should succeed");
    assert_eq!(
        result.name, "email_1",
        "driver should return the canonical email_1 name"
    );

    let indexes = adapter
        .list_collection_indexes("table_view_test", "idx_unique")
        .await
        .expect("list_collection_indexes should succeed");
    let email_idx = indexes
        .iter()
        .find(|i| i.name == "email_1")
        .expect("email_1 must be in listed indexes");
    assert!(email_idx.is_unique, "email_1 must carry unique=true");

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 351 — TTL single-field index (`expireAfterSeconds`).
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_create_index_ttl_single_field() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("idx_ttl");
    let _ = coll.drop().await;

    let request = CreateMongoIndexRequest {
        name: Some("session_ttl".into()),
        fields: vec![MongoIndexField {
            name: "createdAt".into(),
            direction: MongoIndexDirection::Asc,
        }],
        unique: None,
        sparse: None,
        expire_after_seconds: Some(3600),
        partial_filter_expression: None,
        collation: None,
    };
    let result = adapter
        .create_collection_index("table_view_test", "idx_ttl", request)
        .await
        .expect("create_collection_index should succeed");
    assert_eq!(result.name, "session_ttl");

    let mut cursor = coll
        .list_indexes()
        .await
        .expect("list_indexes should succeed");
    let mut found_ttl = false;
    while let Some(next) = futures_util::StreamExt::next(&mut cursor).await {
        let model = next.expect("cursor next");
        let name = model
            .options
            .as_ref()
            .and_then(|o| o.name.clone())
            .unwrap_or_default();
        if name == "session_ttl" {
            let secs = model
                .options
                .as_ref()
                .and_then(|o| o.expire_after.as_ref())
                .map(|d| d.as_secs())
                .expect("expire_after must be set");
            assert_eq!(secs, 3600);
            found_ttl = true;
        }
    }
    assert!(found_ttl, "session_ttl index must be present");

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 351 — partialFilterExpression round-trip.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_create_index_partial_filter() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("idx_partial");
    let _ = coll.drop().await;

    let filter = serde_json::json!({ "active": true });
    let request = CreateMongoIndexRequest {
        name: Some("active_only".into()),
        fields: vec![MongoIndexField {
            name: "user".into(),
            direction: MongoIndexDirection::Asc,
        }],
        unique: None,
        sparse: None,
        expire_after_seconds: None,
        partial_filter_expression: Some(filter),
        collation: None,
    };
    let result = adapter
        .create_collection_index("table_view_test", "idx_partial", request)
        .await
        .expect("create_collection_index should succeed");
    assert_eq!(result.name, "active_only");

    let mut cursor = coll
        .list_indexes()
        .await
        .expect("list_indexes should succeed");
    let mut found = false;
    while let Some(next) = futures_util::StreamExt::next(&mut cursor).await {
        let model = next.expect("cursor next");
        let name = model
            .options
            .as_ref()
            .and_then(|o| o.name.clone())
            .unwrap_or_default();
        if name == "active_only" {
            let pfe = model
                .options
                .as_ref()
                .and_then(|o| o.partial_filter_expression.clone())
                .expect("partial_filter_expression must be set");
            assert!(pfe.get_bool("active").unwrap_or(false));
            found = true;
        }
    }
    assert!(found, "active_only index must be present");

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 351 — compound (2-field) index with collation.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_create_index_compound_with_collation() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("idx_compound");
    let _ = coll.drop().await;

    let request = CreateMongoIndexRequest {
        name: Some("name_asc_age_desc".into()),
        fields: vec![
            MongoIndexField {
                name: "name".into(),
                direction: MongoIndexDirection::Asc,
            },
            MongoIndexField {
                name: "age".into(),
                direction: MongoIndexDirection::Desc,
            },
        ],
        unique: None,
        sparse: None,
        expire_after_seconds: None,
        partial_filter_expression: None,
        collation: Some(MongoIndexCollation {
            locale: "en".into(),
            strength: Some(2),
        }),
    };
    let result = adapter
        .create_collection_index("table_view_test", "idx_compound", request)
        .await
        .expect("create_collection_index should succeed");
    assert_eq!(result.name, "name_asc_age_desc");

    let indexes = adapter
        .list_collection_indexes("table_view_test", "idx_compound")
        .await
        .expect("list_collection_indexes should succeed");
    let compound = indexes
        .iter()
        .find(|i| i.name == "name_asc_age_desc")
        .expect("compound index must be listed");
    assert_eq!(
        compound.columns,
        vec!["name".to_string(), "age".to_string()]
    );
    assert_eq!(compound.index_type, "compound");

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 351 — drop an existing index by name.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_drop_existing_index() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("idx_drop");
    let _ = coll.drop().await;
    coll.insert_one(doc! { "email": "a@example.com" })
        .await
        .expect("seed insert should succeed");

    let req = CreateMongoIndexRequest {
        name: None,
        fields: vec![MongoIndexField {
            name: "email".into(),
            direction: MongoIndexDirection::Asc,
        }],
        unique: None,
        sparse: None,
        expire_after_seconds: None,
        partial_filter_expression: None,
        collation: None,
    };
    adapter
        .create_collection_index("table_view_test", "idx_drop", req)
        .await
        .expect("create should succeed");

    let before = adapter
        .list_collection_indexes("table_view_test", "idx_drop")
        .await
        .expect("list should succeed");
    assert!(before.iter().any(|i| i.name == "email_1"));

    adapter
        .drop_collection_index("table_view_test", "idx_drop", "email_1")
        .await
        .expect("drop_collection_index should succeed");

    let after = adapter
        .list_collection_indexes("table_view_test", "idx_drop")
        .await
        .expect("list should succeed");
    assert!(
        !after.iter().any(|i| i.name == "email_1"),
        "email_1 must be gone after drop"
    );

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 351 — dropping the `_id_` index goes through the driver and is
/// rejected (MongoDB enforces this server-side; the adapter does not
/// special-case `_id_` because the Tauri command shim handles the
/// friendly Validation message before the driver round-trip).
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_drop_id_index_rejected() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("idx_drop_id");
    let _ = coll.drop().await;
    coll.insert_one(doc! { "name": "ada" })
        .await
        .expect("seed insert should succeed");

    let err = adapter
        .drop_collection_index("table_view_test", "idx_drop_id", "_id_")
        .await
        .expect_err("dropping _id_ must fail");
    match err {
        AppError::Database(msg) => {
            assert!(
                msg.to_lowercase().contains("_id") || msg.to_lowercase().contains("drop"),
                "unexpected driver message: {msg}"
            );
        }
        other => panic!("expected Database error, got {other:?}"),
    }

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 351 — creating two indexes with the same name + different
/// options yields an `IndexOptionsConflict` (or similar) driver error.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_create_index_duplicate_name_errors() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("idx_dup");
    let _ = coll.drop().await;
    coll.insert_one(doc! { "email": "a@example.com" })
        .await
        .expect("seed insert should succeed");

    let req1 = CreateMongoIndexRequest {
        name: Some("conflict".into()),
        fields: vec![MongoIndexField {
            name: "email".into(),
            direction: MongoIndexDirection::Asc,
        }],
        unique: Some(true),
        sparse: None,
        expire_after_seconds: None,
        partial_filter_expression: None,
        collation: None,
    };
    adapter
        .create_collection_index("table_view_test", "idx_dup", req1)
        .await
        .expect("first create should succeed");

    let req2 = CreateMongoIndexRequest {
        name: Some("conflict".into()),
        fields: vec![MongoIndexField {
            name: "email".into(),
            direction: MongoIndexDirection::Asc,
        }],
        unique: Some(false),
        sparse: None,
        expire_after_seconds: None,
        partial_filter_expression: None,
        collation: None,
    };
    let err = adapter
        .create_collection_index("table_view_test", "idx_dup", req2)
        .await
        .expect_err("second create should fail");
    match err {
        AppError::Database(_) => { /* driver wording can vary */ }
        other => panic!("expected Database error, got {other:?}"),
    }

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 352 — round-trip a validator together with `validationLevel`
/// = "moderate" and `validationAction` = "warn". After collMod the
/// driver-side `listCollections.options` must surface all three values.
///
/// 작성 이유 (2026-05-15): 본 sprint 가 validator + level + action 의
/// IPC 페어 라운드트립을 wire-up 한다. live 라우팅에서 server-side
/// `options` 가 응답에 포함되어야 ValidatorPanel UI 가 select 컨트롤
/// 을 hydrate 할 수 있다.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_set_validator_with_level_and_action_roundtrip() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("validator_moderate_warn");
    let _ = coll.drop().await;
    coll.insert_one(doc! { "name": "ada" })
        .await
        .expect("seed insert should succeed");

    let validator = serde_json::json!({
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["name"],
            "properties": {
                "name": { "bsonType": "string" }
            }
        }
    });
    adapter
        .set_collection_validator(
            "table_view_test",
            "validator_moderate_warn",
            Some(validator),
            Some("moderate".into()),
            Some("warn".into()),
        )
        .await
        .expect("collMod with moderate+warn should succeed");

    let readback = adapter
        .get_collection_validator("table_view_test", "validator_moderate_warn")
        .await
        .expect("get validator should succeed");

    assert!(
        readback.validator.is_some(),
        "validator must round-trip non-null"
    );
    assert_eq!(
        readback.validation_level.as_deref(),
        Some("moderate"),
        "level must round-trip as moderate"
    );
    assert_eq!(
        readback.validation_action.as_deref(),
        Some("warn"),
        "action must round-trip as warn"
    );

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 352 — omitting `validation_level` / `validation_action` lets
/// MongoDB apply its server-side defaults (`strict` / `error`). The
/// backward-compat path: pre-sprint callers only sent the validator, and
/// the new wire format must produce the same observable server state.
///
/// 작성 이유 (2026-05-15): 옴 미트된 옵션이 collMod 에서 누락되어야
/// 백워드 컴팻 요구사항을 만족한다. MongoDB 가 server-side 기본값을
/// 적용하므로 readback 은 strict + error 여야 한다.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_set_validator_omitted_level_action_preserves_server_defaults() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("validator_defaults");
    let _ = coll.drop().await;
    coll.insert_one(doc! { "name": "linus" })
        .await
        .expect("seed insert should succeed");

    let validator = serde_json::json!({
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["name"]
        }
    });
    adapter
        .set_collection_validator(
            "table_view_test",
            "validator_defaults",
            Some(validator),
            None,
            None,
        )
        .await
        .expect("collMod without level/action should succeed");

    let readback = adapter
        .get_collection_validator("table_view_test", "validator_defaults")
        .await
        .expect("get validator should succeed");

    assert!(readback.validator.is_some(), "validator must round-trip");
    // MongoDB applies `strict` / `error` server-side when the client
    // omits the fields. Older driver versions may also echo back the
    // canonical default rather than omitting the key from the response,
    // so we accept either "Some(default)" or "None".
    match readback.validation_level.as_deref() {
        Some("strict") | None => {}
        other => panic!("expected strict-or-none level, got: {other:?}"),
    }
    match readback.validation_action.as_deref() {
        Some("error") | None => {}
        other => panic!("expected error-or-none action, got: {other:?}"),
    }

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 352 — the Tauri command shim rejects unknown `validationLevel`
/// values with `AppError::Validation` before any adapter round-trip.
///
/// 작성 이유 (2026-05-15): 화이트리스트 게이트가 통합 레벨에서도
/// 화이트리스트 사양에 부합하는지 검증. 어댑터까지 도달하지 않는
/// 다는 점에서 client 안전 보장이 핵심.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_set_validator_rejects_unknown_level() {
    // 이 테스트는 어댑터 자체가 아니라 Tauri command 계층의 화이트리스트를
    // 검증한다. 컨테이너가 없으면 setup 이 None 을 반환하지만, 화이트
    // 리스트는 connection 도달 전에 작동하므로 정상 동작 검증을 위해
    // adapter 가 준비된 환경에서 돌아가야 한다.
    if common::setup_mongo_adapter().await.is_none() {
        return;
    }
    // Tauri command 계층 (`set_mongo_validator_inner`) 은 pub(crate) 가
    // 아니라 mod-private 이므로 통합 테스트는 `set_collection_validator`
    // trait 시그니처를 우회해 호출할 수 없다. 대신 adapter 가 화이트
    // 리스트와 무관하게 (`Some("bogus")`) 값을 수신했을 때 driver 가
    // collMod 에서 거부하는지를 확인한다 — 화이트리스트가 동작하지
    // 않는 최악의 경우에도 server-side 가 차단함을 보장.
    let adapter = common::setup_mongo_adapter().await.expect("setup");
    let config = common::mongo_test_config()
        .await
        .expect("mongo endpoint resolution failed");
    let seed = seed_client(&config).await;
    let coll = seed
        .database("table_view_test")
        .collection::<Document>("validator_unknown_level");
    let _ = coll.drop().await;
    coll.insert_one(doc! { "name": "grace" })
        .await
        .expect("seed insert should succeed");

    let err = adapter
        .set_collection_validator(
            "table_view_test",
            "validator_unknown_level",
            None,
            Some("bogus".into()),
            None,
        )
        .await
        .expect_err("server-side must reject bogus level");
    match err {
        AppError::Database(_) => { /* driver wording varies across versions */ }
        other => panic!("expected Database error from driver, got {other:?}"),
    }

    coll.drop().await.expect("cleanup drop_collection");
    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}

/// Sprint 351 — TTL on a compound index is rejected by the adapter
/// before any driver round-trip.
#[tokio::test]
#[serial_test::serial]
async fn test_mongo_adapter_create_index_ttl_on_compound_rejected() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => return,
    };

    let req = CreateMongoIndexRequest {
        name: None,
        fields: vec![
            MongoIndexField {
                name: "createdAt".into(),
                direction: MongoIndexDirection::Asc,
            },
            MongoIndexField {
                name: "userId".into(),
                direction: MongoIndexDirection::Asc,
            },
        ],
        unique: None,
        sparse: None,
        expire_after_seconds: Some(3600),
        partial_filter_expression: None,
        collation: None,
    };
    let err = adapter
        .create_collection_index("table_view_test", "idx_ttl_compound", req)
        .await
        .expect_err("compound + TTL must be rejected");
    match err {
        AppError::Validation(msg) => assert!(msg.contains("single-field")),
        other => panic!("expected Validation, got {other:?}"),
    }

    adapter
        .disconnect()
        .await
        .expect("disconnect should succeed");
}
