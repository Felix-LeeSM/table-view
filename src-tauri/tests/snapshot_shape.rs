//! 작성 2026-05-16 (Phase 1 sprint-357) — `get_initial_app_state_inner` IPC
//! 의 wire shape 검증 (AC-357-01 / AC-357-03 / AC-357-04 / AC-357-06 /
//! AC-357-07).
//!
//! strategy doc F.2 (line 911–998) 와 byte-equivalent shape:
//!   {
//!     schemaVersion: 1,
//!     snapshotVersion: number,
//!     generatedAt: number,
//!     partial: boolean,
//!     stores: { connections, workspaces, mru, theme, safeMode },
//!     runtime: { activeStatuses }
//!   }
//!
//! top-level 키 집합은 아래 `test_snapshot_top_level_key_set_is_closed` 의
//! `assert_eq!` 가 갖는다 — 여기 개수를 적으면 다음 필드 추가가 이 줄을 낡게
//! 만든다 (#2183 이 `connectionsRestoredFromBackup` 을 더할 때 이 줄은 이미
//! 실제 키 수와 어긋나 있었다). boot non-critical (favorites / queryHistory /
//! schemaCache / datagrid_prefs) 은 미포함 — lazy IPC 로 mount 시 fetch.
//!
//! `_inner` 시그니처: (pool, window_label, status_map) → 직렬화 가능한 JSON value
//! — Tauri command 의 wrapper 는 `window.label()` + `state.connection_status`
//! 에서 두 인자를 추출.

use serde_json::Value;
use serial_test::serial;
use sqlx::SqlitePool;
use std::collections::HashMap;
use table_view_lib::commands::snapshot::get_initial_app_state_inner;
use table_view_lib::models::{ConnectionConfig, ConnectionStatus, DatabaseType, SslMode};
use table_view_lib::storage::{self, local};
use tempfile::TempDir;

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    (dir, pool)
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

fn empty_status() -> HashMap<String, ConnectionStatus> {
    HashMap::new()
}

// ----------------------------------------------------------------------
// AC-357-01 — top-level 키 집합이 닫혀 있는지. Empty DB 시점에도 모든 키가
// 존재해야 하고, 목록 밖의 키는 없어야 한다.
// ----------------------------------------------------------------------
#[tokio::test]
#[serial]
async fn test_snapshot_top_level_key_set_is_closed() {
    let (_dir, pool) = setup().await;
    let snap = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    let obj = json.as_object().expect("top-level must be an object");

    // 집합 비교 하나로 둔다 — 빠진 키와 목록 밖 키를 같은 단언이 잡고, 길이
    // 리터럴을 따로 두지 않아 필드를 더할 때 갱신할 자리가 하나다.
    //
    // `recovered` (v0.3.1) 는 boot 자동 복구(quarantine + fresh) 발생 여부,
    // `connectionsRestoredFromBackup` (#2183) 은 connections.json 이 없어서
    // 백업으로 되살렸고 그 백업에 연결이나 그룹이 있었는지다. 두 사건은
    // 사용자에게 반대되는 말을 하고 다른 파일을 가리켜서 키가 따로다. 둘 다
    // runtime meta 라 schemaVersion 은 1 유지.
    let keys: std::collections::BTreeSet<&str> = obj.keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        std::collections::BTreeSet::from([
            "schemaVersion",
            "snapshotVersion",
            "generatedAt",
            "partial",
            "recovered",
            "connectionsRestoredFromBackup",
            "stores",
            "runtime",
        ]),
        "top-level wire keys are a closed set"
    );

    let stores = obj["stores"].as_object().expect("stores must be object");
    assert!(
        stores.contains_key("connections"),
        "missing stores.connections"
    );
    assert!(
        stores.contains_key("workspaces"),
        "missing stores.workspaces"
    );
    assert!(stores.contains_key("mru"), "missing stores.mru");
    assert!(stores.contains_key("theme"), "missing stores.theme");
    assert!(stores.contains_key("safeMode"), "missing stores.safeMode");
    assert_eq!(
        stores.len(),
        5,
        "stores must have exactly 5 keys, found {:?}",
        stores.keys().collect::<Vec<_>>()
    );

    let runtime = obj["runtime"].as_object().expect("runtime must be object");
    assert!(
        runtime.contains_key("activeStatuses"),
        "missing runtime.activeStatuses"
    );

    cleanup();
}

// AC-357-01 — boot non-critical store 미포함 (favorites / queryHistory /
// schemaCache / datagrid_prefs). lazy IPC 로 mount 시 fetch.
#[tokio::test]
#[serial]
async fn test_snapshot_omits_lazy_loaded_stores() {
    let (_dir, pool) = setup().await;
    let snap = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    let stores = json["stores"].as_object().unwrap();

    for forbidden in ["favorites", "queryHistory", "schemaCache", "datagridPrefs"] {
        assert!(
            !stores.contains_key(forbidden),
            "stores must not include lazy-loaded `{}` — that domain has its own IPC",
            forbidden
        );
    }
    cleanup();
}

// AC-357-01 — schemaVersion = 1.
#[tokio::test]
#[serial]
async fn test_snapshot_schema_version_is_one() {
    let (_dir, pool) = setup().await;
    let snap = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    assert_eq!(
        json["schemaVersion"],
        Value::from(1),
        "schemaVersion must be 1 (Phase 1 wire format)"
    );
    cleanup();
}

// ----------------------------------------------------------------------
// AC-357-06 — empty DB 시 default values + partial=false + activeStatuses={}.
// ----------------------------------------------------------------------
#[tokio::test]
#[serial]
async fn test_snapshot_empty_db_defaults_partial_false() {
    let (_dir, pool) = setup().await;
    let snap = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();

    assert_eq!(json["partial"], Value::Bool(false));

    let stores = &json["stores"];

    // connections — { items: [], groups: [] }
    let conns = stores["connections"].as_object().unwrap();
    assert_eq!(conns["items"], Value::Array(vec![]));
    assert_eq!(conns["groups"], Value::Array(vec![]));

    // workspaces — { byConnectionId: {} } (launcher scope)
    let ws = stores["workspaces"].as_object().unwrap();
    assert_eq!(
        ws["byConnectionId"],
        Value::Object(serde_json::Map::new()),
        "launcher scope must have empty byConnectionId"
    );

    // mru — { recentConnections: [], lastUsedConnectionId: null }
    let mru = stores["mru"].as_object().unwrap();
    assert_eq!(mru["recentConnections"], Value::Array(vec![]));
    assert_eq!(mru["lastUsedConnectionId"], Value::Null);

    // theme — default { themeId: "slate", mode: "system" }
    // Wave 9.5 (2026-05-16) — 회귀 2 contract: backend default 의 theme_id 가
    // frontend `DEFAULT_THEME_ID` ("slate") 와 일치해야 한다.
    let theme = stores["theme"].as_object().unwrap();
    assert_eq!(theme["themeId"], "slate");
    assert_eq!(theme["mode"], "system");

    // safeMode — default { mode: "warn" } (#1113: 신규 설치 실효 기본값).
    let safe = stores["safeMode"].as_object().unwrap();
    assert_eq!(safe["mode"], "warn");

    // runtime.activeStatuses — {}
    let runtime = &json["runtime"];
    assert_eq!(
        runtime["activeStatuses"],
        Value::Object(serde_json::Map::new())
    );

    cleanup();
}

// ----------------------------------------------------------------------
// AC-357-03 — window scope. launcher → byConnectionId {}; workspace-conn-1 →
// 그 connection 만 노출.
// ----------------------------------------------------------------------
#[tokio::test]
#[serial]
async fn test_snapshot_launcher_window_scope_returns_empty_workspaces() {
    let (_dir, pool) = setup().await;

    // Seed: 두 connection 의 workspace row 가 존재해도 launcher 에서는 안 보임.
    let now = 1_700_000_000_000i64;
    sqlx::query(
        "INSERT INTO workspaces(connection_id, db_name, active_tab_id, tabs_json, \
         sidebar_expanded_json, closed_tabs_json, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("conn-1")
    .bind("db-a")
    .bind::<Option<String>>(None)
    .bind("[]")
    .bind("[]")
    .bind("[]")
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO workspaces(connection_id, db_name, active_tab_id, tabs_json, \
         sidebar_expanded_json, closed_tabs_json, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("conn-2")
    .bind("db-b")
    .bind::<Option<String>>(None)
    .bind("[]")
    .bind("[]")
    .bind("[]")
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();

    let snap = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    let ws = json["stores"]["workspaces"].as_object().unwrap();
    let by_conn = ws["byConnectionId"].as_object().unwrap();
    assert!(
        by_conn.is_empty(),
        "launcher window scope: byConnectionId must be empty even when DB rows exist, got {:?}",
        by_conn.keys().collect::<Vec<_>>()
    );

    cleanup();
}

#[tokio::test]
#[serial]
async fn test_snapshot_workspace_window_scope_returns_only_its_connection() {
    let (_dir, pool) = setup().await;

    let now = 1_700_000_000_000i64;
    // Two connections, each with workspace data. Workspace window for conn-1
    // must only see conn-1; conn-2 must be filtered out.
    for (cid, db) in [("conn-1", "db-a"), ("conn-1", "db-b"), ("conn-2", "db-c")] {
        sqlx::query(
            "INSERT INTO workspaces(connection_id, db_name, active_tab_id, tabs_json, \
             sidebar_expanded_json, closed_tabs_json, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(cid)
        .bind(db)
        .bind::<Option<String>>(None)
        .bind("[]")
        .bind("[]")
        .bind("[]")
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();
    }

    let snap = get_initial_app_state_inner(&pool, "workspace-conn-1", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    let by_conn = json["stores"]["workspaces"]["byConnectionId"]
        .as_object()
        .unwrap();
    assert!(
        by_conn.contains_key("conn-1"),
        "workspace window must include its own conn-1"
    );
    assert!(
        !by_conn.contains_key("conn-2"),
        "workspace window must exclude other conn-2, got keys {:?}",
        by_conn.keys().collect::<Vec<_>>()
    );

    // conn-1 should contain both db-a and db-b sub-workspaces.
    let conn1 = by_conn["conn-1"].as_object().unwrap();
    assert!(conn1.contains_key("db-a"));
    assert!(conn1.contains_key("db-b"));

    cleanup();
}

// ----------------------------------------------------------------------
// AC-357-04 — `snapshotVersion` 단조 증가. 같은 process 안에서 두 번 호출
// 시 s2.snapshotVersion > s1.snapshotVersion.
// ----------------------------------------------------------------------
#[tokio::test]
#[serial]
async fn test_snapshot_version_is_monotonically_increasing() {
    let (_dir, pool) = setup().await;

    let s1 = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let s2 = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let s3 = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();

    let v1 = serde_json::to_value(&s1).unwrap()["snapshotVersion"]
        .as_u64()
        .expect("snapshotVersion must be number");
    let v2 = serde_json::to_value(&s2).unwrap()["snapshotVersion"]
        .as_u64()
        .unwrap();
    let v3 = serde_json::to_value(&s3).unwrap()["snapshotVersion"]
        .as_u64()
        .unwrap();

    assert!(
        v2 > v1,
        "snapshotVersion must increase: v1={} v2={}",
        v1,
        v2
    );
    assert!(
        v3 > v2,
        "snapshotVersion must increase: v2={} v3={}",
        v2,
        v3
    );

    cleanup();
}

// ----------------------------------------------------------------------
// AC-357-01 — runtime.activeStatuses 가 in-memory status map 을 그대로 반영.
// ----------------------------------------------------------------------
#[tokio::test]
#[serial]
async fn test_snapshot_runtime_active_statuses_reflects_status_map() {
    let (_dir, pool) = setup().await;

    let mut statuses = HashMap::new();
    // Sprint 364 (2026-05-16) — `Connected` 가 struct variant 로 승격됐다.
    // `active_db: None` 으로 기록해야 snapshot 안의 wire shape 가
    // `{type:"connected"}` (필드 부재) 그대로 유지된다.
    statuses.insert(
        "conn-1".to_string(),
        ConnectionStatus::Connected { active_db: None },
    );
    statuses.insert("conn-2".to_string(), ConnectionStatus::Disconnected);

    let snap = get_initial_app_state_inner(&pool, "launcher", &statuses)
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    let runtime = json["runtime"]["activeStatuses"].as_object().unwrap();
    assert_eq!(runtime.len(), 2);
    assert!(runtime.contains_key("conn-1"));
    assert!(runtime.contains_key("conn-2"));
    // ConnectionStatus 의 serde 형태 (tag="type", content="message") 가 그대로
    // 전달되어야 함. Phase 1 시점의 enum 은 `{type:"connected"} / {type:"disconnected"} /
    // {type:"error", message:"..."}` 세 variant.
    assert_eq!(runtime["conn-1"]["type"], Value::String("connected".into()));
    assert_eq!(
        runtime["conn-2"]["type"],
        Value::String("disconnected".into())
    );

    cleanup();
}

// ----------------------------------------------------------------------
// AC-357-01 — seeded DB → stores 가 실제 SQLite row 를 반영.
// ----------------------------------------------------------------------
#[tokio::test]
#[serial]
async fn test_snapshot_returns_seeded_connections_and_groups() {
    let (_dir, pool) = setup().await;
    let now = 1_700_000_000_000i64;

    sqlx::query(
        "INSERT INTO connection_groups(id, name, color, collapsed, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("g1")
    .bind("Production")
    .bind::<Option<String>>(None)
    .bind(0i64)
    .bind(0i64)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, database, \
         group_id, color, connection_timeout, keep_alive_interval, environment, auth_source, \
         replica_set, tls_enabled, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("c1")
    .bind("MyPG")
    .bind("postgresql")
    .bind("localhost")
    .bind(5432i64)
    .bind("postgres")
    .bind("")
    .bind("postgres")
    .bind::<Option<String>>(Some("g1".into()))
    .bind::<Option<String>>(None)
    .bind::<Option<i64>>(None)
    .bind::<Option<i64>>(None)
    .bind::<Option<String>>(None)
    .bind::<Option<String>>(None)
    .bind::<Option<String>>(None)
    .bind::<Option<i64>>(None)
    .bind(0i64)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();

    let snap = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    let conns = json["stores"]["connections"].as_object().unwrap();
    let items = conns["items"].as_array().unwrap();
    let groups = conns["groups"].as_array().unwrap();
    assert_eq!(items.len(), 1, "expected 1 connection");
    assert_eq!(groups.len(), 1, "expected 1 group");
    assert_eq!(items[0]["id"], Value::String("c1".into()));
    assert_eq!(items[0]["name"], Value::String("MyPG".into()));
    // password 는 has_password boolean 으로만 노출 — plaintext / ciphertext 없음.
    assert!(items[0].get("password").is_none());
    assert!(items[0].get("password_enc").is_none());
    // ConnectionConfigPublic wire shape is camelCase.
    assert_eq!(items[0]["hasPassword"], Value::Bool(false));
    assert!(items[0].get("has_password").is_none());
    assert_eq!(groups[0]["id"], Value::String("g1".into()));

    cleanup();
}

// ----------------------------------------------------------------------
// AC-357-01 — mru 가 last_used DESC 정렬 + lastUsedConnectionId 가 맨 위.
// ----------------------------------------------------------------------
#[tokio::test]
#[serial]
async fn test_snapshot_mru_orders_recent_descending() {
    let (_dir, pool) = setup().await;
    for (id, ts) in [("c-old", 1i64), ("c-mid", 100), ("c-new", 10_000)] {
        sqlx::query("INSERT INTO mru(connection_id, last_used) VALUES (?, ?)")
            .bind(id)
            .bind(ts)
            .execute(&pool)
            .await
            .unwrap();
    }
    let snap = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    let mru = json["stores"]["mru"].as_object().unwrap();
    let recent = mru["recentConnections"].as_array().unwrap();
    let ids: Vec<&str> = recent.iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(
        ids,
        vec!["c-new", "c-mid", "c-old"],
        "MRU should be ordered by last_used DESC"
    );
    assert_eq!(mru["lastUsedConnectionId"], Value::String("c-new".into()));
    cleanup();
}

// ----------------------------------------------------------------------
// AC-357-01 — settings 의 theme / safe_mode 가 stores.theme / stores.safeMode
// 로 노출.
// ----------------------------------------------------------------------
#[tokio::test]
#[serial]
async fn test_snapshot_reads_theme_and_safe_mode_from_settings() {
    let (_dir, pool) = setup().await;
    let now = 1_700_000_000_000i64;

    sqlx::query("INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
        .bind("theme")
        .bind(r#"{"themeId":"dracula","mode":"dark"}"#)
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
        .bind("safe_mode")
        .bind(r#"{"mode":"strict"}"#)
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();

    let snap = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    assert_eq!(json["stores"]["theme"]["themeId"], "dracula");
    assert_eq!(json["stores"]["theme"]["mode"], "dark");
    // 영속된 유효 3-tier 값은 wire 로 그대로 round-trip (#1113 하위 호환).
    assert_eq!(json["stores"]["safeMode"]["mode"], "strict");
    cleanup();
}

/// #1649 (ADR 0058) — the SQLite mirror has no CA column, so a `verify-ca`
/// connection reconstructs from it as `verify-full` with `caCertPath: null`.
/// Nothing connects from the snapshot, so that is harmless to *dial* — but the
/// boot window is editable, and a user who opens and saves the connection before
/// `loadConnections()` replaces the snapshot would write the null CA path back
/// to the file SOT and lose it, after which every save is rejected by the
/// fail-closed gate. `read_connections` therefore overlays the authoritative
/// posture from the file SOT. Seeding the mirror with the *lossy* projection is
/// what makes this test bite: drop the overlay and the assertions below read
/// back `verify-full` / null.
#[tokio::test]
#[serial]
async fn test_snapshot_restores_verify_ca_and_ca_path_from_the_file_sot() {
    let (_dir, pool) = setup().await;
    let now = 1_700_000_000_000i64;
    let ca_path = "/opt/corp/private/corp-ca.pem";

    storage::save_connection(
        ConnectionConfig {
            id: "c-ca".into(),
            name: "PG private CA".into(),
            db_type: DatabaseType::Postgresql,
            host: "localhost".into(),
            port: 5432,
            user: "postgres".into(),
            password: String::new(),
            database: "postgres".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::VerifyCa,
            ca_cert_path: Some(ca_path.into()),
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        },
        Some(String::new()),
    )
    .expect("file SOT write");

    // The mirror row carries only the legacy integer columns, exactly as
    // `SslMode::to_legacy` projects `verify-ca`: (tls_enabled=1, trust=0), which
    // folds back to `verify-full` — the loss this overlay exists to repair.
    sqlx::query(
        "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, database, \
         tls_enabled, trust_server_certificate, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("c-ca")
    .bind("PG private CA")
    .bind("postgresql")
    .bind("localhost")
    .bind(5432i64)
    .bind("postgres")
    .bind("")
    .bind("postgres")
    .bind(1i64)
    .bind(0i64)
    .bind(0i64)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();

    let snap = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    let items = json["stores"]["connections"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(
        items[0]["sslMode"],
        Value::String("verify-ca".into()),
        "the boot snapshot must carry the file-SOT posture, not the mirror's \
         lossy projection"
    );
    assert_eq!(
        items[0]["caCertPath"],
        Value::String(ca_path.into()),
        "the CA path lives only in the file SOT — the snapshot must restore it"
    );

    cleanup();
}
