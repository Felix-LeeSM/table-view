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
//! The variable names are `src-tauri/tests/common/mod.rs`'s, and the MySQL and
//! MariaDB defaults below are the same as that file's. PostgreSQL is where the
//! two part: its external-endpoint branch there takes no defaults at all and
//! needs `PGHOST` `PGPORT` `PGUSER` `PGPASSWORD` `PGDATABASE` together, so the
//! command above runs these tests against docker-compose while the app's own
//! integration tests still fall through to testcontainers.
//!
//! No container is started from here. That is this crate's choice, not a rule
//! from anywhere: ADR 0024 assigns no owner — it pins an owner-pid label and a
//! dead-PID sweep, whose stated property is being race-safe between concurrent
//! owners — and a CLI whose live coverage is one `SELECT 1` per engine is
//! cheaper to point at a running server than to give a container lifecycle to.
//!
//! # What CI runs
//!
//! `.github/workflows/ci.yml`'s `CLI Live Query (Docker)` job names this binary
//! with `cargo test -p tvw --test query_url_live` and hands it a PostgreSQL, a
//! MySQL and a MariaDB service container through the same variables as the
//! command above. SQLite needs no server and no variable.
//!
//! It is a job of its own rather than a step inside `Integration Tests
//! (Docker)`. That job runs its whole suite through `cargo llvm-cov nextest`,
//! which sets its own instrumentation `RUSTFLAGS` — cargo-llvm-cov's, not a
//! line in `ci.yml` — and builds into its own target directory, so a plain
//! `cargo test` step beside it shares no artifacts with it and pays this
//! crate's graph from scratch wherever it sits. Selecting `-p tvw` inside that
//! coverage command instead is what the job's own comment warns against for
//! `--workspace`: the three `--fail-under-*` literals would then be grading a
//! different population. Keeping the two apart also keeps a red here off the
//! job that carries those literals; which job names are required is live GitHub
//! state, tracked in `memory/runbook/pr-merge-gates/memory.md` rather than
//! asserted here.
//!
//! Output formats are not asserted here. `--format table|json|csv` is pinned
//! byte for byte by `test_sqlite_select_one_is_pinned_byte_for_byte_in_every_format`
//! in `src-tauri/tvw/src/lib.rs` and by `src-tauri/tvw/src/render.rs`'s own
//! tests (#2322), and rendering does not read the DSN, so repeating the loop
//! once per engine here would buy no engine-specific evidence.

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
