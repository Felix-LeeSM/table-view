use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Native cancel failure shape returned by `cancel_query_native`.
///
/// The frontend uses the `type` discriminator to decide whether the cancel
/// race is silent (`AlreadyCompleted`) or user-visible (`PermissionDenied` /
/// `NetworkError`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CancelError {
    AlreadyCompleted,
    PermissionDenied { message: String },
    NetworkError { message: String },
}

impl std::fmt::Display for CancelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CancelError::AlreadyCompleted => f.write_str("Cancel: query already completed"),
            CancelError::PermissionDenied { message } => {
                write!(f, "Cancel: permission denied ({message})")
            }
            CancelError::NetworkError { message } => {
                write!(f, "Cancel: network error ({message})")
            }
        }
    }
}

impl std::error::Error for CancelError {}

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Search authentication error: {0}")]
    SearchAuthentication(String),

    #[error("Search TLS error: {0}")]
    SearchTls(String),

    #[error("Search network error: {0}")]
    SearchNetwork(String),

    #[error("Search timeout error: {0}")]
    SearchTimeout(String),

    #[error("Search permission error: {0}")]
    SearchPermission(String),

    #[error("Search unsupported version: {0}")]
    SearchUnsupportedVersion(String),

    #[error("Search product mismatch: {0}")]
    SearchProductMismatch(String),

    #[error("Search shard failure: {0}")]
    SearchShardFailure(String),

    #[error("Search partial failure: {0}")]
    SearchPartialFailure(String),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Not found: {0}")]
    NotFound(String),

    /// Issue #1584 — defense-in-depth: a sensitive command was invoked from a
    /// window whose label is not permitted to run it (the launcher webview).
    /// launcher/workspace share one SPA bundle and Tauri v2 ACL does not gate
    /// app-defined commands, so this runtime label guard is the backend
    /// enforcement point. Serializes via the catch-all as its Display string.
    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error(transparent)]
    Cancel(#[from] CancelError),

    #[error("Unsupported operation: {0}")]
    Unsupported(String),

    /// Sprint 266 — backend pool 의 활성 db 가 frontend 의 기대 db 와 다른
    /// 상태에서 RDB 실행 명령이 도착했을 때. `execute_query` /
    /// `execute_query_batch` 의 사전 검증이 throw. UI 는 `expected` / `actual`
    /// 을 모두 표시해 race 의 양쪽을 보여줘야 함.
    #[error("Database mismatch: expected '{expected}', but found '{actual}'")]
    DbMismatch { expected: String, actual: String },

    #[error("Window error: {0}")]
    Window(String),

    /// Sprint 355 — A/C 도메인 mutate IPC 는 boot 시 frontend → backend 의
    /// legacy localStorage import 가 완료된 후에만 진행할 수 있다. import 가
    /// `pending` / `importing` / `failed` 상태일 때 mutate 가 들어오면 본
    /// variant 로 reject. Frontend 는 retry path 로 import 를 재시도하거나
    /// 사용자에게 safe-mode 진입을 알린다. Strategy line 1189.
    #[error("Legacy import in progress — write blocked")]
    LegacyImportInProgress,

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

impl AppError {
    /// Issue #1453 — forced constructor for connection errors that embed
    /// driver/config text. Masks URI userinfo (`://user:secret@`) and
    /// key=value (`password=` / `pwd=`) credential values before the
    /// message can reach status events, the sidebar, or logs. Adapters
    /// must route driver connect/ping errors through this instead of
    /// `AppError::Connection` directly (static messages are exempt).
    pub fn connection_redacted(message: impl Into<String>) -> Self {
        AppError::Connection(crate::storage::sql_redact::redact_connection_message(
            &message.into(),
        ))
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            AppError::Cancel(error) => {
                #[derive(Serialize)]
                struct CancelEnvelope<'a> {
                    #[serde(rename = "type")]
                    kind: &'static str,
                    payload: &'a CancelError,
                }

                CancelEnvelope {
                    kind: "Cancel",
                    payload: error,
                }
                .serialize(serializer)
            }
            AppError::DbMismatch { expected, actual } => {
                #[derive(Serialize)]
                struct DbMismatchPayload<'a> {
                    expected: &'a str,
                    actual: &'a str,
                }

                #[derive(Serialize)]
                struct DbMismatchEnvelope<'a> {
                    #[serde(rename = "type")]
                    kind: &'static str,
                    message: String,
                    payload: DbMismatchPayload<'a>,
                }

                DbMismatchEnvelope {
                    kind: "DbMismatch",
                    message: self.to_string(),
                    payload: DbMismatchPayload { expected, actual },
                }
                .serialize(serializer)
            }
            _ => serializer.serialize_str(self.to_string().as_str()),
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::Database(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display_formats() {
        assert_eq!(
            AppError::Connection("refused".into()).to_string(),
            "Connection error: refused"
        );
        assert_eq!(
            AppError::SearchAuthentication("bad credentials".into()).to_string(),
            "Search authentication error: bad credentials"
        );
        assert_eq!(
            AppError::SearchTls("certificate rejected".into()).to_string(),
            "Search TLS error: certificate rejected"
        );
        assert_eq!(
            AppError::SearchNetwork("connection refused".into()).to_string(),
            "Search network error: connection refused"
        );
        assert_eq!(
            AppError::SearchTimeout("root probe".into()).to_string(),
            "Search timeout error: root probe"
        );
        assert_eq!(
            AppError::SearchPermission("forbidden".into()).to_string(),
            "Search permission error: forbidden"
        );
        assert_eq!(
            AppError::SearchUnsupportedVersion("6.8.23".into()).to_string(),
            "Search unsupported version: 6.8.23"
        );
        assert_eq!(
            AppError::SearchProductMismatch("OpenSearch detected".into()).to_string(),
            "Search product mismatch: OpenSearch detected"
        );
        assert_eq!(
            AppError::SearchShardFailure("all shards failed".into()).to_string(),
            "Search shard failure: all shards failed"
        );
        assert_eq!(
            AppError::SearchPartialFailure("1 shard failed".into()).to_string(),
            "Search partial failure: 1 shard failed"
        );
        assert_eq!(
            AppError::Storage("file not found".into()).to_string(),
            "Storage error: file not found"
        );
        assert_eq!(
            AppError::Encryption("bad key".into()).to_string(),
            "Encryption error: bad key"
        );
        assert_eq!(
            AppError::Validation("empty name".into()).to_string(),
            "Validation error: empty name"
        );
        assert_eq!(
            AppError::NotFound("id-123".into()).to_string(),
            "Not found: id-123"
        );
        assert_eq!(
            AppError::Forbidden("launcher window".into()).to_string(),
            "Forbidden: launcher window"
        );
        assert_eq!(
            AppError::Unsupported("mysql".into()).to_string(),
            "Unsupported operation: mysql"
        );
        assert_eq!(
            AppError::Window("launcher build failed".into()).to_string(),
            "Window error: launcher build failed"
        );
    }

    // Reason: issue #1453 — the forced connection-error constructor must
    // mask credential echoes (URI userinfo + key=value) while keeping the
    // `Connection error:` envelope and non-secret context (2026-07-10).
    #[test]
    fn connection_redacted_masks_uri_and_kv_credentials() {
        let err = AppError::connection_redacted(
            "could not connect to mysql://root:S3cretPw1@db:3306/app password=S3cretPw1",
        );
        let message = err.to_string();
        assert!(
            !message.contains("S3cretPw1"),
            "leaked plaintext credential: {message}"
        );
        assert_eq!(
            message,
            "Connection error: could not connect to mysql://root:***@db:3306/app password=***"
        );
    }

    #[test]
    fn generic_error_serializes_to_legacy_string() {
        let err = AppError::Connection("timeout".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"Connection error: timeout\"");
    }

    #[test]
    fn db_mismatch_serializes_to_typed_envelope_with_message() {
        let err = AppError::DbMismatch {
            expected: "db1".into(),
            actual: "db2".into(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["type"], "DbMismatch");
        assert_eq!(
            json["message"],
            "Database mismatch: expected 'db1', but found 'db2'"
        );
        assert_eq!(json["payload"]["expected"], "db1");
        assert_eq!(json["payload"]["actual"], "db2");
    }

    #[test]
    fn cancel_error_serializes_to_typed_envelope() {
        let err = AppError::Cancel(CancelError::PermissionDenied {
            message: "cannot kill backend".into(),
        });
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["type"], "Cancel");
        assert_eq!(json["payload"]["type"], "PermissionDenied");
        assert_eq!(json["payload"]["message"], "cannot kill backend");
    }

    #[test]
    fn io_error_converts_to_app_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let app_err: AppError = io_err.into();
        match app_err {
            AppError::Io(_) => {}
            other => panic!("Expected Io variant, got {:?}", other),
        }
    }

    #[test]
    fn serde_error_converts_to_app_error() {
        let serde_err: serde_json::Error = serde_json::from_str::<i32>("not a number").unwrap_err();
        let app_err: AppError = serde_err.into();
        match app_err {
            AppError::Serde(_) => {}
            other => panic!("Expected Serde variant, got {:?}", other),
        }
    }
}
