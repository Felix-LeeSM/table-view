// Sprint 238 AC-238-02 — PostgreSQL `data_type` → `ColumnCategory` 매핑.
// 작성일 2026-05-10.

use crate::models::ColumnCategory;

/// PostgreSQL `sqlx` Type 의 표시명 (`type_info().to_string()`) 을
/// DataGrid display category 로 변환한다. 미지 type 은 `Unknown` fallback.
pub fn map_pg_data_type(data_type: &str) -> ColumnCategory {
    match data_type.to_ascii_lowercase().as_str() {
        "int2" | "int4" | "int8" | "smallint" | "integer" | "bigint" | "smallserial" | "serial"
        | "bigserial" | "oid" => ColumnCategory::Int,

        "numeric" | "decimal" | "real" | "double precision" | "float4" | "float8" | "money" => {
            ColumnCategory::Float
        }

        "bool" | "boolean" => ColumnCategory::Bool,

        "date" | "time" | "timetz" | "timestamp" | "timestamptz" | "interval" => {
            ColumnCategory::Datetime
        }

        "json" | "jsonb" => ColumnCategory::Object,

        "bytea" => ColumnCategory::Binary,

        // text / varchar / character / char / uuid / inet / cidr / macaddr / xml 등
        // 모두 가독 가능한 텍스트 → Text 로 흡수 (spec: uuid → text 흡수).
        "text" | "varchar" | "character varying" | "char" | "character" | "name" | "uuid"
        | "inet" | "cidr" | "macaddr" | "macaddr8" | "xml" | "citext" => ColumnCategory::Text,

        _ => ColumnCategory::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_integer_aliases_to_int() {
        for s in [
            "int2", "int4", "int8", "smallint", "integer", "bigint", "serial",
        ] {
            assert_eq!(map_pg_data_type(s), ColumnCategory::Int, "{s}");
        }
    }

    #[test]
    fn maps_float_aliases_to_float() {
        for s in [
            "numeric",
            "decimal",
            "real",
            "double precision",
            "float4",
            "float8",
        ] {
            assert_eq!(map_pg_data_type(s), ColumnCategory::Float, "{s}");
        }
    }

    #[test]
    fn maps_bool_aliases_to_bool() {
        for s in ["bool", "boolean"] {
            assert_eq!(map_pg_data_type(s), ColumnCategory::Bool, "{s}");
        }
    }

    #[test]
    fn maps_date_time_aliases_to_datetime() {
        for s in [
            "date",
            "time",
            "timetz",
            "timestamp",
            "timestamptz",
            "interval",
        ] {
            assert_eq!(map_pg_data_type(s), ColumnCategory::Datetime, "{s}");
        }
    }

    #[test]
    fn maps_json_to_object() {
        for s in ["json", "jsonb"] {
            assert_eq!(map_pg_data_type(s), ColumnCategory::Object, "{s}");
        }
    }

    #[test]
    fn maps_bytea_to_binary() {
        assert_eq!(map_pg_data_type("bytea"), ColumnCategory::Binary);
    }

    #[test]
    fn maps_text_uuid_inet_to_text_per_spec() {
        // AC-238-02: uuid → text 흡수.
        for s in [
            "text",
            "varchar",
            "character varying",
            "char",
            "uuid",
            "inet",
            "cidr",
            "xml",
        ] {
            assert_eq!(map_pg_data_type(s), ColumnCategory::Text, "{s}");
        }
    }

    #[test]
    fn maps_unknown_custom_type_to_unknown() {
        // PG custom enum type, hstore, geometry, range type 등 미지 입력.
        for s in ["hstore", "geometry", "ltree", "tsvector", "my_custom_enum"] {
            assert_eq!(map_pg_data_type(s), ColumnCategory::Unknown, "{s}");
        }
    }

    #[test]
    fn is_case_insensitive() {
        assert_eq!(map_pg_data_type("INT4"), ColumnCategory::Int);
        assert_eq!(map_pg_data_type("VarChar"), ColumnCategory::Text);
        assert_eq!(map_pg_data_type("Boolean"), ColumnCategory::Bool);
    }
}
