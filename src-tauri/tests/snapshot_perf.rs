//! 작성 2026-05-16 (Phase 1 sprint-357) — `get_initial_app_state_inner` 의
//! Q9 boot perf (AC-357-05).
//!
//! 시드: 10 connection × 5 group × 50 workspace tab × 500 history row.
//! Strategy F.2 line 968 — p95 < 50ms.
//!
//! 측정: 100 회 반복, sorted samples 의 95-percentile. `--release` 권장
//! (debug 빌드는 sqlite SELECT 자체가 2-3x slower).
//!
//! Test 는 항상 release 모드로 측정해야 의미가 있음. cargo test --release 로
//! 실행하면 `RELEASE_BUILD` define 이 켜져 더 엄격한 budget 을 강제. debug
//! 모드에서는 budget 을 2x 로 늘려 noise 흡수 — debug 실패도 회귀 신호이긴
//! 하지만 false positive 가 많아 hard fail 시키지 않음.

use serial_test::serial;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::time::Instant;
use table_view_lib::commands::snapshot::get_initial_app_state_inner;
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

async fn seed(pool: &SqlitePool) {
    let now = 1_700_000_000_000i64;

    // 5 groups
    for i in 0i64..5 {
        sqlx::query(
            "INSERT INTO connection_groups(id, name, color, collapsed, sort_order, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(format!("g-{}", i))
        .bind(format!("Group {}", i))
        .bind::<Option<String>>(None)
        .bind(0i64)
        .bind(i)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
    }

    // 10 connections (round-robin into groups)
    for i in 0i64..10 {
        sqlx::query(
            "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, database, \
             group_id, color, connection_timeout, keep_alive_interval, environment, auth_source, \
             replica_set, tls_enabled, sort_order, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(format!("c-{}", i))
        .bind(format!("Conn {}", i))
        .bind("postgresql")
        .bind("localhost")
        .bind(5432i64 + i)
        .bind("postgres")
        .bind("encrypted-pwd")
        .bind("db")
        .bind::<Option<String>>(Some(format!("g-{}", i % 5)))
        .bind::<Option<String>>(None)
        .bind::<Option<i64>>(None)
        .bind::<Option<i64>>(None)
        .bind::<Option<String>>(None)
        .bind::<Option<String>>(None)
        .bind::<Option<String>>(None)
        .bind::<Option<i64>>(None)
        .bind(i)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
    }

    // 50 workspace tabs across 10 conn × 5 db
    let mut tx = pool.begin().await.unwrap();
    for i in 0i64..10 {
        for db in 0i64..5 {
            // build tabs_json with 1 tab per (conn, db) — total 50 tab rows
            let tabs = serde_json::json!([
                {
                    "id": format!("tab-{}-{}", i, db),
                    "title": format!("Tab {}/{}", i, db),
                    "connectionId": format!("c-{}", i),
                    "closable": true,
                    "type": "table",
                    "paradigm": "rdb",
                    "schema": "public",
                    "table": "users"
                }
            ])
            .to_string();
            sqlx::query(
                "INSERT INTO workspaces(connection_id, db_name, active_tab_id, tabs_json, \
                 sidebar_expanded_json, closed_tabs_json, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(format!("c-{}", i))
            .bind(format!("db-{}", db))
            .bind(format!("tab-{}-{}", i, db))
            .bind(tabs)
            .bind("[]")
            .bind("[]")
            .bind(now)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
    }
    tx.commit().await.unwrap();

    // 500 query_history rows (Q9 contract: max 100 history scenario covered
    // by row count; we exceed 100 to be conservative).
    let mut tx = pool.begin().await.unwrap();
    for i in 0i64..500 {
        sqlx::query(
            "INSERT INTO query_history(connection_id, tab_id, paradigm, query_mode, database, \
             collection, source, sql, sql_redacted, status, error_message, rows_affected, \
             duration_ms, executed_at, server_pid) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(format!("c-{}", i % 10))
        .bind::<Option<String>>(None)
        .bind("rdb")
        .bind("sql")
        .bind::<Option<String>>(None)
        .bind::<Option<String>>(None)
        .bind("raw")
        .bind("SELECT 1")
        .bind("SELECT 1")
        .bind("success")
        .bind::<Option<String>>(None)
        .bind::<Option<i64>>(Some(1))
        .bind(5i64)
        .bind(now + i)
        .bind::<Option<i64>>(None)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();

    // 10 mru entries
    for i in 0i64..10 {
        sqlx::query("INSERT INTO mru(connection_id, last_used) VALUES (?, ?)")
            .bind(format!("c-{}", i))
            .bind(now + i)
            .execute(pool)
            .await
            .unwrap();
    }
}

// AC-357-05 — Q9 budget p95 < 50ms. Debug 모드에서는 noise 가 커서 budget 을
// 2x (100ms) 로 완화 — 실제 검증은 `cargo test --release` 가 강제. p95/p99
// 모두 출력해 회귀 시 어느 percentile 부터 어긋났는지 추적 가능.
#[tokio::test]
#[serial]
async fn test_snapshot_p95_under_50ms() {
    let (_dir, pool) = setup().await;
    seed(&pool).await;

    let status = HashMap::new();
    // warm-up — first call compiles prepared statements + opens conn pool slot.
    let _ = get_initial_app_state_inner(&pool, "launcher", &status)
        .await
        .unwrap();

    let mut samples_us = Vec::with_capacity(100);
    for _ in 0..100 {
        let start = Instant::now();
        let _ = get_initial_app_state_inner(&pool, "launcher", &status)
            .await
            .unwrap();
        samples_us.push(start.elapsed().as_micros());
    }
    samples_us.sort_unstable();

    let p50 = samples_us[49];
    let p95 = samples_us[94];
    let p99 = samples_us[98];
    let max = *samples_us.last().unwrap();

    println!(
        "snapshot perf (launcher scope): p50={}us p95={}us p99={}us max={}us",
        p50, p95, p99, max
    );

    #[cfg(debug_assertions)]
    let budget_us = 100_000u128; // 100ms — debug noise relief.
    #[cfg(not(debug_assertions))]
    let budget_us = 50_000u128; // 50ms — Q9 strict budget (release).

    assert!(
        p95 <= budget_us,
        "p95 ({}us) exceeded budget ({}us) — Q9 boot perf regression",
        p95,
        budget_us
    );

    cleanup();
}

// Workspace scope (1 connection × 5 db sub-workspaces) 는 launcher 보다
// workspaces SELECT 부담이 더 크다. 같은 budget 적용 — workspace window 의
// boot 도 launcher 와 동일하게 50ms 안.
#[tokio::test]
#[serial]
async fn test_snapshot_workspace_scope_p95_under_50ms() {
    let (_dir, pool) = setup().await;
    seed(&pool).await;

    let status = HashMap::new();
    let _ = get_initial_app_state_inner(&pool, "workspace-c-0", &status)
        .await
        .unwrap();

    let mut samples_us = Vec::with_capacity(100);
    for _ in 0..100 {
        let start = Instant::now();
        let _ = get_initial_app_state_inner(&pool, "workspace-c-0", &status)
            .await
            .unwrap();
        samples_us.push(start.elapsed().as_micros());
    }
    samples_us.sort_unstable();

    let p50 = samples_us[49];
    let p95 = samples_us[94];
    let p99 = samples_us[98];
    let max = *samples_us.last().unwrap();

    println!(
        "snapshot perf (workspace scope): p50={}us p95={}us p99={}us max={}us",
        p50, p95, p99, max
    );

    #[cfg(debug_assertions)]
    let budget_us = 100_000u128;
    #[cfg(not(debug_assertions))]
    let budget_us = 50_000u128;

    assert!(
        p95 <= budget_us,
        "workspace scope p95 ({}us) exceeded budget ({}us)",
        p95,
        budget_us
    );

    cleanup();
}
