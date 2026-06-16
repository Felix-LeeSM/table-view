use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::ConnectionConfig;

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
        return Err(AppError::Validation(
            "Confirmation key must exactly match the target key".into(),
        ));
    }
    Ok(())
}

pub(super) fn require_confirm_pattern(
    pattern: &str,
    confirm_pattern: &str,
) -> Result<(), AppError> {
    if pattern != confirm_pattern {
        return Err(AppError::Validation(
            "Confirmation pattern must exactly match the Redis pattern".into(),
        ));
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

pub(super) fn redis_connection_error(err: ::redis::RedisError) -> AppError {
    AppError::Connection(err.to_string())
}

pub(super) fn redis_database_error(err: ::redis::RedisError) -> AppError {
    AppError::Database(err.to_string())
}

pub(super) fn connection_url(config: &ConnectionConfig) -> Result<(String, u16), AppError> {
    connection_url_for("Redis", config)
}

pub(super) fn connection_url_for(
    product_label: &'static str,
    config: &ConnectionConfig,
) -> Result<(String, u16), AppError> {
    let database = parse_database_index(product_label, &config.database)?;
    let scheme = if config.tls_enabled.unwrap_or(false) {
        "rediss"
    } else {
        "redis"
    };
    let host = format_host(&config.host);
    let auth = format_auth(&config.user, &config.password);
    Ok((
        format!("{scheme}://{auth}{host}:{}/{database}", config.port),
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

fn format_host(host: &str) -> String {
    let trimmed = host.trim();
    if trimmed.contains(':') && !trimmed.starts_with('[') {
        format!("[{trimmed}]")
    } else {
        trimmed.to_string()
    }
}

fn format_auth(user: &str, password: &str) -> String {
    match (user.is_empty(), password.is_empty()) {
        (true, true) => String::new(),
        (true, false) => format!(":{}@", percent_encode(password)),
        (false, true) => format!("{}:@", percent_encode(user)),
        (false, false) => format!("{}:{}@", percent_encode(user), percent_encode(password)),
    }
}

fn percent_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}
