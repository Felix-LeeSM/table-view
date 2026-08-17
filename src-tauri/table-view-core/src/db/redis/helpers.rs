use ::redis::{AsyncConnectionConfig, ConnectionAddr, ConnectionInfo, RedisConnectionInfo};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::ConnectionConfig;

/// Hard ceiling for the dial timeout derived from
/// `ConnectionConfig::connection_timeout`. Matches the other adapters that
/// clamp explicitly (`MssqlAdapter::MAX_CONNECTION_TIMEOUT_SECS`,
/// `db::search_http::SEARCH_HTTP_TIMEOUT_MAX_SECS`).
pub(crate) const REDIS_CONNECT_TIMEOUT_MAX_SECS: u32 = 300;

/// Issue #2429 — the dial timeout handed to the driver.
///
/// Redis/Valkey used to pass none at all, so an unreachable host fell through
/// to the OS TCP connect timeout — over a minute on a host that silently drops
/// SYNs, i.e. the worst wait in the app and the one nothing here had chosen.
/// The unset default lives in [`ConnectionConfig::connect_timeout`]; only the
/// ceiling above is local to this adapter.
pub(crate) fn connect_timeout(config: &ConnectionConfig) -> Duration {
    config.connect_timeout(REDIS_CONNECT_TIMEOUT_MAX_SECS)
}

/// Driver-side connection options carrying [`connect_timeout`]. Shared by
/// `test_for` and `connect` so the probe and the real dial cannot drift.
pub(super) fn async_connection_config(config: &ConnectionConfig) -> AsyncConnectionConfig {
    AsyncConnectionConfig::new().set_connection_timeout(connect_timeout(config))
}

pub(super) const DEFAULT_REDIS_DATABASES: u16 = 16;
pub(super) const DEFAULT_SCAN_LIMIT: u32 = 100;
pub(super) const MAX_SCAN_LIMIT: u32 = 500;

pub(super) type RedisConnection = ::redis::aio::MultiplexedConnection;

pub(super) fn validate_key(key: &str) -> Result<(), AppError> {
    if key.is_empty() {
        return Err(AppError::Validation("Redis key is required".into()));
    }
    Ok(())
}

pub(super) fn require_confirm_key(key: &str, confirm_key: &str) -> Result<(), AppError> {
    if key != confirm_key {
        // Issue #1090 — name the target key and the resolution: editor callers
        // have no key input, so a bare "must match" message is a dead-end.
        return Err(AppError::Validation(format!(
            "Confirmation key must exactly match the target key \"{key}\". \
             Confirm the operation in the destructive-action dialog, or run it \
             from the key's action in the sidebar."
        )));
    }
    Ok(())
}

pub(super) fn require_confirm_pattern(
    pattern: &str,
    confirm_pattern: &str,
) -> Result<(), AppError> {
    if pattern != confirm_pattern {
        return Err(AppError::Validation(format!(
            "Confirmation pattern must exactly match the Redis pattern \"{pattern}\". \
             Confirm the operation in the destructive-action dialog."
        )));
    }
    Ok(())
}

pub(super) fn bounded_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(DEFAULT_SCAN_LIMIT).clamp(1, MAX_SCAN_LIMIT)
}

pub(super) fn ensure_not_cancelled(cancel: Option<&CancellationToken>) -> Result<(), AppError> {
    if cancel.is_some_and(CancellationToken::is_cancelled) {
        return Err(AppError::Database("Operation cancelled".into()));
    }
    Ok(())
}

/// Issue #1453 — defense in depth: since #1454 we build a structured
/// `ConnectionInfo` rather than a `redis://:pw@host` URL, so the driver no longer
/// has a credential-bearing URL to echo. Any RedisError still routes through the
/// redacting constructor in case a message ever carries one.
pub(super) fn redis_connection_error(err: ::redis::RedisError) -> AppError {
    AppError::connection_redacted(err.to_string())
}

pub(super) fn redis_database_error(err: ::redis::RedisError) -> AppError {
    AppError::Database(err.to_string())
}

pub(super) fn connection_info(
    config: &ConnectionConfig,
) -> Result<(ConnectionInfo, u16), AppError> {
    connection_info_for("Redis", config)
}

/// Issue #1454 (P2-4) — build a `ConnectionInfo` directly instead of assembling
/// a `redis://user:pw@host` URL string. PostgreSQL/MySQL use option builders;
/// Redis was the only adapter concatenating the password into a `String`, where
/// one debug log (or a driver error echoing the URL) leaks it. Here the password
/// lives only in `RedisConnectionInfo.password` (never percent-encoded, which was
/// purely a URL artifact) and the connect target is a structured `ConnectionAddr`
/// whose Display is `host:port` — no credential ever enters a URL string.
pub(super) fn connection_info_for(
    product_label: &'static str,
    config: &ConnectionConfig,
) -> Result<(ConnectionInfo, u16), AppError> {
    let database = parse_database_index(product_label, &config.database)?;
    let host = tcp_host(&config.host);
    let addr = if config.ssl_mode.tls_on() {
        ConnectionAddr::TcpTls {
            host,
            port: config.port,
            // #1063 / #1649 — the `require` posture opts into skip-verify; for
            // redis-rs this is the `insecure` flag on the TLS address. Every
            // verifying posture keeps full certificate verification. redis-rs
            // takes no CA-file option here, so `verify-ca` verifies against the
            // public roots — never weaker than `verify-full`.
            insecure: config.ssl_mode.skip_verify(),
            tls_params: None,
        }
    } else {
        ConnectionAddr::Tcp(host, config.port)
    };
    let (username, password) = credentials(&config.user, &config.password);
    Ok((
        ConnectionInfo {
            addr,
            redis: RedisConnectionInfo {
                db: i64::from(database),
                username,
                password,
                ..Default::default()
            },
        },
        database,
    ))
}

fn parse_database_index(product_label: &'static str, raw: &str) -> Result<u16, AppError> {
    if raw.trim().is_empty() {
        return Ok(0);
    }
    raw.trim().parse::<u16>().map_err(|_| {
        AppError::Validation(format!(
            "{product_label} database must be a non-negative numeric index"
        ))
    })
}

/// The redis driver resolves `ConnectionAddr::Tcp` host via `to_socket_addrs`,
/// which rejects bracketed IPv6 (`[::1]`) — strip surrounding brackets so both
/// bare and bracketed literals connect. (URL assembly needed the brackets; the
/// structured form needs them gone.)
fn tcp_host(host: &str) -> String {
    let trimmed = host.trim();
    trimmed
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(trimmed)
        .to_string()
}

/// Map user/password to `RedisConnectionInfo` fields, preserving the prior
/// URL-auth semantics: empty username → `None`; a username with an empty
/// password still authenticates with an empty password (`Some("")`, matching the
/// old `user:@` URL); no username and no password → no auth at all.
fn credentials(user: &str, password: &str) -> (Option<String>, Option<String>) {
    let username = (!user.is_empty()).then(|| user.to_string());
    let password = if !password.is_empty() {
        Some(password.to_string())
    } else if !user.is_empty() {
        Some(String::new())
    } else {
        None
    };
    (username, password)
}
