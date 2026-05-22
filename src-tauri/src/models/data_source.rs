use super::{DatabaseType, Paradigm};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionKind {
    Server,
    File,
    Url,
    CloudApi,
    Cluster,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryLanguageId {
    Sql,
    Mongosh,
    RedisCommand,
    SearchDsl,
    Cql,
    Partiql,
    Cypher,
    Gql,
    Gremlin,
    VectorQuery,
    StreamCommand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogModelKind {
    Rdb,
    Document,
    Kv,
    Search,
    WideColumn,
    CloudDocument,
    Graph,
    Vector,
    Stream,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResultEnvelopeKind {
    Tabular,
    Document,
    KeyValue,
    SearchHits,
    Graph,
    VectorNeighbors,
    StreamRecords,
    Metrics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafetyPolicyId {
    RdbDefault,
    DocumentDefault,
    KvDefault,
    SearchDefault,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendAdapterContractKind {
    Rdb,
    Document,
    Search,
    Kv,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendAdapterContractState {
    FactoryBacked,
    DeclaredOnly,
    MarkerOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendAdapterCapability {
    Lifecycle,
    RelationalCatalog,
    RelationalQuery,
    RelationalSchemaMutation,
    DocumentCatalog,
    DocumentQuery,
    DocumentMutation,
    KeyValueMarker,
    SearchMarker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackendAdapterContract {
    pub kind: BackendAdapterContractKind,
    pub state: BackendAdapterContractState,
    pub capabilities: &'static [BackendAdapterCapability],
}

impl BackendAdapterContract {
    pub fn has_capability(&self, capability: BackendAdapterCapability) -> bool {
        self.capabilities.contains(&capability)
    }
}

#[derive(Debug, Clone)]
pub struct DataSourceProfile {
    pub id: DatabaseType,
    pub paradigm: Paradigm,
    pub connection_kind: ConnectionKind,
    pub languages: &'static [QueryLanguageId],
    pub catalog_model: CatalogModelKind,
    pub result_kinds: &'static [ResultEnvelopeKind],
    pub safety_policy: SafetyPolicyId,
    pub adapter_contract: BackendAdapterContract,
}

impl DataSourceProfile {
    pub fn has_backend_capability(&self, capability: BackendAdapterCapability) -> bool {
        self.adapter_contract.has_capability(capability)
    }
}

const SQL: &[QueryLanguageId] = &[QueryLanguageId::Sql];
const MONGOSH: &[QueryLanguageId] = &[QueryLanguageId::Mongosh];
const REDIS_COMMAND: &[QueryLanguageId] = &[QueryLanguageId::RedisCommand];

const TABULAR_RESULT: &[ResultEnvelopeKind] = &[ResultEnvelopeKind::Tabular];
const DOCUMENT_RESULTS: &[ResultEnvelopeKind] =
    &[ResultEnvelopeKind::Document, ResultEnvelopeKind::Tabular];
const KV_RESULTS: &[ResultEnvelopeKind] = &[
    ResultEnvelopeKind::KeyValue,
    ResultEnvelopeKind::StreamRecords,
];

const RDB_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::RelationalCatalog,
    BackendAdapterCapability::RelationalQuery,
    BackendAdapterCapability::RelationalSchemaMutation,
];
const DOCUMENT_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::DocumentCatalog,
    BackendAdapterCapability::DocumentQuery,
    BackendAdapterCapability::DocumentMutation,
];
const KV_MARKER_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::KeyValueMarker,
];
const SEARCH_MARKER_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::SearchMarker,
];

const FACTORY_RDB_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Rdb,
    state: BackendAdapterContractState::FactoryBacked,
    capabilities: RDB_CAPABILITIES,
};
const DECLARED_RDB_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Rdb,
    state: BackendAdapterContractState::DeclaredOnly,
    capabilities: RDB_CAPABILITIES,
};
const FACTORY_DOCUMENT_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Document,
    state: BackendAdapterContractState::FactoryBacked,
    capabilities: DOCUMENT_CAPABILITIES,
};
pub const KV_MARKER_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Kv,
    state: BackendAdapterContractState::MarkerOnly,
    capabilities: KV_MARKER_CAPABILITIES,
};
pub const SEARCH_MARKER_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Search,
    state: BackendAdapterContractState::MarkerOnly,
    capabilities: SEARCH_MARKER_CAPABILITIES,
};

pub fn get_data_source_profile(db_type: &DatabaseType) -> DataSourceProfile {
    match db_type {
        DatabaseType::Postgresql => rdb_profile(DatabaseType::Postgresql, FACTORY_RDB_CONTRACT),
        DatabaseType::Mysql => rdb_profile(DatabaseType::Mysql, FACTORY_RDB_CONTRACT),
        DatabaseType::Mariadb => rdb_profile(DatabaseType::Mariadb, FACTORY_RDB_CONTRACT),
        DatabaseType::Sqlite => DataSourceProfile {
            id: DatabaseType::Sqlite,
            paradigm: Paradigm::Rdb,
            connection_kind: ConnectionKind::File,
            languages: SQL,
            catalog_model: CatalogModelKind::Rdb,
            result_kinds: TABULAR_RESULT,
            safety_policy: SafetyPolicyId::RdbDefault,
            adapter_contract: FACTORY_RDB_CONTRACT,
        },
        DatabaseType::Mssql => rdb_profile(DatabaseType::Mssql, DECLARED_RDB_CONTRACT),
        DatabaseType::Oracle => rdb_profile(DatabaseType::Oracle, DECLARED_RDB_CONTRACT),
        DatabaseType::Mongodb => DataSourceProfile {
            id: DatabaseType::Mongodb,
            paradigm: Paradigm::Document,
            connection_kind: ConnectionKind::Server,
            languages: MONGOSH,
            catalog_model: CatalogModelKind::Document,
            result_kinds: DOCUMENT_RESULTS,
            safety_policy: SafetyPolicyId::DocumentDefault,
            adapter_contract: FACTORY_DOCUMENT_CONTRACT,
        },
        DatabaseType::Redis => DataSourceProfile {
            id: DatabaseType::Redis,
            paradigm: Paradigm::Kv,
            connection_kind: ConnectionKind::Server,
            languages: REDIS_COMMAND,
            catalog_model: CatalogModelKind::Kv,
            result_kinds: KV_RESULTS,
            safety_policy: SafetyPolicyId::KvDefault,
            adapter_contract: KV_MARKER_CONTRACT,
        },
    }
}

impl DatabaseType {
    pub fn data_source_profile(&self) -> DataSourceProfile {
        get_data_source_profile(self)
    }
}

fn rdb_profile(id: DatabaseType, adapter_contract: BackendAdapterContract) -> DataSourceProfile {
    DataSourceProfile {
        id,
        paradigm: Paradigm::Rdb,
        connection_kind: ConnectionKind::Server,
        languages: SQL,
        catalog_model: CatalogModelKind::Rdb,
        result_kinds: TABULAR_RESULT,
        safety_policy: SafetyPolicyId::RdbDefault,
        adapter_contract,
    }
}
