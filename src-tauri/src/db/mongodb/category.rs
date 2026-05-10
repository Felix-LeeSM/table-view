// Sprint 238 AC-238-02 — Mongo BSON type tag → `ColumnCategory` 매핑.
// 작성일 2026-05-10. BSON tag 의 정의는 `bson_type_name` (queries.rs) 에 lock.

use crate::models::ColumnCategory;

/// Mongo BSON type tag (예: "Int32", "String", "ObjectId") 를 DataGrid
/// display category 로 매핑한다.
///
/// 동적 schema (한 column 안에서 row 마다 다른 type) 의 경우 column 의
/// modal type tag (가장 빈도 높은 type) 가 입력으로 들어오므로 — 본
/// 함수는 단일 tag 만 본다. 미지 tag 는 `Unknown` fallback.
pub fn map_mongo_data_type(data_type: &str) -> ColumnCategory {
    match data_type {
        "Int32" | "Int64" => ColumnCategory::Int,
        "Double" | "Decimal128" => ColumnCategory::Float,
        "Boolean" => ColumnCategory::Bool,
        "DateTime" | "Timestamp" => ColumnCategory::Datetime,
        "Document"
        | "Array"
        | "RegularExpression"
        | "JavaScriptCode"
        | "JavaScriptCodeWithScope"
        | "DbPointer" => ColumnCategory::Object,
        "Binary" => ColumnCategory::Binary,
        // String / ObjectId (24 hex chars) / Symbol — spec: uuid 류 → text 흡수.
        "String" | "ObjectId" | "Symbol" => ColumnCategory::Text,
        // Null / Undefined / MaxKey / MinKey — sentinel, 폭 산식에 의미 없음.
        _ => ColumnCategory::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_int_variants_to_int() {
        for s in ["Int32", "Int64"] {
            assert_eq!(map_mongo_data_type(s), ColumnCategory::Int, "{s}");
        }
    }

    #[test]
    fn maps_float_variants_to_float() {
        for s in ["Double", "Decimal128"] {
            assert_eq!(map_mongo_data_type(s), ColumnCategory::Float, "{s}");
        }
    }

    #[test]
    fn maps_boolean_to_bool() {
        assert_eq!(map_mongo_data_type("Boolean"), ColumnCategory::Bool);
    }

    #[test]
    fn maps_datetime_and_timestamp_to_datetime() {
        for s in ["DateTime", "Timestamp"] {
            assert_eq!(map_mongo_data_type(s), ColumnCategory::Datetime, "{s}");
        }
    }

    #[test]
    fn maps_document_and_array_to_object() {
        for s in ["Document", "Array", "RegularExpression", "JavaScriptCode"] {
            assert_eq!(map_mongo_data_type(s), ColumnCategory::Object, "{s}");
        }
    }

    #[test]
    fn maps_binary_to_binary() {
        assert_eq!(map_mongo_data_type("Binary"), ColumnCategory::Binary);
    }

    #[test]
    fn maps_string_and_objectid_and_symbol_to_text() {
        // AC-238-02: 가독 가능한 텍스트류 (uuid 흡수 패턴) 는 Text.
        for s in ["String", "ObjectId", "Symbol"] {
            assert_eq!(map_mongo_data_type(s), ColumnCategory::Text, "{s}");
        }
    }

    #[test]
    fn maps_sentinels_and_unknown_to_unknown() {
        for s in ["Null", "Undefined", "MaxKey", "MinKey", "MysteryTag"] {
            assert_eq!(map_mongo_data_type(s), ColumnCategory::Unknown, "{s}");
        }
    }

    #[test]
    fn is_case_sensitive() {
        // Mongo BSON tag 는 PascalCase 로 fixed. 소문자 입력은 미지로 처리.
        assert_eq!(map_mongo_data_type("string"), ColumnCategory::Unknown);
    }
}
