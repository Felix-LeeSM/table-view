//! Shared TLS/encryption decision for the sqlx-based RDB adapters
//! (PostgreSQL, MySQL/MariaDB).
//!
//! Issue #1062 wired the model's TLS posture onto the sqlx connect options so a
//! user who turns TLS on is never silently downgraded to plaintext by the driver
//! default (`sslmode=prefer` / `ssl-mode=PREFERRED`). #1649 (ADR 0058) promotes
//! that posture from the `(tls_enabled, trust_server_certificate)` boolean pair
//! to the uniform [`SslMode`] enum and adds the `verify-ca` posture: the user
//! names a private/self-signed CA ([`ConnectionConfig::ca_cert_path`]) so a
//! server whose certificate no public CA signs can still be authenticated,
//! closing the MITM-substitution gap that `require` (skip-verify) leaves open.
//!
//! The posture's companion requirement — a `verify-ca` that names no CA file
//! must not reach the driver — is not enforced yet; see #1649.
//! This helper resolves the model into an explicit, driver-neutral decision that
//! each adapter maps onto its concrete driver `SslMode`.
//!
//! ## Why `verify-ca` is never handed to the driver as `VerifyCa`
//!
//! Two facts, both read out of the versions this repo pins in
//! `src-tauri/Cargo.lock` (sqlx 0.8.6, rustls 0.23.39):
//!
//! 1. **The user CA is added to the public roots, not substituted for them.**
//!    `sqlx-core-0.8.6/src/net/tls/tls_rustls.rs:141` seeds the store with
//!    `certs_from_webpki()` (the bundled Mozilla roots) and `:153` then `add()`s
//!    the user's PEM on top. Naming a CA therefore *widens* the trust set; sqlx
//!    0.8.6 offers no way to narrow it (`PgConnectOptions`/`MySqlConnectOptions`
//!    expose only `ssl_mode` / `ssl_root_cert` / `ssl_ca` / client cert+key — no
//!    custom `rustls::ClientConfig`).
//! 2. **`VerifyCa` asks rustls to stop checking the hostname.**
//!    `sqlx-postgres-0.8.6/src/connection/tls.rs:52` computes
//!    `accept_invalid_hostnames = !matches!(options.ssl_mode, PgSslMode::VerifyFull)`
//!    and `sqlx-mysql-0.8.6/src/connection/tls.rs:64` the same against
//!    `VerifyIdentity`, which swaps in `NoHostnameTlsVerifier`
//!    (`tls_rustls.rs:157`, `:165`, `:171`).
//!
//! Fact 2 is *currently* inert by accident: `NoHostnameTlsVerifier`
//! (`tls_rustls.rs:309`) swallows only the unit
//! `CertificateError::NotValidForName`, while rustls 0.23.39 raises
//! `NotValidForNameContext { .. }` instead
//! (`rustls-0.23.39/src/webpki/mod.rs:71-74`), so the error falls through and the
//! handshake still fails on a name mismatch. A patch bump on either crate
//! re-opens it silently. We do not build on an upstream accident: `verify-ca`
//! resolves to the same decision as `verify-full` plus the user's CA as an
//! *extra* anchor, so hostname verification is our choice, not sqlx's.
//!
//! Because fact 1 is not fixable inside sqlx 0.8.6, a certificate issued by any
//! public CA **for the real database hostname** is still accepted under
//! `verify-ca`. That residual is inherent to the anchor-widening design, not to
//! this mapping.

use crate::error::AppError;
use crate::models::{ConnectionConfig, SslMode};

/// Driver-neutral outcome of the [`SslMode`] posture. Each sqlx adapter maps
/// this onto its own driver enum:
///
/// | decision                           | `PgSslMode`                    | `MySqlSslMode`              | [`SslMode`]   |
/// |------------------------------------|--------------------------------|-----------------------------|---------------|
/// | `Disable`                          | `Disable`                      | `Disabled`                  | `disable`     |
/// | `Default`                          | (unset)                        | (unset)                     | `prefer`      |
/// | `RequireSkipVerify`                | `Require`                      | `Required`                  | `require`     |
/// | `RequireVerifyFull { Some(path) }` | `VerifyFull` + `ssl_root_cert` | `VerifyIdentity` + `ssl_ca` | `verify-ca`   |
/// | `RequireVerifyFull { None }`       | `VerifyFull`                   | `VerifyIdentity`            | `verify-full` |
///
/// There is deliberately **no** variant that selects the drivers' own `VerifyCa`
/// mode — see the module docs. Collapsing the two verifying postures into one
/// variant makes the unsafe mapping unrepresentable in both adapters at once
/// rather than relying on each of them to remember. `Clone` (not `Copy`) because
/// of the owned path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TlsDecision {
    /// #1063 — explicitly force plaintext (`sslmode=disable`). Distinct from
    /// `Default`: the driver default (`prefer`) opportunistically encrypts and
    /// an active attacker can strip it, whereas `Disable` is the operator's
    /// deliberate choice to never negotiate TLS.
    Disable,
    /// TLS not requested — leave the driver default (`prefer`) untouched.
    /// Preserves the pre-#1062 behavior for connections that set no posture.
    Default,
    /// Force encryption but skip certificate verification (`sslmode=require`).
    RequireSkipVerify,
    /// Force encryption with full chain **and hostname** verification.
    ///
    /// `extra_ca_cert_path` is the `verify-ca` posture: the user's
    /// private/self-signed CA, handed to the driver's root-certificate option so
    /// rustls trusts it *in addition to* the bundled public roots. `None` is
    /// plain `verify-full`.
    ///
    RequireVerifyFull { extra_ca_cert_path: Option<String> },
}

/// Resolve the model's [`SslMode`] posture into a driver-neutral decision.
///
/// `verify-ca` and `verify-full` deliberately collapse onto the same variant —
/// the former just carries an extra trust anchor. See the module docs for why we
/// never select the drivers' own `VerifyCa` mode.
///
/// The [`SslMode`] enum makes the old invalid combinations (TLS on without a
/// trust decision, trust without TLS) unrepresentable, so this no longer has an
/// error case; the fallible signature is kept for the callers that already
/// propagate it.
pub(crate) fn resolve_tls_decision(config: &ConnectionConfig) -> Result<TlsDecision, AppError> {
    Ok(match config.ssl_mode {
        SslMode::Disable => TlsDecision::Disable,
        SslMode::Prefer => TlsDecision::Default,
        SslMode::Require => TlsDecision::RequireSkipVerify,
        SslMode::VerifyCa => TlsDecision::RequireVerifyFull {
            extra_ca_cert_path: config.ca_cert_path.clone(),
        },
        SslMode::VerifyFull => TlsDecision::RequireVerifyFull {
            extra_ca_cert_path: None,
        },
    })
}

#[cfg(test)]
mod tests {
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
        // The default posture must not force TLS, so connections that never
        // chose one keep the pre-#1062 driver `prefer` behavior.
        assert_eq!(
            resolve_tls_decision(&config(SslMode::Prefer, None)).unwrap(),
            TlsDecision::Default
        );
    }

    #[test]
    fn disable_forces_plaintext() {
        // Reason: #1063 — `disable` must reach a distinct forced-plaintext
        // decision. `prefer` opportunistically encrypts and an active attacker
        // can strip it; `disable` never negotiates at all. (2026-07-17)
        assert_eq!(
            resolve_tls_decision(&config(SslMode::Disable, None)).unwrap(),
            TlsDecision::Disable
        );
    }

    #[test]
    fn require_skips_verification() {
        assert_eq!(
            resolve_tls_decision(&config(SslMode::Require, None)).unwrap(),
            TlsDecision::RequireSkipVerify
        );
    }

    #[test]
    fn verify_full_requires_full_verification() {
        assert_eq!(
            resolve_tls_decision(&config(SslMode::VerifyFull, None)).unwrap(),
            TlsDecision::RequireVerifyFull {
                extra_ca_cert_path: None
            }
        );
    }

    #[test]
    fn verify_ca_carries_the_ca_path() {
        // Reason: #1649 — verify-ca must forward the CA path so the adapter can
        // validate the server cert against a private/self-signed CA; a stray
        // ca_cert_path on a non-verify-ca posture must NOT leak into the
        // decision. (2026-08-02)
        assert_eq!(
            resolve_tls_decision(&config(SslMode::VerifyCa, Some("/etc/ssl/my-ca.pem"))).unwrap(),
            TlsDecision::RequireVerifyFull {
                extra_ca_cert_path: Some("/etc/ssl/my-ca.pem".into())
            }
        );
        assert_eq!(
            resolve_tls_decision(&config(SslMode::VerifyFull, Some("/etc/ssl/my-ca.pem"))).unwrap(),
            TlsDecision::RequireVerifyFull {
                extra_ca_cert_path: None
            }
        );
    }

    #[test]
    fn legacy_migration_matches_prior_resolve_semantics() {
        // Reason: #1649 — SslMode::from_legacy must fold the ADR 0053 boolean
        // pair onto the exact postures the pre-#1649 resolve_tls_decision
        // produced, so stored connections migrate with zero downgrade. The table
        // is the full 3x3 `(tls_enabled, trust_server_certificate)` matrix — the
        // two cells the old code rejected with `AppError::Validation`
        // ((unset|false, true)) are the ones this migration changes behavior on,
        // so they are pinned here rather than left to inference. (2026-08-02)
        let cells: [(Option<bool>, Option<bool>, SslMode); 9] = [
            // tls unset
            (None, None, SslMode::Prefer),
            (None, Some(false), SslMode::Disable),
            // Was `Err("trustServerCertificate requires TLS to be enabled")`;
            // now the opportunistic default. `tls_enabled` unset is the user's
            // "no TLS choice" state, so `prefer` — never weaker than the old
            // behavior, which refused to connect at all.
            (None, Some(true), SslMode::Prefer),
            // tls off — explicit forced-plaintext marker (#1063).
            (Some(false), None, SslMode::Prefer),
            (Some(false), Some(false), SslMode::Disable),
            // Same previously-rejected combination with an explicit `tls=false`.
            (Some(false), Some(true), SslMode::Prefer),
            // tls on
            (Some(true), None, SslMode::VerifyFull),
            (Some(true), Some(false), SslMode::VerifyFull),
            (Some(true), Some(true), SslMode::Require),
        ];
        for (tls_enabled, trust, expected) in cells {
            assert_eq!(
                SslMode::from_legacy(tls_enabled, trust),
                expected,
                "legacy cell (tls_enabled={tls_enabled:?}, trust={trust:?}) must fold to {expected:?}"
            );
        }
    }

    #[test]
    fn to_legacy_round_trips_every_posture_the_mirror_can_hold() {
        // Reason: #1649 — the SQLite mirror keeps the legacy integer columns, so
        // `to_legacy` must land on a pair that `from_legacy` folds back to the
        // same posture. `VerifyCa` is the one lossy cell (it degrades to
        // `VerifyFull` there) because the mirror has no CA column; the cold-boot
        // reconstruct restores it from the file SOT. (2026-08-02)
        for mode in [
            SslMode::Disable,
            SslMode::Prefer,
            SslMode::Require,
            SslMode::VerifyFull,
        ] {
            let (tls_enabled, trust) = mode.to_legacy();
            assert_eq!(
                SslMode::from_legacy(tls_enabled, trust),
                mode,
                "{mode:?} must survive the mirror's legacy-column round trip"
            );
        }
        let (tls_enabled, trust) = SslMode::VerifyCa.to_legacy();
        assert_eq!(
            SslMode::from_legacy(tls_enabled, trust),
            SslMode::VerifyFull
        );
    }

    #[test]
    fn tls_on_and_skip_verify_split_the_postures_for_the_on_off_engines() {
        // Reason: #1649 — MSSQL/mongo/redis/search only need encrypt-or-not plus
        // verify-or-not. Pinning both helpers keeps a future variant from
        // silently landing in the wrong bucket. (2026-08-02)
        assert_eq!(
            [
                SslMode::Disable.tls_on(),
                SslMode::Prefer.tls_on(),
                SslMode::Require.tls_on(),
                SslMode::VerifyCa.tls_on(),
                SslMode::VerifyFull.tls_on(),
            ],
            [false, false, true, true, true]
        );
        assert_eq!(
            [
                SslMode::Disable.skip_verify(),
                SslMode::Prefer.skip_verify(),
                SslMode::Require.skip_verify(),
                SslMode::VerifyCa.skip_verify(),
                SslMode::VerifyFull.skip_verify(),
            ],
            [false, false, true, false, false]
        );
    }
}
