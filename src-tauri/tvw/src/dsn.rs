//! `--url DSN` → [`ConnectionConfig`] + the adapter that speaks it.
//!
//! `table-view-core` builds every driver's options field by field from the
//! struct and owns no URL parser, so the mapping has to live somewhere. The
//! app's equivalent is `parseConnectionUrl` in
//! `src/features/connection/model.ts`; this is the Rust half of the same
//! contract, narrowed to ADR 0061's SQL core.

use percent_encoding::percent_decode_str;
use table_view_core::db::{ActiveAdapter, MysqlAdapter, PostgresAdapter, SqliteAdapter};
use table_view_core::models::{ConnectionConfig, DatabaseType, SslMode};
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
        // `parse` is the only producer and its table has five rows mapping onto
        // the four types above. Reaching here means someone widened that table
        // and skipped this match.
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

    // Absoluteness, existence and the app-data-directory refusal are
    // `validate_user_database_path`'s in `table-view-core`; re-checking them
    // here would fork the rule.
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
        // The app's default for a connection that states no posture (ADR 0058).
        // `sslmode=` in the DSN is not honoured yet — see the crate docs.
        ssl_mode: SslMode::default(),
        ca_cert_path: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    }
}

fn decode(value: &str) -> String {
    percent_decode_str(value).decode_utf8_lossy().into_owned()
}

/// A DSN echoed back in an error message carries the password. Cut everything
/// between `://` and the last `@` of the authority rather than trying to parse
/// a string that already failed to parse.
fn redact(raw: &str) -> String {
    let Some(scheme_end) = raw.find("://") else {
        return raw.to_string();
    };
    let authority_start = scheme_end + 3;
    let authority_end = raw[authority_start..]
        .find(['/', '?', '#'])
        .map(|i| authority_start + i)
        .unwrap_or(raw.len());
    match raw[authority_start..authority_end].rfind('@') {
        Some(at) => format!(
            "{}***@{}",
            &raw[..authority_start],
            &raw[authority_start + at + 1..]
        ),
        None => raw.to_string(),
    }
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
    fn test_parse_hostless_server_dsn_is_rejected() {
        parse("postgres:///db").expect_err("a server DSN without a host has no target");
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
