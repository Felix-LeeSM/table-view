// Sprint 238 AC-238-02 — PostgreSQL `data_type` → `ColumnCategory` 매핑.
// Sprint 258 — `format_type(atttypid, atttypmod)` 결과 (varchar(200),
// numeric(10,2), text[], timestamp with time zone …) 를 DDL-level 친화
// 표기로 정규화 (`normalize_pg_type`) + parameter / array 표기에서 base
// type 만 잘라 category 매핑.

use crate::models::ColumnCategory;

/// Sprint 259 — `format_type` 은 SERIAL 의 underlying type (`integer` /
/// `bigint` / `smallint`) 만 노출하므로, default 가 `nextval(...)` 인
/// 정수 컬럼을 원래의 `serial` / `bigserial` / `smallserial` DDL 표기로
/// 복원한다. category 매핑에는 영향 없음 (정수 → Int 그대로).
pub fn restore_serial(data_type: String, default_value: Option<&str>) -> String {
    let is_nextval = default_value
        .map(|d| d.trim_start().to_ascii_lowercase().starts_with("nextval("))
        .unwrap_or(false);
    if !is_nextval {
        return data_type;
    }
    match data_type.as_str() {
        "smallint" => "smallserial".to_string(),
        "integer" => "serial".to_string(),
        "bigint" => "bigserial".to_string(),
        _ => data_type,
    }
}

/// `pg_catalog.format_type` 의 raw 출력 (`character varying(200)`,
/// `timestamp with time zone` …) 을 psql `\d` 와 일치하는 단축형으로
/// 변환한다. DDL-level 표기성은 유지하되 사용자 가독성을 높인다.
///
/// 변환 대상:
/// - `character varying(N)` → `varchar(N)`, `character varying` → `varchar`
/// - `character(N)` → `char(N)`, `character` → `char`
/// - `timestamp with time zone` → `timestamptz`
/// - `timestamp without time zone` → `timestamp`
/// - `time with time zone` → `timetz`
/// - `time without time zone` → `time`
pub fn normalize_pg_type(raw: &str) -> String {
    // 긴 패턴 먼저 (substring overlap 가드).
    let pairs: &[(&str, &str)] = &[
        ("character varying", "varchar"),
        ("timestamp with time zone", "timestamptz"),
        ("timestamp without time zone", "timestamp"),
        ("time with time zone", "timetz"),
        ("time without time zone", "time"),
        ("character", "char"),
    ];
    let mut s = raw.to_string();
    for (from, to) in pairs {
        s = s.replace(from, to);
    }
    s
}

/// PostgreSQL DDL-level type (`varchar(200)`, `text[]`, `numeric(10,2)`,
/// `timestamptz` …) 또는 `type_info().to_string()` 의 short alias 를
/// DataGrid display category 로 변환한다. 미지 type 은 `Unknown` fallback.
pub fn map_pg_data_type(data_type: &str) -> ColumnCategory {
    let lower = data_type.to_ascii_lowercase();
    let lower = lower.trim();

    // Array (text[], integer[]) → Object (JSON-like display).
    if lower.ends_with("[]") {
        return ColumnCategory::Object;
    }

    // Strip parameter clauses (varchar(200), numeric(10,2), …).
    let base = match lower.find('(') {
        Some(idx) => lower[..idx].trim_end(),
        None => lower,
    };

    match base {
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

        // Sprint 258 — uuid 별도 카테고리 (36자 고정폭, default 18rem).
        "uuid" => ColumnCategory::Uuid,

        // text / varchar / char / etc. — 가독 가능한 텍스트 흡수.
        // `character varying` / `character` 는 normalize 전 raw 입력도
        // 그대로 통과시키기 위한 legacy fallback.
        "text" | "varchar" | "char" | "name" | "inet" | "cidr" | "macaddr" | "macaddr8" | "xml"
        | "citext" | "character varying" | "character" => ColumnCategory::Text,

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
    fn maps_text_inet_to_text_per_spec() {
        // Sprint 258 — uuid 는 별도 카테고리로 분리됨 (별도 테스트).
        for s in [
            "text",
            "varchar",
            "character varying",
            "char",
            "inet",
            "cidr",
            "xml",
        ] {
            assert_eq!(map_pg_data_type(s), ColumnCategory::Text, "{s}");
        }
    }

    #[test]
    fn maps_uuid_to_uuid_category_sprint_258() {
        // Sprint 258 — uuid 는 own category (default 18rem, left-align).
        assert_eq!(map_pg_data_type("uuid"), ColumnCategory::Uuid);
        assert_eq!(map_pg_data_type("UUID"), ColumnCategory::Uuid);
    }

    #[test]
    fn strips_parameter_clauses_sprint_258() {
        // format_type 결과 ("varchar(200)", "numeric(10,2)") 도 base
        // type 으로 매칭.
        assert_eq!(map_pg_data_type("varchar(200)"), ColumnCategory::Text);
        assert_eq!(
            map_pg_data_type("character varying(50)"),
            ColumnCategory::Text
        );
        assert_eq!(map_pg_data_type("numeric(10,2)"), ColumnCategory::Float);
        assert_eq!(map_pg_data_type("char(10)"), ColumnCategory::Text);
    }

    #[test]
    fn maps_array_types_to_object_sprint_258() {
        // Array 표기 (text[], integer[]) → Object (JSON-like display).
        assert_eq!(map_pg_data_type("text[]"), ColumnCategory::Object);
        assert_eq!(map_pg_data_type("integer[]"), ColumnCategory::Object);
        assert_eq!(map_pg_data_type("varchar(200)[]"), ColumnCategory::Object);
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

    #[test]
    fn normalize_pg_type_shortens_long_aliases_sprint_258() {
        // psql `\d` 와 일치하는 단축형으로 변환.
        assert_eq!(normalize_pg_type("character varying(200)"), "varchar(200)");
        assert_eq!(normalize_pg_type("character varying"), "varchar");
        assert_eq!(normalize_pg_type("character(10)"), "char(10)");
        assert_eq!(normalize_pg_type("character"), "char");
        assert_eq!(normalize_pg_type("timestamp with time zone"), "timestamptz");
        assert_eq!(
            normalize_pg_type("timestamp without time zone"),
            "timestamp"
        );
        assert_eq!(normalize_pg_type("time with time zone"), "timetz");
        assert_eq!(normalize_pg_type("time without time zone"), "time");
    }

    #[test]
    fn normalize_pg_type_leaves_already_short_forms_unchanged_sprint_258() {
        // 정규화 무관한 입력은 pass-through.
        for s in [
            "integer",
            "bigint",
            "uuid",
            "text",
            "numeric(10,2)",
            "boolean",
            "text[]",
            "jsonb",
        ] {
            assert_eq!(normalize_pg_type(s), s);
        }
    }

    #[test]
    fn restore_serial_restores_integer_with_nextval_default_sprint_259() {
        // SERIAL / BIGSERIAL / SMALLSERIAL 은 format_type 이 underlying
        // 정수 type 만 반환 → nextval(...) default 패턴 검출 시 복원.
        assert_eq!(
            restore_serial(
                "integer".to_string(),
                Some("nextval('public.foo_id_seq'::regclass)")
            ),
            "serial"
        );
        assert_eq!(
            restore_serial(
                "bigint".to_string(),
                Some("nextval('public.foo_id_seq'::regclass)")
            ),
            "bigserial"
        );
        assert_eq!(
            restore_serial(
                "smallint".to_string(),
                Some("nextval('public.foo_id_seq'::regclass)")
            ),
            "smallserial"
        );
    }

    #[test]
    fn restore_serial_passes_through_when_no_nextval_sprint_259() {
        // default 가 nextval 이 아니거나 없으면 정수 type 그대로.
        assert_eq!(restore_serial("integer".to_string(), Some("42")), "integer");
        assert_eq!(restore_serial("integer".to_string(), None), "integer");
        // non-integer type 은 nextval default 가 있어도 pass-through.
        assert_eq!(
            restore_serial("text".to_string(), Some("nextval('foo_seq'::regclass)")),
            "text"
        );
    }

    #[test]
    fn restore_serial_is_case_insensitive_to_default_prefix_sprint_259() {
        // pg_get_expr 의 출력은 일관되게 소문자 nextval 이지만 보강.
        assert_eq!(
            restore_serial("integer".to_string(), Some("NEXTVAL('foo_seq'::regclass)")),
            "serial"
        );
    }
}
