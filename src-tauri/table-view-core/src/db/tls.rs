//! Shared TLS/encryption decision for the RDB adapters that resolve the whole
//! `sslmode` posture rather than a plain on/off toggle: PostgreSQL and
//! MySQL/MariaDB (sqlx), SQL Server (tiberius) and — since #2154 — Oracle
//! (oracle-rs). Every one of them reads [`resolve_tls_decision`]; the on/off
//! engines read [`SslMode::tls_on`] / [`SslMode::skip_verify`] instead and never
//! reach this module. It also owns the process-wide rustls provider install
//! ([`install_rustls_crypto_provider`]), because that is a property of the
//! process rather than of any one adapter.
//!
//! Issue #1062 wired the model's TLS posture onto the sqlx connect options so a
//! user who turns TLS on is never silently downgraded to plaintext by the driver
//! default (`sslmode=prefer` / `ssl-mode=PREFERRED`). #1649 (ADR 0058) promotes
//! that posture from the `(tls_enabled, trust_server_certificate)` boolean pair
//! to the uniform [`SslMode`] enum and adds the `verify-ca` posture: the user
//! names a private/self-signed CA ([`ConnectionConfig::ca_cert_path`]) so a
//! server whose certificate no public CA signs can still be authenticated,
//! closing the MITM-substitution gap that `require` (skip-verify) leaves open.
//! This helper resolves the model into an explicit, driver-neutral decision that
//! each adapter maps onto its concrete driver `SslMode`.
//!
//! ## Why `verify-ca` is never handed to the sqlx drivers as `VerifyCa`
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
//! `verify-ca` on PostgreSQL/MySQL/MariaDB. That residual is inherent to the
//! anchor-widening design, not to this mapping.
//!
//! ## The anchor direction is the driver's, not this module's
//!
//! `RequireVerifyFull { extra_ca_cert_path }` says "verify, and here is a CA the
//! user named". What each adapter does with the rest of its root store differs
//! and this module does not decide it. SQL Server widens the OS trust store the
//! same way sqlx widens the webpki bundle (`db::mssql`). Oracle is the one
//! consumer that goes the other way: oracle-rs seeds its root store *either*
//! from the CA file *or* from the webpki bundle, never both, so naming a CA
//! there **narrows** the anchor set (`db::oracle`, the `RequireVerifyFull` arm).
//! Narrower is never looser, and hostname verification stays on in every
//! branch — but "`verify-ca` only ever adds anchors" is a sqlx/tiberius fact,
//! not a posture-wide one.

use crate::error::AppError;
use crate::models::{ConnectionConfig, SslMode};

/// Install the process-wide rustls [`CryptoProvider`] once, so that every
/// rustls consumer in this process resolves the same one.
///
/// [`CryptoProvider`]: rustls::crypto::CryptoProvider
///
/// #2154 — this workspace compiles rustls 0.23 with *both* provider features on
/// (`src-tauri/Cargo.lock` lists `aws-lc-rs` and `ring` in the rustls dependency
/// array), so `from_crate_features()` can infer neither and
/// `rustls::ClientConfig::builder()` **panics** instead of returning an error
/// (`rustls-0.23.39/src/crypto/mod.rs:248-286`).
///
/// Three consumers in this process resolve the process default rather than
/// naming a provider, so the install binds all three at once:
///
/// * `oracle-rs` — `TlsConfig::build_client_config` calls
///   `ClientConfig::builder()` (`oracle-rs-0.1.7/src/transport/tls.rs:142`) for
///   both the #2154 TCPS path and the #1065 wallet mTLS path, which reaches it
///   through `Config::with_wallet` (`oracle-rs-0.1.7/src/config.rs:252-255`).
///   That wallet path has been panicking since #1065 wherever a wallet was
///   actually readable; no unit test caught it because none supplies a loadable
///   wallet.
/// * `redis` — `rustls::ClientConfig::builder()`
///   (`redis-0.32.7/src/connection.rs:988`), a direct dependency through
///   `tokio-rustls-comp` (`src-tauri/table-view-core/Cargo.toml:80`).
/// * `reqwest` — `CryptoProvider::get_default()` first, `ring` only as the
///   fallback (`reqwest-0.12.28/src/async_impl/client.rs:763-771`), a direct
///   dependency through `rustls-tls`
///   (`src-tauri/table-view-core/Cargo.toml:81`); it carries the Search
///   adapter's HTTPS (`db::search_http`).
///
/// sqlx is the one rustls user here that does name its provider explicitly
/// (`sqlx-core-0.8.6/src/net/tls/tls_rustls.rs:99`·`:104`·`:107`
/// `builder_with_provider`), which is why pg/mysql never needed this.
///
/// **Call it from process startup, not from a dial.** Installing it lazily on
/// the first Oracle connection would leave the redis and reqwest backends
/// decided by whether an Oracle connection happened to be assembled first, and
/// would leave redis' `builder()` panicking until it was. The app calls this in
/// `table_view_lib::run()` before any adapter exists; adapters call it too so
/// library consumers and unit tests are covered. `install_default` is itself
/// idempotent — it returns `Err` when a provider is already installed, which
/// satisfies the same need — so repeat calls are free and no `Once` is needed.
///
/// `aws-lc-rs` is the choice because it is rustls' own default feature and
/// sqlx's default branch, so nothing in the process gets a backend it would not
/// have had on a single-provider build.
pub fn install_rustls_crypto_provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

/// Fail-closed rejection for `verify-ca` without a CA file. Surfaced verbatim
/// by the storage write boundary and by every connect path that reads
/// [`resolve_tls_decision`], so the user reads the same actionable sentence
/// wherever the posture is caught.
pub(crate) const VERIFY_CA_REQUIRES_CA_MESSAGE: &str =
    "sslmode=verify-ca requires a CA certificate file: select the CA that signs the server \
     certificate, or switch to verify-full to verify against the built-in public CA list";

/// Driver-neutral outcome of the [`SslMode`] posture, consumed by
/// `db::postgres`, `db::mysql`, `db::mssql` and `db::oracle`. The two sqlx
/// adapters map it onto their own driver enum:
///
/// | decision                           | `PgSslMode`                    | `MySqlSslMode`              | [`SslMode`]   |
/// |------------------------------------|--------------------------------|-----------------------------|---------------|
/// | `Disable`                          | `Disable`                      | `Disabled`                  | `disable`     |
/// | `Default`                          | (unset)                        | (unset)                     | `prefer`      |
/// | `RequireSkipVerify`                | `Require`                      | `Required`                  | `require`     |
/// | `RequireVerifyFull { Some(path) }` | `VerifyFull` + `ssl_root_cert` | `VerifyIdentity` + `ssl_ca` | `verify-ca`   |
/// | `RequireVerifyFull { None }`       | `VerifyFull`                   | `VerifyIdentity`            | `verify-full` |
///
/// There is deliberately **no** variant that selects the sqlx drivers' own
/// `VerifyCa` mode — see the module docs. Collapsing the two verifying postures
/// into one variant makes the unsafe mapping unrepresentable in `db::postgres`
/// and `db::mysql` at once rather than relying on each of them to remember.
/// `Clone` (not `Copy`) because of the owned path.
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
    /// private/self-signed CA, handed to the driver's root-certificate option.
    /// Whether that anchor lands *beside* the driver's existing roots (sqlx,
    /// tiberius) or *instead of* them (oracle-rs) is the adapter's business —
    /// see the module docs. `None` is plain `verify-full`.
    ///
    /// The path is **not** optional for `verify-ca`: a posture that names a
    /// trust anchor it does not have is indistinguishable from `verify-full`, so
    /// [`resolve_tls_decision`] rejects it (libpq does the same) instead of
    /// silently re-labelling the user's choice.
    RequireVerifyFull { extra_ca_cert_path: Option<String> },
}

/// The CA path a `verify-ca` posture must carry, or the fail-closed error.
/// Whitespace-only counts as absent — the form writes `null` for an empty input,
/// but a hand-edited `connections.json` or a raw IPC payload can carry `" "`.
fn require_ca_cert_path(ca_cert_path: Option<&str>) -> Result<String, AppError> {
    ca_cert_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AppError::Validation(VERIFY_CA_REQUIRES_CA_MESSAGE.into()))
}

/// Write-boundary half of the fail-closed `verify-ca` contract: a stored
/// connection never carries `verify-ca` without a CA file.
///
/// Called from `storage::save_connection_with_wallet`, the single chokepoint
/// through which every file-SOT writer introduces a posture (the
/// `save_connection` IPC, the dual-write `persist_connection` IPC, and import).
/// Guarding the chokepoint instead of each caller is what makes the invariant
/// hold at *every* boundary. It runs for every engine: the on/off engines ignore
/// `ca_cert_path`, but storing an unanchored `verify-ca` there would still
/// travel to pg/mysql through an export or a `dbType` switch.
/// [`resolve_tls_decision`] repeats the check at connect time for rows written
/// before this gate existed.
pub fn validate_tls_posture(config: &ConnectionConfig) -> Result<(), AppError> {
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
/// rejection: the [`SslMode`] enum makes the old invalid combinations (TLS on
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
    fn verify_ca_without_a_ca_file_fails_closed() {
        // Reason: #1649 — a `verify-ca` posture with no CA file names a trust
        // anchor it does not have, so it is byte-for-byte the `verify-full` it
        // claims to be stricter than. libpq hard-errors on the same combination
        // rather than silently re-labelling the user's choice; so do we.
        // Whitespace-only counts as absent (hand-edited JSON / raw IPC).
        // (2026-08-02)
        for missing in [None, Some(""), Some("   ")] {
            let err = resolve_tls_decision(&config(SslMode::VerifyCa, missing))
                .expect_err("verify-ca without a CA file must not reach the driver");
            assert!(
                matches!(err, AppError::Validation(ref msg) if msg == VERIFY_CA_REQUIRES_CA_MESSAGE),
                "ca_cert_path {missing:?} must fail closed with the shared message, got: {err}"
            );
            assert!(
                validate_tls_posture(&config(SslMode::VerifyCa, missing)).is_err(),
                "the write boundary must reject ca_cert_path {missing:?} too"
            );
        }
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
        // pair onto the exact postures the pre-#1649 resolve_tls_decision
        // produced, so stored connections migrate with zero downgrade. The table
        // is the full 3x3 `(tls_enabled, trust_server_certificate)` matrix — the
        // three cells the old code rejected with `AppError::Validation`
        // ((unset|false, true) and (true, None)) are the ones this migration
        // changes behavior on, so they are pinned here rather than left to
        // inference. (2026-08-02)
        let cells: [(Option<bool>, Option<bool>, SslMode); 9] = [
            // tls unset
            (None, None, SslMode::Prefer),
            (None, Some(false), SslMode::Disable),
            // Was `Err("trustServerCertificate requires TLS to be enabled")` on
            // pg/mysql/mssql and `Err(… mTLS wallet …)` on Oracle. A refusal is
            // not representable, so the fold takes the only posture that cannot
            // be a silent downgrade: encrypt, and honor the `trust=true` the
            // user did state. `prefer` here would let an attacker strip TLS and
            // would make MSSQL force plaintext outright.
            (None, Some(true), SslMode::Require),
            // tls off — explicit forced-plaintext marker (#1063).
            (Some(false), None, SslMode::Prefer),
            (Some(false), Some(false), SslMode::Disable),
            // Same previously-rejected combination with an explicit `tls=false`.
            // This is the one the SQL Server URL paste could store
            // (`?encrypt=false&trustServerCertificate=true`).
            (Some(false), Some(true), SslMode::Require),
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
        // The security property the table encodes, asserted directly so a future
        // edit to a cell cannot quietly re-open the downgrade: no legacy pair
        // that names an explicit `trust` decision may fold onto a posture that
        // leaves plaintext on the table.
        for tls_enabled in [None, Some(false), Some(true)] {
            let folded = SslMode::from_legacy(tls_enabled, Some(true));
            assert!(
                folded.tls_on(),
                "trust=true with tls_enabled={tls_enabled:?} folded to {folded:?}, which does not \
                 force encryption"
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
