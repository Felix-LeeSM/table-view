//! `tvw` — the one-shot CLI of ADR 0061, scaffolded by #1770.
//!
//! `tvw query --url <DSN> "<SQL>"` opens one connection through
//! `table-view-core`, runs one statement, prints the rows and exits. No Tauri,
//! no webview, no window.
//!
//! # What v0.1 does not do yet
//!
//! - **Saved profiles.** `--url` is the only way in; `tvw query <profile>` and
//!   `tvw conn add/ls/rm` are #1772 and #1773.
//! - **Safe Mode.** [`EXIT_SAFE_MODE_BLOCKED`] is reserved and nothing returns
//!   it — the destructive-statement gate is #1771.
//! - **`sslmode=` in the DSN.** A DSN carrying any parameter is refused by
//!   [`dsn::parse`] rather than connected under the app's default posture
//!   (`SslMode::Prefer` — opportunistic encryption with no certificate check,
//!   ADR 0053 decision 3). The app's paste handler does honour the parameter;
//!   reading it here is tracked under "CLI DSN parsing" in
//!   `docs/roadmap/follow-up-queue.md`.
//!
//! # Boundaries inherited from the core adapters
//!
//! - **Raw DDL against SQLite is refused**, by
//!   `validate_sqlite_write_guardrails` in `table-view-core`. `tvw query --url
//!   sqlite://… "CREATE TABLE …"` exits 1 and repeats that adapter's reason.
//!   The server engines take DDL normally.
//! - **`--format csv` cannot tell NULL from an empty string** — RFC 4180 has no
//!   null and both come out as an empty field. `--format json` and the default
//!   table format both keep the distinction. This matches the app's own CSV
//!   export (`json_to_cell_string` in
//!   `src-tauri/src/commands/export/grid_writers.rs`).
//! - **`--format json` types a SQLite INTEGER cell as a quoted string.** The
//!   `rows` array of `SELECT a FROM t ORDER BY a` is `[["1"],["2"]]` on SQLite
//!   and `[[1],[2]]` on PostgreSQL 16 — the second half measured on PR #2313.
//!   The SQLite adapter serialises that storage class as a JSON string on
//!   purpose (ADR 0026: a value over 2^53 is corrupted by a reader's `f64`) and
//!   the app undoes it in `wrapNumericCells`, where the CLI has no such layer.
//!   `--format table` and `--format csv` print the bare token on either engine,
//!   so only the JSON branch shows it. Tracked under "CLI output typing" in
//!   `docs/roadmap/follow-up-queue.md`.

pub mod dsn;
pub mod render;

use std::io::Write;

use clap::{Args, Parser, Subcommand, ValueEnum};
use table_view_core::db::{row_cap, ActiveAdapter};
use table_view_core::error::AppError;
use table_view_core::models::QueryType;

/// The statement ran; its output is on stdout.
pub const EXIT_SUCCESS: u8 = 0;

/// Anything that stopped the statement: unusable arguments, an unparseable
/// DSN, a refused connection, a driver or server error.
pub const EXIT_ERROR: u8 = 1;

/// Reserved for Safe Mode's destructive-statement refusal (ADR 0061). **Nothing
/// returns this yet** — the gate itself is #1771, and #1770 only fixes the
/// number so the contract does not move once callers depend on it.
///
/// 3 rather than 2 because `clap` exits 2 on a usage error by default, and a
/// caller distinguishing "blocked" from "you typed it wrong" would then be
/// reading one number for two events. [`run_argv`] folds clap's usage errors
/// into [`EXIT_ERROR`] for the same reason.
pub const EXIT_SAFE_MODE_BLOCKED: u8 = 3;

/// What a run produced. Held rather than printed so the whole CLI is callable
/// from a test without a subprocess.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub stdout: String,
    pub stderr: String,
    pub code: u8,
}

/// A failure with the exit code it owes the caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliError {
    /// Everything that is not a Safe Mode refusal.
    Failed(String),
    /// Safe Mode refused a destructive statement (#1771). Unconstructed today;
    /// the variant is the seam that keeps [`EXIT_SAFE_MODE_BLOCKED`] wired to a
    /// mapping rather than sitting as a loose constant.
    SafeModeBlocked(String),
}

impl CliError {
    pub fn failed(message: impl Into<String>) -> Self {
        CliError::Failed(message.into())
    }

    pub fn exit_code(&self) -> u8 {
        match self {
            CliError::Failed(_) => EXIT_ERROR,
            CliError::SafeModeBlocked(_) => EXIT_SAFE_MODE_BLOCKED,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            CliError::Failed(message) | CliError::SafeModeBlocked(message) => message,
        }
    }
}

impl From<AppError> for CliError {
    fn from(error: AppError) -> Self {
        // `AppError::connection_redacted` already masked credentials in the
        // adapters' connect/ping paths, so `to_string` is safe to surface.
        CliError::Failed(error.to_string())
    }
}

#[derive(Debug, Parser)]
#[command(
    name = "tvw",
    version,
    about = "Run one SQL statement against a database and print the result"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Run one SQL statement and print its result.
    Query(QueryArgs),
}

#[derive(Debug, Args)]
pub struct QueryArgs {
    /// Connection DSN. postgres://, postgresql://, mysql://, mariadb:// or
    /// sqlite:///absolute/path.db
    #[arg(long, value_name = "DSN")]
    pub url: String,

    /// Output format. Identical whether stdout is a terminal or a pipe.
    #[arg(long, value_enum, default_value_t = Format::Table)]
    pub format: Format,

    /// The SQL to run.
    #[arg(value_name = "SQL")]
    pub sql: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Format {
    Table,
    Json,
    Csv,
}

/// Parse `argv`, run it, and report what to print and what to exit with.
///
/// Never panics on bad input and never calls `std::process::exit`, so a test
/// can assert the full contract in-process.
pub async fn run_argv<I, T>(argv: I) -> Outcome
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let cli = match Cli::try_parse_from(argv) {
        Ok(cli) => cli,
        Err(error) => {
            let text = error.render().to_string();
            // `--help` and `--version` are a successful run that happens to be
            // routed through clap's error type. Everything else is a usage
            // error, and ADR 0061 gives usage errors no code of their own.
            return if error.use_stderr() {
                Outcome {
                    stdout: String::new(),
                    stderr: text,
                    code: EXIT_ERROR,
                }
            } else {
                Outcome {
                    stdout: text,
                    stderr: String::new(),
                    code: EXIT_SUCCESS,
                }
            };
        }
    };

    match run(cli).await {
        Ok(outcome) => outcome,
        Err(error) => Outcome {
            stdout: String::new(),
            stderr: format!("tvw: {}\n", error.message()),
            code: error.exit_code(),
        },
    }
}

/// Write an [`Outcome`] to its two sinks and hand back the code to exit with.
///
/// `tvw query … | head` closes the pipe early. Left to `print!`, that is a
/// panic — a Rust backtrace on stderr and exit 101, which is not one of the
/// three codes the contract defines. A reader that stopped reading is not a
/// query failure, so the run's own code stands either way: a successful run
/// still exits 0, and a failed one keeps its code rather than being laundered
/// into success because stdout went away. Notices follow the rows or not at
/// all — a sink that just refused the data is not asked for more.
pub fn emit(outcome: &Outcome, stdout: impl Write, stderr: impl Write) -> u8 {
    if write_all(stdout, &outcome.stdout).is_ok() {
        let _ = write_all(stderr, &outcome.stderr);
    }
    outcome.code
}

fn write_all(mut sink: impl Write, text: &str) -> std::io::Result<()> {
    sink.write_all(text.as_bytes())?;
    sink.flush()
}

async fn run(cli: Cli) -> Result<Outcome, CliError> {
    let Command::Query(args) = cli.command;

    let config = dsn::parse(&args.url)?;
    let adapter = dsn::make_adapter(&config);
    adapter.lifecycle().connect(&config).await?;

    let outcome = execute(&adapter, &args).await;

    // Best effort. A teardown failure must not replace the statement's own
    // error, and the process is one step from exiting either way.
    let _ = adapter.lifecycle().disconnect().await;

    outcome
}

async fn execute(adapter: &ActiveAdapter, args: &QueryArgs) -> Result<Outcome, CliError> {
    let result = adapter.as_rdb()?.execute_sql(&args.sql, None).await?;
    let stdout = render::render(&result, args.format)?;

    // Notices go to stderr so a pipe receives rows and nothing else.
    let mut stderr = String::new();
    if result.truncated {
        // Silence here would be data loss: the adapter stops fetching at the
        // process-wide cap and the caller would read a short answer as the
        // whole one.
        stderr.push_str(&format!(
            "tvw: warning: fetching stopped at the {}-row cap, so the output above is incomplete\n",
            row_cap::current()
        ));
    }
    if let QueryType::Dml { rows_affected } = result.query_type {
        stderr.push_str(&format!("tvw: {rows_affected} row(s) affected\n"));
    }

    Ok(Outcome {
        stdout,
        stderr,
        code: EXIT_SUCCESS,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn argv(rest: &[&str]) -> Vec<String> {
        std::iter::once("tvw".to_string())
            .chain(rest.iter().map(|s| (*s).to_string()))
            .collect()
    }

    async fn run_cli(rest: &[&str]) -> Outcome {
        run_argv(argv(rest)).await
    }

    /// An empty file is a valid, empty SQLite database, so no driver is needed
    /// to make one.
    fn empty_sqlite_db(dir: &Path) -> String {
        let path = dir.join("tvw-test.db");
        std::fs::File::create(&path).expect("create the database file");
        format!("sqlite://{}", path.display())
    }

    /// A database with one table. The CLI cannot create it — `table-view-core`
    /// refuses raw SQLite DDL — so the driver does it directly.
    async fn seeded_sqlite_db(dir: &Path) -> String {
        let path = dir.join("tvw-seeded.db");
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .expect("open the database for seeding");
        sqlx::query("CREATE TABLE t (a INTEGER)")
            .execute(&pool)
            .await
            .expect("seed the table");
        pool.close().await;
        format!("sqlite://{}", path.display())
    }

    #[test]
    fn test_exit_codes_are_distinct_and_pinned() {
        // ADR 0061 fixes 0 for success, 1 for error and "a code of its own" for
        // a Safe Mode refusal without saying which; 3 is this crate's choice
        // for that code, argued at `EXIT_SAFE_MODE_BLOCKED`. A caller that
        // branches on these must not have the ground move under it.
        assert_eq!(EXIT_SUCCESS, 0);
        assert_eq!(EXIT_ERROR, 1);
        assert_eq!(EXIT_SAFE_MODE_BLOCKED, 3);
        assert_ne!(EXIT_SAFE_MODE_BLOCKED, EXIT_ERROR);
        assert_ne!(EXIT_SAFE_MODE_BLOCKED, EXIT_SUCCESS);
        // 2 stays free: it is clap's own usage-error code, and reusing it would
        // make "blocked by Safe Mode" indistinguishable from "bad arguments"
        // for anyone whose argument parser is not this one.
        assert_ne!(EXIT_SAFE_MODE_BLOCKED, 2);
    }

    #[test]
    fn test_cli_error_maps_each_variant_to_its_code() {
        assert_eq!(CliError::failed("boom").exit_code(), EXIT_ERROR);
        assert_eq!(
            CliError::SafeModeBlocked("DROP TABLE".into()).exit_code(),
            EXIT_SAFE_MODE_BLOCKED
        );
        assert_eq!(
            CliError::from(AppError::Database("driver said no".into())).exit_code(),
            EXIT_ERROR
        );
    }

    /// stdout after the reader is gone: `tvw query … | head` in one struct.
    struct ClosedPipe;

    impl std::io::Write for ClosedPipe {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
        }
    }

    fn outcome(code: u8) -> Outcome {
        Outcome {
            stdout: "rows\n".to_string(),
            stderr: "notice\n".to_string(),
            code,
        }
    }

    #[test]
    fn test_emit_sends_rows_to_stdout_and_notices_to_stderr() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        assert_eq!(
            emit(&outcome(EXIT_SUCCESS), &mut out, &mut err),
            EXIT_SUCCESS
        );
        assert_eq!(String::from_utf8(out).expect("utf8"), "rows\n");
        assert_eq!(
            String::from_utf8(err).expect("utf8"),
            "notice\n",
            "a notice on stdout would corrupt the data channel"
        );
    }

    #[test]
    fn test_a_closed_stdout_never_launders_the_exit_code() {
        // The reader walking away is not a verdict on the query. Every code the
        // contract defines has to survive it — a failure laundered into 0 is a
        // script that thinks the statement ran.
        for code in [EXIT_SUCCESS, EXIT_ERROR, EXIT_SAFE_MODE_BLOCKED] {
            assert_eq!(
                emit(&outcome(code), ClosedPipe, Vec::new()),
                code,
                "a broken pipe rewrote exit code {code}"
            );
        }
    }

    #[tokio::test]
    async fn test_help_exits_zero_on_stdout() {
        let outcome = run_cli(&["--help"]).await;
        assert_eq!(outcome.code, EXIT_SUCCESS);
        assert!(outcome.stderr.is_empty(), "help is not an error");
        assert!(outcome.stdout.contains("query"));
    }

    #[tokio::test]
    async fn test_usage_errors_exit_one_not_claps_two() {
        for args in [
            vec![],
            vec!["query"],
            vec!["query", "--url", "postgres://h/d"],
            vec![
                "query",
                "--url",
                "postgres://h/d",
                "--format",
                "yaml",
                "SELECT 1",
            ],
            vec!["query", "--url", "postgres://h/d", "--nope", "SELECT 1"],
            vec!["nonsense"],
        ] {
            let outcome = run_cli(&args).await;
            assert_eq!(
                outcome.code, EXIT_ERROR,
                "{args:?} should exit 1, got {}",
                outcome.code
            );
            assert!(outcome.stdout.is_empty(), "{args:?} wrote to stdout");
            assert!(!outcome.stderr.is_empty(), "{args:?} explained nothing");
        }
    }

    #[tokio::test]
    async fn test_unusable_dsn_exits_one_before_touching_the_network() {
        let outcome = run_cli(&["query", "--url", "not-a-dsn", "SELECT 1"]).await;
        assert_eq!(outcome.code, EXIT_ERROR);
        assert!(outcome.stderr.starts_with("tvw: "));
    }

    #[tokio::test]
    async fn test_refused_connection_exits_one_without_leaking_the_password() {
        // Port 1 has no listener, so this fails in `connect` rather than in
        // parsing — the path where a driver error string can carry the DSN.
        let outcome = run_cli(&[
            "query",
            "--url",
            "postgres://someone:hunter2@127.0.0.1:1/postgres",
            "SELECT 1",
        ])
        .await;
        assert_eq!(outcome.code, EXIT_ERROR);
        assert!(
            outcome.stderr.contains("Connection error"),
            "this has to fail in connect, not in parsing, or it proves nothing \
             about a driver error carrying the DSN: {}",
            outcome.stderr
        );
        assert!(
            !outcome.stderr.contains("hunter2"),
            "password reached stderr: {}",
            outcome.stderr
        );
    }

    #[tokio::test]
    async fn test_missing_sqlite_file_exits_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("absent.db");
        let outcome = run_cli(&[
            "query",
            "--url",
            &format!("sqlite://{}", missing.display()),
            "SELECT 1",
        ])
        .await;
        assert_eq!(outcome.code, EXIT_ERROR);
    }

    #[tokio::test]
    async fn test_sqlite_select_one_is_pinned_byte_for_byte_in_every_format() {
        // ADR 0061's SQL core has four engines and this is the one that needs
        // no server. Live coverage of all four is #2323. The literals are what
        // a caller's script parses, so they are spelled out here rather than
        // matched loosely; `render.rs` owns the same pinning for the cells the
        // one row here cannot reach.
        let dir = tempfile::tempdir().expect("tempdir");
        let url = empty_sqlite_db(dir.path());

        for (format, expected) in [
            (
                "table",
                concat!("+---+\n", "| 1 |\n", "+===+\n", "| 1 |\n", "+---+\n"),
            ),
            (
                "json",
                concat!(
                    "{\n",
                    "  \"columns\": [\n",
                    "    {\n",
                    "      \"name\": \"1\",\n",
                    "      \"type\": \"NULL\"\n",
                    "    }\n",
                    "  ],\n",
                    "  \"rows\": [\n",
                    "    [\n",
                    "      1\n",
                    "    ]\n",
                    "  ]\n",
                    "}\n",
                ),
            ),
            ("csv", "1\n1\n"),
        ] {
            let outcome = run_cli(&["query", "--url", &url, "--format", format, "SELECT 1"]).await;
            assert_eq!(
                outcome.code, EXIT_SUCCESS,
                "--format {format} failed: {}",
                outcome.stderr
            );
            assert_eq!(outcome.stdout, expected, "--format {format}");
        }
    }

    #[tokio::test]
    async fn test_default_format_is_table_regardless_of_the_environment() {
        // ADR 0061 fixes `table` as the default and rejects deciding it from
        // the environment, so the two runs must agree byte for byte whether
        // this test's stdout is a terminal or a captured pipe.
        let dir = tempfile::tempdir().expect("tempdir");
        let url = empty_sqlite_db(dir.path());

        let default = run_cli(&["query", "--url", &url, "SELECT 1"]).await;
        let explicit = run_cli(&["query", "--url", &url, "--format", "table", "SELECT 1"]).await;
        assert_eq!(default.code, EXIT_SUCCESS, "{}", default.stderr);
        assert_eq!(default.stdout, explicit.stdout);
        assert!(default.stdout.starts_with('+'), "{}", default.stdout);
    }

    #[tokio::test]
    async fn test_a_select_matching_no_rows_still_writes_one_json_document() {
        // End to end through a real adapter rather than a hand-built
        // `QueryResult`: `render.rs` owns the same branch as a unit test.
        let dir = tempfile::tempdir().expect("tempdir");
        let url = seeded_sqlite_db(dir.path()).await;

        let outcome = run_cli(&[
            "query",
            "--url",
            &url,
            "--format",
            "json",
            "SELECT a FROM t WHERE 1 = 0",
        ])
        .await;
        assert_eq!(outcome.code, EXIT_SUCCESS, "{}", outcome.stderr);
        assert_eq!(outcome.stdout, "{\n  \"columns\": [],\n  \"rows\": []\n}\n");
    }

    #[tokio::test]
    async fn test_statement_without_a_result_set_reports_on_stderr_and_exits_zero() {
        let dir = tempfile::tempdir().expect("tempdir");
        let url = seeded_sqlite_db(dir.path()).await;

        let insert = run_cli(&["query", "--url", &url, "INSERT INTO t VALUES (1), (2)"]).await;
        assert_eq!(insert.code, EXIT_SUCCESS, "{}", insert.stderr);
        assert!(insert.stdout.is_empty(), "stdout stays the data channel");
        assert!(
            insert.stderr.contains("2 row(s) affected"),
            "no row count: {}",
            insert.stderr
        );
    }

    #[tokio::test]
    async fn test_raw_ddl_against_sqlite_is_refused_and_repeats_the_adapters_reason() {
        // Not a CLI decision — `validate_sqlite_write_guardrails` in
        // `table-view-core` refuses `QueryType::Ddl` for every caller. Pinned
        // here because it is the one place the CLI's engine coverage is not
        // uniform, and a user meets it as an exit code.
        let dir = tempfile::tempdir().expect("tempdir");
        let url = empty_sqlite_db(dir.path());

        let outcome = run_cli(&["query", "--url", &url, "CREATE TABLE t (a INTEGER)"]).await;
        assert_eq!(outcome.code, EXIT_ERROR);
        assert!(outcome.stdout.is_empty());
        assert!(
            outcome.stderr.contains("Raw SQLite DDL is not supported"),
            "the refusal should reach the user verbatim: {}",
            outcome.stderr
        );
    }

    #[tokio::test]
    async fn test_truncation_warns_on_stderr_instead_of_returning_a_short_answer_silently() {
        let dir = tempfile::tempdir().expect("tempdir");
        let url = empty_sqlite_db(dir.path());

        let previous = row_cap::current();
        row_cap::set(2);
        let outcome = run_cli(&[
            "query",
            "--url",
            &url,
            "SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3",
        ])
        .await;
        row_cap::set(previous);

        assert_eq!(outcome.code, EXIT_SUCCESS, "{}", outcome.stderr);
        assert!(
            outcome.stderr.contains("incomplete"),
            "a capped fetch must say so: {:?}",
            outcome.stderr
        );
    }
}
