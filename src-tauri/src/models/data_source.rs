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
pub enum FileConnectionPermissionScope {
    LocalFile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileConnectionPrivacyPolicyId {
    LocalFirst,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileConnectionInputKind {
    Database,
    Analytics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileConnectionInputStatus {
    Supported,
    Deferred,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileConnectionInputContract {
    pub id: &'static str,
    pub kind: FileConnectionInputKind,
    pub extensions: &'static [&'static str],
    pub status: FileConnectionInputStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileConnectionContract {
    pub path_field: &'static str,
    pub read_only_field: &'static str,
    pub permission_scope: FileConnectionPermissionScope,
    pub privacy_policy: FileConnectionPrivacyPolicyId,
    pub supported_inputs: &'static [FileConnectionInputContract],
    pub deferred_inputs: &'static [FileConnectionInputContract],
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
pub enum BackendAdapterId {
    Postgresql,
    MysqlFamily,
    Sqlite,
    Duckdb,
    Mssql,
    Oracle,
    Mongodb,
    Redis,
    Valkey,
    DeclaredRdb,
    SearchEngine,
    Marker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendAdapterCapabilitySource {
    Postgresql,
    MysqlFamily,
    Sqlite,
    Duckdb,
    Mssql,
    Oracle,
    Mongodb,
    Redis,
    Valkey,
    DeclaredRdb,
    SearchEngine,
    Marker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackendAdapterProfile {
    pub id: BackendAdapterId,
    pub kind: BackendAdapterContractKind,
    pub capability_source: BackendAdapterCapabilitySource,
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
    KeyValueCatalog,
    KeyValueRead,
    KeyValueMutation,
    SearchMarker,
    SearchCatalog,
    SearchQuery,
    SearchSafetyPlan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackendAdapterContract {
    pub kind: BackendAdapterContractKind,
    pub state: BackendAdapterContractState,
    pub implementation: BackendAdapterId,
    pub capability_source: BackendAdapterCapabilitySource,
    pub capabilities: &'static [BackendAdapterCapability],
}

impl BackendAdapterContract {
    pub fn has_capability(&self, capability: BackendAdapterCapability) -> bool {
        self.capabilities.contains(&capability)
    }

    pub fn profile(&self) -> BackendAdapterProfile {
        BackendAdapterProfile {
            id: self.implementation,
            kind: self.kind,
            capability_source: self.capability_source,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataSourceDialectId {
    Postgresql,
    Mysql,
    Mariadb,
    Sqlite,
    Duckdb,
    Mssql,
    Oracle,
    Mongodb,
    Redis,
    Valkey,
    Elasticsearch,
    Opensearch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataSourceDialectFamily {
    Postgres,
    Mysql,
    Sqlite,
    Duckdb,
    Mssql,
    Oracle,
    Mongodb,
    Redis,
    Valkey,
    Elasticsearch,
    Opensearch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerVersionProbeId {
    PostgresVersionSettings,
    MysqlFamilyVersion,
    SqliteVersion,
    MssqlServerProperty,
    MongodbBuildInfo,
    SearchRoot,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DataSourceDialectMetadata {
    pub id: DataSourceDialectId,
    pub family: DataSourceDialectFamily,
    pub version_probe: ServerVersionProbeId,
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
    pub backend_adapter: BackendAdapterProfile,
    pub dialect: DataSourceDialectMetadata,
    pub adapter_contract: BackendAdapterContract,
    pub file_connection: Option<FileConnectionContract>,
}

impl DataSourceProfile {
    pub fn has_backend_capability(&self, capability: BackendAdapterCapability) -> bool {
        self.adapter_contract.has_capability(capability)
    }
}

const SQL: &[QueryLanguageId] = &[QueryLanguageId::Sql];
const MONGOSH: &[QueryLanguageId] = &[QueryLanguageId::Mongosh];
const REDIS_COMMAND: &[QueryLanguageId] = &[QueryLanguageId::RedisCommand];
const SEARCH_DSL: &[QueryLanguageId] = &[QueryLanguageId::SearchDsl];

const TABULAR_RESULT: &[ResultEnvelopeKind] = &[ResultEnvelopeKind::Tabular];
const DOCUMENT_RESULTS: &[ResultEnvelopeKind] =
    &[ResultEnvelopeKind::Document, ResultEnvelopeKind::Tabular];
const KV_RESULTS: &[ResultEnvelopeKind] = &[
    ResultEnvelopeKind::KeyValue,
    ResultEnvelopeKind::StreamRecords,
    ResultEnvelopeKind::Tabular,
];
const SEARCH_RESULTS: &[ResultEnvelopeKind] = &[ResultEnvelopeKind::SearchHits];

const RDB_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::RelationalCatalog,
    BackendAdapterCapability::RelationalQuery,
    BackendAdapterCapability::RelationalSchemaMutation,
];
const SQLITE_RDB_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::RelationalCatalog,
    BackendAdapterCapability::RelationalQuery,
];
const DUCKDB_RDB_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::RelationalCatalog,
    BackendAdapterCapability::RelationalQuery,
];
const MSSQL_QUERY_RDB_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::RelationalQuery,
];
const ORACLE_QUERY_RDB_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::RelationalQuery,
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
const REDIS_KV_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::KeyValueCatalog,
    BackendAdapterCapability::KeyValueRead,
    BackendAdapterCapability::KeyValueMutation,
];
const VALKEY_KV_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::KeyValueCatalog,
    BackendAdapterCapability::KeyValueRead,
];
const SEARCH_MARKER_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::SearchMarker,
];
const SEARCH_ENGINE_CAPABILITIES: &[BackendAdapterCapability] = &[
    BackendAdapterCapability::Lifecycle,
    BackendAdapterCapability::SearchCatalog,
    BackendAdapterCapability::SearchQuery,
    BackendAdapterCapability::SearchSafetyPlan,
];

const POSTGRES_RDB_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Rdb,
    state: BackendAdapterContractState::FactoryBacked,
    implementation: BackendAdapterId::Postgresql,
    capability_source: BackendAdapterCapabilitySource::Postgresql,
    capabilities: RDB_CAPABILITIES,
};
const MYSQL_FAMILY_RDB_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Rdb,
    state: BackendAdapterContractState::FactoryBacked,
    implementation: BackendAdapterId::MysqlFamily,
    capability_source: BackendAdapterCapabilitySource::MysqlFamily,
    capabilities: RDB_CAPABILITIES,
};
const SQLITE_RDB_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Rdb,
    state: BackendAdapterContractState::FactoryBacked,
    implementation: BackendAdapterId::Sqlite,
    capability_source: BackendAdapterCapabilitySource::Sqlite,
    capabilities: SQLITE_RDB_CAPABILITIES,
};
const DUCKDB_FILE_RDB_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Rdb,
    state: BackendAdapterContractState::FactoryBacked,
    implementation: BackendAdapterId::Duckdb,
    capability_source: BackendAdapterCapabilitySource::Duckdb,
    capabilities: DUCKDB_RDB_CAPABILITIES,
};
const MSSQL_QUERY_RDB_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Rdb,
    state: BackendAdapterContractState::FactoryBacked,
    implementation: BackendAdapterId::Mssql,
    capability_source: BackendAdapterCapabilitySource::Mssql,
    capabilities: MSSQL_QUERY_RDB_CAPABILITIES,
};
const ORACLE_QUERY_RDB_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Rdb,
    state: BackendAdapterContractState::FactoryBacked,
    implementation: BackendAdapterId::Oracle,
    capability_source: BackendAdapterCapabilitySource::Oracle,
    capabilities: ORACLE_QUERY_RDB_CAPABILITIES,
};
const FACTORY_DOCUMENT_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Document,
    state: BackendAdapterContractState::FactoryBacked,
    implementation: BackendAdapterId::Mongodb,
    capability_source: BackendAdapterCapabilitySource::Mongodb,
    capabilities: DOCUMENT_CAPABILITIES,
};
const FACTORY_REDIS_KV_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Kv,
    state: BackendAdapterContractState::FactoryBacked,
    implementation: BackendAdapterId::Redis,
    capability_source: BackendAdapterCapabilitySource::Redis,
    capabilities: REDIS_KV_CAPABILITIES,
};
const FACTORY_VALKEY_KV_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Kv,
    state: BackendAdapterContractState::FactoryBacked,
    implementation: BackendAdapterId::Valkey,
    capability_source: BackendAdapterCapabilitySource::Valkey,
    capabilities: VALKEY_KV_CAPABILITIES,
};
pub const KV_MARKER_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Kv,
    state: BackendAdapterContractState::MarkerOnly,
    implementation: BackendAdapterId::Marker,
    capability_source: BackendAdapterCapabilitySource::Marker,
    capabilities: KV_MARKER_CAPABILITIES,
};
pub const SEARCH_MARKER_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Search,
    state: BackendAdapterContractState::MarkerOnly,
    implementation: BackendAdapterId::Marker,
    capability_source: BackendAdapterCapabilitySource::Marker,
    capabilities: SEARCH_MARKER_CAPABILITIES,
};
pub const SEARCH_ENGINE_CONTRACT: BackendAdapterContract = BackendAdapterContract {
    kind: BackendAdapterContractKind::Search,
    state: BackendAdapterContractState::FactoryBacked,
    implementation: BackendAdapterId::SearchEngine,
    capability_source: BackendAdapterCapabilitySource::SearchEngine,
    capabilities: SEARCH_ENGINE_CAPABILITIES,
};

const SQLITE_SUPPORTED_FILE_INPUTS: &[FileConnectionInputContract] =
    &[FileConnectionInputContract {
        id: "sqlite-database",
        kind: FileConnectionInputKind::Database,
        extensions: &[".sqlite", ".sqlite3", ".db"],
        status: FileConnectionInputStatus::Supported,
    }];
const SQLITE_FILE_CONNECTION: FileConnectionContract = FileConnectionContract {
    path_field: "database",
    read_only_field: "readOnly",
    permission_scope: FileConnectionPermissionScope::LocalFile,
    privacy_policy: FileConnectionPrivacyPolicyId::LocalFirst,
    supported_inputs: SQLITE_SUPPORTED_FILE_INPUTS,
    deferred_inputs: &[],
};

const DUCKDB_SUPPORTED_FILE_INPUTS: &[FileConnectionInputContract] = &[
    FileConnectionInputContract {
        id: "duckdb-database",
        kind: FileConnectionInputKind::Database,
        extensions: &[".duckdb"],
        status: FileConnectionInputStatus::Supported,
    },
    FileConnectionInputContract {
        id: "csv",
        kind: FileConnectionInputKind::Analytics,
        extensions: &[".csv"],
        status: FileConnectionInputStatus::Supported,
    },
    FileConnectionInputContract {
        id: "parquet",
        kind: FileConnectionInputKind::Analytics,
        extensions: &[".parquet"],
        status: FileConnectionInputStatus::Supported,
    },
    FileConnectionInputContract {
        id: "json",
        kind: FileConnectionInputKind::Analytics,
        extensions: &[".json"],
        status: FileConnectionInputStatus::Supported,
    },
    FileConnectionInputContract {
        id: "ndjson",
        kind: FileConnectionInputKind::Analytics,
        extensions: &[".ndjson"],
        status: FileConnectionInputStatus::Supported,
    },
];
const DUCKDB_DEFERRED_FILE_INPUTS: &[FileConnectionInputContract] = &[];
const DUCKDB_FILE_CONNECTION: FileConnectionContract = FileConnectionContract {
    path_field: "database",
    read_only_field: "readOnly",
    permission_scope: FileConnectionPermissionScope::LocalFile,
    privacy_policy: FileConnectionPrivacyPolicyId::LocalFirst,
    supported_inputs: DUCKDB_SUPPORTED_FILE_INPUTS,
    deferred_inputs: DUCKDB_DEFERRED_FILE_INPUTS,
};

const POSTGRES_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Postgresql,
    family: DataSourceDialectFamily::Postgres,
    version_probe: ServerVersionProbeId::PostgresVersionSettings,
};
const MYSQL_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Mysql,
    family: DataSourceDialectFamily::Mysql,
    version_probe: ServerVersionProbeId::MysqlFamilyVersion,
};
const MARIADB_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Mariadb,
    family: DataSourceDialectFamily::Mysql,
    version_probe: ServerVersionProbeId::MysqlFamilyVersion,
};
const SQLITE_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Sqlite,
    family: DataSourceDialectFamily::Sqlite,
    version_probe: ServerVersionProbeId::SqliteVersion,
};
const DUCKDB_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Duckdb,
    family: DataSourceDialectFamily::Duckdb,
    version_probe: ServerVersionProbeId::None,
};
const MSSQL_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Mssql,
    family: DataSourceDialectFamily::Mssql,
    version_probe: ServerVersionProbeId::MssqlServerProperty,
};
const ORACLE_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Oracle,
    family: DataSourceDialectFamily::Oracle,
    version_probe: ServerVersionProbeId::None,
};
const MONGODB_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Mongodb,
    family: DataSourceDialectFamily::Mongodb,
    version_probe: ServerVersionProbeId::MongodbBuildInfo,
};
const REDIS_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Redis,
    family: DataSourceDialectFamily::Redis,
    version_probe: ServerVersionProbeId::None,
};
const VALKEY_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Valkey,
    family: DataSourceDialectFamily::Valkey,
    version_probe: ServerVersionProbeId::None,
};
const ELASTICSEARCH_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Elasticsearch,
    family: DataSourceDialectFamily::Elasticsearch,
    version_probe: ServerVersionProbeId::SearchRoot,
};
const OPENSEARCH_DIALECT: DataSourceDialectMetadata = DataSourceDialectMetadata {
    id: DataSourceDialectId::Opensearch,
    family: DataSourceDialectFamily::Opensearch,
    version_probe: ServerVersionProbeId::SearchRoot,
};

pub fn get_data_source_profile(db_type: &DatabaseType) -> DataSourceProfile {
    match db_type {
        DatabaseType::Postgresql => rdb_profile(
            DatabaseType::Postgresql,
            POSTGRES_RDB_CONTRACT,
            POSTGRES_DIALECT,
        ),
        DatabaseType::Mysql => rdb_profile(
            DatabaseType::Mysql,
            MYSQL_FAMILY_RDB_CONTRACT,
            MYSQL_DIALECT,
        ),
        DatabaseType::Mariadb => rdb_profile(
            DatabaseType::Mariadb,
            MYSQL_FAMILY_RDB_CONTRACT,
            MARIADB_DIALECT,
        ),
        DatabaseType::Sqlite => DataSourceProfile {
            id: DatabaseType::Sqlite,
            paradigm: Paradigm::Rdb,
            connection_kind: ConnectionKind::File,
            languages: SQL,
            catalog_model: CatalogModelKind::Rdb,
            result_kinds: TABULAR_RESULT,
            safety_policy: SafetyPolicyId::RdbDefault,
            backend_adapter: SQLITE_RDB_CONTRACT.profile(),
            dialect: SQLITE_DIALECT,
            adapter_contract: SQLITE_RDB_CONTRACT,
            file_connection: Some(SQLITE_FILE_CONNECTION),
        },
        DatabaseType::Duckdb => DataSourceProfile {
            id: DatabaseType::Duckdb,
            paradigm: Paradigm::Rdb,
            connection_kind: ConnectionKind::File,
            languages: SQL,
            catalog_model: CatalogModelKind::Rdb,
            result_kinds: TABULAR_RESULT,
            safety_policy: SafetyPolicyId::RdbDefault,
            backend_adapter: DUCKDB_FILE_RDB_CONTRACT.profile(),
            dialect: DUCKDB_DIALECT,
            adapter_contract: DUCKDB_FILE_RDB_CONTRACT,
            file_connection: Some(DUCKDB_FILE_CONNECTION),
        },
        DatabaseType::Mssql => {
            rdb_profile(DatabaseType::Mssql, MSSQL_QUERY_RDB_CONTRACT, MSSQL_DIALECT)
        }
        DatabaseType::Oracle => rdb_profile(
            DatabaseType::Oracle,
            ORACLE_QUERY_RDB_CONTRACT,
            ORACLE_DIALECT,
        ),
        DatabaseType::Mongodb => DataSourceProfile {
            id: DatabaseType::Mongodb,
            paradigm: Paradigm::Document,
            connection_kind: ConnectionKind::Server,
            languages: MONGOSH,
            catalog_model: CatalogModelKind::Document,
            result_kinds: DOCUMENT_RESULTS,
            safety_policy: SafetyPolicyId::DocumentDefault,
            backend_adapter: FACTORY_DOCUMENT_CONTRACT.profile(),
            dialect: MONGODB_DIALECT,
            adapter_contract: FACTORY_DOCUMENT_CONTRACT,
            file_connection: None,
        },
        DatabaseType::Redis => DataSourceProfile {
            id: DatabaseType::Redis,
            paradigm: Paradigm::Kv,
            connection_kind: ConnectionKind::Server,
            languages: REDIS_COMMAND,
            catalog_model: CatalogModelKind::Kv,
            result_kinds: KV_RESULTS,
            safety_policy: SafetyPolicyId::KvDefault,
            backend_adapter: FACTORY_REDIS_KV_CONTRACT.profile(),
            dialect: REDIS_DIALECT,
            adapter_contract: FACTORY_REDIS_KV_CONTRACT,
            file_connection: None,
        },
        DatabaseType::Valkey => DataSourceProfile {
            id: DatabaseType::Valkey,
            paradigm: Paradigm::Kv,
            connection_kind: ConnectionKind::Server,
            languages: REDIS_COMMAND,
            catalog_model: CatalogModelKind::Kv,
            result_kinds: KV_RESULTS,
            safety_policy: SafetyPolicyId::KvDefault,
            backend_adapter: FACTORY_VALKEY_KV_CONTRACT.profile(),
            dialect: VALKEY_DIALECT,
            adapter_contract: FACTORY_VALKEY_KV_CONTRACT,
            file_connection: None,
        },
        DatabaseType::Elasticsearch => {
            search_profile(DatabaseType::Elasticsearch, ELASTICSEARCH_DIALECT)
        }
        DatabaseType::Opensearch => search_profile(DatabaseType::Opensearch, OPENSEARCH_DIALECT),
    }
}

impl DatabaseType {
    pub fn data_source_profile(&self) -> DataSourceProfile {
        get_data_source_profile(self)
    }
}

fn rdb_profile(
    id: DatabaseType,
    adapter_contract: BackendAdapterContract,
    dialect: DataSourceDialectMetadata,
) -> DataSourceProfile {
    DataSourceProfile {
        id,
        paradigm: Paradigm::Rdb,
        connection_kind: ConnectionKind::Server,
        languages: SQL,
        catalog_model: CatalogModelKind::Rdb,
        result_kinds: TABULAR_RESULT,
        safety_policy: SafetyPolicyId::RdbDefault,
        backend_adapter: adapter_contract.profile(),
        dialect,
        adapter_contract,
        file_connection: None,
    }
}

fn search_profile(id: DatabaseType, dialect: DataSourceDialectMetadata) -> DataSourceProfile {
    DataSourceProfile {
        id,
        paradigm: Paradigm::Search,
        connection_kind: ConnectionKind::Server,
        languages: SEARCH_DSL,
        catalog_model: CatalogModelKind::Search,
        result_kinds: SEARCH_RESULTS,
        safety_policy: SafetyPolicyId::SearchDefault,
        backend_adapter: SEARCH_ENGINE_CONTRACT.profile(),
        dialect,
        adapter_contract: SEARCH_ENGINE_CONTRACT,
        file_connection: None,
    }
}

#[cfg(test)]
mod tests {
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
}
