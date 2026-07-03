//! Shared TLS/encryption decision for the sqlx-based RDB adapters
//! (PostgreSQL, MySQL/MariaDB).
//!
//! Issue #1062 — `ConnectionConfig::tls_enabled` /
//! `trust_server_certificate` were carried on the model but never wired into
//! the sqlx connect options, so PG/MySQL silently relied on the driver
//! default (`sslmode=prefer` / `ssl-mode=PREFERRED`) — "encrypt if possible,
//! otherwise plaintext". A user who believed TLS was on could be silently
//! downgraded to cleartext. This helper resolves the model fields into an
//! explicit, driver-neutral decision that each adapter maps onto its concrete
//! `SslMode`, matching the MSSQL (tiberius) semantics in `db/mssql.rs`.

use crate::error::AppError;
use crate::models::ConnectionConfig;

/// Driver-neutral outcome of the `tls_enabled` / `trust_server_certificate`
/// decision. Each sqlx adapter maps this onto its own `SslMode`:
///
/// | decision            | `PgSslMode`  | `MySqlSslMode`   |
/// |---------------------|--------------|------------------|
/// | `Default`           | (unset)      | (unset)          |
/// | `RequireSkipVerify` | `Require`    | `Required`       |
/// | `RequireVerifyFull` | `VerifyFull` | `VerifyIdentity` |
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TlsDecision {
    /// TLS not requested — leave the driver default untouched. Preserves the
    /// pre-#1062 behavior for existing connections (`tls_enabled` unset).
    Default,
    /// Force encryption but skip certificate verification
    /// (`trust_server_certificate = true`).
    RequireSkipVerify,
    /// Force encryption with full CA + hostname verification
    /// (`trust_server_certificate = false`).
    RequireVerifyFull,
}

/// Resolve the TLS decision, rejecting combinations that cannot be honored
/// rather than silently ignoring them (issue #1062 acceptance criterion).
///
/// Parity with the MSSQL adapter (`db/mssql.rs`):
/// * `tls_enabled = true` requires an explicit `trust_server_certificate`
///   decision — `None` is rejected so the caller never gets an unexpected
///   verification posture.
/// * `trust_server_certificate = true` with TLS off is rejected — trusting a
///   certificate is meaningless without encryption.
pub(crate) fn resolve_tls_decision(config: &ConnectionConfig) -> Result<TlsDecision, AppError> {
    match (
        config.tls_enabled.unwrap_or(false),
        config.trust_server_certificate,
    ) {
        (true, Some(true)) => Ok(TlsDecision::RequireSkipVerify),
        (true, Some(false)) => Ok(TlsDecision::RequireVerifyFull),
        (true, None) => Err(AppError::Validation(
            "TLS requires an explicit trustServerCertificate decision".into(),
        )),
        (false, Some(true)) => Err(AppError::Validation(
            "trustServerCertificate requires TLS to be enabled".into(),
        )),
        (false, _) => Ok(TlsDecision::Default),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DatabaseType;

    fn config(tls_enabled: Option<bool>, trust: Option<bool>) -> ConnectionConfig {
        ConnectionConfig {
            id: "t".into(),
            name: "t".into(),
            db_type: DatabaseType::Postgresql,
            host: "localhost".into(),
            port: 5432,
            user: "u".into(),
            password: "p".into(),
            database: "d".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled,
            trust_server_certificate: trust,
        }
    }

    #[test]
    fn tls_off_by_default_leaves_driver_default() {
        // Legacy connections carry neither field — must not force TLS so the
        // pre-#1062 behavior is preserved.
        assert_eq!(
            resolve_tls_decision(&config(None, None)).unwrap(),
            TlsDecision::Default
        );
        assert_eq!(
            resolve_tls_decision(&config(Some(false), None)).unwrap(),
            TlsDecision::Default
        );
        assert_eq!(
            resolve_tls_decision(&config(Some(false), Some(false))).unwrap(),
            TlsDecision::Default
        );
    }

    #[test]
    fn tls_on_with_trust_skips_verification() {
        assert_eq!(
            resolve_tls_decision(&config(Some(true), Some(true))).unwrap(),
            TlsDecision::RequireSkipVerify
        );
    }

    #[test]
    fn tls_on_without_trust_requires_full_verification() {
        assert_eq!(
            resolve_tls_decision(&config(Some(true), Some(false))).unwrap(),
            TlsDecision::RequireVerifyFull
        );
    }

    #[test]
    fn tls_on_without_trust_decision_is_rejected() {
        // Parity with MSSQL: enabling TLS without deciding on cert trust must
        // fail loudly, never silently pick a verification posture.
        let err = resolve_tls_decision(&config(Some(true), None)).unwrap_err();
        assert!(matches!(err, AppError::Validation(msg) if msg.contains("trustServerCertificate")));
    }

    #[test]
    fn trust_without_tls_is_rejected() {
        // Trusting a certificate is meaningless without encryption — reject
        // instead of silently ignoring the flag.
        let err = resolve_tls_decision(&config(Some(false), Some(true))).unwrap_err();
        assert!(matches!(err, AppError::Validation(msg) if msg.contains("TLS")));
        let err = resolve_tls_decision(&config(None, Some(true))).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
