use serde_json::json;
use table_view_lib::{
    db::{DuckdbAdapter, KvAdapter, RdbAdapter, RedisAdapter, SearchAdapter, SearchEngineAdapter},
    error::AppError,
    models::{
        get_data_source_profile, BackendAdapterCapability, DatabaseType, DropTableRequest,
        Paradigm, QueryLanguageId, SafetyPolicyId, SearchDeleteByQueryRequest,
        SearchDestructiveSafety,
    },
};

const ALL_DATABASE_TYPES: &[DatabaseType] = &[
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
];

const FUTURE_LANGUAGE_PLACEHOLDERS: &[QueryLanguageId] = &[
    QueryLanguageId::Cql,
    QueryLanguageId::Partiql,
    QueryLanguageId::Cypher,
    QueryLanguageId::Gql,
    QueryLanguageId::Gremlin,
    QueryLanguageId::VectorQuery,
    QueryLanguageId::StreamCommand,
];

#[test]
fn safety_policy_matches_profile_paradigm() {
    for db_type in ALL_DATABASE_TYPES {
        let profile = get_data_source_profile(db_type);
        let expected = match profile.paradigm {
            Paradigm::Rdb => SafetyPolicyId::RdbDefault,
            Paradigm::Document => SafetyPolicyId::DocumentDefault,
            Paradigm::Kv => SafetyPolicyId::KvDefault,
            Paradigm::Search => SafetyPolicyId::SearchDefault,
        };

        assert_eq!(profile.safety_policy, expected, "{db_type:?}");
    }
}

#[test]
fn capabilities_do_not_cross_paradigm_boundaries() {
    for db_type in ALL_DATABASE_TYPES {
        let profile = get_data_source_profile(db_type);

        match profile.paradigm {
            Paradigm::Rdb => {
                assert!(
                    profile.has_backend_capability(BackendAdapterCapability::RelationalQuery),
                    "{db_type:?} should claim relational query"
                );
                assert!(
                    !profile.has_backend_capability(BackendAdapterCapability::DocumentQuery),
                    "{db_type:?} must not claim document query"
                );
                assert!(
                    !profile.has_backend_capability(BackendAdapterCapability::KeyValueRead),
                    "{db_type:?} must not claim KV read"
                );
                assert!(
                    !profile.has_backend_capability(BackendAdapterCapability::SearchQuery),
                    "{db_type:?} must not claim search query"
                );
            }
            Paradigm::Document => {
                assert!(profile.has_backend_capability(BackendAdapterCapability::DocumentQuery));
                assert!(!profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
                assert!(!profile.has_backend_capability(BackendAdapterCapability::KeyValueRead));
                assert!(!profile.has_backend_capability(BackendAdapterCapability::SearchQuery));
            }
            Paradigm::Kv => {
                assert!(profile.has_backend_capability(BackendAdapterCapability::KeyValueCatalog));
                assert!(!profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
                assert!(!profile.has_backend_capability(BackendAdapterCapability::DocumentQuery));
                assert!(!profile.has_backend_capability(BackendAdapterCapability::SearchQuery));
            }
            Paradigm::Search => {
                assert!(profile.has_backend_capability(BackendAdapterCapability::SearchQuery));
                assert!(profile.has_backend_capability(BackendAdapterCapability::SearchSafetyPlan));
                assert!(!profile.has_backend_capability(BackendAdapterCapability::RelationalQuery));
                assert!(!profile.has_backend_capability(BackendAdapterCapability::DocumentQuery));
                assert!(!profile.has_backend_capability(BackendAdapterCapability::KeyValueRead));
            }
        }
    }
}

#[test]
fn future_language_placeholders_remain_out_of_runtime_profiles() {
    for db_type in ALL_DATABASE_TYPES {
        let profile = get_data_source_profile(db_type);

        for future_language in FUTURE_LANGUAGE_PLACEHOLDERS {
            assert!(
                !profile.languages.contains(future_language),
                "{db_type:?} must not claim future language {future_language:?}"
            );
        }
    }
}

#[test]
fn dbms_specific_unsupported_capability_deltas_are_declared() {
    let mssql = get_data_source_profile(&DatabaseType::Mssql);
    assert!(mssql.has_backend_capability(BackendAdapterCapability::Lifecycle));
    assert!(mssql.has_backend_capability(BackendAdapterCapability::RelationalCatalog));
    assert!(mssql.has_backend_capability(BackendAdapterCapability::RelationalQuery));
    assert!(!mssql.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));

    let oracle = get_data_source_profile(&DatabaseType::Oracle);
    assert!(oracle.has_backend_capability(BackendAdapterCapability::Lifecycle));
    assert!(oracle.has_backend_capability(BackendAdapterCapability::RelationalCatalog));
    assert!(oracle.has_backend_capability(BackendAdapterCapability::RelationalQuery));
    assert!(!oracle.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));

    assert!(!get_data_source_profile(&DatabaseType::Sqlite)
        .has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));
    assert!(!get_data_source_profile(&DatabaseType::Duckdb)
        .has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation));
    assert!(get_data_source_profile(&DatabaseType::Redis)
        .has_backend_capability(BackendAdapterCapability::KeyValueMutation));
    assert!(get_data_source_profile(&DatabaseType::Valkey)
        .has_backend_capability(BackendAdapterCapability::KeyValueMutation));
}

/// Regression for #1044: the wired SQLite production adapter (`make_adapter`
/// constructs `SqliteAdapter`) implements bounded structured DDL through
/// `create_table`, so its profile must declare `RelationalSchemaMutation`.
/// Binds the capability declaration to the wired implementation so the two
/// cannot drift (the declaration used to say "no DDL" while the engine did DDL).
#[tokio::test]
async fn sqlite_schema_mutation_declaration_matches_wired_create_table() {
    let profile = get_data_source_profile(&DatabaseType::Sqlite);
    assert!(
        profile.has_backend_capability(BackendAdapterCapability::RelationalSchemaMutation),
        "wired SqliteAdapter implements create_table, so the profile must declare RelationalSchemaMutation"
    );

    // preview_only returns the DDL text without a live pool, proving the wired
    // adapter performs schema mutation (returns Ok, not AppError::Unsupported).
    let adapter = table_view_lib::db::SqliteAdapter::new();
    let request = table_view_lib::models::CreateTableRequest {
        connection_id: "sqlite".to_string(),
        schema: "main".to_string(),
        name: "capability_1044".to_string(),
        columns: vec![table_view_lib::models::ColumnDefinition {
            name: "id".to_string(),
            data_type: "INTEGER".to_string(),
            nullable: false,
            default_value: None,
            comment: None,
            is_identity: false,
        }],
        primary_key: Some(vec!["id".to_string()]),
        preview_only: true,
        table_comment: None,
        expected_database: None,
    };
    let result = adapter
        .create_table(&request)
        .await
        .expect("wired SQLite adapter implements create_table");
    assert!(
        result.sql.contains("CREATE TABLE"),
        "create_table must emit real DDL, got: {}",
        result.sql
    );
}

#[tokio::test]
async fn dbms_specific_unsupported_delta_paths_return_explicit_app_errors() {
    let duckdb = DuckdbAdapter::new();
    assert_unsupported(
        RdbAdapter::drop_table(&duckdb, &drop_table_request()).await,
        &["DuckDB", "table drop"],
    );

    let valkey = RedisAdapter::new_valkey();
    assert_connection(
        valkey.set_string(valkey_set_string_request()).await,
        "Valkey connection is not open",
    );

    let search = SearchEngineAdapter::fixture_elasticsearch();
    assert_unsupported(
        search
            .plan_delete_by_query(&unsupported_search_body_request())
            .await,
        &["body feature", "script", "not supported"],
    );
}

#[tokio::test]
async fn destructive_search_plan_stays_preview_only() {
    let search = SearchEngineAdapter::fixture_opensearch();
    let preview = search
        .plan_delete_by_query(&preview_delete_by_query_request())
        .await
        .expect("fixture preview should plan");

    assert_eq!(preview.operation, "deleteByQuery");
    assert_eq!(preview.target, "logs-opensearch-2026.05.24");
    assert!(preview.preview_only);
    assert!(!preview.requires_confirmation);
    assert!(preview
        .warnings
        .iter()
        .any(|warning| warning.contains("execution is unsupported")));

    let mut execution = preview_delete_by_query_request();
    execution.preview_only = false;
    execution.safety.acknowledged_risk = true;
    execution.safety.expected_target = Some("logs-opensearch-2026.05.24".into());
    assert_unsupported(
        search.plan_delete_by_query(&execution).await,
        &["only preview plans are available"],
    );

    let mut wildcard = preview_delete_by_query_request();
    wildcard.index_pattern = "logs-*".into();
    wildcard.safety.allow_wildcard = true;
    assert_validation(
        search.plan_delete_by_query(&wildcard).await,
        "wildcard targets are unsupported",
    );
}

#[test]
fn unsupported_app_error_keeps_legacy_tauri_string_mapping() {
    let value = serde_json::to_value(AppError::Unsupported("feature not supported".into()))
        .expect("unsupported error should serialize");

    assert_eq!(value, json!("Unsupported operation: feature not supported"));
}

fn drop_table_request() -> DropTableRequest {
    DropTableRequest {
        connection_id: "fixture".into(),
        schema: "main".into(),
        table: "users".into(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    }
}

fn valkey_set_string_request() -> table_view_lib::db::KvSetStringRequest {
    table_view_lib::db::KvSetStringRequest {
        key: "session:1".into(),
        value: "value".into(),
        database: Some(0),
        ttl_seconds: None,
        safety: table_view_lib::db::KvWriteSafety::RejectOverwrite,
    }
}

fn unsupported_search_body_request() -> SearchDeleteByQueryRequest {
    SearchDeleteByQueryRequest {
        index_pattern: "logs-elastic-2026.05.24".into(),
        body: json!({
            "query": { "match_all": {} },
            "script": { "source": "ctx._source.remove('field')" }
        }),
        preview_only: true,
        safety: SearchDestructiveSafety {
            acknowledged_risk: false,
            allow_wildcard: false,
            expected_target: None,
        },
    }
}

fn preview_delete_by_query_request() -> SearchDeleteByQueryRequest {
    SearchDeleteByQueryRequest {
        index_pattern: "logs-opensearch-2026.05.24".into(),
        body: json!({
            "query": { "term": { "service": "api" } }
        }),
        preview_only: true,
        safety: SearchDestructiveSafety {
            acknowledged_risk: false,
            allow_wildcard: false,
            expected_target: None,
        },
    }
}

fn assert_unsupported<T>(result: Result<T, AppError>, fragments: &[&str]) {
    match result {
        Err(AppError::Unsupported(message)) => {
            for fragment in fragments {
                assert!(
                    message.contains(fragment),
                    "expected unsupported message to contain {fragment:?}, got {message:?}",
                );
            }
        }
        Err(other) => panic!("expected Unsupported, got {other:?}"),
        Ok(_) => panic!("expected Unsupported, got Ok"),
    }
}

fn assert_connection<T>(result: Result<T, AppError>, fragment: &str) {
    match result {
        Err(AppError::Connection(message)) => assert!(
            message.contains(fragment),
            "expected connection message to contain {fragment:?}, got {message:?}",
        ),
        Err(other) => panic!("expected Connection, got {other:?}"),
        Ok(_) => panic!("expected Connection, got Ok"),
    }
}

fn assert_validation<T>(result: Result<T, AppError>, fragment: &str) {
    match result {
        Err(AppError::Validation(message)) => assert!(
            message.contains(fragment),
            "expected validation message to contain {fragment:?}, got {message:?}",
        ),
        Err(other) => panic!("expected Validation, got {other:?}"),
        Ok(_) => panic!("expected Validation, got Ok"),
    }
}
