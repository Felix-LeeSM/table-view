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

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Not found: {0}")]
    NotFound(String),

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
    #[error("Database mismatch: expected '{expected}', backend pool has '{actual}'")]
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
            AppError::Unsupported("mysql".into()).to_string(),
            "Unsupported operation: mysql"
        );
        assert_eq!(
            AppError::Window("launcher build failed".into()).to_string(),
            "Window error: launcher build failed"
        );
    }

    #[test]
    fn error_serialize_to_string() {
        let err = AppError::Connection("timeout".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"Connection error: timeout\"");
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
