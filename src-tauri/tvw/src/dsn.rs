//! `--url DSN` → [`ConnectionConfig`] + the adapter that speaks it.
//!
//! `table-view-core` builds every driver's options field by field from the
//! struct and owns no URL parser, so the mapping has to live somewhere. The
//! app's equivalent is `parseConnectionUrl` in
//! `src/features/connection/model.ts`; this is the Rust half of the same
//! contract, narrowed to ADR 0061's SQL core.
//!
//! The two do not read a DSN identically. `docs/roadmap/follow-up-queue.md`
//! lists the divergences found so far under "CLI DSN parsing" — `sslmode=`,
//! percent-decoding of the database name, repeated leading slashes. A DSN part
//! this module cannot honour is refused rather than dropped, so the gap costs
//! the user an error and never a posture they did not choose.

use percent_encoding::percent_decode_str;
use table_view_core::db::{ActiveAdapter, MysqlAdapter, PostgresAdapter, SqliteAdapter};
use table_view_core::models::{ConnectionConfig, DatabaseType, SslMode};
use table_view_core::storage::sql_redact::redact_connection_message;
use url::Url;

use crate::CliError;

/// Schemes ADR 0061 puts in the v0.1 CLI surface, with the port the app seeds
/// when the DSN omits one (`DATABASE_DEFAULTS` in
/// `src/features/connection/model.ts`). `postgres` is the legacy shorthand the
/// app's paste handler also accepts; `DatabaseType`'s own `FromStr` does not,
/// which is why this table exists instead of a `parse()` call.
const SCHEMES: &[(&str, DatabaseType, u16)] = &[
    ("postgresql", DatabaseType::Postgresql, 5432),
    ("postgres", DatabaseType::Postgresql, 5432),
    ("mysql", DatabaseType::Mysql, 3306),
    ("mariadb", DatabaseType::Mariadb, 3306),
    ("sqlite", DatabaseType::Sqlite, 0),
];

/// Turn a DSN into the config the adapters take.
///
/// Unsupported-but-real schemes (`mongodb:`, `oracle:`, …) get their own
/// message: the app speaks them, this CLI does not yet, and ADR 0061 keeps the
/// CLI's claim a subset of the app's.
pub fn parse(raw: &str) -> Result<ConnectionConfig, CliError> {
    let url = Url::parse(raw.trim()).map_err(|e| {
        CliError::failed(format!("--url is not a valid DSN ({e}): {}", redact(raw)))
    })?;
    let scheme = url.scheme().to_ascii_lowercase();

    let Some((_, db_type, default_port)) = SCHEMES.iter().find(|(name, _, _)| *name == scheme)
    else {
        return Err(CliError::failed(format!(
            "unsupported DSN scheme '{scheme}'. tvw v0.1 speaks postgres, mysql, mariadb and \
             sqlite (ADR 0061); the desktop app covers the rest"
        )));
    };

    if let Some(part) = unread_part(&url) {
        return Err(CliError::failed(format!(
            "--url carries {part}, which tvw v0.1 does not read. Dropping it would open a \
             connection you did not ask for — a dropped '?sslmode=verify-full' is \
             opportunistic encryption with no certificate check, a dropped '?mode=ro' is a \
             writable handle — and ADR 0053 counts that silent loss as a defect, so it is \
             refused instead. Remove the parameter, or use the desktop app, which does \
             read 'sslmode='"
        )));
    }

    if matches!(db_type, DatabaseType::Sqlite) {
        return sqlite_config(&url);
    }

    let host = url.host_str().unwrap_or_default();
    if host.is_empty() {
        return Err(CliError::failed(format!(
            "--url names no host: {}",
            redact(raw)
        )));
    }

    Ok(config(
        db_type.clone(),
        host.to_string(),
        url.port().unwrap_or(*default_port),
        decode(url.username()),
        decode(url.password().unwrap_or_default()),
        decode(url.path().trim_start_matches('/')),
    ))
}

/// The adapter for a config this module produced.
///
/// Deliberately not a copy of the app's 12-arm `make_adapter`
/// (`src-tauri/src/commands/connection.rs`): the arms below are exactly the
/// types [`parse`] can return, so a scheme added there without an arm here
/// fails to compile rather than falling into a runtime `_`.
pub fn make_adapter(config: &ConnectionConfig) -> ActiveAdapter {
    match config.db_type {
        DatabaseType::Postgresql => ActiveAdapter::Rdb(Box::new(PostgresAdapter::new())),
        DatabaseType::Mysql => ActiveAdapter::Rdb(Box::new(MysqlAdapter::new())),
        DatabaseType::Mariadb => ActiveAdapter::Rdb(Box::new(MysqlAdapter::new_mariadb())),
        DatabaseType::Sqlite => ActiveAdapter::Rdb(Box::new(SqliteAdapter::new())),
        // `parse` is the only producer and every row of its `SCHEMES` table
        // maps onto an arm above. Reaching here means someone widened that
        // table and skipped this match.
        ref other => unreachable!("{other:?} is not in tvw's scheme table"),
    }
}

/// SQLite carries a file path, not an endpoint.
///
/// `sqlite:///abs/path.db` (authority present but empty) and `sqlite:/abs/path.db`
/// (no authority at all) both land on `/abs/path.db`. `sqlite://name.db` does
/// not: the URL grammar reads `name.db` as the authority, so the path is empty
/// and the user almost certainly meant a third slash.
fn sqlite_config(url: &Url) -> Result<ConnectionConfig, CliError> {
    let authority = url.host_str().unwrap_or_default();
    if !authority.is_empty() {
        return Err(CliError::failed(format!(
            "sqlite DSN reads '{authority}' as a host. Use three slashes and an absolute path: \
             sqlite:///{}",
            authority
        )));
    }

    let path = decode(url.path());
    if path.is_empty() {
        return Err(CliError::failed(
            "sqlite DSN names no file. Use sqlite:///absolute/path.db".to_string(),
        ));
    }

    // Emptiness, absoluteness and the app-data-directory refusal are
    // `validate_user_database_path`'s in `table-view-core`, and a missing file
    // is refused a step later by that adapter's `create_if_missing(false)`.
    // Re-checking either here would fork the rule.
    Ok(config(
        DatabaseType::Sqlite,
        String::new(),
        0,
        String::new(),
        String::new(),
        path,
    ))
}

/// Every field of `ConnectionConfig` written once. The struct has no `Default`
/// impl and grows source-specific fields (Oracle wallet, Mongo replica set)
/// that no DSN this CLI accepts can set.
fn config(
    db_type: DatabaseType,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
) -> ConnectionConfig {
    ConnectionConfig {
        // A one-shot process holds no connection store, so the identity fields
        // exist only to satisfy the struct.
        id: "tvw".to_string(),
        name: "tvw --url".to_string(),
        db_type,
        host,
        port,
        user,
        password,
        database,
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        // The app's default for a connection that states no posture (ADR 0053
        // decision 3, which ADR 0058 adds depth to without changing). Every DSN
        // reaching here states no posture: `parse` refuses a query string
        // rather than dropping the one it cannot read.
        ssl_mode: SslMode::default(),
        ca_cert_path: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    }
}

/// What a DSN states that [`parse`] never reads, named so the refusal can say
/// which part it means.
///
/// The name only, never the value: a parameter can carry a credential
/// (`?password=…`), and this string ends up in an error message that reaches
/// logs and CI output. Only the text before the first `=` travels, so a token
/// that spells no name (`?s3cretlooking`, which `query_pairs` hands back as a
/// name with an empty value) is described rather than quoted.
///
/// `?` with nothing after it states nothing, so it is not a refusal.
fn unread_part(url: &Url) -> Option<String> {
    let first_token = url
        .query()
        .unwrap_or_default()
        .split('&')
        .find(|token| !token.is_empty());
    if let Some(token) = first_token {
        return Some(match token.split_once('=') {
            Some((name, _)) if !name.is_empty() => format!("the parameter '{name}'"),
            _ => "a query parameter".to_string(),
        });
    }
    match url.fragment() {
        Some(fragment) if !fragment.is_empty() => Some("a '#' fragment".to_string()),
        _ => None,
    }
}

fn decode(value: &str) -> String {
    percent_decode_str(value).decode_utf8_lossy().into_owned()
}

/// A DSN echoed back in an error message carries secrets, and this echo runs
/// exactly when the string did not parse — so no structure in it can be
/// assumed. The question is "does a credential shape survive", never "is there
/// a `://`": a missing colon or a missing slash is the ordinary typo, and it
/// leaves the password fully intact.
///
/// Three cuts, in order. Everything from the first `?`/`#` on, because
/// `?password=…` is as much a credential as the one in the authority.
/// Everything between the scheme and the last `@` that is left, because that is
/// where userinfo sits however many slashes the user typed. Then core's own
/// masker for `password=`/`pwd=`, which needs no URL shape at all and so covers
/// a libpq conninfo string handed to `--url` by mistake.
///
/// Only the scheme survives in front of the mask, so an `@` further along the
/// string costs the message its host too. That is over-redaction on a string
/// that already failed to parse, which is the direction to err in here.
fn redact(raw: &str) -> String {
    // `…` marks that something was cut, so a truncated DSN is not read as the
    // whole one the user typed.
    let (body, cut) = match raw.find(['?', '#']) {
        Some(i) => (&raw[..i], "…"),
        None => (raw, ""),
    };
    let kept = scheme_prefix(body);
    let masked = match body[kept..].rfind('@') {
        Some(at) => format!("{}***{}", &body[..kept], &body[kept + at..]),
        None => body.to_string(),
    };
    redact_connection_message(&format!("{masked}{cut}"))
}

/// The `scheme:` a string opens with, plus the slashes after it — or nothing,
/// when it opens with something else. RFC 3986 allows a scheme only ASCII
/// letters, digits and `+-.`, so this is the one span of an unparseable DSN
/// that cannot be holding a credential and can be shown back to the user.
fn scheme_prefix(body: &str) -> usize {
    let Some((scheme, rest)) = body.split_once(':') else {
        return 0;
    };
    let is_scheme = scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    if !is_scheme {
        return 0;
    }
    scheme.len() + 1 + (rest.len() - rest.trim_start_matches('/').len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_ok(raw: &str) -> ConnectionConfig {
        parse(raw).unwrap_or_else(|e| panic!("{raw} should parse: {}", e.message()))
    }

    #[test]
    fn test_parse_postgres_dsn_full_authority_maps_every_field() {
        let config = parse_ok("postgresql://alice:s3cret@db.example:6543/shop");
        assert!(matches!(config.db_type, DatabaseType::Postgresql));
        assert_eq!(config.host, "db.example");
        assert_eq!(config.port, 6543);
        assert_eq!(config.user, "alice");
        assert_eq!(config.password, "s3cret");
        assert_eq!(config.database, "shop");
    }

    #[test]
    fn test_parse_postgres_alias_scheme_resolves_same_as_postgresql() {
        let alias = parse_ok("postgres://h/db");
        assert!(matches!(alias.db_type, DatabaseType::Postgresql));
        assert_eq!(alias.port, 5432, "an omitted port takes the engine default");
    }

    #[test]
    fn test_parse_mysql_and_mariadb_share_a_port_but_not_a_type() {
        let mysql = parse_ok("mysql://root@127.0.0.1/test");
        let mariadb = parse_ok("mariadb://root@127.0.0.1/test");
        assert!(matches!(mysql.db_type, DatabaseType::Mysql));
        assert!(matches!(mariadb.db_type, DatabaseType::Mariadb));
        assert_eq!((mysql.port, mariadb.port), (3306, 3306));
        assert_eq!(mysql.password, "", "no password in the DSN means none set");
    }

    #[test]
    fn test_parse_percent_encoded_credentials_are_decoded() {
        // A password holding the characters that delimit a DSN can only travel
        // percent-encoded, and the driver needs the decoded bytes.
        let config = parse_ok("postgres://a%40b:p%2Fw%3A%40@h:5432/d%20b");
        assert_eq!(config.user, "a@b");
        assert_eq!(config.password, "p/w:@");
        assert_eq!(config.database, "d b");
    }

    #[test]
    fn test_parse_sqlite_three_slash_form_yields_absolute_path() {
        let config = parse_ok("sqlite:///tmp/shop.db");
        assert!(matches!(config.db_type, DatabaseType::Sqlite));
        assert_eq!(config.database, "/tmp/shop.db");
        assert_eq!((config.host.as_str(), config.port), ("", 0));
    }

    #[test]
    fn test_parse_sqlite_single_slash_form_yields_the_same_path() {
        assert_eq!(parse_ok("sqlite:/tmp/shop.db").database, "/tmp/shop.db");
    }

    #[test]
    fn test_parse_sqlite_two_slash_form_is_rejected_with_the_third_slash_shown() {
        let error = parse("sqlite://shop.db").expect_err("two slashes make a host, not a path");
        assert!(
            error.message().contains("sqlite:///shop.db"),
            "the message should show the fixed DSN, got: {}",
            error.message()
        );
    }

    #[test]
    fn test_parse_unsupported_scheme_names_the_scheme_and_the_supported_set() {
        let error = parse("mongodb://h/db").expect_err("mongo is not in the v0.1 CLI surface");
        assert!(error.message().contains("mongodb"));
        assert!(error.message().contains("sqlite"));
    }

    #[test]
    fn test_parse_refuses_a_dsn_parameter_rather_than_dropping_the_tls_posture() {
        // The silent path is the defect. `config` pins `ssl_mode` to
        // `SslMode::default()` — `Prefer`, opportunistic encryption with no
        // certificate check — so connecting anyway would put a user who typed
        // `verify-full` on a weaker posture than they asked for, with the
        // password on the wire and no message anywhere.
        let error = parse("postgres://u:s3cret@h/db?sslmode=verify-full")
            .expect_err("an unread TLS parameter must not turn into a connection");
        assert!(
            error.message().contains("the parameter 'sslmode'"),
            "the refusal should name the parameter, got: {}",
            error.message()
        );
        assert!(
            !error.message().contains("s3cret"),
            "password leaked into: {}",
            error.message()
        );
    }

    #[test]
    fn test_parse_refuses_sqlite_parameters_before_the_sqlite_branch_drops_them() {
        // Same root, second victim: `sqlite_config` reads `url.path()` only and
        // `config` pins `read_only: false`, so a dropped `?mode=ro` hands back a
        // writable handle. The guard has to run before that branch.
        let error = parse("sqlite:///tmp/shop.db?mode=ro")
            .expect_err("a sqlite parameter is dropped by url.path(), so it must be refused");
        assert!(
            error.message().contains("the parameter 'mode'"),
            "the refusal should name the parameter, got: {}",
            error.message()
        );
    }

    #[test]
    fn test_parse_refusal_names_the_parameter_but_never_its_value() {
        // A parameter can hold a credential and the refusal reaches logs and CI
        // output, so the name travels and the value does not.
        let error = parse("mysql://h/db?password=hunter2").expect_err("an unread parameter");
        assert!(error.message().contains("password"));
        assert!(
            !error.message().contains("hunter2"),
            "the value leaked into: {}",
            error.message()
        );
    }

    #[test]
    fn test_parse_refuses_a_fragment_it_would_otherwise_drop() {
        let error = parse("postgres://h/db#anchor").expect_err("no getter here reads the fragment");
        assert!(
            error.message().contains("a '#' fragment"),
            "the refusal should name the part it means, got: {}",
            error.message()
        );
    }

    #[test]
    fn test_parse_accepts_a_query_that_states_nothing() {
        // `?` with nothing after it loses nothing, and refusing it would reject
        // a DSN that means exactly what it says.
        assert_eq!(parse_ok("postgres://h/db?").database, "db");
    }

    #[test]
    fn test_parse_error_message_never_echoes_a_password_carried_as_a_parameter() {
        // A DSN that fails `Url::parse` never reaches the guard above, so the
        // echo path has to cut the query itself.
        let error = parse("postgres://alice:hunter2@h:99999/db?password=leaked")
            .expect_err("99999 does not fit a u16 port");
        assert!(
            !error.message().contains("leaked"),
            "parameter credential leaked into: {}",
            error.message()
        );
        assert!(!error.message().contains("hunter2"));
    }

    #[test]
    fn test_parse_error_message_redacts_a_dsn_that_never_looked_like_a_url() {
        // The echo happens exactly when the string did not parse, so nothing
        // about its shape can be assumed — least of all the `://` an earlier
        // cut keyed on. Each of these is one typo away from a working DSN and
        // each still holds the password.
        for raw in [
            "h/db?password=s3cret",            // no scheme at all
            "postgres//u:s3cret@h/db",         // the scheme's ':' missing
            "postgres:/u:s3cret@h/db",         // parses; names no host
            "host=h password=s3cret dbname=d", // libpq conninfo, not a URL
            "postgres://u:s3cret@h:99999/db",  // the shape that already worked
        ] {
            let error = parse(raw).expect_err("none of these name a reachable server");
            assert!(
                !error.message().contains("s3cret"),
                "{raw} put its credential in: {}",
                error.message()
            );
        }
    }

    #[test]
    fn test_parse_refusal_never_echoes_a_query_token_that_states_no_name() {
        // `?token` with no `=` parses as a name with an empty value, so naming
        // "the parameter" would hand back the whole token — user text of
        // unknown shape, in a message that reaches logs and CI output.
        let error = parse("postgres://h/db?s3cretlooking").expect_err("an unread parameter");
        assert!(
            !error.message().contains("s3cretlooking"),
            "a nameless query token reached: {}",
            error.message()
        );
    }

    #[test]
    fn test_parse_hostless_server_dsn_is_rejected() {
        let error = parse("postgres:///db").expect_err("a server DSN without a host has no target");
        assert!(
            error.message().contains("names no host"),
            "a sqlite-style path under a server scheme must say what is missing, got: {}",
            error.message()
        );
    }

    #[test]
    fn test_parse_error_message_never_echoes_the_password() {
        // The DSN is an argv value, so it is already visible in `ps` — but the
        // error text also reaches logs and CI output, which outlive the process.
        let error = parse("postgres://alice:hunter2@h:99999/db")
            .expect_err("99999 does not fit a u16 port");
        assert!(
            !error.message().contains("hunter2"),
            "password leaked into: {}",
            error.message()
        );
        assert!(error.message().contains("***@"));
    }

    #[test]
    fn test_make_adapter_picks_the_mariadb_flavoured_mysql_adapter() {
        // MariaDB and MySQL share one adapter type and differ only by the
        // constructor, so a copy-paste here would be invisible at runtime until
        // a vendor-specific query ran.
        for (dsn, expected) in [
            ("postgres://h/d", DatabaseType::Postgresql),
            ("mysql://h/d", DatabaseType::Mysql),
            ("mariadb://h/d", DatabaseType::Mariadb),
            ("sqlite:///tmp/x.db", DatabaseType::Sqlite),
        ] {
            let adapter = make_adapter(&parse_ok(dsn));
            assert_eq!(
                format!("{:?}", adapter.kind()),
                format!("{expected:?}"),
                "{dsn} produced the wrong adapter"
            );
        }
    }
}
