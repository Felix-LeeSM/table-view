//! 작성 2026-05-16 (Phase 1 sprint-358) — Phase 1 W1 dual-write 4 domains:
//! connections / favorites / mru / settings.
//!
//! Sprint 358 (Phase 1 W1) 시점에는 file/LS write 후 SQLite mirror INSERT/UPDATE.
//! Sprint 370 (Phase 4 W3 cut) 이후 favorites / mru / settings 의 file 분기는
//! retire 되었고 SQLite-only 가 된다. 본 통합 파일의 단언도 sprint-370 의
//! 회귀를 함께 잠근다 — file 미생성 + SQLite row 만 존재.
//!
//! `connections` 도메인은 별 트리거 (storage::save_connection — 기존
//! connections.json file SOT). sprint-370 의 In Scope 는 favorites / mru /
//! settings 의 W3 cut 만 다루고 connections file SOT 는 sprint-375 의 W4
//! file cleanup 까지 유지된다.
//!
//! AC mapping:
//!   - AC-358-01 connections dual-write   (file connections.json + SQLite connections row)
//!   - AC-358-02 favorites SQLite-only    (sprint-370 W3 cut — file retired)
//!   - AC-358-03 mru SQLite-only          (sprint-370 W3 cut — file retired)
//!   - AC-358-04 settings SQLite-only     (sprint-370 W3 cut — file retired)
//!   - AC-358-08 guard 4-state            (pending/importing/failed reject; done accept)
//!   - AC-358-09 mismatch counter == 0    (100-call stress, normal path)

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::persist_connections::{
    persist_connection_inner, PersistConnectionRequest,
};
use table_view_lib::commands::persist_favorites::{persist_favorite_inner, PersistFavoriteRequest};
use table_view_lib::commands::persist_mru::{persist_mru_inner, PersistMruRequest};
use table_view_lib::commands::persist_settings::{persist_setting_inner, PersistSettingRequest};
use table_view_lib::error::AppError;
use table_view_lib::storage::local;
use table_view_lib::storage::meta::{set_legacy_import_state, LegacyImportState};
use table_view_lib::storage::reconcile::mismatch_counter;
use tempfile::TempDir;

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    // 모든 dual-write 테스트는 import 완료 상태에서 시작 — guard 가 통과해야
    // SQLite write 가 일어남.
    set_legacy_import_state(&pool, LegacyImportState::Done)
        .await
        .unwrap();
    // 이 helper 가 호출되는 시점에는 process-shared mismatch_counter 가 다른
    // 테스트에서 누적되어 있을 수 있다. 각 테스트는 시작 시 reset 한다 (아래).
    (dir, pool)
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

// ---------------------------------------------------------------------------
// AC-358-01: connections dual-write
// ---------------------------------------------------------------------------

fn sample_connection_req(id: &str, name: &str) -> PersistConnectionRequest {
    PersistConnectionRequest {
        id: id.into(),
        name: name.into(),
        db_type: "postgresql".into(),
        host: "localhost".into(),
        port: 5432,
        user: "postgres".into(),
        database: "testdb".into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
        sort_order: 0,
    }
}

#[tokio::test]
#[serial]
async fn ac_358_01_persist_connection_writes_to_file_and_sqlite() {
    mismatch_counter::reset();
    let (_dir, pool) = setup().await;

    let req = sample_connection_req("c-d1", "DualOne");
    persist_connection_inner(&pool, req).await.unwrap();

    // file write: connections.json must contain the entry. 후속 sprint 가
    // file SOT 로부터 list_connections 를 호출하므로 같은 storage helper 를
    // 통해 read.
    let data = table_view_lib::storage::load_storage_redacted().unwrap();
    assert_eq!(data.connections.len(), 1, "file write missing");
    assert_eq!(data.connections[0].id, "c-d1");
    assert_eq!(data.connections[0].name, "DualOne");

    // SQLite mirror.
    let row: (String, String) = sqlx::query_as("SELECT id, name FROM connections WHERE id = ?")
        .bind("c-d1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.0, "c-d1");
    assert_eq!(row.1, "DualOne");

    // Normal path → mismatch counter must stay zero.
    assert_eq!(mismatch_counter::current(), 0);
    cleanup();
}

#[tokio::test]
#[serial]
async fn ac_358_01_persist_connection_update_in_place_keeps_one_row() {
    mismatch_counter::reset();
    let (_dir, pool) = setup().await;

    persist_connection_inner(&pool, sample_connection_req("c-d2", "First"))
        .await
        .unwrap();
    let mut updated = sample_connection_req("c-d2", "Renamed");
    updated.host = "remote.example".into();
    persist_connection_inner(&pool, updated).await.unwrap();

    let data = table_view_lib::storage::load_storage_redacted().unwrap();
    assert_eq!(data.connections.len(), 1);
    assert_eq!(data.connections[0].name, "Renamed");

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM connections")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        count, 1,
        "SQLite mirror must update in place, not duplicate"
    );

    let host: String = sqlx::query_scalar("SELECT host FROM connections WHERE id = ?")
        .bind("c-d2")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(host, "remote.example");

    cleanup();
}

// ---------------------------------------------------------------------------
// AC-358-02: favorites dual-write
// ---------------------------------------------------------------------------

fn sample_favorite_req(id: &str, name: &str, sql: &str) -> PersistFavoriteRequest {
    PersistFavoriteRequest {
        id: id.into(),
        name: name.into(),
        sql: sql.into(),
        connection_id: None,
        sort_order: 0,
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_000,
    }
}

#[tokio::test]
#[serial]
async fn ac_358_02_persist_favorite_writes_to_sqlite_only() {
    // Sprint 358 → Sprint 370 — file (`favorites.json`) write 분기 retire.
    // 본 테스트는 W3 cut 이후의 invariant 를 잠근다: SQLite row 1, file 0.
    mismatch_counter::reset();
    let (dir, pool) = setup().await;

    persist_favorite_inner(
        &pool,
        vec![sample_favorite_req(
            "fav-1",
            "Find Users",
            "SELECT * FROM users",
        )],
    )
    .await
    .unwrap();

    // Sprint 370 invariant — favorites.json 미생성.
    let path = dir.path().join("favorites.json");
    assert!(
        !path.exists(),
        "favorites.json must not exist after W3 cut (file write retired)"
    );

    // SQLite mirror — single canonical source.
    let row: (String, String, String) =
        sqlx::query_as("SELECT id, name, sql FROM favorites WHERE id = ?")
            .bind("fav-1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row.0, "fav-1");
    assert_eq!(row.1, "Find Users");
    assert_eq!(row.2, "SELECT * FROM users");

    assert_eq!(mismatch_counter::current(), 0);
    cleanup();
}

// ---------------------------------------------------------------------------
// AC-358-03: mru dual-write
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_358_03_persist_mru_writes_to_sqlite_only() {
    // Sprint 358 → Sprint 370 — file (`mru.json`) write 분기 retire.
    mismatch_counter::reset();
    let (dir, pool) = setup().await;

    persist_mru_inner(
        &pool,
        vec![PersistMruRequest {
            connection_id: "conn-A".into(),
            last_used: 1_700_000_500_000,
        }],
    )
    .await
    .unwrap();

    // Sprint 370 invariant — mru.json 미생성.
    let path = dir.path().join("mru.json");
    assert!(
        !path.exists(),
        "mru.json must not exist after W3 cut (file write retired)"
    );

    // SQLite mirror — single canonical source.
    let row: (String, i64) =
        sqlx::query_as("SELECT connection_id, last_used FROM mru WHERE connection_id = ?")
            .bind("conn-A")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row.0, "conn-A");
    assert_eq!(row.1, 1_700_000_500_000);

    assert_eq!(mismatch_counter::current(), 0);
    cleanup();
}

// ---------------------------------------------------------------------------
// AC-358-04: settings dual-write (6 known keys)
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_358_04_persist_settings_all_six_known_keys_round_trip() {
    // Sprint 358 → Sprint 370 — file (`settings.json`) write 분기 retire.
    mismatch_counter::reset();
    let (dir, pool) = setup().await;

    // 6 known keys from contract: theme / safe_mode / home_recent_collapsed /
    // sidebar_width / query_history_retention_days / query_history_enabled.
    let cases: Vec<(&str, &str)> = vec![
        ("theme", r#"{"themeId":"monokai","mode":"light"}"#),
        ("safe_mode", r#"{"mode":"on"}"#),
        ("home_recent_collapsed", "true"),
        ("sidebar_width", "320"),
        ("query_history_retention_days", "30"),
        ("query_history_enabled", "false"),
    ];

    for (key, value) in &cases {
        persist_setting_inner(
            &pool,
            PersistSettingRequest {
                key: (*key).into(),
                value_json: (*value).into(),
            },
        )
        .await
        .unwrap();
    }

    // Sprint 370 invariant — settings.json 미생성.
    let path = dir.path().join("settings.json");
    assert!(
        !path.exists(),
        "settings.json must not exist after W3 cut (file write retired)"
    );

    // SQLite mirror — 6 rows.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 6);

    // 각 row 의 value_json 까지 일치하는지 확인.
    for (key, value) in &cases {
        let stored: String = sqlx::query_scalar("SELECT value_json FROM settings WHERE key = ?")
            .bind(*key)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stored, *value, "value_json mismatch for {}", key);
    }

    assert_eq!(mismatch_counter::current(), 0);
    cleanup();
}

// ---------------------------------------------------------------------------
// AC-358-08: guard 4-state — pending / importing / failed 거부, done 정상.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_358_08_persist_connection_rejects_when_legacy_import_pending() {
    mismatch_counter::reset();
    let (_dir, pool) = setup().await;
    set_legacy_import_state(&pool, LegacyImportState::Pending)
        .await
        .unwrap();

    let err = persist_connection_inner(&pool, sample_connection_req("c-d3", "X"))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::LegacyImportInProgress));

    // SQLite row 0 — guard 가 작동했음.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM connections")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        count, 0,
        "connections row must not exist when guard rejected"
    );

    cleanup();
}

#[tokio::test]
#[serial]
async fn ac_358_08_persist_connection_rejects_when_legacy_import_importing() {
    mismatch_counter::reset();
    let (_dir, pool) = setup().await;
    set_legacy_import_state(&pool, LegacyImportState::Importing)
        .await
        .unwrap();
    let err = persist_connection_inner(&pool, sample_connection_req("c-d4", "Y"))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::LegacyImportInProgress));
    cleanup();
}

#[tokio::test]
#[serial]
async fn ac_358_08_persist_connection_rejects_when_legacy_import_failed() {
    mismatch_counter::reset();
    let (_dir, pool) = setup().await;
    set_legacy_import_state(&pool, LegacyImportState::Failed)
        .await
        .unwrap();
    let err = persist_connection_inner(&pool, sample_connection_req("c-d5", "Z"))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::LegacyImportInProgress));
    cleanup();
}

#[tokio::test]
#[serial]
async fn ac_358_08_persist_favorite_rejects_when_legacy_import_pending() {
    mismatch_counter::reset();
    let (_dir, pool) = setup().await;
    set_legacy_import_state(&pool, LegacyImportState::Pending)
        .await
        .unwrap();
    let err = persist_favorite_inner(&pool, vec![sample_favorite_req("fav-1", "x", "SELECT 1")])
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::LegacyImportInProgress));
    cleanup();
}

#[tokio::test]
#[serial]
async fn ac_358_08_persist_mru_rejects_when_legacy_import_pending() {
    mismatch_counter::reset();
    let (_dir, pool) = setup().await;
    set_legacy_import_state(&pool, LegacyImportState::Pending)
        .await
        .unwrap();
    let err = persist_mru_inner(
        &pool,
        vec![PersistMruRequest {
            connection_id: "conn-A".into(),
            last_used: 1,
        }],
    )
    .await
    .unwrap_err();
    assert!(matches!(err, AppError::LegacyImportInProgress));
    cleanup();
}

#[tokio::test]
#[serial]
async fn ac_358_08_persist_setting_rejects_when_legacy_import_pending() {
    mismatch_counter::reset();
    let (_dir, pool) = setup().await;
    set_legacy_import_state(&pool, LegacyImportState::Pending)
        .await
        .unwrap();
    let err = persist_setting_inner(
        &pool,
        PersistSettingRequest {
            key: "theme".into(),
            value_json: r#"{"themeId":"dark","mode":"dark"}"#.into(),
        },
    )
    .await
    .unwrap_err();
    assert!(matches!(err, AppError::LegacyImportInProgress));
    cleanup();
}

// ---------------------------------------------------------------------------
// AC-358-09: mismatch counter 0 on 100 normal-path dual-writes.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_358_09_normal_path_one_hundred_writes_keeps_mismatch_counter_zero() {
    mismatch_counter::reset();
    let (_dir, pool) = setup().await;

    for i in 0..100 {
        persist_setting_inner(
            &pool,
            PersistSettingRequest {
                key: format!("ephemeral_key_{}", i),
                value_json: format!("\"value-{}\"", i),
            },
        )
        .await
        .unwrap();
    }
    assert_eq!(mismatch_counter::current(), 0);

    cleanup();
}
