//! Q9 boot perf of `get_initial_app_state_inner` (AC-357-05).
//!
//! Seed: 10 connections × 5 groups × 50 workspace tabs × 500 history rows.
//! Strategy F.2 line 968 — p95 < 50ms.
//!
//! Measurement: 100 iterations, the 95th percentile of the sorted samples.
//! `--release` is recommended (in a debug build the sqlite SELECT alone is
//! 2-3x slower).
//!
//! Only a release-mode measurement is meaningful. `cargo test --release`
//! turns off `debug_assertions`, so the `#[cfg(not(debug_assertions))]`
//! branch below enforces the stricter budget. In debug mode the budget is
//! doubled to absorb noise — a debug failure is still a regression signal,
//! but it carries too many false positives to hard-fail on.

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

// AC-357-05 — Q9 budget p95 < 50ms. Debug mode is noisy, so the budget is
// relaxed 2x (100ms) there — `cargo test --release` enforces the real check.
// Both p95 and p99 are printed so a regression shows which percentile
// slipped first.
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

// Workspace scope (1 connection × 5 db sub-workspaces) puts a heavier
// workspaces SELECT load on the query than launcher scope. The same budget
// applies — a workspace window must boot within 50ms just like launcher.
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
