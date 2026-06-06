use super::*;

#[test]
fn redis_profile_declares_value_and_stream_result_support() {
    let profile = DatabaseType::Redis.data_source_profile();

    assert_eq!(profile.paradigm, Paradigm::Kv);
    assert_eq!(
        profile.result_kinds,
        &[
            ResultEnvelopeKind::KeyValue,
            ResultEnvelopeKind::StreamRecords,
            ResultEnvelopeKind::Tabular
        ]
    );
    assert!(profile.has_backend_capability(BackendAdapterCapability::KeyValueCatalog));
    assert!(profile.has_backend_capability(BackendAdapterCapability::KeyValueRead));
    assert!(profile.has_backend_capability(BackendAdapterCapability::KeyValueMutation));
    assert!(!profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
}

#[test]
fn profile_matrix_covers_factory_backed_mssql_and_oracle_contracts() {
    for (db_type, dialect, version_probe, implementation) in [
        (
            DatabaseType::Mssql,
            DataSourceDialectId::Mssql,
            ServerVersionProbeId::MssqlServerProperty,
            BackendAdapterId::Mssql,
        ),
        (
            DatabaseType::Oracle,
            DataSourceDialectId::Oracle,
            ServerVersionProbeId::OracleVVersion,
            BackendAdapterId::Oracle,
        ),
    ] {
        let profile = db_type.data_source_profile();

        assert_eq!(
            std::mem::discriminant(&profile.id),
            std::mem::discriminant(&db_type)
        );
        assert_eq!(profile.paradigm, Paradigm::Rdb);
        assert_eq!(profile.connection_kind, ConnectionKind::Server);
        assert_eq!(profile.languages, SQL);
        assert_eq!(profile.catalog_model, CatalogModelKind::Rdb);
        assert_eq!(profile.result_kinds, TABULAR_RESULT);
        assert_eq!(profile.safety_policy, SafetyPolicyId::RdbDefault);
        assert_eq!(profile.dialect.id, dialect);
        assert_eq!(profile.dialect.version_probe, version_probe);
        assert_eq!(profile.backend_adapter.id, implementation);
        assert_eq!(
            profile.adapter_contract.state,
            BackendAdapterContractState::FactoryBacked
        );
        assert!(profile.file_connection.is_none());
        assert!(profile.has_backend_capability(BackendAdapterCapability::Lifecycle));
        assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalCatalog));
        assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
        assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));
        assert!(!profile.has_backend_capability(BackendAdapterCapability::DocumentQuery));
    }
}

#[test]
fn profile_matrix_covers_existing_server_rdb_dialects() {
    for (db_type, dialect, family, version_probe, implementation) in [
        (
            DatabaseType::Postgresql,
            DataSourceDialectId::Postgresql,
            DataSourceDialectFamily::Postgres,
            ServerVersionProbeId::PostgresVersionSettings,
            BackendAdapterId::Postgresql,
        ),
        (
            DatabaseType::Mysql,
            DataSourceDialectId::Mysql,
            DataSourceDialectFamily::Mysql,
            ServerVersionProbeId::MysqlFamilyVersion,
            BackendAdapterId::MysqlFamily,
        ),
        (
            DatabaseType::Mariadb,
            DataSourceDialectId::Mariadb,
            DataSourceDialectFamily::Mysql,
            ServerVersionProbeId::MysqlFamilyVersion,
            BackendAdapterId::MysqlFamily,
        ),
    ] {
        let profile = db_type.data_source_profile();

        assert_eq!(profile.paradigm, Paradigm::Rdb);
        assert_eq!(profile.connection_kind, ConnectionKind::Server);
        assert_eq!(profile.languages, SQL);
        assert_eq!(profile.dialect.id, dialect);
        assert_eq!(profile.dialect.family, family);
        assert_eq!(profile.dialect.version_probe, version_probe);
        assert_eq!(profile.backend_adapter.id, implementation);
        assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
        assert!(profile.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));
    }
}

#[test]
fn profile_matrix_covers_file_document_kv_and_search_shapes() {
    let sqlite = DatabaseType::Sqlite.data_source_profile();
    assert_eq!(sqlite.connection_kind, ConnectionKind::File);
    assert_eq!(
        sqlite.dialect.version_probe,
        ServerVersionProbeId::SqliteVersion
    );
    assert!(sqlite.file_connection.unwrap().supported_inputs[0]
        .extensions
        .contains(&".sqlite"));
    assert!(!sqlite.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));

    let duckdb = DatabaseType::Duckdb.data_source_profile();
    assert_eq!(duckdb.connection_kind, ConnectionKind::File);
    assert_eq!(duckdb.dialect.version_probe, ServerVersionProbeId::None);
    assert_eq!(
        duckdb.file_connection.unwrap().supported_inputs[1].kind,
        FileConnectionInputKind::Analytics
    );

    let mongo = DatabaseType::Mongodb.data_source_profile();
    assert_eq!(mongo.paradigm, Paradigm::Document);
    assert_eq!(mongo.catalog_model, CatalogModelKind::Document);
    assert!(mongo.has_backend_capability(BackendAdapterCapability::DocumentMutation));

    let valkey = DatabaseType::Valkey.data_source_profile();
    assert_eq!(valkey.paradigm, Paradigm::Kv);
    assert!(valkey.has_backend_capability(BackendAdapterCapability::KeyValueRead));
    assert!(!valkey.has_backend_capability(BackendAdapterCapability::KeyValueMutation));

    for db_type in [DatabaseType::Elasticsearch, DatabaseType::Opensearch] {
        let profile = get_data_source_profile(&db_type);
        assert_eq!(profile.paradigm, Paradigm::Search);
        assert_eq!(profile.languages, SEARCH_DSL);
        assert_eq!(profile.result_kinds, SEARCH_RESULTS);
        assert!(profile.has_backend_capability(BackendAdapterCapability::SearchSafetyPlan));
    }
}
