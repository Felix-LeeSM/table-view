//! SQLite file creation command.

use crate::db::sqlite::SqliteAdapter;
use crate::error::AppError;

#[tauri::command]
pub async fn create_sqlite_database_file(path: String) -> Result<String, AppError> {
    SqliteAdapter::create_database_file(&path).await
}
