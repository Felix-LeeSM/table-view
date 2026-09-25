// AC-238-02 — Mongo BSON type tag → `ColumnCategory` mapping.
// Written 2026-05-10. The BSON tag definitions are locked in `bson_type_name`
// (queries.rs).

use crate::models::ColumnCategory;

/// Maps a Mongo BSON type tag (e.g. "Int32", "String", "ObjectId") to a
/// DataGrid display category.
///
/// With a dynamic schema (a different type per row inside one column) the
/// input is the column's modal type tag (its most frequent type), so this
/// function looks at a single tag only. An unknown tag falls back to
/// `Unknown`.
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
        // ObjectId is an id (a fixed 24 hex chars), which means the same as
        // the Uuid category. Unified on the same width policy as PG uuid
        // (default 18rem, left-align).
        "ObjectId" => ColumnCategory::Uuid,
        // String / Symbol — variable-length text.
        "String" | "Symbol" => ColumnCategory::Text,
        // Null / Undefined / MaxKey / MinKey — sentinels, no meaning for the
        // width formula.
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
    fn maps_string_and_symbol_to_text() {
        // Variable-length text (ObjectId is split into the Uuid category).
        for s in ["String", "Symbol"] {
            assert_eq!(map_mongo_data_type(s), ColumnCategory::Text, "{s}");
        }
    }

    #[test]
    fn maps_objectid_to_uuid_category_sprint_259() {
        // ObjectId is an id (a fixed 24 hex chars) and takes the same width
        // policy as PG uuid. Split from text.
        assert_eq!(map_mongo_data_type("ObjectId"), ColumnCategory::Uuid);
    }

    #[test]
    fn maps_sentinels_and_unknown_to_unknown() {
        for s in ["Null", "Undefined", "MaxKey", "MinKey", "MysteryTag"] {
            assert_eq!(map_mongo_data_type(s), ColumnCategory::Unknown, "{s}");
        }
    }

    #[test]
    fn is_case_sensitive() {
        // Mongo BSON tags are fixed PascalCase. Lowercase input is unknown.
        assert_eq!(map_mongo_data_type("string"), ColumnCategory::Unknown);
    }
}
