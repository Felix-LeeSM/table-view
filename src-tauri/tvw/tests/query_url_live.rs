//! #1770 AC-1 — `tvw query --url … "SELECT 1"` against each of ADR 0061's four
//! SQL engines, driving the real binary rather than the library.
//!
//! # Getting the servers
//!
//! ```text
//! pnpm db:up                      # docker-compose.yml at the repo root
//! cd src-tauri
//! PGHOST=127.0.0.1 MYSQL_HOST=127.0.0.1 MARIADB_HOST=127.0.0.1 \
//!   cargo test -p tvw --test query_url_live -- --nocapture
//! ```
//!
//! The variable names and their defaults are the ones
//! `src-tauri/tests/common/mod.rs` already uses for its external-endpoint
//! branch, so an environment that runs the app's integration tests runs these
//! too. No container is started from here: `tvw` is not the crate that owns the
//! testcontainer lifecycle (ADR 0024), and a second owner would leave strays.
//!
//! # Not wired into CI yet
//!
//! `.github/workflows/ci.yml`'s `Integration Tests (Docker)` job runs its
//! suite through `cargo llvm-cov nextest`, and a plain `cargo test` step beside
//! it recompiles the whole dependency graph — DuckDB is `bundled`, i.e. built
//! from C++ source — because the coverage run sets its own `RUSTFLAGS`. Adding
//! `-p tvw` to the coverage command instead pulls this crate into the
//! `--fail-under-*` denominator, which that job's own comment warns against.
//! Tracked in `docs/contributor-guide/testing-and-quality.md`.

use std::process::Command;

/// A skip that shouts under CI. A test that reports PASS because it found no
/// server is the failure mode `fail_loud_under_ci` in
/// `src-tauri/tests/common/mod.rs` exists to prevent.
fn skip(engine: &str, gate: &str) {
    assert!(
        std::env::var_os("CI").is_none(),
        "{engine} has no endpoint under CI. Set {gate} (and start the server) or \
         drop this test from the workflow on purpose — a silent skip here would \
         report PASS for a query that never ran."
    );
    println!("SKIP: {engine} — {gate} is unset, so no endpoint was resolved.");
}

fn var(name: &str, fallback: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| fallback.to_string())
}

/// Run the built binary and return `(exit code, stdout, stderr)`.
///
/// `CARGO_BIN_EXE_tvw` is cargo's own path to the binary this crate produced,
/// so the test exercises `src/main.rs` — the argv plumbing and the `ExitCode`
/// conversion — and not just the library behind it.
fn tvw(args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_tvw"))
        .args(args)
        .output()
        .expect("the tvw binary should be runnable");
    (
        output
            .status
            .code()
            .expect("tvw should not die on a signal"),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

/// DDL → DML → DDL through three separate one-shot runs, which is the only way
/// a CLI with no session can do it. Proves the `rows_affected` notice reaches
/// stderr while stdout stays empty — the branch the SQLite lib test cannot take,
/// because that adapter refuses raw DDL.
fn assert_dml_round_trip(engine: &str, url: &str) {
    // The compose databases are shared with the app's own integration tests, so
    // the name has to be unique per process.
    let table = format!("tvw_live_{}", std::process::id());

    let (code, _, stderr) = tvw(&[
        "query",
        "--url",
        url,
        &format!("CREATE TABLE {table} (a INTEGER)"),
    ]);
    assert_eq!(code, 0, "{engine}: CREATE TABLE exited {code}: {stderr}");

    let (code, stdout, stderr) = tvw(&[
        "query",
        "--url",
        url,
        &format!("INSERT INTO {table} (a) VALUES (1), (2)"),
    ]);
    assert_eq!(code, 0, "{engine}: INSERT exited {code}: {stderr}");
    assert!(
        stdout.is_empty(),
        "{engine}: a statement with no result set wrote to stdout: {stdout}"
    );
    assert!(
        stderr.contains("2 row(s) affected"),
        "{engine}: no row count on stderr: {stderr}"
    );

    let (code, _, stderr) = tvw(&["query", "--url", url, &format!("DROP TABLE {table}")]);
    assert_eq!(code, 0, "{engine}: DROP TABLE exited {code}: {stderr}");
}

fn assert_select_one(engine: &str, url: &str) {
    let (code, stdout, stderr) = tvw(&["query", "--url", url, "SELECT 1"]);
    assert_eq!(code, 0, "{engine}: tvw exited {code}. stderr: {stderr}");
    assert!(
        stdout.contains('1'),
        "{engine}: no row in the output: {stdout}"
    );

    // The same statement through every format, because `--format` is the only
    // thing that may change the output (ADR 0061).
    for format in ["table", "json", "csv"] {
        let (code, stdout, stderr) = tvw(&["query", "--url", url, "--format", format, "SELECT 1"]);
        assert_eq!(
            code, 0,
            "{engine}/--format {format}: exited {code}. stderr: {stderr}"
        );
        assert!(
            stdout.contains('1'),
            "{engine}/--format {format} printed: {stdout}"
        );
    }
}

#[test]
fn test_query_url_postgres_select_one_succeeds() {
    let Ok(host) = std::env::var("PGHOST") else {
        return skip("PostgreSQL", "PGHOST");
    };
    let url = format!(
        "postgres://{}:{}@{host}:{}/{}",
        var("PGUSER", "testuser"),
        var("PGPASSWORD", "testpass"),
        var("PGPORT", "15432"),
        var("PGDATABASE", "table_view_test"),
    );
    assert_select_one("PostgreSQL", &url);
    assert_dml_round_trip("PostgreSQL", &url);
}

#[test]
fn test_query_url_mysql_select_one_succeeds() {
    let Ok(host) = std::env::var("MYSQL_HOST") else {
        return skip("MySQL", "MYSQL_HOST");
    };
    let url = format!(
        "mysql://{}:{}@{host}:{}/{}",
        var("MYSQL_USER", "testuser"),
        var("MYSQL_PASSWORD", "testpass"),
        var("MYSQL_PORT", "13306"),
        var("MYSQL_DATABASE", "table_view_test"),
    );
    assert_select_one("MySQL", &url);
    assert_dml_round_trip("MySQL", &url);
}

#[test]
fn test_query_url_mariadb_select_one_succeeds() {
    let Ok(host) = std::env::var("MARIADB_HOST") else {
        return skip("MariaDB", "MARIADB_HOST");
    };
    let url = format!(
        "mariadb://{}:{}@{host}:{}/{}",
        var("MARIADB_USER", "testuser"),
        var("MARIADB_PASSWORD", "testpass"),
        var("MARIADB_PORT", "23306"),
        var("MARIADB_DATABASE", "table_view_test"),
    );
    assert_select_one("MariaDB", &url);
    assert_dml_round_trip("MariaDB", &url);
}

#[test]
fn test_query_url_sqlite_select_one_succeeds() {
    // The file engine needs no server, so this arm of AC-1 has no gate.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("live.db");
    std::fs::File::create(&path).expect("an empty file is an empty SQLite database");
    assert_select_one("SQLite", &format!("sqlite://{}", path.display()));
}

#[test]
fn test_query_url_exit_codes_hold_for_the_real_binary() {
    // AC-3 through the process boundary: the library's mapping is only the
    // contract if `main.rs` hands the same number to the shell.
    let (code, stdout, stderr) = tvw(&["query", "--url", "postgres://:1", "SELECT 1"]);
    assert_eq!(code, 1, "an unusable DSN must exit 1. stderr: {stderr}");
    assert!(stdout.is_empty());
    assert!(!stderr.is_empty());

    let (code, stdout, _) = tvw(&["--help"]);
    assert_eq!(code, 0, "--help is a successful run");
    assert!(stdout.contains("query"));
}
