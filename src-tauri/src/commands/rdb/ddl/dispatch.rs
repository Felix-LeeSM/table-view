use crate::commands::connection::AppState;
use crate::db::{BoxFuture, RdbAdapter};
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, CreateIndexRequest,
    CreateTablePlanRequest, CreateTableRequest, CreateTriggerRequest, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, DropTriggerRequest,
    RenameTableRequest, SchemaChangeResult,
};

use super::super::{ensure_expected_db, not_connected};

pub(super) enum DatabaseCommand {
    Create,
    Drop,
}

pub(super) trait DdlSchemaChangeRequest {
    fn connection_id(&self) -> &str;
    fn expected_database(&self) -> Option<&str>;
    /// Issue #1529 — a preview (`preview_only`) only emits SQL text and never
    /// executes, so it is exempt from the read-only write gate.
    fn preview_only(&self) -> bool;
    fn dispatch<'a>(
        &'a self,
        adapter: &'a dyn RdbAdapter,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;
}

pub(super) async fn run_schema_change<R>(
    state: &AppState,
    request: &R,
) -> Result<SchemaChangeResult, AppError>
where
    R: DdlSchemaChangeRequest + ?Sized,
{
    // Issue #1529 — read-only connection gate. Structured DDL is always a write
    // and bypasses the `execute_query` chokepoint, so it needs its own gate.
    // Previews are exempt (they only emit SQL). Uses the backend store's own
    // `read_only` flag so a direct IPC cannot bypass it.
    if !request.preview_only() {
        let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
        crate::commands::safe_mode::enforce_read_only(&pool, request.connection_id(), true).await?;
    }
    let active = state
        .active_adapter(request.connection_id())
        .await
        .ok_or_else(|| not_connected(request.connection_id()))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database()).await?;
    request.dispatch(adapter).await
}

pub(super) async fn run_database_change(
    state: &AppState,
    connection_id: &str,
    name: &str,
    command: DatabaseCommand,
) -> Result<(), AppError> {
    // Issue #1529 — the read-only gate for CREATE / DROP DATABASE lives in the
    // command wrappers (`create_rdb_database` / `drop_rdb_database`), mirroring
    // where `gate_destructive_ddl` sits, so the `_inner` unit tests stay
    // hermetic (no global pool init).
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;

    match command {
        DatabaseCommand::Create => adapter.create_database(name).await,
        DatabaseCommand::Drop => adapter.drop_database(name).await,
    }
}

macro_rules! impl_schema_change_request {
    ($ty:ty, $method:ident) => {
        impl DdlSchemaChangeRequest for $ty {
            fn connection_id(&self) -> &str {
                &self.connection_id
            }

            fn expected_database(&self) -> Option<&str> {
                self.expected_database.as_deref()
            }

            fn preview_only(&self) -> bool {
                self.preview_only
            }

            fn dispatch<'a>(
                &'a self,
                adapter: &'a dyn RdbAdapter,
            ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
                adapter.$method(self)
            }
        }
    };
}

impl_schema_change_request!(DropTableRequest, drop_table);
impl_schema_change_request!(RenameTableRequest, rename_table);
impl_schema_change_request!(AlterTableRequest, alter_table);
impl_schema_change_request!(AddColumnRequest, add_column);
impl_schema_change_request!(DropColumnRequest, drop_column);
impl_schema_change_request!(CreateTableRequest, create_table);
impl_schema_change_request!(CreateTablePlanRequest, create_table_plan);
impl_schema_change_request!(CreateIndexRequest, create_index);
impl_schema_change_request!(DropIndexRequest, drop_index);
impl_schema_change_request!(AddConstraintRequest, add_constraint);
impl_schema_change_request!(DropConstraintRequest, drop_constraint);
impl_schema_change_request!(CreateTriggerRequest, create_trigger);
impl_schema_change_request!(DropTriggerRequest, drop_trigger);
