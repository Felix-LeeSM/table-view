//! 작성 2026-05-16 (Phase 2 sprint-359) — AC-359-04: MySQL native cancel.
//!
//! Drives `SELECT SLEEP(60)` and issues `cancel_query_native` mid-flight.
//! The slow query must terminate within seconds — proves
//! `KILL QUERY <thread_id>` reaches the server and the sleeping
//! statement observes the abort (MySQL returns
//! `ER_QUERY_INTERRUPTED`, 1317).

mod common;

use std::time::{Duration, Instant};

#[tokio::test]
#[serial_test::serial]
async fn mysql_cancel_query_terminates_sleep_within_budget() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => {
            println!("SKIP: MySQL container unavailable");
            return;
        }
    };

    let config = common::mysql_test_config().await.expect("mysql config");
    let opts = sqlx::mysql::MySqlConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(&config.user)
        .password(&config.password)
        .database(&config.database);

    let victim_pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(opts)
        .await
        .expect("victim pool");

    // Grab the connection's thread_id (= the value our KILL QUERY needs).
    let thread_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
        .fetch_one(&victim_pool)
        .await
        .expect("CONNECTION_ID()");

    let victim_handle = {
        let pool = victim_pool.clone();
        tokio::spawn(async move { sqlx::query("SELECT SLEEP(60)").execute(&pool).await })
    };
    tokio::time::pause();
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(100)).await;
    tokio::time::resume();

    let cancel_start = Instant::now();
    adapter
        .cancel_query_native(thread_id as i64)
        .await
        .expect("cancel_query_native should succeed");
    let cancel_elapsed = cancel_start.elapsed();

    let join_start = Instant::now();
    let victim_result = tokio::time::timeout(Duration::from_secs(5), victim_handle)
        .await
        .expect("victim must not exceed 5s");
    let victim_elapsed = join_start.elapsed();

    assert!(
        cancel_elapsed < Duration::from_secs(2),
        "KILL QUERY round-trip should be sub-2s, got {:?}",
        cancel_elapsed
    );
    assert!(
        victim_elapsed < Duration::from_secs(5),
        "SLEEP(60) must abort within 5s of KILL QUERY, got {:?}",
        victim_elapsed
    );

    // The victim's outcome can be Ok (because SLEEP returns 1 when
    // interrupted in older servers) or Err (1317). Both prove cancel
    // landed.
    let _inner = victim_result.expect("victim join successful");

    victim_pool.close().await;
    let _ = adapter.disconnect_pool().await;
}

/// Issue #1230 — end-to-end: `execute_query_tracked` reports the executing
/// connection's thread id, and `KILL QUERY <id>` against it aborts the
/// in-flight `SLEEP(60)` well within budget. MySQL may surface the aborted
/// SLEEP as Ok(1) or Err(1317), so we assert on the timing (the query stops
/// long before its 60s sleep) rather than the outcome class.
#[tokio::test]
#[serial_test::serial]
async fn mysql_execute_query_tracked_pid_enables_native_cancel() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => {
            println!("SKIP: MySQL container unavailable");
            return;
        }
    };

    let (tx, rx) = tokio::sync::oneshot::channel::<i64>();
    let runner = {
        let adapter = adapter.clone();
        tokio::spawn(async move {
            adapter
                .execute_query_tracked("SELECT SLEEP(60)", None, Some(tx))
                .await
        })
    };

    let thread_id = tokio::time::timeout(Duration::from_secs(10), rx)
        .await
        .expect("thread id channel resolves within 10s")
        .expect("tracked thread id was sent");

    adapter
        .cancel_query_native(thread_id)
        .await
        .expect("native cancel with the tracked thread id succeeds");

    let join_start = Instant::now();
    let _ = tokio::time::timeout(Duration::from_secs(10), runner)
        .await
        .expect("runner join within budget")
        .expect("runner task did not panic");
    assert!(
        join_start.elapsed() < Duration::from_secs(10),
        "SLEEP(60) must abort well within budget after native cancel via tracked pid"
    );

    let _ = adapter.disconnect_pool().await;
}

#[tokio::test]
#[serial_test::serial]
async fn mysql_cancel_unknown_thread_id_errs() {
    // AC-359-06 (MySQL bucket): ER_NO_SUCH_THREAD (1094) for unknown
    // thread → our impl re-shapes to "unknown thread id" which
    // classify_cancel_error folds onto AlreadyCompleted.
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => {
            println!("SKIP: MySQL container unavailable");
            return;
        }
    };

    let result = adapter.cancel_query_native(999_999_999).await;
    assert!(result.is_err(), "cancel against unknown thread must Err");
    let msg = result.unwrap_err().to_string().to_ascii_lowercase();
    // Either our normalised "unknown thread id" prefix or the raw
    // sqlx surface — both are acceptable signals.
    assert!(
        msg.contains("unknown thread") || msg.contains("1094"),
        "expected ER_NO_SUCH_THREAD-style error, got: {}",
        msg
    );

    let _ = adapter.disconnect_pool().await;
}
