//! Written 2026-05-16.
//!
//! Four-case wire regression for the `ConnectionStatus` enum. Q14 added the
//! `Connecting` variant and reshaped the enum into struct form as
//! `Connected { active_db: Option<String> }`, so this guards the wire contract
//! against the frontend discriminated union (`{type:"connecting"} |
//! {type:"connected", activeDb?: string} | {type:"disconnected"} |
//! {type:"error", message: string}`).
//!
//! Reason:
//! - `#[serde(tag = "type")]` is internally tagged → the struct variant is
//!   flattened.
//! - `rename_all_fields = "camelCase"` → `active_db` becomes `activeDb`
//!   automatically.
//! - `#[serde(skip_serializing_if = "Option::is_none")]` → `activeDb: null`
//!   never appears in a `Connected{None}` payload.

use table_view_lib::models::ConnectionStatus;

#[test]
fn connection_status_connecting_serializes_to_type_only() {
    // AC-364-01 (a): the Connecting variant carries no extra field on the
    // wire — just `{"type":"connecting"}`.
    let status = ConnectionStatus::Connecting;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, r#"{"type":"connecting"}"#);
}

#[test]
fn connection_status_connected_with_some_active_db_serializes_camel_case() {
    // AC-364-01 (b) + AC-364-02 (positive): active_db: Some("foo") is
    // flattened onto the wire as `activeDb` (camelCase).
    let status = ConnectionStatus::Connected {
        active_db: Some("foo".into()),
    };
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, r#"{"type":"connected","activeDb":"foo"}"#);
}

#[test]
fn connection_status_connected_with_none_active_db_omits_field() {
    // AC-364-01 (c) + AC-364-02 (negative): when active_db is None the
    // `activeDb` field must be absent from the wire (`activeDb: null` is
    // forbidden).
    let status = ConnectionStatus::Connected { active_db: None };
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, r#"{"type":"connected"}"#);
}

#[test]
fn connection_status_disconnected_serializes_to_type_only() {
    // AC-364-01 (d): the Disconnected variant carries no extra field —
    // `{"type":"disconnected"}`.
    let status = ConnectionStatus::Disconnected;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, r#"{"type":"disconnected"}"#);
}

#[test]
fn connection_status_error_with_message_serializes_camel_case() {
    // AC-364-01 (e): Error{message} includes the message field on the wire.
    let status = ConnectionStatus::Error {
        message: "bad".into(),
    };
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, r#"{"type":"error","message":"bad"}"#);
}

// ---- Deserialize round-trip ----------------------------------------------

#[test]
fn connection_status_deserializes_connecting() {
    let status: ConnectionStatus = serde_json::from_str(r#"{"type":"connecting"}"#).unwrap();
    assert!(matches!(status, ConnectionStatus::Connecting));
}

#[test]
fn connection_status_deserializes_connected_with_active_db() {
    let status: ConnectionStatus =
        serde_json::from_str(r#"{"type":"connected","activeDb":"foo"}"#).unwrap();
    match status {
        ConnectionStatus::Connected { active_db } => {
            assert_eq!(active_db.as_deref(), Some("foo"));
        }
        other => panic!("expected Connected{{active_db:Some(..)}}, got {:?}", other),
    }
}

#[test]
fn connection_status_deserializes_connected_without_active_db_as_none() {
    // Reason: when the `Connected{None}` wire payload
    // (`{"type":"connected"}`) is deserialized again it must come back as
    // `active_db: None`.
    let status: ConnectionStatus = serde_json::from_str(r#"{"type":"connected"}"#).unwrap();
    match status {
        ConnectionStatus::Connected { active_db } => assert!(active_db.is_none()),
        other => panic!("expected Connected{{active_db:None}}, got {:?}", other),
    }
}

#[test]
fn connection_status_deserializes_disconnected() {
    let status: ConnectionStatus = serde_json::from_str(r#"{"type":"disconnected"}"#).unwrap();
    assert!(matches!(status, ConnectionStatus::Disconnected));
}

#[test]
fn connection_status_deserializes_error_with_message() {
    let status: ConnectionStatus =
        serde_json::from_str(r#"{"type":"error","message":"bad"}"#).unwrap();
    match status {
        ConnectionStatus::Error { message } => assert_eq!(message, "bad"),
        other => panic!("expected Error{{message:...}}, got {:?}", other),
    }
}
