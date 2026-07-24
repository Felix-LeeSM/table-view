use std::any::TypeId;

use crate::db::{
    adapters::sqlite::SqliteAdapter as CanonicalSqliteAdapter,
    capabilities::{BackendAdapterCapability, BackendAdapterContractKind},
    contracts::{DbAdapter, NamespaceLabel, RdbAdapter},
    sqlite::SqliteAdapter as LegacySqliteAdapter,
    SqliteAdapter as RootSqliteAdapter,
};
use crate::models::{get_data_source_profile, DatabaseType};

#[test]
fn sqlite_adapter_topology_preserves_public_paths_and_contracts() {
    assert_eq!(
        TypeId::of::<CanonicalSqliteAdapter>(),
        TypeId::of::<LegacySqliteAdapter>()
    );
    assert_eq!(
        TypeId::of::<CanonicalSqliteAdapter>(),
        TypeId::of::<RootSqliteAdapter>()
    );

    let adapter = CanonicalSqliteAdapter::new();
    assert!(matches!(adapter.kind(), DatabaseType::Sqlite));
    assert!(matches!(
        <CanonicalSqliteAdapter as RdbAdapter>::namespace_label(&adapter),
        NamespaceLabel::Single { name: "file" }
    ));

    let profile = get_data_source_profile(&DatabaseType::Sqlite);
    assert_eq!(
        profile.adapter_contract.kind,
        BackendAdapterContractKind::Rdb
    );
    assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
    // Wired SqliteAdapter implements bounded structured DDL (create_table), so
    // the declaration claims RelationalSchemaMutation (#1044).
    assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));
}

#[test]
fn duckdb_adapter_declares_query_without_schema_mutation() {
    // Issue #1070 (ADR 0051 Stage 1) — the DuckdbAdapter wires
    // `execute_sql_batch` (BEGIN..COMMIT structured row edits, #1767). DML row
    // mutation rides `RelationalQuery` (the same posture CSV import declared in
    // #1640; there is no separate relational data-mutation capability), which
    // DuckDB already claims, so the declaration matches the wired path.
    // `RelationalSchemaMutation` must stay OFF: DuckDB's structural DDL trait
    // methods remain `Unsupported` pending Stage 2. This locks the Stage-1
    // boundary so a later DDL slice cannot silently flip it early.
    let profile = get_data_source_profile(&DatabaseType::Duckdb);
    assert_eq!(
        profile.adapter_contract.kind,
        BackendAdapterContractKind::Rdb
    );
    assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
    assert!(!profile.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));
}
