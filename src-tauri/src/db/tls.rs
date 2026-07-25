//! Shared TLS/encryption decision for the sqlx-based RDB adapters
//! (PostgreSQL, MySQL/MariaDB).
//!
//! Issue #1062 wired the model's TLS posture onto the sqlx connect options so a
//! user who turns TLS on is never silently downgraded to plaintext by the
//! driver default (`sslmode=prefer` / `ssl-mode=PREFERRED`). #1649 (ADR 0058)
//! promotes that posture from the `(tls_enabled, trust_server_certificate)`
//! boolean pair to the uniform [`SslMode`] enum and adds the `verify-ca`
//! posture: the user names a private/self-signed CA
//! ([`ConnectionConfig::ca_cert_path`]) so a server whose certificate no public
//! CA signs can still be authenticated, closing the MITM-substitution gap that
//! `require` (skip-verify) leaves open. This helper resolves the model into an
//! explicit, driver-neutral decision that each adapter maps onto its concrete
//! `SslMode`.
//!
//! ## Why `verify-ca` is never handed to the driver as `VerifyCa` (#1649 re-review)
//!
//! Two upstream facts, both read from the pinned sources:
//!
//! 1. **The user CA is added to the public roots, not substituted for them.**
//!    `sqlx-core-0.8.6/src/net/tls/tls_rustls.rs:141` seeds the store with
//!    `certs_from_webpki()` (the bundled Mozilla roots — the `runtime-tokio-rustls`
//!    feature resolves to `_tls-rustls-ring-webpki`) and `:153` then `add()`s the
//!    user's PEM on top. Naming a CA therefore *widens* the trust set; sqlx 0.8.6
//!    offers no way to narrow it (`PgConnectOptions`/`MySqlConnectOptions` expose
//!    only `ssl_mode` / `ssl_root_cert` / `ssl_ca` / client cert+key — no custom
//!    `rustls::ClientConfig`).
//! 2. **`VerifyCa` asks rustls to stop checking the hostname.**
//!    `sqlx-postgres-0.8.6/src/connection/tls.rs:52` and
//!    `sqlx-mysql-0.8.6/src/connection/tls.rs:64` both compute
//!    `accept_invalid_hostnames = !matches!(mode, VerifyFull | VerifyIdentity)`,
//!    which swaps the verifier for `NoHostnameTlsVerifier`
//!    (`tls_rustls.rs:157-173`).
//!
//! Fact 2 is *currently* inert by accident: `NoHostnameTlsVerifier`
//! (`tls_rustls.rs:309`) swallows only the unit `CertificateError::NotValidForName`,
//! while rustls 0.23.39 — the version in our lockfile — raises
//! `NotValidForNameContext { .. }` instead (`rustls-0.23.39/src/webpki/mod.rs:71-78`),
//! so the error falls through and the handshake still fails on a name mismatch. A
//! patch bump on either crate re-opens it silently. We do not build on an upstream
//! accident: `verify-ca` resolves to the same decision as `verify-full` plus the
//! user's CA as an *extra* anchor, so hostname verification is our choice, not
//! sqlx's. Since fact 1 is not fixable inside sqlx 0.8.6, a certificate issued by
//! any public CA **for the real database hostname** is still accepted — that
//! residual is recorded in `docs/product/known-limitations.md`, not papered over.

use crate::error::AppError;
use crate::models::{ConnectionConfig, SslMode};

/// Fail-closed rejection for `verify-ca` without a CA file (#1649 review B1).
/// Surfaced verbatim by `save_connection` and by the pg/mysql connect path, so
/// the user reads the same actionable sentence wherever the posture is caught.
pub(crate) const VERIFY_CA_REQUIRES_CA_MESSAGE: &str =
    "sslmode=verify-ca requires a CA certificate file: select the CA that signs the server \
     certificate, or switch to verify-full to verify against the built-in public CA list";

/// Driver-neutral outcome of the [`SslMode`] posture. Each sqlx adapter maps
/// this onto its own `SslMode`:
///
/// | decision                          | `PgSslMode`  | `MySqlSslMode`   | `SslMode`                  |
/// |-----------------------------------|--------------|------------------|----------------------------|
/// | `Disable`                         | `Disable`    | `Disabled`       | `disable`                  |
/// | `Default`                         | (unset)      | (unset)          | `prefer`                   |
/// | `RequireSkipVerify`               | `Require`    | `Required`       | `require`                  |
/// | `RequireVerifyFull { Some(path) }`| `VerifyFull` + `ssl_root_cert` | `VerifyIdentity` + `ssl_ca` | `verify-ca`   |
/// | `RequireVerifyFull { None }`      | `VerifyFull` | `VerifyIdentity` | `verify-full`              |
///
/// There is deliberately **no** variant that selects the drivers' own
/// `VerifyCa` / `VerifyCa` modes — see the module docs: those ask rustls to stop
/// checking the hostname while still trusting the bundled Mozilla roots, and the
/// only reason that is not exploitable on the current lockfile is an upstream
/// pattern-match mismatch. Collapsing the two verifying postures into one
/// variant makes the unsafe mapping unrepresentable in both adapters at once
/// rather than relying on each of them to remember. `Clone` (not `Copy`) because
/// of the owned path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TlsDecision {
    /// Explicitly force plaintext (`sslmode=disable`) — never negotiate TLS.
    Disable,
    /// TLS not requested — leave the driver default (`prefer`) untouched.
    Default,
    /// Force encryption but skip certificate verification (`sslmode=require`).
    RequireSkipVerify,
    /// Force encryption with full CA **and hostname** verification.
    ///
    /// `extra_ca_cert_path` is the `verify-ca` posture (#1649): the user's
    /// private/self-signed CA, handed to the driver's root-certificate option so
    /// rustls trusts it *in addition to* the bundled public roots
    /// (`sqlx-core-0.8.6/src/net/tls/tls_rustls.rs:141` seeds, `:153` adds — the
    /// anchor set can only grow). `None` is plain `verify-full`.
    ///
    /// The path is **not** optional for `verify-ca`: a posture that names a
    /// trust anchor it does not have is indistinguishable from `verify-full`,
    /// so [`resolve_tls_decision`] rejects it (libpq does the same) instead of
    /// silently re-labelling the user's choice.
    RequireVerifyFull { extra_ca_cert_path: Option<String> },
}

/// The CA path a `verify-ca` posture must carry, or the fail-closed error.
/// Whitespace-only is treated as absent — the form writes `null` for an empty
/// input, but a hand-edited `connections.json` or IPC payload can carry `" "`.
fn require_ca_cert_path(ca_cert_path: Option<&str>) -> Result<String, AppError> {
    ca_cert_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AppError::Validation(VERIFY_CA_REQUIRES_CA_MESSAGE.into()))
}

/// #1649 review B1 — the write-boundary half of the fail-closed `verify-ca`
/// contract: a stored connection never carries `verify-ca` without a CA file.
///
/// #1649 re-review B5 — called from `storage::save_connection_with_wallet`, the
/// single chokepoint through which every file-SOT writer introduces a posture
/// (the `save_connection` IPC, the dual-write `persist_connection` IPC, and
/// import). Guarding the chokepoint instead of each caller is what makes the
/// invariant hold at *every* boundary — `persist_connection` used to write past
/// a caller-side check. It runs for every engine: the on/off engines ignore
/// `ca_cert_path`, but storing an unanchored `verify-ca` there would still
/// travel to pg/mysql through an export or a dbType switch.
/// [`resolve_tls_decision`] repeats the check at connect time for rows written
/// before this gate existed.
pub(crate) fn validate_tls_posture(config: &ConnectionConfig) -> Result<(), AppError> {
    if config.ssl_mode == SslMode::VerifyCa {
        require_ca_cert_path(config.ca_cert_path.as_deref())?;
    }
    Ok(())
}

/// Resolve the model's [`SslMode`] posture into a driver-neutral decision.
///
/// `verify-ca` and `verify-full` deliberately collapse onto the same variant —
/// the former just carries an extra trust anchor. See the module docs for why we
/// never select the drivers' own `VerifyCa` mode.
///
/// The only error since #1649 is the fail-closed `verify-ca`-without-a-CA-file
/// rejection: the `SslMode` enum makes the old invalid combinations (TLS on
/// without a trust decision, trust without TLS) unrepresentable, but a posture
/// that names a trust anchor it does not have must not reach the driver.
pub(crate) fn resolve_tls_decision(config: &ConnectionConfig) -> Result<TlsDecision, AppError> {
    Ok(match config.ssl_mode {
        SslMode::Disable => TlsDecision::Disable,
        SslMode::Prefer => TlsDecision::Default,
        SslMode::Require => TlsDecision::RequireSkipVerify,
        SslMode::VerifyCa => TlsDecision::RequireVerifyFull {
            extra_ca_cert_path: Some(require_ca_cert_path(config.ca_cert_path.as_deref())?),
        },
        SslMode::VerifyFull => TlsDecision::RequireVerifyFull {
            extra_ca_cert_path: None,
        },
    })
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
            resolve_tls_decision(&config(SslMode::Prefer, None)).unwrap(),
            TlsDecision::Default
        );
    }

    #[test]
    fn disable_forces_plaintext() {
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
        // decision. (2026-07-25)
        assert_eq!(
            resolve_tls_decision(&config(SslMode::VerifyCa, Some("/etc/ssl/my-ca.pem"))).unwrap(),
            TlsDecision::RequireVerifyFull {
                extra_ca_cert_path: Some("/etc/ssl/my-ca.pem".into())
            }
        );
        // A ca_cert_path attached to verify-full is ignored — only verify-ca
        // reads it.
        assert_eq!(
            resolve_tls_decision(&config(SslMode::VerifyFull, Some("/etc/ssl/my-ca.pem"))).unwrap(),
            TlsDecision::RequireVerifyFull {
                extra_ca_cert_path: None
            }
        );
    }

    #[test]
    fn verify_ca_without_a_ca_file_fails_closed() {
        // Reason: #1649 review B1 — a `verify-ca` posture with no CA file names
        // a trust anchor it does not have, so it is byte-for-byte the
        // `verify-full` it claims to be stricter than. libpq hard-errors on the
        // same combination rather than silently re-labelling the user's choice;
        // so do we. Whitespace-only counts as absent (hand-edited JSON / raw
        // IPC). (2026-07-25)
        for missing in [None, Some(""), Some("   ")] {
            let err = resolve_tls_decision(&config(SslMode::VerifyCa, missing))
                .expect_err("verify-ca without a CA file must not reach the driver");
            assert!(
                matches!(err, AppError::Validation(ref msg) if msg == VERIFY_CA_REQUIRES_CA_MESSAGE),
                "ca_cert_path {missing:?} must fail closed with the shared message, got: {err}"
            );
        }
        // Same contract at the write boundary `save_connection` uses.
        assert!(validate_tls_posture(&config(SslMode::VerifyCa, None)).is_err());
        assert!(validate_tls_posture(&config(SslMode::VerifyCa, Some("/ca.pem"))).is_ok());
        // Every other posture is unaffected — no CA file is required.
        for mode in [
            SslMode::Disable,
            SslMode::Prefer,
            SslMode::Require,
            SslMode::VerifyFull,
        ] {
            assert!(
                validate_tls_posture(&config(mode, None)).is_ok(),
                "{mode:?} must not require a CA file"
            );
        }
    }

    #[test]
    fn legacy_migration_matches_prior_resolve_semantics() {
        // Reason: #1649 — SslMode::from_legacy must fold the ADR 0053 boolean
        // pair onto the exact postures the old resolve_tls_decision produced, so
        // stored connections migrate with zero downgrade. The table is the full
        // 3x3 `(tls_enabled, trust_server_certificate)` matrix — the two cells
        // the old code rejected with `AppError::Validation` ((unset|false, true))
        // are the ones this migration changes behavior on, so they are pinned
        // here rather than left to inference. (2026-07-25)
        let cells: [(Option<bool>, Option<bool>, SslMode); 9] = [
            // tls unset
            (None, None, SslMode::Prefer),
            (None, Some(false), SslMode::Disable),
            // Was `Err("trustServerCertificate requires TLS to be enabled")`;
            // now the opportunistic default. `tls_enabled` unset is the user's
            // "no TLS choice" state, so `prefer` (never weaker than the old
            // behavior, which refused to connect at all) is the fold.
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
}
