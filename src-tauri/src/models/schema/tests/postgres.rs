use super::super::*;
use serde_json;

#[test]
fn view_info_serde_roundtrip() {
    let info = ViewInfo {
        name: "active_users".to_string(),
        schema: "public".to_string(),
        definition: Some("SELECT * FROM users WHERE active = true".to_string()),
    };
    let json = serde_json::to_string(&info).unwrap();
    let deserialized: ViewInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.name, "active_users");
    assert_eq!(deserialized.schema, "public");
    assert_eq!(
        deserialized.definition,
        Some("SELECT * FROM users WHERE active = true".to_string())
    );

    let info_no_def = ViewInfo {
        name: "simple_view".to_string(),
        schema: "public".to_string(),
        definition: None,
    };
    let json_no_def = serde_json::to_string(&info_no_def).unwrap();
    let deserialized_no_def: ViewInfo = serde_json::from_str(&json_no_def).unwrap();
    assert_eq!(deserialized_no_def.definition, None);
}

#[test]
fn trigger_info_serde_roundtrip() {
    // Sprint 272 — TriggerInfo round-trips with camelCase wire form
    // (`functionSchema`, `functionName`, `whenExpression`). Older
    // payloads that omit `arguments` / `whenExpression` deserialize to
    // `None` via `Option<String>`.
    let info = TriggerInfo {
        name: "audit_users_insert".to_string(),
        schema: "public".to_string(),
        table: "users".to_string(),
        timing: "BEFORE".to_string(),
        events: vec!["INSERT".to_string(), "UPDATE".to_string()],
        orientation: "ROW".to_string(),
        function_schema: "audit".to_string(),
        function_name: "log_change".to_string(),
        arguments: Some("'users'".to_string()),
        when_expression: Some("(NEW.email IS NOT NULL)".to_string()),
        definition: "CREATE TRIGGER audit_users_insert …".to_string(),
    };
    let json = serde_json::to_string(&info).unwrap();
    // camelCase wire form check.
    assert!(
        json.contains("\"functionSchema\":\"audit\""),
        "expected camelCase functionSchema, got: {json}"
    );
    assert!(
        json.contains("\"functionName\":\"log_change\""),
        "expected camelCase functionName, got: {json}"
    );
    assert!(
        json.contains("\"whenExpression\":\"(NEW.email IS NOT NULL)\""),
        "expected camelCase whenExpression, got: {json}"
    );
    let deserialized: TriggerInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, info);

    // Minimal payload (no arguments / no whenExpression) round-trips.
    let minimal = TriggerInfo {
        name: "t1".to_string(),
        schema: "public".to_string(),
        table: "orders".to_string(),
        timing: "AFTER".to_string(),
        events: vec!["DELETE".to_string()],
        orientation: "STATEMENT".to_string(),
        function_schema: "public".to_string(),
        function_name: "cleanup".to_string(),
        arguments: None,
        when_expression: None,
        definition: "CREATE TRIGGER t1 …".to_string(),
    };
    let json_min = serde_json::to_string(&minimal).unwrap();
    let de_min: TriggerInfo = serde_json::from_str(&json_min).unwrap();
    assert_eq!(de_min, minimal);
}

#[test]
fn create_trigger_request_serde_roundtrip() {
    // Sprint 273 — `CreateTriggerRequest` round-trips with camelCase
    // wire form (`connectionId`, `triggerName`, `whenExpression`,
    // `functionSchema`, `functionName`, `functionArguments`,
    // `previewOnly`, `expectedDatabase`). `preview_only` and
    // `expected_database` default to `false` / `None` when omitted
    // (`#[serde(default)]`).
    let req = CreateTriggerRequest {
        connection_id: "conn-1".to_string(),
        schema: "public".to_string(),
        table: "users".to_string(),
        trigger_name: "audit_users_insert".to_string(),
        timing: "BEFORE".to_string(),
        events: vec!["INSERT".to_string()],
        orientation: "ROW".to_string(),
        when_expression: Some("(NEW.email IS NOT NULL)".to_string()),
        function_schema: "audit".to_string(),
        function_name: "log_insert".to_string(),
        function_arguments: Some("'users'".to_string()),
        preview_only: true,
        expected_database: Some("appdb".to_string()),
    };
    let json = serde_json::to_string(&req).unwrap();
    assert!(
        json.contains("\"connectionId\":\"conn-1\""),
        "expected camelCase connectionId, got: {json}"
    );
    assert!(
        json.contains("\"triggerName\":\"audit_users_insert\""),
        "expected camelCase triggerName, got: {json}"
    );
    assert!(
        json.contains("\"whenExpression\":\"(NEW.email IS NOT NULL)\""),
        "expected camelCase whenExpression, got: {json}"
    );
    assert!(
        json.contains("\"functionSchema\":\"audit\""),
        "expected camelCase functionSchema, got: {json}"
    );
    assert!(
        json.contains("\"functionName\":\"log_insert\""),
        "expected camelCase functionName, got: {json}"
    );
    assert!(
        json.contains("\"functionArguments\":\"'users'\""),
        "expected camelCase functionArguments, got: {json}"
    );
    assert!(json.contains("\"previewOnly\":true"));
    assert!(json.contains("\"expectedDatabase\":\"appdb\""));
    let deserialized: CreateTriggerRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.connection_id, "conn-1");
    assert_eq!(deserialized.trigger_name, "audit_users_insert");
    assert_eq!(deserialized.timing, "BEFORE");
    assert_eq!(deserialized.events, vec!["INSERT".to_string()]);
    assert_eq!(deserialized.orientation, "ROW");
    assert_eq!(
        deserialized.when_expression,
        Some("(NEW.email IS NOT NULL)".to_string())
    );
    assert_eq!(deserialized.function_schema, "audit");
    assert_eq!(deserialized.function_name, "log_insert");
    assert_eq!(deserialized.function_arguments, Some("'users'".to_string()));
    assert!(deserialized.preview_only);
    assert_eq!(deserialized.expected_database, Some("appdb".to_string()));

    // Back-compat — payload omitting `previewOnly`, `expectedDatabase`,
    // `whenExpression`, `functionArguments` deserialises to false /
    // None (Sprint 273 default-flag invariant).
    let minimal = r#"{
            "connectionId":"c",
            "schema":"s",
            "table":"t",
            "triggerName":"tg",
            "timing":"AFTER",
            "events":["UPDATE"],
            "orientation":"STATEMENT",
            "functionSchema":"public",
            "functionName":"fn"
        }"#;
    let parsed: CreateTriggerRequest = serde_json::from_str(minimal).unwrap();
    assert!(!parsed.preview_only);
    assert!(parsed.expected_database.is_none());
    assert!(parsed.when_expression.is_none());
    assert!(parsed.function_arguments.is_none());
}

#[test]
fn drop_trigger_request_serde_roundtrip() {
    // Sprint 274 — `DropTriggerRequest` round-trips with camelCase
    // wire form (`connectionId`, `triggerName`, `cascade`,
    // `previewOnly`, `expectedDatabase`). `cascade`, `preview_only`
    // and `expected_database` default to `false` / `None` when
    // omitted (`#[serde(default)]`).
    let req = DropTriggerRequest {
        connection_id: "conn-1".to_string(),
        schema: "public".to_string(),
        table: "users".to_string(),
        trigger_name: "tg_audit".to_string(),
        cascade: true,
        preview_only: true,
        expected_database: Some("appdb".to_string()),
    };
    let json = serde_json::to_string(&req).unwrap();
    assert!(
        json.contains("\"connectionId\":\"conn-1\""),
        "expected camelCase connectionId, got: {json}"
    );
    assert!(
        json.contains("\"triggerName\":\"tg_audit\""),
        "expected camelCase triggerName, got: {json}"
    );
    assert!(json.contains("\"cascade\":true"));
    assert!(json.contains("\"previewOnly\":true"));
    assert!(json.contains("\"expectedDatabase\":\"appdb\""));
    let deserialized: DropTriggerRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.connection_id, "conn-1");
    assert_eq!(deserialized.schema, "public");
    assert_eq!(deserialized.table, "users");
    assert_eq!(deserialized.trigger_name, "tg_audit");
    assert!(deserialized.cascade);
    assert!(deserialized.preview_only);
    assert_eq!(deserialized.expected_database, Some("appdb".to_string()));

    // Back-compat — payload omitting `cascade`, `previewOnly`, and
    // `expectedDatabase` deserialises to false / None (Sprint 274
    // default-flag invariant).
    let minimal = r#"{
            "connectionId":"c",
            "schema":"s",
            "table":"t",
            "triggerName":"tg"
        }"#;
    let parsed: DropTriggerRequest = serde_json::from_str(minimal).unwrap();
    assert!(!parsed.cascade);
    assert!(!parsed.preview_only);
    assert!(parsed.expected_database.is_none());
}

#[test]
fn function_info_serde_roundtrip() {
    let info = FunctionInfo {
        name: "calculate_total".to_string(),
        schema: "public".to_string(),
        arguments: Some("user_id integer".to_string()),
        return_type: Some("numeric".to_string()),
        language: Some("plpgsql".to_string()),
        source: Some("BEGIN RETURN 0; END".to_string()),
        kind: "function".to_string(),
    };
    let json = serde_json::to_string(&info).unwrap();
    let deserialized: FunctionInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.name, "calculate_total");
    assert_eq!(deserialized.kind, "function");
    assert_eq!(deserialized.arguments, Some("user_id integer".to_string()));
    assert_eq!(deserialized.return_type, Some("numeric".to_string()));
    assert_eq!(deserialized.language, Some("plpgsql".to_string()));
    assert_eq!(deserialized.source, Some("BEGIN RETURN 0; END".to_string()));

    let info_minimal = FunctionInfo {
        name: "do_something".to_string(),
        schema: "public".to_string(),
        arguments: None,
        return_type: None,
        language: None,
        source: None,
        kind: "procedure".to_string(),
    };
    let json_minimal = serde_json::to_string(&info_minimal).unwrap();
    let deserialized_minimal: FunctionInfo = serde_json::from_str(&json_minimal).unwrap();
    assert_eq!(deserialized_minimal.kind, "procedure");
    assert!(deserialized_minimal.arguments.is_none());
    assert!(deserialized_minimal.return_type.is_none());
}
