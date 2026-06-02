use serde::{Deserialize, Serialize};

use super::{QueryColumn, QueryResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileAnalyticsSourceKind {
    Csv,
    Parquet,
    Json,
    Ndjson,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalyticsSource {
    pub id: String,
    pub alias: String,
    pub file_name: String,
    pub kind: FileAnalyticsSourceKind,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalyticsSourceMetadata {
    pub source: FileAnalyticsSource,
    pub columns: Vec<QueryColumn>,
    pub preview_sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalyticsPreview {
    pub source: FileAnalyticsSource,
    pub result: QueryResult,
    pub executed_sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalyticsQueryResponse {
    pub source: FileAnalyticsSource,
    pub result: QueryResult,
    pub executed_sql: String,
}
