//! #1649 (ADR 0058) — `verify-ca` without a CA file must fail closed.
//!
//! `verify-ca` means "also trust this private CA": sqlx 0.8.6 seeds the root
//! store with the bundled Mozilla roots (`sqlx-core-0.8.6/src/net/tls/
//! tls_rustls.rs:141`) and `add()`s the user's PEM on top (`:153`) — the anchor
//! set can only grow. A `verify-ca` posture carrying no CA file therefore
//! resolves to *exactly* the `verify-full` the user chose not to pick, while the
//! stored vocabulary keeps claiming a private trust anchor that does not exist —
//! the connection reads as hardened in the UI and in an export review, and the
//! discrepancy only surfaces when someone audits the certificate chain. libpq
//! treats the same combination as a hard error rather than re-labelling the
//! choice; these tests pin that contract on the adapter entry points, *before* a
//! socket is opened.
//!
//! The companion property — that a `verify-ca` posture never disables hostname
//! verification — is pinned in the `--lib` unit tests next to the mapping it
//! guards (`src-tauri/src/db/postgres/connection.rs`,
//! `src-tauri/src/db/mysql/connection.rs`:
//! `connect_options_never_select_the_hostname_skipping_mode`), because
//! `connect_options` is private to the adapters.

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
