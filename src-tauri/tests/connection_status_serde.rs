//! 작성 2026-05-16 (Phase 3 sprint-364).
//!
//! `ConnectionStatus` enum 의 4-case wire regression. Phase 3 Q14 에서
//! `Connecting` variant 추가 + `Connected { active_db: Option<String> }`
//! 로 struct-shaped 으로 재구성됨에 따라 frontend discriminated union
//! (`{type:"connecting"} | {type:"connected", activeDb?: string} |
//! {type:"disconnected"} | {type:"error", message: string}`) 과의 wire
//! contract 를 회귀 가드.
//!
//! 사유:
//! - `#[serde(tag = "type")]` internally-tagged → struct variant 가 평면화.
//! - `rename_all_fields = "camelCase"` → `active_db` → `activeDb` 자동 변환.
//! - `#[serde(skip_serializing_if = "Option::is_none")]` → `Connected{None}`
//!   payload 에 `activeDb: null` 이 나타나지 않음 (codex 3차 #6).

use table_view_lib::models::ConnectionStatus;

#[test]
fn connection_status_connecting_serializes_to_type_only() {
    // AC-364-01 (a): Connecting variant 는 wire 에 추가 필드 없이
    // `{"type":"connecting"}` 만 가진다.
    let status = ConnectionStatus::Connecting;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, r#"{"type":"connecting"}"#);
}

#[test]
fn connection_status_connected_with_some_active_db_serializes_camel_case() {
    // AC-364-01 (b) + AC-364-02 (positive): active_db: Some("foo") 는
    // wire 에 `activeDb` (camelCase) 로 평면화된다.
    let status = ConnectionStatus::Connected {
        active_db: Some("foo".into()),
    };
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, r#"{"type":"connected","activeDb":"foo"}"#);
}

#[test]
fn connection_status_connected_with_none_active_db_omits_field() {
    // AC-364-01 (c) + AC-364-02 (negative): active_db: None 일 때
    // `activeDb` 필드는 wire 에 부재해야 한다 (`activeDb: null` 금지 —
    // codex 3차 #6).
    let status = ConnectionStatus::Connected { active_db: None };
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, r#"{"type":"connected"}"#);
}

#[test]
fn connection_status_disconnected_serializes_to_type_only() {
    // AC-364-01 (d): Disconnected variant 는 추가 필드 없이
    // `{"type":"disconnected"}`.
    let status = ConnectionStatus::Disconnected;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, r#"{"type":"disconnected"}"#);
}

#[test]
fn connection_status_error_with_message_serializes_camel_case() {
    // AC-364-01 (e): Error{message} 는 message 필드를 wire 에 포함.
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
    // 사유: `Connected{None}` wire payload (`{"type":"connected"}`) 가
    // 다시 deserialize 될 때 `active_db: None` 으로 복원되어야 한다.
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
