//! 작성 2026-05-16 (Phase 4 W2→W3 sprint-370)
//!
//! 사유: AC-370-01 — boot 시점 4 도메인 비교 모듈의 end-to-end 시나리오 검증.
//! `measure_all` 이 file/LS SOT 와 SQLite mirror 의 row count + content hash 를
//! 비교해 drift 시 counter 증가, 일치 시 변경 없음. inline 테스트가 단위 invariant
//! 을 lock 하고 본 파일이 integration shape — 통합 setup + 4 도메인 round-trip — 을
//! 확정한다.

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::models::{ConnectionConfig, DatabaseType};
use table_view_lib::storage::local;
use table_view_lib::storage::local_files::{
    save_favorites_file, save_mru_file, save_settings_file, FavoriteRecord, MruRecord,
};
use table_view_lib::storage::mismatch_metric::{counter, measure_all, DomainResult};
use tempfile::TempDir;

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    counter::reset();
    (dir, pool)
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    counter::reset();
}

#[tokio::test]
#[serial]
async fn ac_370_01_no_drift_when_all_four_domains_match() {
    let (_dir, pool) = setup().await;

    // Seed file + SQLite in lockstep for all four domains.

    // connections — file via save_connection; SQLite mirror via INSERT.
    let conn = ConnectionConfig {
        id: "c-eq".into(),
        name: "EqConn".into(),
        db_type: DatabaseType::Postgresql,
        host: "h".into(),
        port: 5432,
        user: "u".into(),
        password: String::new(),
        database: "d".into(),
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
    };
    table_view_lib::storage::save_connection(conn, None).unwrap();
    sqlx::query(
        "INSERT INTO connections \
         (id, name, db_type, host, port, user, password_enc, database, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("c-eq")
    .bind("EqConn")
    .bind("postgresql")
    .bind("h")
    .bind(5432i64)
    .bind("u")
    .bind("")
    .bind("d")
    .bind(0i64)
    .bind(1i64)
    .bind(1i64)
    .execute(&pool)
    .await
    .unwrap();

    // favorites — file + SQLite.
    save_favorites_file(&[FavoriteRecord {
        id: "fav-eq".into(),
        name: "F1".into(),
        sql: "SELECT 1".into(),
        connection_id: None,
        created_at: 10,
        updated_at: 10,
    }])
    .unwrap();
    sqlx::query(
        "INSERT INTO favorites(id, name, sql, connection_id, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("fav-eq")
    .bind("F1")
    .bind("SELECT 1")
    .bind::<Option<String>>(None)
    .bind(0i64)
    .bind(10i64)
    .bind(10i64)
    .execute(&pool)
    .await
    .unwrap();

    // mru — file + SQLite.
    save_mru_file(&[MruRecord {
        connection_id: "c-eq".into(),
        last_used: 99,
    }])
    .unwrap();
    sqlx::query("INSERT INTO mru(connection_id, last_used) VALUES (?, ?)")
        .bind("c-eq")
        .bind(99i64)
        .execute(&pool)
        .await
        .unwrap();

    // settings — file + SQLite.
    let mut s = std::collections::BTreeMap::new();
    s.insert(
        "theme".into(),
        r#"{"themeId":"slate","mode":"dark"}"#.into(),
    );
    save_settings_file(&s).unwrap();
    sqlx::query("INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
        .bind("theme")
        .bind(r#"{"themeId":"slate","mode":"dark"}"#)
        .bind(1i64)
        .execute(&pool)
        .await
        .unwrap();

    let report = measure_all(&pool).await.unwrap();
    assert_eq!(
        report.mismatches(),
        0,
        "all four domains in lockstep — no drift"
    );
    assert_eq!(counter::current(), 0, "counter must stay at 0");
    for d in &report.domains {
        match d {
            DomainResult::Ok { domain, rows } => {
                assert!(
                    matches!(*domain, "connections" | "favorites" | "mru" | "settings"),
                    "unexpected domain {domain}"
                );
                assert_eq!(*rows, 1, "{domain} should have 1 row");
            }
            DomainResult::Mismatch { domain, .. } => {
                panic!("unexpected mismatch for {domain}")
            }
        }
    }
    cleanup();
}

#[tokio::test]
#[serial]
async fn ac_370_01_drift_in_all_four_domains_triggers_four_increments() {
    let (_dir, pool) = setup().await;

    // file SOT 만 채움. SQLite mirror 는 empty.
    let conn = ConnectionConfig {
        id: "c-drift".into(),
        name: "DriftConn".into(),
        db_type: DatabaseType::Mongodb,
        host: "h".into(),
        port: 27017,
        user: "u".into(),
        password: String::new(),
        database: "d".into(),
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
    };
    table_view_lib::storage::save_connection(conn, None).unwrap();
    save_favorites_file(&[FavoriteRecord {
        id: "fav-drift".into(),
        name: "F".into(),
        sql: "SELECT 2".into(),
        connection_id: None,
        created_at: 1,
        updated_at: 1,
    }])
    .unwrap();
    save_mru_file(&[MruRecord {
        connection_id: "c-drift".into(),
        last_used: 1,
    }])
    .unwrap();
    let mut s = std::collections::BTreeMap::new();
    s.insert("safe_mode".into(), r#""strict""#.into());
    save_settings_file(&s).unwrap();

    let report = measure_all(&pool).await.unwrap();
    assert_eq!(
        report.mismatches(),
        4,
        "all four domains drift → 4 Mismatch entries"
    );
    assert_eq!(
        counter::current(),
        4,
        "counter must increment once per domain drift"
    );
    cleanup();
}

#[tokio::test]
#[serial]
async fn ac_370_01_counter_does_not_increment_when_only_metric_logs() {
    // Re-run twice; second invocation with the same in-sync state must not
    // re-increment the counter.
    let (_dir, pool) = setup().await;
    let _ = measure_all(&pool).await.unwrap();
    let baseline = counter::current();
    assert_eq!(baseline, 0);
    let _ = measure_all(&pool).await.unwrap();
    assert_eq!(
        counter::current(),
        baseline,
        "no-drift second run must keep counter stable"
    );
    cleanup();
}
