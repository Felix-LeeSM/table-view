use std::{mem, str::FromStr};

use table_view_lib::{
    db::{
        ActiveAdapter, BoxFuture, DbAdapter, KvAdapter, MongoAdapter, MysqlAdapter,
        PostgresAdapter, SearchAdapter,
    },
    error::AppError,
    models::{
        get_data_source_profile, BackendAdapterCapability, BackendAdapterCapabilitySource,
        BackendAdapterContractKind, BackendAdapterContractState, BackendAdapterId,
        CatalogModelKind, ConnectionConfig, ConnectionKind, DataSourceDialectFamily,
        DataSourceDialectId, DatabaseType, FileConnectionInputKind, FileConnectionInputStatus,
        FileConnectionPermissionScope, FileConnectionPrivacyPolicyId, Paradigm, QueryLanguageId,
        ResultEnvelopeKind, SafetyPolicyId, ServerVersionProbeId, FILE_RDBMS_DATABASE_TYPES,
        KV_MARKER_CONTRACT, RDBMS_DATABASE_TYPES, RUNTIME_RDBMS_DATABASE_TYPES,
        SEARCH_MARKER_CONTRACT, SERVER_RDBMS_DATABASE_TYPES,
    },
};

fn database_type_label(db_type: &DatabaseType) -> &'static str {
    match db_type {
        DatabaseType::Postgresql => "postgresql",
        DatabaseType::Mysql => "mysql",
        DatabaseType::Mariadb => "mariadb",
        DatabaseType::Sqlite => "sqlite",
        DatabaseType::Duckdb => "duckdb",
        DatabaseType::Mssql => "mssql",
        DatabaseType::Oracle => "oracle",
        DatabaseType::Mongodb => "mongodb",
        DatabaseType::Redis => "redis",
    }
}

fn database_type_labels(db_types: &[DatabaseType]) -> Vec<&'static str> {
    db_types.iter().map(database_type_label).collect()
}

#[test]
fn backend_adapter_contract_profiles_are_encoded() {
    let all_database_types = [
        DatabaseType::Postgresql,
        DatabaseType::Mysql,
        DatabaseType::Mariadb,
        DatabaseType::Sqlite,
        DatabaseType::Duckdb,
        DatabaseType::Mssql,
        DatabaseType::Oracle,
        DatabaseType::Mongodb,
        DatabaseType::Redis,
    ];

    for db_type in all_database_types {
        let profile = get_data_source_profile(&db_type);

        assert_eq!(mem::discriminant(&profile.id), mem::discriminant(&db_type));
        assert_eq!(profile.paradigm, db_type.paradigm());
        assert!(!profile.languages.is_empty());
        assert!(!profile.result_kinds.is_empty());
        assert_eq!(
            profile.has_backend_capability(BackendAdapterCapability::Lifecycle),
            profile.adapter_contract.state != BackendAdapterContractState::DeclaredOnly
        );
    }
}

#[test]
fn backend_profiles_encode_current_database_type_contracts() {
    let postgres = get_data_source_profile(&DatabaseType::Postgresql);
    assert_eq!(postgres.connection_kind, ConnectionKind::Server);
    assert_eq!(postgres.languages, [QueryLanguageId::Sql]);
    assert_eq!(postgres.catalog_model, CatalogModelKind::Rdb);
    assert_eq!(postgres.result_kinds, [ResultEnvelopeKind::Tabular]);
    assert_eq!(postgres.safety_policy, SafetyPolicyId::RdbDefault);
    assert_eq!(
        postgres.adapter_contract.kind,
        BackendAdapterContractKind::Rdb
    );
    assert_eq!(
        postgres.adapter_contract.state,
        BackendAdapterContractState::FactoryBacked
    );
    assert!(postgres.has_backend_capability(BackendAdapterCapability::RelationalQuery));

    let sqlite = get_data_source_profile(&DatabaseType::Sqlite);
    assert_eq!(sqlite.connection_kind, ConnectionKind::File);
    assert_eq!(
        sqlite.adapter_contract.state,
        BackendAdapterContractState::FactoryBacked
    );
    assert!(sqlite.has_backend_capability(BackendAdapterCapability::RelationalQuery));
    assert!(!sqlite.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));

    let mssql = get_data_source_profile(&DatabaseType::Mssql);
    assert_eq!(
        mssql.adapter_contract.state,
        BackendAdapterContractState::DeclaredOnly
    );

    let mongodb = get_data_source_profile(&DatabaseType::Mongodb);
    assert_eq!(mongodb.paradigm, Paradigm::Document);
    assert_eq!(mongodb.languages, [QueryLanguageId::Mongosh]);
    assert_eq!(mongodb.catalog_model, CatalogModelKind::Document);
    assert_eq!(
        mongodb.result_kinds,
        [ResultEnvelopeKind::Document, ResultEnvelopeKind::Tabular]
    );
    assert_eq!(
        mongodb.adapter_contract.kind,
        BackendAdapterContractKind::Document
    );
    assert!(mongodb.has_backend_capability(BackendAdapterCapability::DocumentQuery));

    let redis = get_data_source_profile(&DatabaseType::Redis);
    assert_eq!(redis.paradigm, Paradigm::Kv);
    assert_eq!(redis.languages, [QueryLanguageId::RedisCommand]);
    assert_eq!(
        redis.result_kinds,
        [
            ResultEnvelopeKind::KeyValue,
            ResultEnvelopeKind::StreamRecords
        ]
    );
    assert_eq!(redis.adapter_contract.kind, BackendAdapterContractKind::Kv);
    assert_eq!(
        redis.adapter_contract.state,
        BackendAdapterContractState::FactoryBacked
    );
    assert_eq!(redis.backend_adapter.id, BackendAdapterId::Redis);
    assert_eq!(
        redis.backend_adapter.capability_source,
        BackendAdapterCapabilitySource::Redis
    );
    assert!(redis.has_backend_capability(BackendAdapterCapability::KeyValueCatalog));
    assert!(redis.has_backend_capability(BackendAdapterCapability::KeyValueRead));
    assert!(redis.has_backend_capability(BackendAdapterCapability::KeyValueMutation));
}

#[test]
fn duckdb_profile_is_file_backed_rdbms_with_runtime_catalog_query_contract() {
    let duckdb = DatabaseType::from_str("duckdb").expect("duckdb identity must parse");
    let profile = get_data_source_profile(&duckdb);

    assert_eq!(profile.paradigm, Paradigm::Rdb);
    assert_eq!(profile.connection_kind, ConnectionKind::File);
    assert_eq!(profile.languages, [QueryLanguageId::Sql]);
    assert_eq!(profile.catalog_model, CatalogModelKind::Rdb);
    assert_eq!(profile.result_kinds, [ResultEnvelopeKind::Tabular]);
    assert_eq!(profile.safety_policy, SafetyPolicyId::RdbDefault);
    assert_eq!(
        profile.adapter_contract.kind,
        BackendAdapterContractKind::Rdb
    );
    assert_eq!(
        profile.adapter_contract.state,
        BackendAdapterContractState::FactoryBacked
    );
    assert_eq!(profile.backend_adapter.id, BackendAdapterId::Duckdb);
    assert_eq!(
        profile.backend_adapter.capability_source,
        BackendAdapterCapabilitySource::Duckdb
    );
    assert_eq!(profile.dialect.id, DataSourceDialectId::Duckdb);
    assert_eq!(profile.dialect.family, DataSourceDialectFamily::Duckdb);
    assert_eq!(profile.dialect.version_probe, ServerVersionProbeId::None);
    assert_eq!(
        profile.file_connection.expect("duckdb file contract"),
        table_view_lib::models::FileConnectionContract {
            path_field: "database",
            read_only_field: "readOnly",
            permission_scope: FileConnectionPermissionScope::LocalFile,
            privacy_policy: FileConnectionPrivacyPolicyId::LocalFirst,
            supported_inputs: &[
                table_view_lib::models::FileConnectionInputContract {
                    id: "duckdb-database",
                    kind: FileConnectionInputKind::Database,
                    extensions: &[".duckdb"],
                    status: FileConnectionInputStatus::Supported,
                },
                table_view_lib::models::FileConnectionInputContract {
                    id: "csv",
                    kind: FileConnectionInputKind::Analytics,
                    extensions: &[".csv"],
                    status: FileConnectionInputStatus::Supported,
                },
                table_view_lib::models::FileConnectionInputContract {
                    id: "parquet",
                    kind: FileConnectionInputKind::Analytics,
                    extensions: &[".parquet"],
                    status: FileConnectionInputStatus::Supported,
                },
                table_view_lib::models::FileConnectionInputContract {
                    id: "json",
                    kind: FileConnectionInputKind::Analytics,
                    extensions: &[".json"],
                    status: FileConnectionInputStatus::Supported,
                },
                table_view_lib::models::FileConnectionInputContract {
                    id: "ndjson",
                    kind: FileConnectionInputKind::Analytics,
                    extensions: &[".ndjson"],
                    status: FileConnectionInputStatus::Supported,
                },
            ],
            deferred_inputs: &[],
        }
    );
    assert!(profile.has_backend_capability(BackendAdapterCapability::Lifecycle));
    assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalCatalog));
    assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
    assert!(!profile.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));
}

#[test]
fn rdbms_integration_gate_profiles_are_coherent() {
    assert_eq!(
        database_type_labels(RDBMS_DATABASE_TYPES),
        vec![
            "postgresql",
            "mysql",
            "mariadb",
            "sqlite",
            "duckdb",
            "mssql",
            "oracle",
        ]
    );
    assert_eq!(
        database_type_labels(RUNTIME_RDBMS_DATABASE_TYPES),
        vec!["postgresql", "mysql", "mariadb", "sqlite", "duckdb"]
    );
    assert_eq!(
        database_type_labels(SERVER_RDBMS_DATABASE_TYPES),
        vec!["postgresql", "mysql", "mariadb"]
    );
    assert_eq!(
        database_type_labels(FILE_RDBMS_DATABASE_TYPES),
        vec!["sqlite", "duckdb"]
    );

    for db_type in RUNTIME_RDBMS_DATABASE_TYPES {
        let profile = get_data_source_profile(db_type);

        assert_eq!(profile.paradigm, Paradigm::Rdb);
        assert_eq!(profile.languages, [QueryLanguageId::Sql]);
        assert_eq!(profile.catalog_model, CatalogModelKind::Rdb);
        assert_eq!(profile.result_kinds, [ResultEnvelopeKind::Tabular]);
        assert_eq!(profile.safety_policy, SafetyPolicyId::RdbDefault);
        assert_eq!(
            profile.adapter_contract.kind,
            BackendAdapterContractKind::Rdb
        );
        assert_eq!(
            profile.adapter_contract.state,
            BackendAdapterContractState::FactoryBacked
        );
        assert!(profile.has_backend_capability(BackendAdapterCapability::Lifecycle));
        assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalCatalog));
        assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
    }

    for db_type in [DatabaseType::Mssql, DatabaseType::Oracle] {
        let profile = get_data_source_profile(&db_type);

        assert_eq!(profile.paradigm, Paradigm::Rdb);
        assert_eq!(
            profile.adapter_contract.state,
            BackendAdapterContractState::DeclaredOnly
        );
        assert_eq!(profile.backend_adapter.id, BackendAdapterId::DeclaredRdb);
        assert_eq!(
            profile.backend_adapter.capability_source,
            BackendAdapterCapabilitySource::DeclaredRdb
        );
        assert!(!profile.has_backend_capability(BackendAdapterCapability::Lifecycle));
        assert!(!profile.has_backend_capability(BackendAdapterCapability::RelationalCatalog));
        assert!(!profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
        assert!(!profile.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));
    }
}

#[test]
fn mariadb_profile_keeps_identity_while_exposing_mysql_family_runtime_metadata() {
    let mysql = get_data_source_profile(&DatabaseType::Mysql);
    let mariadb = get_data_source_profile(&DatabaseType::Mariadb);

    assert_eq!(
        mem::discriminant(&mysql.id),
        mem::discriminant(&DatabaseType::Mysql)
    );
    assert_eq!(
        mem::discriminant(&mariadb.id),
        mem::discriminant(&DatabaseType::Mariadb)
    );
    assert_eq!(mariadb.adapter_contract, mysql.adapter_contract);
    assert_eq!(
        mariadb.adapter_contract.kind,
        BackendAdapterContractKind::Rdb
    );
    assert_eq!(
        mariadb.adapter_contract.state,
        BackendAdapterContractState::FactoryBacked
    );
    assert_eq!(mariadb.backend_adapter, mysql.backend_adapter);
    assert_eq!(mariadb.backend_adapter.id, BackendAdapterId::MysqlFamily);
    assert_eq!(
        mariadb.backend_adapter.kind,
        BackendAdapterContractKind::Rdb
    );
    assert_eq!(
        mariadb.backend_adapter.capability_source,
        BackendAdapterCapabilitySource::MysqlFamily
    );
    assert_eq!(mysql.dialect.id, DataSourceDialectId::Mysql);
    assert_eq!(mysql.dialect.family, DataSourceDialectFamily::Mysql);
    assert_eq!(
        mysql.dialect.version_probe,
        ServerVersionProbeId::MysqlFamilyVersion
    );
    assert_eq!(mariadb.dialect.id, DataSourceDialectId::Mariadb);
    assert_eq!(mariadb.dialect.family, DataSourceDialectFamily::Mysql);
    assert_eq!(
        mariadb.dialect.version_probe,
        ServerVersionProbeId::MysqlFamilyVersion
    );
}

#[test]
fn marker_contracts_remain_marker_only_for_deferred_adapter_families() {
    assert_eq!(
        KV_MARKER_CONTRACT.state,
        BackendAdapterContractState::MarkerOnly
    );
    assert!(!KV_MARKER_CONTRACT.has_capability(BackendAdapterCapability::KeyValueCatalog));
    assert!(!KV_MARKER_CONTRACT.has_capability(BackendAdapterCapability::KeyValueRead));
    assert!(!KV_MARKER_CONTRACT.has_capability(BackendAdapterCapability::KeyValueMutation));
    assert_eq!(
        SEARCH_MARKER_CONTRACT.kind,
        BackendAdapterContractKind::Search
    );
    assert_eq!(
        SEARCH_MARKER_CONTRACT.state,
        BackendAdapterContractState::MarkerOnly
    );
    assert!(SEARCH_MARKER_CONTRACT.has_capability(BackendAdapterCapability::SearchMarker));
}

#[test]
fn active_adapter_profile_resolves_from_kind_and_variant_contract_is_explicit() {
    let rdb = ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()));
    assert_eq!(rdb.adapter_contract_kind(), BackendAdapterContractKind::Rdb);
    assert_eq!(
        rdb.data_source_profile().adapter_contract.kind,
        BackendAdapterContractKind::Rdb
    );

    let document = ActiveAdapter::Document(Box::new(MongoAdapter::new()));
    assert_eq!(
        document.adapter_contract_kind(),
        BackendAdapterContractKind::Document
    );
    assert_eq!(
        document.data_source_profile().adapter_contract.kind,
        BackendAdapterContractKind::Document
    );

    let search = ActiveAdapter::Search(Box::new(StubSearchAdapter));
    assert_eq!(
        search.adapter_contract_kind(),
        BackendAdapterContractKind::Search
    );

    let kv = ActiveAdapter::Kv(Box::new(StubKvAdapter));
    assert_eq!(kv.adapter_contract_kind(), BackendAdapterContractKind::Kv);
}

#[test]
fn active_mariadb_adapter_reports_mariadb_profile_over_mysql_family_adapter() {
    let mariadb = ActiveAdapter::Rdb(Box::new(MysqlAdapter::new_mariadb()));
    let profile = mariadb.data_source_profile();

    assert_eq!(
        mem::discriminant(&mariadb.kind()),
        mem::discriminant(&DatabaseType::Mariadb)
    );
    assert_eq!(
        mem::discriminant(&profile.id),
        mem::discriminant(&DatabaseType::Mariadb)
    );
    assert_eq!(profile.backend_adapter.id, BackendAdapterId::MysqlFamily);
    assert_eq!(profile.dialect.id, DataSourceDialectId::Mariadb);
    assert_eq!(profile.dialect.family, DataSourceDialectFamily::Mysql);
}

struct StubSearchAdapter;

impl DbAdapter for StubSearchAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Postgresql
    }

    fn connect<'a>(&'a self, _config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
}

impl SearchAdapter for StubSearchAdapter {}

struct StubKvAdapter;

impl DbAdapter for StubKvAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Redis
    }

    fn connect<'a>(&'a self, _config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
}

impl KvAdapter for StubKvAdapter {}
