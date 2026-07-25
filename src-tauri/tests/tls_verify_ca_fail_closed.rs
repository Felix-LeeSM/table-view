//! #1649 (ADR 0058) — `verify-ca` without a CA file must fail closed.
//!
//! sqlx 0.8.6 turns `VerifyCa` with no explicit root certificate into "verify
//! against the bundled Mozilla webpki roots, `accept_invalid_hostnames = true`"
//! (sqlx-postgres `src/connection/tls.rs` computes
//! `accept_invalid_hostnames = !matches!(ssl_mode, VerifyFull)`; sqlx-core
//! `src/net/tls/tls_rustls.rs` falls back to the public root store when
//! `root_cert_path` is `None`). Any certificate signed by any public CA, for any
//! hostname, then passes — a user who deliberately picked `verify-ca` gets a
//! silently MITM-able session, the exact substitution attack ADR 0058 decision 1
//! exists to close. libpq treats the same combination as a hard error; these
//! tests pin that contract on the adapter entry points, *before* a socket is
//! opened, so the posture can never reach the driver without a trust anchor.

use table_view_lib::db::{MysqlAdapter, PostgresAdapter};
use table_view_lib::error::AppError;
use table_view_lib::models::{ConnectionConfig, DatabaseType, SslMode};

/// Nothing listens on port 1, so a config that is allowed to reach the network
/// fails with a connection error instead of a validation error — which is what
/// separates "rejected up front" from "dialed anyway".
const DEAD_PORT: u16 = 1;

fn verify_ca_without_ca_file(db_type: DatabaseType) -> ConnectionConfig {
    ConnectionConfig {
        id: "tls-1".into(),
        name: "verify-ca without CA".into(),
        db_type,
        host: "127.0.0.1".into(),
        port: DEAD_PORT,
        user: "u".into(),
        password: "p".into(),
        database: "d".into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(1),
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        ssl_mode: SslMode::VerifyCa,
        ca_cert_path: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    }
}

fn assert_fails_closed(err: AppError) {
    let message = err.to_string();
    assert!(
        matches!(err, AppError::Validation(_)),
        "verify-ca without a CA file must be rejected as invalid configuration, \
         not handed to the driver (got: {message})"
    );
    assert!(
        message.contains("verify-ca") && message.contains("CA certificate"),
        "the rejection must name the missing CA file so the user can fix it \
         (got: {message})"
    );
}

#[tokio::test]
async fn postgres_rejects_verify_ca_without_ca_file_before_dialing() {
    let err = PostgresAdapter::test(&verify_ca_without_ca_file(DatabaseType::Postgresql))
        .await
        .expect_err("verify-ca without a CA file must not open a connection");
    assert_fails_closed(err);
}

#[tokio::test]
async fn mysql_rejects_verify_ca_without_ca_file_before_dialing() {
    let err = MysqlAdapter::test(&verify_ca_without_ca_file(DatabaseType::Mysql))
        .await
        .expect_err("verify-ca without a CA file must not open a connection");
    assert_fails_closed(err);
}
