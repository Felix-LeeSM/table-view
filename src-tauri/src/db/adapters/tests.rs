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
    assert!(!profile.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));
}
