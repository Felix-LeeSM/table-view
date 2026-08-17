//! Oracle adapter internals.
//!
//! Issue #1072 dissolves the bounded #905/#906 runtime slice and wires the full
//! `OracleAdapter` into production: service-name lifecycle, catalog metadata,
//! SELECT/DML batch, cooperative cancel, tabular table-data queries, structured
//! table/index/constraint DDL, and PL/SQL body/package source. Issue #1065
//! adds SID connections (`Config::with_sid`) and Oracle wallet mTLS
//! (`Config::with_wallet`, `ewallet.pem`) with a host/service/SID injection
//! whitelist. Issue #1072 (2차) also wires read-only trigger listing
//! (`list_triggers` over `all_triggers`, header-only definition — the LONG
//! body is not read). Issue #2154 opens the two remaining dial paths onto the
//! same `connect_config` axis: a pasted TNS connect descriptor (parsed down to
//! host/port/service/protocol, every other clause rejected) and wallet-less
//! 1-way TLS (TCPS) driven by the shared [`crate::db::tls`] posture, with the
//! CA file of `verify-ca` as the trust anchor. Raw DDL/admin execution,
//! switch-database, trigger DDL (create/drop) and single-trigger source,
//! tnsnames.ora alias resolution, and advanced auth remain unsupported or
//! unclaimed.

mod admin;
mod catalog;
mod ddl;
#[cfg(test)]
mod ddl_tests;
mod runtime;
mod table_data;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::future::Future;
use std::time::Duration;

use oracle_rs::{Config as OracleConfig, Connection as OracleConnection, TlsConfig};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::info;

use crate::db::tls::{install_rustls_crypto_provider, resolve_tls_decision, TlsDecision};
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DatabaseType, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, FunctionInfo, IndexInfo,
    RenameTableRequest, SchemaChangeResult, TableData, TableInfo, TriggerInfo, ViewInfo,
};

use super::{BoxFuture, DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};

pub(crate) const ORACLE_CONNECT_TIMEOUT_MAX_SECS: u32 = 30;
const ORACLE_TEST_CONNECT_TIMEOUT_SECS: u64 = 5;

#[derive(Default)]
struct OracleConnectionState {
    connection: Option<OracleConnection>,
    connected_config: Option<ConnectionConfig>,
    server_version: Option<String>,
    server_banner: Option<String>,
}

#[derive(Default)]
pub struct OracleAdapter {
    state: Mutex<OracleConnectionState>,
}

impl OracleAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let connection = Self::open_connection(config, ORACLE_TEST_CONNECT_TIMEOUT_SECS).await?;
        let ping_result = connection.ping().await.map_err(map_oracle_connection_error);
        let close_result = connection
            .close()
            .await
            .map_err(map_oracle_connection_error);

        ping_result?;
        close_result?;
        Ok(())
    }

    async fn connect_session(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let timeout_secs = connection_timeout_secs(config);
        // #2154 — read the dial target off the resolved driver config, not off
        // `config.host`/`config.port`: a TNS descriptor supplies its own
        // coordinates and the form's host/port are unused in that branch, so
        // logging the form fields would name a server we never dialed.
        let oracle_config = Self::connect_config(config, timeout_secs)?;
        let (dialed_host, dialed_port) = (oracle_config.host.clone(), oracle_config.port);
        let connection = OracleConnection::connect_with_config(oracle_config)
            .await
            .map_err(map_oracle_connection_error)?;
        if let Err(err) = connection.ping().await {
            let _ = connection.close().await;
            return Err(map_oracle_connection_error(err));
        }

        let server_info = connection.server_info().await;
        let mut guard = self.state.lock().await;
        guard.server_version = non_empty(server_info.version);
        guard.server_banner = non_empty(server_info.banner);
        guard.connected_config = Some(config.clone());
        guard.connection = Some(connection);

        info!("Connected to Oracle at {dialed_host}:{dialed_port}");
        Ok(())
    }

    async fn disconnect_session(&self) -> Result<(), AppError> {
        let connection = {
            let mut guard = self.state.lock().await;
            guard.server_version = None;
            guard.server_banner = None;
            guard.connected_config = None;
            guard.connection.take()
        };

        if let Some(connection) = connection {
            connection
                .close()
                .await
                .map_err(map_oracle_connection_error)?;
        }

        Ok(())
    }

    async fn ping_session(&self) -> Result<(), AppError> {
        let guard = self.state.lock().await;
        let connection = guard
            .connection
            .as_ref()
            .ok_or_else(|| AppError::Connection("Oracle connection is not open".into()))?;

        connection.ping().await.map_err(map_oracle_connection_error)
    }

    async fn connected_config(&self) -> Result<ConnectionConfig, AppError> {
        self.state
            .lock()
            .await
            .connected_config
            .clone()
            .ok_or_else(|| AppError::Connection("Oracle connection is not open".into()))
    }

    async fn current_service_name(&self) -> Option<String> {
        self.state
            .lock()
            .await
            .connected_config
            .as_ref()
            .map(|config| config.database.trim().to_string())
            .filter(|service_name| !service_name.is_empty())
    }

    fn connect_config(
        config: &ConnectionConfig,
        timeout_secs: u64,
    ) -> Result<OracleConfig, AppError> {
        // `database` carries the service name, the SID when `oracle_use_sid`,
        // or — since #2154 — a whole TNS connect descriptor.
        let dial_source = config.database.trim();
        let descriptor = if dial_source.starts_with('(') {
            Some(parse_tns_descriptor(dial_source)?)
        } else {
            None
        };
        // #2154 — a descriptor names host, port, service and connect method
        // itself, so it owns all four: honoring the form's host/port beside it
        // would leave two sources of truth for one dial. The Oracle form
        // disables those inputs while a descriptor is present.
        let (host, port, service, use_sid) = match &descriptor {
            Some(target) => (
                target.host.as_str(),
                target.port,
                target.service.as_str(),
                target.use_sid,
            ),
            None => (
                config.host.trim(),
                config.port,
                dial_source,
                config.oracle_use_sid.unwrap_or(false),
            ),
        };
        let username = config.user.trim();

        if host.is_empty() {
            return Err(AppError::Validation("Oracle host is required".into()));
        }
        if port == 0 {
            return Err(AppError::Validation("Oracle port is required".into()));
        }
        if service.is_empty() {
            return Err(AppError::Validation(
                if use_sid {
                    "Oracle SID is required"
                } else {
                    "Oracle service name is required"
                }
                .into(),
            ));
        }
        if username.is_empty() {
            return Err(AppError::Validation("Oracle user is required".into()));
        }
        if config.password.is_empty() {
            return Err(AppError::Validation(
                "Oracle password authentication is required; advanced/external auth is unsupported (#1065)".into(),
            ));
        }
        // #1065 — character whitelist at the trust boundary. The driver's
        // `build_connect_string` interpolates host/service/SID verbatim into a
        // TNS descriptor with zero escaping, so a `)(` value could inject
        // descriptor clauses (real trigger: an imported export envelope,
        // threat model §2.1). This also subsumes the old TNS/`//` substring
        // rejections. Oracle identifiers are `[A-Za-z0-9_$#.-]` in practice
        // (service names carry `.`/`-`, e.g. ADB `..._high.adb.oraclecloud.com`).
        // #2154 — descriptor-sourced coordinates land here too: the descriptor
        // is parsed, never forwarded, so the driver still rebuilds its own
        // connect string out of values this whitelist has cleared.
        if !is_oracle_identifier_safe(host) {
            return Err(AppError::Validation(
                "Oracle host contains unsupported characters; use a plain hostname or IP".into(),
            ));
        }
        if !is_oracle_identifier_safe(service) {
            return Err(AppError::Validation(
                format!(
                    "Oracle {} contains unsupported characters; use a plain identifier, or paste the whole TNS connect descriptor (#2154)",
                    if use_sid { "SID" } else { "service name" }
                ),
            ));
        }
        // Mongo-only fields stay rejected — Oracle never reads them.
        if has_non_empty(&config.auth_source) {
            return Err(AppError::Validation(
                "Oracle advanced auth fields are unsupported; use service-name username/password auth (#1065)".into(),
            ));
        }
        if has_non_empty(&config.replica_set) {
            return Err(AppError::Validation(
                "Oracle routing fields are unsupported; use host, port, and service name (#1065)"
                    .into(),
            ));
        }
        let mut oracle_config = if use_sid {
            OracleConfig::with_sid(host, port, service, username, config.password.as_str())
        } else {
            OracleConfig::new(host, port, service, username, config.password.as_str())
        };

        // #1065 — Oracle wallet (mTLS): reference the user's wallet directory.
        // NOTE: never `{:?}` `oracle_config` — the crate's derived `Debug`
        // prints `password`/`wallet_password` verbatim (threat model §0.1/§2.5).
        let wallet_path = config
            .wallet_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty());
        // #1669 — a wallet password with no wallet path would skip the mTLS
        // block below and connect over plaintext TCP, silently discarding the
        // user's wallet intent. Fail closed. Never interpolate the secret into
        // the message.
        if wallet_path.is_none() && !config.wallet_password.is_empty() {
            return Err(AppError::Validation(
                "Oracle wallet password requires a wallet directory path; set the wallet path or clear the wallet password (#1065)".into(),
            ));
        }

        // ── TLS ────────────────────────────────────────────────────────────
        // Both branches below reach `rustls::ClientConfig::builder()`, which
        // panics with no process default installed. The app installs one at
        // startup; this repeat call covers unit tests and library consumers
        // that never run `table_view_lib::run()`. See
        // `db::tls::install_rustls_crypto_provider` for why it is a process
        // property and not an Oracle one.
        install_rustls_crypto_provider();
        // Two anchors can drive an Oracle handshake and they are mutually
        // exclusive: the wallet (#1065 mTLS — the wallet's own certificate is
        // both trust store and client identity) and the shared sslmode posture
        // (#2154 wallet-less 1-way TCPS). Naming both is an ambiguous
        // instruction, not a stronger one, so it is rejected rather than
        // silently resolved in one direction.
        let tls_enabled = if let Some(wallet_path) = wallet_path {
            if config.ssl_mode.tls_on() {
                return Err(AppError::Validation(
                    "Oracle wallet mTLS and the sslmode posture are separate TLS paths; leave the TLS posture at disable or prefer while a wallet directory is set (#2154)".into(),
                ));
            }
            warn_on_loose_wallet_permissions(wallet_path);
            let wallet_password = if config.wallet_password.is_empty() {
                None
            } else {
                Some(config.wallet_password.as_str())
            };
            oracle_config = oracle_config
                .with_wallet(wallet_path, wallet_password)
                .map_err(|error| map_oracle_tls_path_error(wallet_path, error))?;
            true
        } else {
            // #2154 — the same `resolve_tls_decision` the pg/mysql/mssql
            // adapters read, so `verify-ca` fails closed without a CA file
            // here too (`db::tls::VERIFY_CA_REQUIRES_CA_MESSAGE`).
            match resolve_tls_decision(config)? {
                // oracle-rs has no opportunistic mode: `prefer` is plain TCP,
                // the same wire `disable` forces. They are distinguishable only
                // for engines whose driver negotiates.
                TlsDecision::Disable | TlsDecision::Default => false,
                // `require` = encrypt without verifying. The driver cannot
                // express it: `TlsConfig::danger_accept_invalid_certs` sets a
                // `verify_server` flag that `build_client_config` never reads
                // (oracle-rs 0.1.7, threat model §0.1/D1). Accepting it would
                // relabel the user's posture as a verifying one behind their
                // back, so it is refused with the postures that do work.
                TlsDecision::RequireSkipVerify => {
                    return Err(AppError::Validation(
                        "Oracle cannot skip certificate verification; use verify-full, or verify-ca with the CA that signs the server certificate (#2154)".into(),
                    ))
                }
                TlsDecision::RequireVerifyFull { extra_ca_cert_path } => {
                    // Unlike sqlx (see `db::tls` module docs), naming a CA here
                    // *narrows* the anchors: oracle-rs seeds its root store from
                    // the CA file when one is set and from the webpki bundle
                    // otherwise, never both. That is stricter than the pg/mysql
                    // mapping, never looser. rustls verifies the hostname in
                    // both branches — the driver passes the dial host as the
                    // SNI name and installs no custom verifier.
                    let tls_config = match extra_ca_cert_path.as_deref() {
                        Some(ca_cert_path) => TlsConfig::new().with_ca_cert(ca_cert_path),
                        None => TlsConfig::new(),
                    };
                    // Build eagerly — `Config::tls_config` stores without
                    // validating, so an unreadable CA file would otherwise
                    // surface as a handshake failure at connect time. The
                    // driver echoes the path in that error, so redact it.
                    tls_config.build_client_config().map_err(|error| {
                        match extra_ca_cert_path.as_deref() {
                            Some(ca_cert_path) => map_oracle_tls_path_error(ca_cert_path, error),
                            None => map_oracle_connection_error(error),
                        }
                    })?;
                    oracle_config = oracle_config.tls_config(tls_config);
                    true
                }
            }
        };

        // #2154 — a descriptor's `PROTOCOL` is an instruction, not a hint. The
        // driver rebuilds the connect string from `tls_mode`, so a mismatch
        // here would dial the opposite protocol from the one the descriptor
        // spells out — plaintext where the user pasted TCPS is exactly the
        // silent downgrade the #1065 threat model rejected free-form
        // descriptors over (§2.1). Fail closed in both directions.
        if let Some(target) = &descriptor {
            if target.tcps && !tls_enabled {
                return Err(AppError::Validation(
                    "Oracle TNS descriptor asks for PROTOCOL=TCPS; set the TLS posture to verify-full or verify-ca, or point at a wallet directory (#2154)".into(),
                ));
            }
            if !target.tcps && tls_enabled {
                return Err(AppError::Validation(
                    "Oracle TNS descriptor asks for PROTOCOL=TCP but the connection enables TLS; paste the TCPS descriptor or turn the TLS posture off (#2154)".into(),
                ));
            }
        }

        Ok(oracle_config.connect_timeout(Duration::from_secs(timeout_secs)))
    }

    async fn open_connection(
        config: &ConnectionConfig,
        timeout_secs: u64,
    ) -> Result<OracleConnection, AppError> {
        let oracle_config = Self::connect_config(config, timeout_secs)?;
        OracleConnection::connect_with_config(oracle_config)
            .await
            .map_err(map_oracle_connection_error)
    }
}

impl DbAdapter for OracleAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Oracle
    }

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.connect_session(config).await })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.disconnect_session().await })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.ping_session().await })
    }
}

impl RdbAdapter for OracleAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move {
            let schemas = OracleAdapter::list_schemas(self).await?;
            Ok(schemas.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move {
            let dbs = OracleAdapter::list_databases(self).await?;
            Ok(dbs.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async move { Ok(self.current_service_name().await) })
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async move { OracleAdapter::list_tables(self, namespace).await })
    }

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        cancellable_metadata(
            OracleAdapter::get_table_columns(self, namespace, table),
            cancel,
        )
    }

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
        Box::pin(async move {
            self.execute_query(sql, cancel, crate::db::row_cap::current())
                .await
        })
    }

    fn execute_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        Box::pin(async move { self.execute_query_batch(statements, cancel).await })
    }

    fn dry_run_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        Box::pin(async move { self.dry_run_query_batch(statements, cancel).await })
    }

    #[allow(clippy::too_many_arguments)]
    fn query_table_data<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [crate::models::FilterCondition]>,
        raw_where: Option<&'a str>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>> {
        Box::pin(async move {
            OracleAdapter::query_table_data(
                self, namespace, table, page, page_size, order_by, filters, raw_where, cancel,
            )
            .await
        })
    }

    // Issue #1674 — Oracle row streaming powers the DML/Full schema dump. Same
    // contract as the pg/mysql/sqlite/mssql siblings; `oracle/runtime.rs` owns
    // the cursor batching + cancellation body.
    fn stream_table_rows<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        batch_size: u32,
        column_names: &'a [String],
        sender: tokio::sync::mpsc::Sender<Vec<Vec<serde_json::Value>>>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<u64, AppError>> {
        Box::pin(async move {
            self.stream_table_rows(namespace, table, batch_size, column_names, sender, cancel)
                .await
        })
    }

    fn drop_table<'a>(
        &'a self,
        req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::drop_table(self, req).await })
    }

    fn rename_table<'a>(
        &'a self,
        req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::rename_table(self, req).await })
    }

    fn alter_table<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::alter_table(self, req).await })
    }

    fn add_column<'a>(
        &'a self,
        req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::add_column(self, req).await })
    }

    fn drop_column<'a>(
        &'a self,
        req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::drop_column(self, req).await })
    }

    fn create_table<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::create_table(self, req).await })
    }

    fn create_index<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::create_index(self, req).await })
    }

    fn drop_index<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::drop_index(self, req).await })
    }

    fn add_constraint<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::add_constraint(self, req).await })
    }

    fn drop_constraint<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::drop_constraint(self, req).await })
    }

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        cancellable_metadata(
            OracleAdapter::get_table_indexes(self, namespace, table),
            cancel,
        )
    }

    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        cancellable_metadata(
            OracleAdapter::get_table_constraints(self, namespace, table),
            cancel,
        )
    }

    fn list_views<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        Box::pin(async move { OracleAdapter::list_views(self, namespace).await })
    }

    fn list_functions<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        Box::pin(async move { OracleAdapter::list_functions(self, namespace).await })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move { OracleAdapter::get_view_definition(self, namespace, view).await })
    }

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move { OracleAdapter::get_view_columns(self, namespace, view).await })
    }

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, Vec<ColumnInfo>>, AppError>> {
        Box::pin(async move { OracleAdapter::list_schema_columns(self, namespace).await })
    }

    fn get_function_source<'a>(
        &'a self,
        namespace: &'a str,
        function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move { OracleAdapter::get_function_source(self, namespace, function).await })
    }

    // Reason: #1072 (2차) — list_triggers was the last Oracle catalog stub still
    // inheriting the RdbAdapter default `Ok(Vec::new())`, so the Structure
    // Triggers tab showed empty for Oracle despite live triggers. It now reads
    // `all_triggers` through `oracle/catalog.rs` like the other list_* surfaces.
    // (2026-07-25)
    fn list_triggers<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TriggerInfo>, AppError>> {
        Box::pin(async move { OracleAdapter::list_triggers(self, namespace, table).await })
    }

    // ── Issue #1073 — admin ops (activity/kill/slow/info) Oracle parity ──
    fn list_server_activity<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<crate::models::ServerActivityRow>, AppError>> {
        Box::pin(async move { OracleAdapter::list_server_activity(self).await })
    }

    fn kill_session<'a>(&'a self, id: i64) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { OracleAdapter::kill_session(self, id).await })
    }

    fn slow_queries<'a>(
        &'a self,
        limit: i64,
    ) -> BoxFuture<'a, Result<Vec<crate::models::SlowQueryRow>, AppError>> {
        Box::pin(async move { OracleAdapter::slow_queries(self, limit).await })
    }

    fn server_info<'a>(&'a self) -> BoxFuture<'a, Result<crate::models::ServerInfoRow, AppError>> {
        Box::pin(async move { OracleAdapter::server_info(self).await })
    }
}

fn cancellable_metadata<'a, T>(
    work: impl Future<Output = Result<T, AppError>> + Send + 'a,
    cancel: Option<&'a CancellationToken>,
) -> BoxFuture<'a, Result<T, AppError>>
where
    T: Send + 'a,
{
    Box::pin(async move {
        match cancel {
            Some(token) => tokio::select! {
                result = work => result,
                _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
            },
            None => work.await,
        }
    })
}

pub(crate) fn connection_timeout_secs(config: &ConnectionConfig) -> u64 {
    config
        .connect_timeout(ORACLE_CONNECT_TIMEOUT_MAX_SECS)
        .as_secs()
}

/// Issue #1453 — Oracle connect/ping errors can echo a DSN / URL with
/// credentials; route through the redacting constructor. #1065 extends the
/// redact contract to also mask filesystem paths / cert DNs (wallet + TLS DN
/// leaks) via `redact_paths_and_dn`.
fn map_oracle_connection_error(error: oracle_rs::Error) -> AppError {
    let masked = crate::storage::sql_redact::redact_paths_and_dn(&error.to_string());
    AppError::connection_redacted(masked)
}

/// #1065 — TLS-material load failures from the driver echo the file path
/// (leaks the home-directory username / internal topology): the wallet
/// directory, and since #2154 the `verify-ca` CA certificate. Mask the exact
/// path plus any residual path/DN before routing through the redacting
/// constructor.
fn map_oracle_tls_path_error(path: &str, error: oracle_rs::Error) -> AppError {
    let masked = error.to_string().replace(path, "***");
    let masked = crate::storage::sql_redact::redact_paths_and_dn(&masked);
    AppError::connection_redacted(masked)
}

/// #2154 — the dial coordinates a TNS connect descriptor carries. Everything a
/// descriptor can express beyond these four is rejected, never dropped.
struct TnsDialTarget {
    host: String,
    port: u16,
    /// Service name, or SID when `use_sid` — whichever `CONNECT_DATA` named.
    service: String,
    use_sid: bool,
    /// `PROTOCOL=TCPS`: the descriptor asks for a TLS dial.
    tcps: bool,
}

/// The only clause keys this client honors inside a descriptor.
///
/// #2154 implements option A2 of the #1065 threat model
/// (`docs/explorations/oracle-wallet-tns-threat-model-2026-07-17.md` §5-A):
/// pull host/port/service/protocol out of the descriptor and hard-fail on
/// every other clause. §2.1 rejected free-form descriptors (A3) precisely
/// because a partial parser silently drops clauses that carry security
/// semantics — `SECURITY`/`SSL_SERVER_DN_MATCH` (oracle-rs 0.1.7 stores
/// `ssl_server_dn_match` and never reads it), `ADDRESS_LIST` failover,
/// proxies — leaving the user believing the descriptor pinned a posture the
/// dial never applied. Refusing the clause keeps that belief impossible.
const TNS_HONORED_CLAUSES: [&str; 8] = [
    "DESCRIPTION",
    "ADDRESS",
    "CONNECT_DATA",
    "PROTOCOL",
    "HOST",
    "PORT",
    "SERVICE_NAME",
    "SID",
];

/// Parse a TNS connect descriptor down to the coordinates the driver can dial.
///
/// The descriptor is **never forwarded** — `oracle-rs` rejects descriptors
/// outright (`Config::from_str` errors on a leading `(`) and rebuilds its own
/// connect string from host/port/service, so the parsed parts still pass the
/// `connect_config` character whitelist before the driver sees them.
///
/// Error messages name clause *keys*, never clause values: a descriptor field
/// is where a user can paste a whole `user/password@host` connect string
/// (threat model §4-4), and values also carry internal topology.
fn parse_tns_descriptor(descriptor: &str) -> Result<TnsDialTarget, AppError> {
    let malformed = || {
        AppError::Validation(
            "Oracle TNS descriptor is malformed; paste the whole `(DESCRIPTION=...)` entry from tnsnames.ora (#2154)".into(),
        )
    };

    // One balanced top-level group. Closing to depth 0 before the end would
    // mean two descriptors concatenated, of which only the first is read.
    let mut depth = 0i32;
    for (index, ch) in descriptor.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth < 0 || (depth == 0 && index + 1 != descriptor.len()) {
                    return Err(malformed());
                }
            }
            _ => {}
        }
    }
    if depth != 0 {
        return Err(malformed());
    }

    // Every clause starts at a `(`, so each `(`-delimited fragment is
    // `KEY=VALUE` followed only by the `)` that close it and its parents, plus
    // whatever layout whitespace separates them.
    let mut fragments = descriptor.split('(');
    if fragments.next() != Some("") {
        return Err(malformed());
    }
    let mut clauses: Vec<(String, &str)> = Vec::new();
    for fragment in fragments {
        let (head, closers) = match fragment.find(')') {
            Some(close) => fragment.split_at(close),
            None => (fragment, ""),
        };
        // Whitespace is allowed between the closers: a tnsnames.ora entry
        // written by Net Configuration Assistant puts newlines and indentation
        // there, and the error message plus both form hints tell the user to
        // paste exactly that file's entry. Rejecting it made the instruction
        // impossible to follow. Anything else between clauses is still
        // malformed, and the injection guard is elsewhere — `(HOST=evil host)`
        // is caught by the `connect_config` character whitelist, not here.
        if closers.chars().any(|ch| ch != ')' && !ch.is_whitespace()) {
            return Err(malformed());
        }
        let (key, value) = head.split_once('=').ok_or_else(malformed)?;
        let key = key.trim().to_ascii_uppercase();
        if !TNS_HONORED_CLAUSES.contains(&key.as_str()) {
            // Render the key defensively — it is untrusted input, and it is the
            // one part of the descriptor an error may repeat.
            let named: String = key
                .chars()
                .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
                .take(32)
                .collect();
            return Err(AppError::Validation(format!(
                "Oracle TNS descriptor clause `{named}` is not supported; this client dials one address with PROTOCOL, HOST, PORT and SERVICE_NAME or SID, and refuses clauses it cannot honor rather than ignoring them (#2154)"
            )));
        }
        if clauses.iter().any(|(seen, _)| seen == &key) {
            return Err(AppError::Validation(format!(
                "Oracle TNS descriptor repeats the `{key}` clause; this client dials a single address, so a failover/load-balanced descriptor must be split into one connection per address (#2154)"
            )));
        }
        clauses.push((key, value.trim()));
    }

    let clause = |name: &str| {
        clauses
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| *value)
            .filter(|value| !value.is_empty())
    };
    let required = |name: &'static str| {
        clause(name).ok_or_else(move || {
            AppError::Validation(format!(
                "Oracle TNS descriptor must carry a `{name}` clause (#2154)"
            ))
        })
    };

    let tcps = match required("PROTOCOL")?.to_ascii_uppercase().as_str() {
        "TCP" => false,
        "TCPS" => true,
        _ => {
            return Err(AppError::Validation(
                "Oracle TNS descriptor PROTOCOL must be TCP or TCPS (#2154)".into(),
            ))
        }
    };
    let host = required("HOST")?.to_string();
    let port = required("PORT")?.parse::<u16>().map_err(|_| {
        AppError::Validation("Oracle TNS descriptor PORT is not a valid port number (#2154)".into())
    })?;
    let (service, use_sid) = match (clause("SERVICE_NAME"), clause("SID")) {
        (Some(service_name), None) => (service_name.to_string(), false),
        (None, Some(sid)) => (sid.to_string(), true),
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "Oracle TNS descriptor names both SERVICE_NAME and SID; keep the one the database expects (#2154)".into(),
            ))
        }
        (None, None) => {
            return Err(AppError::Validation(
                "Oracle TNS descriptor must carry a `SERVICE_NAME` or `SID` clause (#2154)".into(),
            ))
        }
    };

    Ok(TnsDialTarget {
        host,
        port,
        service,
        use_sid,
        tcps,
    })
}

/// #1065 — character whitelist for Oracle host / service name / SID at the
/// `connect_config` trust boundary. See the injection note in `connect_config`.
fn is_oracle_identifier_safe(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '$' | '#' | '.' | '-'))
}

/// #1065 — warn (do not fail) when the wallet directory is group/other
/// accessible. The wallet holds the client private key; loose permissions
/// expose it to other local users / sync agents. The path is deliberately
/// omitted from the log line (leak avoidance); only the octal mode is shown.
#[cfg(unix)]
fn warn_on_loose_wallet_permissions(wallet_path: &str) {
    use std::os::unix::fs::PermissionsExt;

    // Only the octal mode is logged, never a filesystem path (leak avoidance);
    // the generic wallet filenames below carry no user-identifying info.
    fn warn_if_loose(mode: u32, what: &str) {
        if mode & 0o077 != 0 {
            tracing::warn!(
                "Oracle wallet {} is group/other-accessible (mode {:o}); \
                 restrict it to 0700/0600 to protect the client private key",
                what,
                mode & 0o7777
            );
        }
    }

    let Ok(meta) = std::fs::metadata(wallet_path) else {
        return;
    };
    warn_if_loose(meta.permissions().mode(), "directory");

    // #1669 — a locked-down wallet directory still leaks the private key if the
    // key files themselves are world/group-readable (e.g. a 0644 `ewallet.pem`).
    // The directory mode alone does not catch that, so check the sensitive
    // wallet files too.
    if meta.is_dir() {
        let dir = std::path::Path::new(wallet_path);
        for name in ["ewallet.pem", "cwallet.sso", "ewallet.p12", "ewallet.sso"] {
            if let Ok(file_meta) = std::fs::metadata(dir.join(name)) {
                warn_if_loose(file_meta.permissions().mode(), name);
            }
        }
    }
}

#[cfg(not(unix))]
fn warn_on_loose_wallet_permissions(_wallet_path: &str) {}

fn has_non_empty(value: &Option<String>) -> bool {
    value
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
