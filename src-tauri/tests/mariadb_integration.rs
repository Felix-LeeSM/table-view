//! Issue #1077 Stage 2 (2026-08-02) — MariaDB users-listing gate.
//!
//! Reason: MariaDB shares `MysqlAdapter`, so the MySQL container stands in for
//! most of the surface. `mysql.user` is the one exception — users listing is the
//! only path where the two vendors send different SQL. What this gate adds is
//! running that SQL against a real MariaDB server and decoding it; which arm is
//! chosen and how the rows map are already covered by the pure unit tests in
//! `db/mysql/schema.rs`.
//!
//! What happened while this file did not exist: one shared constant picked
//! `CONVERT(account_locked USING utf8mb4)`, and on MariaDB, which has no such
//! column, the Users tab died with
//! `1054 (42S22): Unknown column 'account_locked' in 'field list'` (measured on
//! 10.3 · 10.4 · 11.3). Neither the MySQL-only `mysql_integration.rs` nor the
//! offline `mariadb_ddl_preview.rs` goes through that path, so CI was green.
//!
//! Run:
//!   cd src-tauri && cargo test --test mariadb_integration
//!   MARIADB_HOST=localhost MARIADB_PORT=23306 cargo test ... (reuse an external server)

mod common;

use table_view_lib::error::AppError;

/// Issue #1077 Stage 2 — the vendor gate. What a live MariaDB decides and no
/// unit test can:
///
///   1. **The query runs at all.** The MySQL projection names a column this
///      server does not have, so it is rejected with `1054`; only executing the
///      MariaDB arm shows that the server accepts it.
///   2. **The lock flag decodes from `global_priv` JSON.** The extraction is in
///      SQL, not in Rust, so no unit test reaches it. `mariadb.sys` ships
///      locked in the official image, so a real locked principal is graded
///      without any fixture; `root` is the unlocked control.
///
/// The role rule (`is_role`, not an empty `Host`) is settled without a server by
/// `map_mysql_user_row_uses_is_role_not_an_empty_host_to_deny_login`; the role
/// assertion below is end-to-end confirmation, not the guard.
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
        // The shared-constant failure mode lands here: `1054 Unknown column
        // 'account_locked'`.
        Err(e) => panic!("MariaDB users listing must execute and decode: {e}"),
    };

    assert!(!rows.is_empty(), "the listing must not come back empty");
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

    // A dropped or mis-keyed JSON extraction yields `'N'`, which reaches
    // `can_login` as "not locked" — so this assertion is what fails.
    let sys = rows
        .iter()
        .find(|r| r.name.starts_with("mariadb.sys@"))
        .expect("the official image ships a locked mariadb.sys account");
    assert!(
        !sys.can_login,
        "mariadb.sys is ACCOUNT LOCK-ed — the global_priv JSON lock flag must reach can_login"
    );

    // A role carries an empty Host and renders bare.
    let role = rows
        .iter()
        .find(|r| r.name == "tv_users_gate")
        .expect("a MariaDB role must appear in the listing under its bare name");
    assert!(!role.can_login, "a MariaDB role cannot log in");

    adapter.disconnect_pool().await.ok();
}
