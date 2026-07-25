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
fn duckdb_adapter_declares_schema_mutation_stage2() {
    // Issue #1070 (ADR 0051 Stage 2) — the DuckdbAdapter now wires native
    // structural DDL (table create/drop/rename, column add/drop/type, index
    // create/drop) in `duckdb/ddl.rs`, so it claims `RelationalSchemaMutation`
    // (like SQLite #1044). This replaces the Stage-1 lock (which asserted the
    // flag was OFF): the capability boundary moved with the wired DDL. Constraint
    // DDL stays `Unsupported` (Stage 2b) — the coarse `RelationalSchemaMutation`
    // reflects "some structural DDL", not full DDL; the per-action frontend
    // `ddl.*` capabilities (incl. `alterConstraint`) express the exact surface.
    let profile = get_data_source_profile(&DatabaseType::Duckdb);
    assert_eq!(
        profile.adapter_contract.kind,
        BackendAdapterContractKind::Rdb
    );
    assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
    assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));
}
