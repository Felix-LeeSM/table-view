//! 작성 2026-05-16 (Phase 2 sprint-359) — AC-359-06: cancel error
//! classification.
//!
//! Q5.5 — `cancel_query_native` must surface three distinct error classes
//! so the frontend can decide between silent suppression (race already
//! completed), permission toast, and network-loss toast:
//!
//! 1. `AlreadyCompleted` — query 가 이미 끝났거나 매핑된 server_pid 가
//!    affinity 에 없는 경우. frontend 는 silent.
//! 2. `PermissionDenied` — pg `pg_cancel_backend(<other-user-pid>)` 가
//!    `false` 를 반환했을 때 (또는 MySQL/Mongo 의 동등 권한 거부).
//!    frontend 는 toast.
//! 3. `NetworkError` — driver 가 TCP fault 로 죽었을 때. frontend 는
//!    toast.
//!
//! 본 통합 테스트는 enum 자체의 직렬화 + classification helper 를
//! 검증한다. live PG/MySQL/Mongo cancel timing 은 별도 cancel_pg /
//! cancel_mysql / cancel_mongo 통합 테스트가 다룬다.

use table_view_lib::commands::cancel_query::{classify_cancel_error, CancelError};
use table_view_lib::error::AppError;

#[test]
fn already_completed_serialises_with_stable_tag() {
    // frontend 가 discriminator 로 분기하므로 wire-shape 가 변하면
    // 안 된다. JSON 직렬화는 `{"type": "AlreadyCompleted"}` shape.
    let err = CancelError::AlreadyCompleted;
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["type"], "AlreadyCompleted");
}

#[test]
fn permission_denied_serialises_with_stable_tag() {
    let err = CancelError::PermissionDenied {
        message: "cannot kill other user's backend".into(),
    };
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["type"], "PermissionDenied");
    assert_eq!(json["message"], "cannot kill other user's backend");
}

#[test]
fn network_error_serialises_with_stable_tag() {
    let err = CancelError::NetworkError {
        message: "broken pipe".into(),
    };
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["type"], "NetworkError");
    assert_eq!(json["message"], "broken pipe");
}

#[test]
fn app_error_cancel_serialises_as_top_level_cancel_tag() {
    let value = serde_json::to_value(AppError::Cancel(CancelError::AlreadyCompleted)).unwrap();

    assert_eq!(
        value,
        serde_json::json!({
            "type": "Cancel",
            "payload": { "type": "AlreadyCompleted" },
        })
    );
}

#[test]
fn app_error_cancel_preserves_message_payload() {
    let value = serde_json::to_value(AppError::Cancel(CancelError::PermissionDenied {
        message: "denied".into(),
    }))
    .unwrap();

    assert_eq!(
        value,
        serde_json::json!({
            "type": "Cancel",
            "payload": { "type": "PermissionDenied", "message": "denied" },
        })
    );
}

#[test]
fn app_error_db_mismatch_serialises_as_typed_envelope_with_message() {
    let value = serde_json::to_value(AppError::DbMismatch {
        expected: "db1".into(),
        actual: "db2".into(),
    })
    .unwrap();

    assert_eq!(
        value,
        serde_json::json!({
            "type": "DbMismatch",
            "message": "Database mismatch: expected 'db1', but found 'db2'",
            "payload": { "expected": "db1", "actual": "db2" },
        })
    );
}

#[test]
fn classify_permission_denied_strings() {
    // PG `pg_cancel_backend` 가 `false` 반환할 때 우리는 explicit
    // "Permission" 메시지로 raise — classify 가 변경 없이 통과.
    let class = classify_cancel_error("permission denied for function pg_cancel_backend");
    assert!(matches!(class, CancelError::PermissionDenied { .. }));
}

#[test]
fn classify_already_completed_strings() {
    // affinity 에 server_pid 가 없는 경우 (또는 server 가 query 가
    // 이미 끝났다고 응답) 의 우리 sentinel 문자열.
    let class = classify_cancel_error("query already completed");
    assert!(matches!(class, CancelError::AlreadyCompleted));
}

#[test]
fn classify_network_error_strings() {
    // sqlx 의 TCP 오류 메시지 패턴.
    let class = classify_cancel_error("connection refused");
    assert!(matches!(class, CancelError::NetworkError { .. }));
    let class2 = classify_cancel_error("broken pipe");
    assert!(matches!(class2, CancelError::NetworkError { .. }));
}

#[test]
fn classify_unknown_strings_default_to_network_error() {
    // 미분류 메시지는 보수적으로 NetworkError 로 던진다 (silent 가
    // 아닌 toast 가 디폴트 — 사용자에게 보임).
    let class = classify_cancel_error("some unexpected wire trouble");
    assert!(matches!(class, CancelError::NetworkError { .. }));
}
