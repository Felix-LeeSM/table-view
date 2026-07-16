use std::collections::BTreeMap;

use serde::Deserialize;
use table_view_lib::models::{
    get_data_source_profile, BackendAdapterCapability, BackendAdapterCapabilitySource,
    BackendAdapterContractKind, BackendAdapterId, CatalogModelKind, ConnectionKind,
    DataSourceDialectFamily, DataSourceDialectId, DataSourceProfile, DatabaseType,
    FileConnectionContract, FileConnectionInputContract, FileConnectionInputKind,
    FileConnectionInputStatus, FileConnectionPermissionScope, FileConnectionPrivacyPolicyId,
    Paradigm, QueryLanguageId, ResultEnvelopeKind, SafetyPolicyId, ServerVersionProbeId,
};

const PROFILE_PARITY_REPORT: &str =
    include_str!("../../tests/fixtures/data-source-profile-parity.report.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileParityReport {
    report_version: u8,
    runtime_claim_boundary: RuntimeClaimBoundary,
    capability_posture: BTreeMap<String, CapabilityPosture>,
    profiles: BTreeMap<String, ComparableProfile>,
}

// Coarse write posture derived from the raw capability declarations on each
// side (#1045). The raw vocabularies diverge per paradigm (Rust
// adapter_contract capabilities vs TS fine-grained UI flags), so only this
// derived posture is cross-checked, not the raw flags. `schemaMutation` mirrors
// Rust `RelationalSchemaMutation` (the #1044 SQLite-DDL drift class);
// `dataMutation` mirrors Rust `DocumentMutation`/`KeyValueMutation`.
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CapabilityPosture {
    schema_mutation: bool,
    data_mutation: bool,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeClaimBoundary {
    profile_presence_is_runtime_support_claim: bool,
    runtime_support_gate: String,
    excluded_from_strict_parity: Vec<String>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ComparableProfile {
    id: String,
    paradigm: String,
    connection_kind: String,
    languages: Vec<String>,
    catalog_model: String,
    result_kinds: Vec<String>,
    safety_policy: String,
    backend_adapter: ComparableBackendAdapter,
    dialect: ComparableDialect,
    file_connection: Option<ComparableFileConnection>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ComparableBackendAdapter {
    id: String,
    kind: String,
    capability_source: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ComparableDialect {
    id: String,
    family: String,
    version_probe: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ComparableFileConnection {
    path_field: String,
    read_only_field: String,
    permission_scope: String,
    privacy_policy: String,
    supported_inputs: Vec<ComparableFileConnectionInput>,
    deferred_inputs: Vec<ComparableFileConnectionInput>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ComparableFileConnectionInput {
    id: String,
    kind: String,
    extensions: Vec<String>,
    status: String,
}

#[test]
fn profile_registry_matches_ts_rust_strict_parity_report() {
    let report = load_profile_parity_report();
    let actual_profiles = all_database_types()
        .into_iter()
        .map(|db_type| {
            let profile = get_data_source_profile(&db_type);
            (
                database_type_label(&db_type).to_string(),
                comparable_profile(&profile),
            )
        })
        .collect::<BTreeMap<_, _>>();

    let actual_posture = all_database_types()
        .into_iter()
        .map(|db_type| {
            (
                database_type_label(&db_type).to_string(),
                capability_posture(&get_data_source_profile(&db_type)),
            )
        })
        .collect::<BTreeMap<_, _>>();

    assert_eq!(report.report_version, 1);
    assert_eq!(report.runtime_claim_boundary, runtime_claim_boundary());
    assert_eq!(actual_profiles, report.profiles);
    assert_eq!(actual_posture, report.capability_posture);
}

fn capability_posture(profile: &DataSourceProfile) -> CapabilityPosture {
    CapabilityPosture {
        schema_mutation: profile
            .has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation),
        data_mutation: profile.has_backend_capability(BackendAdapterCapability::DocumentMutation)
            || profile.has_backend_capability(BackendAdapterCapability::KeyValueMutation),
    }
}

fn load_profile_parity_report() -> ProfileParityReport {
    serde_json::from_str(PROFILE_PARITY_REPORT).expect("profile parity report must parse")
}

fn runtime_claim_boundary() -> RuntimeClaimBoundary {
    RuntimeClaimBoundary {
        profile_presence_is_runtime_support_claim: false,
        runtime_support_gate: "TS capabilities.connection.test plus adapter conformance claims; Rust adapter_contract remains backend runtime posture evidence.".to_string(),
        excluded_from_strict_parity: vec![
            "ts.capabilities".to_string(),
            "rust.adapter_contract".to_string(),
        ],
    }
}

fn all_database_types() -> [DatabaseType; 12] {
    [
        DatabaseType::Postgresql,
        DatabaseType::Mysql,
        DatabaseType::Mariadb,
        DatabaseType::Sqlite,
        DatabaseType::Duckdb,
        DatabaseType::Mssql,
        DatabaseType::Oracle,
        DatabaseType::Mongodb,
        DatabaseType::Redis,
        DatabaseType::Valkey,
        DatabaseType::Elasticsearch,
        DatabaseType::Opensearch,
    ]
}

fn comparable_profile(profile: &DataSourceProfile) -> ComparableProfile {
    ComparableProfile {
        id: database_type_label(&profile.id).to_string(),
        paradigm: paradigm_label(profile.paradigm).to_string(),
        connection_kind: connection_kind_label(profile.connection_kind).to_string(),
        languages: sorted_strings(
            profile
                .languages
                .iter()
                .map(|language| query_language_label(*language).to_string())
                .collect(),
        ),
        catalog_model: catalog_model_label(profile.catalog_model).to_string(),
        result_kinds: sorted_strings(
            profile
                .result_kinds
                .iter()
                .map(|result_kind| result_envelope_label(*result_kind).to_string())
                .collect(),
        ),
        safety_policy: safety_policy_label(profile.safety_policy).to_string(),
        backend_adapter: ComparableBackendAdapter {
            id: backend_adapter_id_label(profile.backend_adapter.id).to_string(),
            kind: backend_adapter_kind_label(profile.backend_adapter.kind).to_string(),
            capability_source: backend_adapter_capability_source_label(
                profile.backend_adapter.capability_source,
            )
            .to_string(),
        },
        dialect: ComparableDialect {
            id: dialect_id_label(profile.dialect.id).to_string(),
            family: dialect_family_label(profile.dialect.family).to_string(),
            version_probe: version_probe_label(profile.dialect.version_probe).to_string(),
        },
        file_connection: profile.file_connection.map(comparable_file_connection),
    }
}

fn comparable_file_connection(file_connection: FileConnectionContract) -> ComparableFileConnection {
    ComparableFileConnection {
        path_field: file_connection.path_field.to_string(),
        read_only_field: file_connection.read_only_field.to_string(),
        permission_scope: file_connection_permission_scope_label(file_connection.permission_scope)
            .to_string(),
        privacy_policy: file_connection_privacy_policy_label(file_connection.privacy_policy)
            .to_string(),
        supported_inputs: comparable_file_connection_inputs(file_connection.supported_inputs),
        deferred_inputs: comparable_file_connection_inputs(file_connection.deferred_inputs),
    }
}

fn comparable_file_connection_inputs(
    inputs: &[FileConnectionInputContract],
) -> Vec<ComparableFileConnectionInput> {
    let mut comparable_inputs = inputs
        .iter()
        .map(|input| ComparableFileConnectionInput {
            id: input.id.to_string(),
            kind: file_connection_input_kind_label(input.kind).to_string(),
            extensions: sorted_strings(
                input
                    .extensions
                    .iter()
                    .map(|extension| extension.to_string())
                    .collect(),
            ),
            status: file_connection_input_status_label(input.status).to_string(),
        })
        .collect::<Vec<_>>();
    comparable_inputs.sort_by(|left, right| left.id.cmp(&right.id));
    comparable_inputs
}

fn sorted_strings(mut values: Vec<String>) -> Vec<String> {
    values.sort();
    values
}

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
        DatabaseType::Valkey => "valkey",
        DatabaseType::Elasticsearch => "elasticsearch",
        DatabaseType::Opensearch => "opensearch",
    }
}

fn paradigm_label(paradigm: Paradigm) -> &'static str {
    match paradigm {
        Paradigm::Rdb => "rdb",
        Paradigm::Document => "document",
        Paradigm::Search => "search",
        Paradigm::Kv => "kv",
    }
}

fn connection_kind_label(connection_kind: ConnectionKind) -> &'static str {
    match connection_kind {
        ConnectionKind::Server => "server",
        ConnectionKind::File => "file",
        ConnectionKind::Url => "url",
        ConnectionKind::CloudApi => "cloud-api",
        ConnectionKind::Cluster => "cluster",
    }
}

fn query_language_label(language: QueryLanguageId) -> &'static str {
    match language {
        QueryLanguageId::Sql => "sql",
        QueryLanguageId::Mongosh => "mongosh",
        QueryLanguageId::RedisCommand => "redis-command",
        QueryLanguageId::SearchDsl => "search-dsl",
        QueryLanguageId::Cql => "cql",
        QueryLanguageId::Partiql => "partiql",
        QueryLanguageId::Cypher => "cypher",
        QueryLanguageId::Gql => "gql",
        QueryLanguageId::Gremlin => "gremlin",
        QueryLanguageId::VectorQuery => "vector-query",
        QueryLanguageId::StreamCommand => "stream-command",
    }
}

fn catalog_model_label(catalog_model: CatalogModelKind) -> &'static str {
    match catalog_model {
        CatalogModelKind::Rdb => "rdb",
        CatalogModelKind::Document => "document",
        CatalogModelKind::Kv => "kv",
        CatalogModelKind::Search => "search",
        CatalogModelKind::WideColumn => "wide-column",
        CatalogModelKind::CloudDocument => "cloud-document",
        CatalogModelKind::Graph => "graph",
        CatalogModelKind::Vector => "vector",
        CatalogModelKind::Stream => "stream",
    }
}

fn result_envelope_label(result_kind: ResultEnvelopeKind) -> &'static str {
    match result_kind {
        ResultEnvelopeKind::Tabular => "tabular",
        ResultEnvelopeKind::Document => "document",
        ResultEnvelopeKind::KeyValue => "keyValue",
        ResultEnvelopeKind::SearchHits => "searchHits",
        ResultEnvelopeKind::Graph => "graph",
        ResultEnvelopeKind::VectorNeighbors => "vectorNeighbors",
        ResultEnvelopeKind::StreamRecords => "streamRecords",
        ResultEnvelopeKind::Metrics => "metrics",
    }
}

fn safety_policy_label(safety_policy: SafetyPolicyId) -> &'static str {
    match safety_policy {
        SafetyPolicyId::RdbDefault => "rdb-default",
        SafetyPolicyId::DocumentDefault => "document-default",
        SafetyPolicyId::KvDefault => "kv-default",
        SafetyPolicyId::SearchDefault => "search-default",
    }
}

fn backend_adapter_id_label(adapter_id: BackendAdapterId) -> &'static str {
    match adapter_id {
        BackendAdapterId::Postgresql => "postgresql",
        BackendAdapterId::MysqlFamily => "mysql-family",
        BackendAdapterId::Sqlite => "sqlite",
        BackendAdapterId::Duckdb => "duckdb",
        BackendAdapterId::Mssql => "mssql",
        BackendAdapterId::Oracle => "oracle",
        BackendAdapterId::Mongodb => "mongodb",
        BackendAdapterId::Redis => "redis",
        BackendAdapterId::Valkey => "valkey",
        BackendAdapterId::DeclaredRdb => "declared-rdb",
        BackendAdapterId::SearchEngine => "search-engine",
        BackendAdapterId::Marker => "marker",
    }
}

fn backend_adapter_kind_label(adapter_kind: BackendAdapterContractKind) -> &'static str {
    match adapter_kind {
        BackendAdapterContractKind::Rdb => "rdb",
        BackendAdapterContractKind::Document => "document",
        BackendAdapterContractKind::Search => "search",
        BackendAdapterContractKind::Kv => "kv",
    }
}

fn backend_adapter_capability_source_label(
    capability_source: BackendAdapterCapabilitySource,
) -> &'static str {
    match capability_source {
        BackendAdapterCapabilitySource::Postgresql => "postgresql",
        BackendAdapterCapabilitySource::MysqlFamily => "mysql-family",
        BackendAdapterCapabilitySource::Sqlite => "sqlite",
        BackendAdapterCapabilitySource::Duckdb => "duckdb",
        BackendAdapterCapabilitySource::Mssql => "mssql",
        BackendAdapterCapabilitySource::Oracle => "oracle",
        BackendAdapterCapabilitySource::Mongodb => "mongodb",
        BackendAdapterCapabilitySource::Redis => "redis",
        BackendAdapterCapabilitySource::Valkey => "valkey",
        BackendAdapterCapabilitySource::DeclaredRdb => "declared-rdb",
        BackendAdapterCapabilitySource::SearchEngine => "search-engine",
        BackendAdapterCapabilitySource::Marker => "marker",
    }
}

fn dialect_id_label(dialect_id: DataSourceDialectId) -> &'static str {
    match dialect_id {
        DataSourceDialectId::Postgresql => "postgresql",
        DataSourceDialectId::Mysql => "mysql",
        DataSourceDialectId::Mariadb => "mariadb",
        DataSourceDialectId::Sqlite => "sqlite",
        DataSourceDialectId::Duckdb => "duckdb",
        DataSourceDialectId::Mssql => "mssql",
        DataSourceDialectId::Oracle => "oracle",
        DataSourceDialectId::Mongodb => "mongodb",
        DataSourceDialectId::Redis => "redis",
        DataSourceDialectId::Valkey => "valkey",
        DataSourceDialectId::Elasticsearch => "elasticsearch",
        DataSourceDialectId::Opensearch => "opensearch",
    }
}

fn dialect_family_label(family: DataSourceDialectFamily) -> &'static str {
    match family {
        DataSourceDialectFamily::Postgres => "postgres",
        DataSourceDialectFamily::Mysql => "mysql",
        DataSourceDialectFamily::Sqlite => "sqlite",
        DataSourceDialectFamily::Duckdb => "duckdb",
        DataSourceDialectFamily::Mssql => "mssql",
        DataSourceDialectFamily::Oracle => "oracle",
        DataSourceDialectFamily::Mongodb => "mongodb",
        DataSourceDialectFamily::Redis => "redis",
        DataSourceDialectFamily::Valkey => "valkey",
        DataSourceDialectFamily::Elasticsearch => "elasticsearch",
        DataSourceDialectFamily::Opensearch => "opensearch",
    }
}

fn version_probe_label(version_probe: ServerVersionProbeId) -> &'static str {
    match version_probe {
        ServerVersionProbeId::PostgresVersionSettings => "postgres-version-settings",
        ServerVersionProbeId::MysqlFamilyVersion => "mysql-family-version",
        ServerVersionProbeId::SqliteVersion => "sqlite-version",
        ServerVersionProbeId::MssqlServerProperty => "mssql-server-property",
        ServerVersionProbeId::MongodbBuildInfo => "mongodb-build-info",
        ServerVersionProbeId::SearchRoot => "search-root",
        ServerVersionProbeId::None => "none",
    }
}

fn file_connection_permission_scope_label(
    permission_scope: FileConnectionPermissionScope,
) -> &'static str {
    match permission_scope {
        FileConnectionPermissionScope::LocalFile => "local-file",
    }
}

fn file_connection_privacy_policy_label(
    privacy_policy: FileConnectionPrivacyPolicyId,
) -> &'static str {
    match privacy_policy {
        FileConnectionPrivacyPolicyId::LocalFirst => "local-first",
    }
}

fn file_connection_input_kind_label(input_kind: FileConnectionInputKind) -> &'static str {
    match input_kind {
        FileConnectionInputKind::Database => "database",
        FileConnectionInputKind::Analytics => "analytics",
    }
}

fn file_connection_input_status_label(status: FileConnectionInputStatus) -> &'static str {
    match status {
        FileConnectionInputStatus::Supported => "supported",
        FileConnectionInputStatus::Deferred => "deferred",
    }
}
