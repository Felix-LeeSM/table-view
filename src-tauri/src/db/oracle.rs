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
//! body is not read), and (3차) database switching: `switch_database`
//! re-dials the stored service name and `list_databases` offers only dialable
//! names — the stored service plus the open PDBs, never the `CDB$ROOT` or
//! `PDB$SEED` containers — while SID profiles fail closed. Raw DDL/admin
//! execution, trigger DDL (create/drop) and single-trigger source, TNS
//! descriptors, 1-way TLS (TCPS+CA), and advanced auth remain unsupported or
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

use oracle_rs::{Config as OracleConfig, Connection as OracleConnection};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DatabaseType, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, FunctionInfo, IndexInfo,
    RenameTableRequest, SchemaChangeResult, TableData, TableInfo, TriggerInfo, ViewInfo,
};

use super::{BoxFuture, DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};

const ORACLE_CONNECT_TIMEOUT_DEFAULT_SECS: u32 = 300;
const ORACLE_CONNECT_TIMEOUT_MAX_SECS: u64 = 30;
const ORACLE_TEST_CONNECT_TIMEOUT_SECS: u64 = 5;
/// Bound for the detached Logoff of a session that a reconnect/switch replaced.
const ORACLE_LOGOFF_TIMEOUT: Duration = Duration::from_secs(5);
/// #1072 — container names that are never connect targets: the CDB root has no
/// listener service of its own name, and the seed is a read-only clone template.
const ORACLE_ROOT_CONTAINER: &str = "CDB$ROOT";
const ORACLE_SEED_CONTAINER: &str = "PDB$SEED";

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
        let connection = Self::open_connection(config, timeout_secs).await?;
        if let Err(err) = connection.ping().await {
            let _ = connection.close().await;
            return Err(map_oracle_connection_error(err));
        }

        let server_info = connection.server_info().await;
        let replaced = {
            let mut guard = self.state.lock().await;
            guard.server_version = non_empty(server_info.version);
            guard.server_banner = non_empty(server_info.banner);
            guard.connected_config = Some(config.clone());
            guard.connection.replace(connection)
        };
        // #1072 — a reconnect (and the switch-database path below) replaces the
        // live session; send the clean Logoff instead of only dropping it, so
        // the server releases the session now rather than at driver GC time.
        // Detached and bounded on purpose: the driver has no read timeout
        // (`transport/tcp.rs` times out `connect` only) and `close()` waits on
        // `read_exact` for the Logoff reply, so a half-open socket — laptop
        // sleep, VPN drop, container restart, i.e. exactly why a reconnect is
        // happening — would block here until the TCP retransmit timeout. The
        // state swap above is already committed at this point, so awaiting it
        // would hang `switch_active_db` after the switch took effect and leave
        // the UI label behind the backend with no error. Dropping was
        // non-blocking before #1072; this keeps that property, and the failure
        // is logged rather than `let _`-swallowed (same contract as
        // `commands/connection/session.rs`).
        if let Some(replaced) = replaced {
            tokio::spawn(async move {
                match tokio::time::timeout(ORACLE_LOGOFF_TIMEOUT, replaced.close()).await {
                    Ok(Ok(())) => {}
                    Ok(Err(err)) => {
                        warn!("Oracle logoff of the replaced session failed: {err}");
                    }
                    Err(_) => warn!(
                        "Oracle logoff of the replaced session timed out after {}s; the server reaps it",
                        ORACLE_LOGOFF_TIMEOUT.as_secs()
                    ),
                }
            });
        }

        info!("Connected to Oracle at {}:{}", config.host, config.port);
        Ok(())
    }

    /// Issue #1072 — Oracle database switching re-points the stored service name
    /// (or SID) and re-opens the session. Oracle has no `USE <db>`: a session is
    /// bound to the service/PDB it dialed, and an `ALTER SESSION SET CONTAINER`
    /// would not survive anyway because every query opens a fresh connection
    /// from `connected_config` (`oracle/runtime.rs`). Swapping the stored config
    /// is therefore the only switch that holds for the next statement — the same
    /// shape as `mssql/catalog.rs::switch_active_database`. `connect_session`
    /// dials and pings the target *before* it touches the stored state, so a
    /// rejected service name leaves the current connection usable.
    async fn switch_active_service(&self, db_name: &str) -> Result<(), AppError> {
        let db_name = db_name.trim();
        // Validate at the trust boundary before the connection lookup: the name
        // lands in a TNS descriptor the driver interpolates verbatim (#1065),
        // and the guard order is what makes this unit-testable without a live
        // Oracle (same posture as `stream_table_rows`).
        if db_name.is_empty() {
            return Err(AppError::Validation(
                "Oracle service name is required to switch database".into(),
            ));
        }
        if !is_oracle_identifier_safe(db_name) {
            return Err(AppError::Validation(
                "Oracle service name contains unsupported characters; TNS/easy-connect descriptors are not supported (#1065)".into(),
            ));
        }
        // #1072 — the root container is not a listener service. A CDB root's
        // service is the one the session already dialed (`XE`, `FREE`, …), so
        // dialing `CDB$ROOT` is a guaranteed ORA-12514; the #1065 whitelist
        // allows `$`, so it needs its own guard. `list_databases` never offers
        // it either — the two axes have to agree.
        if db_name.eq_ignore_ascii_case(ORACLE_ROOT_CONTAINER) {
            return Err(AppError::Validation(
                "Oracle CDB$ROOT is a container, not a connectable service; switch to a PDB or to the root's own service name".into(),
            ));
        }
        // #1072 — same-axis rule, same reason: the seed is a read-only clone
        // template Oracle keeps mounted for `CREATE PLUGGABLE DATABASE`, never a
        // workload target. `OPEN_PDBS_SQL` and `switch_target_names`
        // (`oracle/catalog.rs`) both drop it, so without this guard the dial
        // would accept a name the picker refuses to offer — the whitelist
        // permits `$`, so it needs its own guard exactly like the root.
        if db_name.eq_ignore_ascii_case(ORACLE_SEED_CONTAINER) {
            return Err(AppError::Validation(
                "Oracle PDB$SEED is a read-only clone template, not a connectable database; switch to a PDB or to the connection's own service name".into(),
            ));
        }

        let mut config = self.connected_config().await?;
        // Oracle folds unquoted identifiers and the listener matches service
        // names case-insensitively, so a case-only re-select is the *same*
        // target: the DbSwitcher re-selecting the current entry must not tear
        // down a working session, and the stored spelling the picker highlights
        // against must survive untouched.
        if config.database.trim().eq_ignore_ascii_case(db_name) {
            return Ok(());
        }
        // #1072 — SID profiles fail closed. A SID names the instance, not a
        // container: dialing a PDB name as a SID is ORA-12505, and a
        // single-instance box has no second SID to offer. `list_databases`
        // agrees by listing only the stored SID for these profiles, so this is
        // unreachable from the picker and guards the IPC entry point.
        if config.oracle_use_sid.unwrap_or(false) {
            return Err(AppError::Unsupported(
                "Oracle SID connections cannot switch database; a SID names the instance, not a pluggable database (#1072)".into(),
            ));
        }
        config.database = db_name.to_string();
        self.connect_session(&config).await
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
        let host = config.host.trim();
        // `database` carries the service name, or the SID when `oracle_use_sid`.
        let service = config.database.trim();
        let username = config.user.trim();
        let use_sid = config.oracle_use_sid.unwrap_or(false);

        if host.is_empty() {
            return Err(AppError::Validation("Oracle host is required".into()));
        }
        if config.port == 0 {
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
        if !is_oracle_identifier_safe(host) {
            return Err(AppError::Validation(
                "Oracle host contains unsupported characters; use a plain hostname or IP".into(),
            ));
        }
        if !is_oracle_identifier_safe(service) {
            return Err(AppError::Validation(
                format!(
                    "Oracle {} contains unsupported characters; TNS/easy-connect descriptors are not supported (#1065)",
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
        // The MSSQL-only trust/tls toggles are never exposed for Oracle — the
        // driver's `danger_accept_invalid_certs` is a no-op (threat model
        // §0.1/D1), so honoring them would be a lie. The wallet field is the
        // only Oracle TLS trigger.
        if config.tls_enabled.unwrap_or(false) || config.trust_server_certificate.unwrap_or(false) {
            return Err(AppError::Validation(
                "Oracle uses an mTLS wallet, not the trust-server-certificate toggle; leave those MSSQL options unset (#1065)".into(),
            ));
        }

        let mut oracle_config = if use_sid {
            OracleConfig::with_sid(
                host,
                config.port,
                service,
                username,
                config.password.as_str(),
            )
        } else {
            OracleConfig::new(
                host,
                config.port,
                service,
                username,
                config.password.as_str(),
            )
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
        if let Some(wallet_path) = wallet_path {
            warn_on_loose_wallet_permissions(wallet_path);
            let wallet_password = if config.wallet_password.is_empty() {
                None
            } else {
                Some(config.wallet_password.as_str())
            };
            oracle_config = oracle_config
                .with_wallet(wallet_path, wallet_password)
                .map_err(|error| map_oracle_wallet_error(wallet_path, error))?;
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

    // Issue #1072 — the last runtime-slice residual: Oracle inherited the trait
    // default `Unsupported`, so the DbSwitcher stayed read-only. See
    // `switch_active_service` for why re-dialing the service name (not
    // `ALTER SESSION SET CONTAINER`) is the switch that actually holds.
    fn switch_database<'a>(&'a self, db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.switch_active_service(db_name).await })
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

fn connection_timeout_secs(config: &ConnectionConfig) -> u64 {
    (config
        .connection_timeout
        .unwrap_or(ORACLE_CONNECT_TIMEOUT_DEFAULT_SECS) as u64)
        .min(ORACLE_CONNECT_TIMEOUT_MAX_SECS)
}

/// Issue #1453 — Oracle connect/ping errors can echo a DSN / URL with
/// credentials; route through the redacting constructor. #1065 extends the
/// redact contract to also mask filesystem paths / cert DNs (wallet + TLS DN
/// leaks) via `redact_paths_and_dn`.
fn map_oracle_connection_error(error: oracle_rs::Error) -> AppError {
    let masked = crate::storage::sql_redact::redact_paths_and_dn(&error.to_string());
    AppError::connection_redacted(masked)
}

/// #1065 — wallet-load failures from the driver echo the wallet path (leaks
/// the home-directory username / internal topology). Mask the exact path plus
/// any residual path/DN before routing through the redacting constructor.
fn map_oracle_wallet_error(wallet_path: &str, error: oracle_rs::Error) -> AppError {
    let masked = error.to_string().replace(wallet_path, "***");
    let masked = crate::storage::sql_redact::redact_paths_and_dn(&masked);
    AppError::connection_redacted(masked)
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
