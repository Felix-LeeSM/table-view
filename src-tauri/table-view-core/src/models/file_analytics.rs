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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_metadata_public_shape_excludes_local_paths() {
        let metadata = FileAnalyticsSourceMetadata {
            source: FileAnalyticsSource {
                id: "src-1".into(),
                alias: "sales_csv".into(),
                file_name: "sales.csv".into(),
                kind: FileAnalyticsSourceKind::Csv,
                size_bytes: 42,
            },
            columns: vec![],
            preview_sql: "SELECT * FROM \"sales_csv\" LIMIT 100".into(),
        };

        let value = serde_json::to_value(metadata).unwrap();
        let source = value
            .get("source")
            .and_then(serde_json::Value::as_object)
            .unwrap();

        let mut keys = source.keys().cloned().collect::<Vec<_>>();
        keys.sort();
        assert_eq!(keys, vec!["alias", "fileName", "id", "kind", "sizeBytes"]);
        assert!(!value.to_string().contains("/Users/felix/private/sales.csv"));
        assert!(value.to_string().contains("sales.csv"));
    }
}
