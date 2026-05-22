use std::mem;

use table_view_lib::{
    db::{
        ActiveAdapter, BoxFuture, DbAdapter, KvAdapter, MongoAdapter, PostgresAdapter,
        SearchAdapter,
    },
    error::AppError,
    models::{
        get_data_source_profile, BackendAdapterCapability, BackendAdapterContractKind,
        BackendAdapterContractState, CatalogModelKind, ConnectionConfig, ConnectionKind,
        DatabaseType, Paradigm, QueryLanguageId, ResultEnvelopeKind, SafetyPolicyId,
        KV_MARKER_CONTRACT, SEARCH_MARKER_CONTRACT,
    },
};

#[test]
fn backend_adapter_contract_profiles_are_encoded() {
    let all_database_types = [
        DatabaseType::Postgresql,
        DatabaseType::Mysql,
        DatabaseType::Mariadb,
        DatabaseType::Sqlite,
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
        assert!(profile.has_backend_capability(BackendAdapterCapability::Lifecycle));
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
    assert_eq!(redis.adapter_contract, KV_MARKER_CONTRACT);
    assert!(redis.has_backend_capability(BackendAdapterCapability::KeyValueMarker));
}

#[test]
fn marker_contracts_remain_marker_only_without_redis_or_search_implementation() {
    assert_eq!(
        KV_MARKER_CONTRACT.state,
        BackendAdapterContractState::MarkerOnly
    );
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
