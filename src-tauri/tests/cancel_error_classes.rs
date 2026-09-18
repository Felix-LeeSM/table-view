//! Written 2026-05-16 — AC-359-06: cancel error classification.
//!
//! Q5.5 — `cancel_query_native` must surface three distinct error classes
//! so the frontend can decide between silent suppression (race already
//! completed), permission toast, and network-loss toast:
//!
//! 1. `AlreadyCompleted` — the query already finished, or the mapped server_pid
//!    is not in affinity. The frontend stays silent.
//! 2. `PermissionDenied` — pg `pg_cancel_backend(<other-user-pid>)` returned
//!    `false` (or MySQL/Mongo refused permission the same way). The frontend
//!    shows a toast.
//! 3. `NetworkError` — the driver died on a TCP fault. The frontend shows a
//!    toast.
//!
//! This integration test checks the serialization of the enum itself plus the
//! classification helper. Live PG/MySQL/Mongo cancel timing belongs to the
//! separate cancel_pg / cancel_mysql / cancel_mongo integration tests.

use table_view_lib::commands::cancel_query::{classify_cancel_error, CancelError};
use table_view_lib::error::AppError;

#[test]
fn already_completed_serialises_with_stable_tag() {
    // The frontend branches on the discriminator, so the wire shape must not
    // change. The JSON serialization has the `{"type": "AlreadyCompleted"}` shape.
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
    // When PG `pg_cancel_backend` returns `false` we raise an explicit
    // "Permission" message — classify recognises it unchanged.
    let class = classify_cancel_error("permission denied for function pg_cancel_backend");
    assert!(matches!(class, CancelError::PermissionDenied { .. }));
}

#[test]
fn classify_already_completed_strings() {
    // Our sentinel string for the case where affinity holds no server_pid (or
    // the server answers that the query already finished).
    let class = classify_cancel_error("query already completed");
    assert!(matches!(class, CancelError::AlreadyCompleted));
}

#[test]
fn classify_network_error_strings() {
    // sqlx's TCP error message patterns.
    let class = classify_cancel_error("connection refused");
    assert!(matches!(class, CancelError::NetworkError { .. }));
    let class2 = classify_cancel_error("broken pipe");
    assert!(matches!(class2, CancelError::NetworkError { .. }));
}

#[test]
fn classify_unknown_strings_default_to_network_error() {
    // An unclassified message is raised conservatively as NetworkError: the
    // default is a toast rather than silence, so the user sees it.
    let class = classify_cancel_error("some unexpected wire trouble");
    assert!(matches!(class, CancelError::NetworkError { .. }));
}
