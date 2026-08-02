//! Issue #1077 Stage 2 (2026-08-02) — MariaDB users-listing gate.
//!
//! 작성 이유: MariaDB 는 `MysqlAdapter` 를 공유하므로 대부분의 surface 는 MySQL
//! 컨테이너가 대표한다. `mysql.user` 만 예외다 — MariaDB 10.4 가 그것을
//! `mysql.global_priv` 위의 view 로 바꾸면서 `account_locked` 컬럼을 없애고
//! `is_role` 을 넣었다. 그래서 users listing 은 두 벤더가 서로 다른 SQL 을 보내는
//! 유일한 경로이고, 진짜 MariaDB 서버만 채점할 수 있다.
//!
//! 이 파일이 없던 동안 무슨 일이 있었나 (round-2 B1): 공유 상수 하나가
//! `CONVERT(account_locked USING utf8mb4)` 를 골랐고, 모든 MariaDB 에서 Users 탭이
//! `1054 (42S22): Unknown column 'account_locked' in 'field list'` 로 죽었다. MySQL 전용
//! `mysql_integration.rs` 도, offline 인 `mariadb_ddl_preview.rs` 도 그 경로를
//! 지나지 않아 CI 가 green 이었다.
//!
//! 실행:
//!   cargo test --manifest-path src-tauri/Cargo.toml --test mariadb_integration
//!   MARIADB_HOST=localhost MARIADB_PORT=13307 cargo test ... (외부 재사용)

mod common;

use table_view_lib::error::AppError;

/// Issue #1077 Stage 2 — the vendor gate. Three properties, each of which only
/// a live MariaDB can decide:
///
///   1. **The query runs at all.** This is the round-2 B1 regression: the MySQL
///      projection is rejected outright by every MariaDB build.
///   2. **The lock flag decodes from `global_priv` JSON.** `mariadb.sys` ships
///      locked in the official image, so a real locked principal is graded
///      without any fixture; `root` is the unlocked control.
///   3. **A role is reported as non-loginable via `is_role`.** The previous rule
///      keyed off an empty `Host`, which is not a role discriminator.
#[tokio::test]
#[serial_test::serial]
async fn test_mariadb_list_database_users_vendor_projection_1077() {
    let adapter = match common::setup_mariadb_adapter().await {
        Some(a) => a,
        None => return,
    };

    // A role has no host, so `CREATE ROLE` is the whole fixture. Idempotent so a
    // reused external server (MARIADB_HOST) does not fail on a second run.
    if let Err(e) = common::mariadb_admin_sql(&["CREATE ROLE IF NOT EXISTS tv_users_gate"]).await {
        // An external MARIADB_HOST may point at a least-privilege login. That is
        // a grant gap in the environment, not a regression in the adapter.
        if e.to_ascii_lowercase().contains("denied") {
            println!("SKIP: the test login may not CREATE ROLE ({e})");
            adapter.disconnect_pool().await.ok();
            return;
        }
        panic!("MariaDB role fixture failed: {e}");
    }

    let rows = match adapter.list_database_users().await {
        Ok(rows) => rows,
        Err(AppError::Database(msg)) if msg.to_ascii_lowercase().contains("denied") => {
            println!("SKIP: the test login lacks SELECT on mysql.user/global_priv ({msg})");
            adapter.disconnect_pool().await.ok();
            return;
        }
        // The B1 failure mode lands here: `1054 Unknown column 'account_locked'`.
        Err(e) => panic!("MariaDB users listing must execute and decode: {e}"),
    };

    assert!(
        !rows.is_empty(),
        "mysql.user always carries at least the root account"
    );
    assert!(
        rows.iter().all(|r| !r.name.is_empty()),
        "every account identity must decode to non-empty text"
    );

    let root = rows
        .iter()
        .find(|r| r.name.starts_with("root@"))
        .expect("the root account must be listed");
    assert!(root.is_superuser, "root holds Super_priv");
    assert!(root.can_login, "root is not locked in the test image");
    assert_eq!(
        root.conn_limit, -1,
        "max_user_connections = 0 (unlimited) must normalise to the PG -1 sentinel"
    );

    // `mysql.global_priv` is the only place MariaDB records the lock, so this
    // assertion fails if the JSON extraction is dropped or mis-keyed.
    let sys = rows
        .iter()
        .find(|r| r.name.starts_with("mariadb.sys@"))
        .expect("the official image ships a locked mariadb.sys account");
    assert!(
        !sys.can_login,
        "mariadb.sys is ACCOUNT LOCK-ed — the global_priv JSON lock flag must reach can_login"
    );

    // A role carries an empty Host and renders bare. The old `!host.is_empty()`
    // rule got this right by accident and got `CREATE USER x@''` wrong; only
    // `is_role` separates the two.
    let role = rows
        .iter()
        .find(|r| r.name == "tv_users_gate")
        .expect("a MariaDB role must appear in the listing under its bare name");
    assert!(!role.can_login, "a MariaDB role cannot log in");

    adapter.disconnect_pool().await.ok();
}
