//! Shared TLS/encryption decision for the sqlx-based RDB adapters
//! (PostgreSQL, MySQL/MariaDB).
//!
//! Issue #1062 wired the model's TLS posture onto the sqlx connect options so a
//! user who turns TLS on is never silently downgraded to plaintext by the
//! driver default (`sslmode=prefer` / `ssl-mode=PREFERRED`). #1649 (ADR 0058)
//! promotes that posture from the `(tls_enabled, trust_server_certificate)`
//! boolean pair to the uniform [`SslMode`] enum and adds the `verify-ca`
//! posture: the server certificate is validated against a user-supplied CA
//! ([`ConnectionConfig::ca_cert_path`]), closing the MITM-substitution gap that
//! `require` (skip-verify) leaves open and that `verify-full` cannot cover for
//! private/self-signed CAs. This helper resolves the model into an explicit,
//! driver-neutral decision that each adapter maps onto its concrete `SslMode`.

use crate::models::{ConnectionConfig, SslMode};

/// Driver-neutral outcome of the [`SslMode`] posture. Each sqlx adapter maps
/// this onto its own `SslMode`:
///
/// | decision            | `PgSslMode`  | `MySqlSslMode`   | `SslMode`     |
/// |---------------------|--------------|------------------|---------------|
/// | `Disable`           | `Disable`    | `Disabled`       | `disable`     |
/// | `Default`           | (unset)      | (unset)          | `prefer`      |
/// | `RequireSkipVerify` | `Require`    | `Required`       | `require`     |
/// | `RequireVerifyCa`   | `VerifyCa`   | `VerifyCa`       | `verify-ca`   |
/// | `RequireVerifyFull` | `VerifyFull` | `VerifyIdentity` | `verify-full` |
///
/// `RequireVerifyCa` carries the CA path so the adapter can point the driver's
/// root-certificate option at it. `Clone` (not `Copy`) because of the owned
/// path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TlsDecision {
    /// Explicitly force plaintext (`sslmode=disable`) — never negotiate TLS.
    Disable,
    /// TLS not requested — leave the driver default (`prefer`) untouched.
    Default,
    /// Force encryption but skip certificate verification (`sslmode=require`).
    RequireSkipVerify,
    /// #1649 — force encryption + verify the server certificate against the CA
    /// at `ca_cert_path` (`sslmode=verify-ca`). `None` falls back to the
    /// driver's default trust store (still verifies, just without a private CA).
    RequireVerifyCa { ca_cert_path: Option<String> },
    /// Force encryption with full CA + hostname verification (`verify-full`).
    RequireVerifyFull,
}

/// Resolve the model's [`SslMode`] posture into a driver-neutral decision.
///
/// Infallible since #1649: the `SslMode` enum makes the previously-rejected
/// combinations (TLS on without a trust decision, trust without TLS)
/// unrepresentable, so there is no longer an error path to surface.
pub(crate) fn resolve_tls_decision(config: &ConnectionConfig) -> TlsDecision {
    match config.ssl_mode {
        SslMode::Disable => TlsDecision::Disable,
        SslMode::Prefer => TlsDecision::Default,
        SslMode::Require => TlsDecision::RequireSkipVerify,
        SslMode::VerifyCa => TlsDecision::RequireVerifyCa {
            ca_cert_path: config.ca_cert_path.clone(),
        },
        SslMode::VerifyFull => TlsDecision::RequireVerifyFull,
    }
}

#[cfg(test)]
mod tests {
    // Purpose: #1649 (ADR 0058) — resolve_tls_decision maps each SslMode posture
    // onto the driver-neutral decision, and verify-ca carries the CA path so the
    // adapter can validate the server certificate against a private CA.
    use super::*;
    use crate::models::DatabaseType;

    fn config(ssl_mode: SslMode, ca_cert_path: Option<&str>) -> ConnectionConfig {
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
            ssl_mode,
            ca_cert_path: ca_cert_path.map(String::from),
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        }
    }

    #[test]
    fn prefer_leaves_driver_default() {
        // Reason: the default posture must not force TLS so legacy connections
        // keep the pre-#1062 driver `prefer` behavior. (2026-07-25)
        assert_eq!(
            resolve_tls_decision(&config(SslMode::Prefer, None)),
            TlsDecision::Default
        );
    }

    #[test]
    fn disable_forces_plaintext() {
        assert_eq!(
            resolve_tls_decision(&config(SslMode::Disable, None)),
            TlsDecision::Disable
        );
    }

    #[test]
    fn require_skips_verification() {
        assert_eq!(
            resolve_tls_decision(&config(SslMode::Require, None)),
            TlsDecision::RequireSkipVerify
        );
    }

    #[test]
    fn verify_full_requires_full_verification() {
        assert_eq!(
            resolve_tls_decision(&config(SslMode::VerifyFull, None)),
            TlsDecision::RequireVerifyFull
        );
    }

    #[test]
    fn verify_ca_carries_the_ca_path() {
        // Reason: #1649 — verify-ca must forward the CA path so the adapter can
        // validate the server cert against a private/self-signed CA; a stray
        // ca_cert_path on a non-verify-ca posture must NOT leak into the
        // decision. (2026-07-25)
        assert_eq!(
            resolve_tls_decision(&config(SslMode::VerifyCa, Some("/etc/ssl/my-ca.pem"))),
            TlsDecision::RequireVerifyCa {
                ca_cert_path: Some("/etc/ssl/my-ca.pem".into())
            }
        );
        // verify-ca with no CA still verifies (driver trust store), just without
        // a private anchor.
        assert_eq!(
            resolve_tls_decision(&config(SslMode::VerifyCa, None)),
            TlsDecision::RequireVerifyCa { ca_cert_path: None }
        );
        // A ca_cert_path attached to verify-full is ignored — only verify-ca
        // reads it.
        assert_eq!(
            resolve_tls_decision(&config(SslMode::VerifyFull, Some("/etc/ssl/my-ca.pem"))),
            TlsDecision::RequireVerifyFull
        );
    }

    #[test]
    fn legacy_migration_matches_prior_resolve_semantics() {
        // Reason: #1649 — SslMode::from_legacy must fold the ADR 0053 boolean
        // pair onto the exact postures the old resolve_tls_decision produced, so
        // stored connections migrate with zero downgrade. (2026-07-25)
        assert_eq!(SslMode::from_legacy(None, None), SslMode::Prefer);
        assert_eq!(SslMode::from_legacy(Some(false), None), SslMode::Prefer);
        assert_eq!(
            SslMode::from_legacy(Some(false), Some(false)),
            SslMode::Disable
        );
        assert_eq!(SslMode::from_legacy(None, Some(false)), SslMode::Disable);
        assert_eq!(
            SslMode::from_legacy(Some(true), Some(true)),
            SslMode::Require
        );
        assert_eq!(
            SslMode::from_legacy(Some(true), Some(false)),
            SslMode::VerifyFull
        );
        // ADR 0053 derived rule: on/off engines' `tls=true, trust=None`.
        assert_eq!(SslMode::from_legacy(Some(true), None), SslMode::VerifyFull);
    }
}
