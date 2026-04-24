use thiserror::Error;

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

    #[error("Unsupported operation: {0}")]
    Unsupported(String),

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
        serializer.serialize_str(self.to_string().as_str())
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
    }

    #[test]
    fn error_serialize_to_string() {
        let err = AppError::Connection("timeout".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"Connection error: timeout\"");
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
