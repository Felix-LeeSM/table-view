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
//! 9 top-level keys. boot non-critical (favorites / queryHistory / schemaCache /
//! datagrid_prefs) 은 미포함 — lazy IPC 로 mount 시 fetch.
//!
//! `_inner` 시그니처: (pool, window_label, status_map) → 직렬화 가능한 JSON value
//! — Tauri command 의 wrapper 는 `window.label()` + `state.connection_status`
//! 에서 두 인자를 추출.

use serde_json::Value;
use serial_test::serial;
use sqlx::SqlitePool;
use std::collections::HashMap;
use table_view_lib::commands::snapshot::get_initial_app_state_inner;
use table_view_lib::models::ConnectionStatus;
use table_view_lib::storage::local;
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
// AC-357-01 — shape 9 키 확인. Empty DB 시점에도 top-level 9 키가 모두
// 존재해야 함.
// ----------------------------------------------------------------------
#[tokio::test]
#[serial]
async fn test_snapshot_top_level_has_nine_keys() {
    let (_dir, pool) = setup().await;
    let snap = get_initial_app_state_inner(&pool, "launcher", &empty_status())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    let obj = json.as_object().expect("top-level must be an object");

    // 9 키: schemaVersion + snapshotVersion + generatedAt + partial + stores +
    //       runtime
    // (stores 와 runtime 은 nested object; 본 assert 는 top-level 키 6 개 +
    //  stores 내부 5 store + runtime 내부 1 = 9 의미 라고 spec 이 적은 것)
    assert!(obj.contains_key("schemaVersion"), "missing schemaVersion");
    assert!(
        obj.contains_key("snapshotVersion"),
        "missing snapshotVersion"
    );
    assert!(obj.contains_key("generatedAt"), "missing generatedAt");
    assert!(obj.contains_key("partial"), "missing partial");
    // v0.3.1 — boot 자동 복구(quarantine + fresh) 발생 여부를 frontend toast 용
    // runtime meta 로 전달. schemaVersion 은 1 유지.
    assert!(obj.contains_key("recovered"), "missing recovered");
    assert!(obj.contains_key("stores"), "missing stores");
    assert!(obj.contains_key("runtime"), "missing runtime");
    assert_eq!(
        obj.len(),
        7,
        "top-level must have exactly 7 keys (schemaVersion, snapshotVersion, generatedAt, partial, recovered, stores, runtime), found {:?}",
        obj.keys().collect::<Vec<_>>()
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

    // safeMode — default { mode: "off" } (or similar default sentinel)
    let safe = stores["safeMode"].as_object().unwrap();
    assert!(safe.contains_key("mode"));

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
        .bind(r#"{"mode":"on"}"#)
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
    assert_eq!(json["stores"]["safeMode"]["mode"], "on");
    cleanup();
}
