// AC-238-02 — PostgreSQL `data_type` → `ColumnCategory` mapping.
// `normalize_pg_type` normalises the `format_type(atttypid, atttypmod)` output
// (varchar(200), numeric(10,2), text[], timestamp with time zone …) into
// DDL-friendly notation, and the category mapping cuts the base type out of
// parameter / array notation.

use crate::models::ColumnCategory;

/// `format_type` exposes only SERIAL's underlying type (`integer` / `bigint` /
/// `smallint`), so an integer column whose default is `nextval(...)` is restored
/// to its original `serial` / `bigserial` / `smallserial` DDL notation. The
/// category mapping is unaffected (an integer still maps to Int).
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

/// Convert the raw `pg_catalog.format_type` output (`character varying(200)`,
/// `timestamp with time zone` …) into the short form psql `\d` prints. Keeps the
/// DDL-level notation while making it easier to read.
///
/// Converted:
/// - `character varying(N)` → `varchar(N)`, `character varying` → `varchar`
/// - `character(N)` → `char(N)`, `character` → `char`
/// - `timestamp with time zone` → `timestamptz`
/// - `timestamp without time zone` → `timestamp`
/// - `time with time zone` → `timetz`
/// - `time without time zone` → `time`
pub fn normalize_pg_type(raw: &str) -> String {
    // Longest patterns first (substring overlap guard).
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

/// Convert a PostgreSQL DDL-level type (`varchar(200)`, `text[]`,
/// `numeric(10,2)`, `timestamptz` …) or the short alias from
/// `type_info().to_string()` into a DataGrid display category. An unknown type
/// falls back to `Unknown`.
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

        // uuid gets its own category (fixed 36-char width, default 18rem).
        "uuid" => ColumnCategory::Uuid,

        // text / varchar / char / etc. — absorbs readable text.
        // `character varying` / `character` are the legacy fallback that lets
        // raw, un-normalised input through unchanged.
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
        // uuid is split into its own category (covered by its own test).
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
        // uuid has its own category (default 18rem, left-align).
        assert_eq!(map_pg_data_type("uuid"), ColumnCategory::Uuid);
        assert_eq!(map_pg_data_type("UUID"), ColumnCategory::Uuid);
    }

    #[test]
    fn strips_parameter_clauses_sprint_258() {
        // format_type output ("varchar(200)", "numeric(10,2)") also matches on
        // the base type.
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
        // Array notation (text[], integer[]) → Object (JSON-like display).
        assert_eq!(map_pg_data_type("text[]"), ColumnCategory::Object);
        assert_eq!(map_pg_data_type("integer[]"), ColumnCategory::Object);
        assert_eq!(map_pg_data_type("varchar(200)[]"), ColumnCategory::Object);
    }

    #[test]
    fn maps_unknown_custom_type_to_unknown() {
        // Unknown input: PG custom enum type, hstore, geometry, range type, etc.
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
        // Convert to the short form psql `\d` prints.
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
        // Input that needs no normalisation passes through.
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
        // For SERIAL / BIGSERIAL / SMALLSERIAL, format_type returns only the
        // underlying integer type → restore once the nextval(...) default
        // pattern is detected.
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
        // When the default is not nextval or is absent, the integer type stays.
        assert_eq!(restore_serial("integer".to_string(), Some("42")), "integer");
        assert_eq!(restore_serial("integer".to_string(), None), "integer");
        // A non-integer type passes through even with a nextval default.
        assert_eq!(
            restore_serial("text".to_string(), Some("nextval('foo_seq'::regclass)")),
            "text"
        );
    }

    #[test]
    fn restore_serial_is_case_insensitive_to_default_prefix_sprint_259() {
        // pg_get_expr consistently emits lowercase nextval; this hardens it anyway.
        assert_eq!(
            restore_serial("integer".to_string(), Some("NEXTVAL('foo_seq'::regclass)")),
            "serial"
        );
    }
}
