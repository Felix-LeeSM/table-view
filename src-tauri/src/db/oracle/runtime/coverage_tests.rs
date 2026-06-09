use oracle_rs::{
    types::{OracleDate, OracleNumber, OracleTimestamp, RowId},
    ColumnInfo as OracleColumnInfo, OracleType, Value,
};

use super::*;

#[test]
fn oracle_query_columns_cover_supported_oracle_type_categories() {
    let mut number = OracleColumnInfo::new("AMOUNT", OracleType::Number);
    number.precision = 12;
    number.scale = 2;
    let mapped_number = oracle_query_column(&number);
    assert_eq!(mapped_number.data_type, "number(12,2)");
    assert_eq!(mapped_number.category, ColumnCategory::Float);

    let number_without_precision = OracleColumnInfo::new("COUNT_VALUE", OracleType::Number);
    let mapped_count = oracle_query_column(&number_without_precision);
    assert_eq!(mapped_count.data_type, "number");
    assert_eq!(mapped_count.category, ColumnCategory::Int);

    let cases = [
        (OracleType::Varchar, "varchar2", ColumnCategory::Text),
        (
            OracleType::BinaryInteger,
            "binary_integer",
            ColumnCategory::Int,
        ),
        (OracleType::Long, "long", ColumnCategory::Text),
        (OracleType::Rowid, "rowid", ColumnCategory::Text),
        (OracleType::Date, "date", ColumnCategory::Datetime),
        (OracleType::Raw, "raw", ColumnCategory::Binary),
        (OracleType::LongRaw, "long raw", ColumnCategory::Binary),
        (OracleType::Char, "char", ColumnCategory::Text),
        (
            OracleType::BinaryFloat,
            "binary_float",
            ColumnCategory::Float,
        ),
        (
            OracleType::BinaryDouble,
            "binary_double",
            ColumnCategory::Float,
        ),
        (OracleType::Cursor, "ref cursor", ColumnCategory::Object),
        (OracleType::Object, "object", ColumnCategory::Object),
        (OracleType::Clob, "clob", ColumnCategory::Text),
        (OracleType::Blob, "blob", ColumnCategory::Binary),
        (OracleType::Bfile, "bfile", ColumnCategory::Binary),
        (OracleType::Json, "json", ColumnCategory::Object),
        (OracleType::Vector, "vector", ColumnCategory::Object),
        (OracleType::Timestamp, "timestamp", ColumnCategory::Datetime),
        (
            OracleType::TimestampTz,
            "timestamp with time zone",
            ColumnCategory::Datetime,
        ),
        (
            OracleType::IntervalYm,
            "interval year to month",
            ColumnCategory::Text,
        ),
        (
            OracleType::IntervalDs,
            "interval day to second",
            ColumnCategory::Text,
        ),
        (OracleType::Urowid, "urowid", ColumnCategory::Text),
        (
            OracleType::TimestampLtz,
            "timestamp with local time zone",
            ColumnCategory::Datetime,
        ),
        (OracleType::Boolean, "boolean", ColumnCategory::Bool),
    ];

    for (oracle_type, data_type, category) in cases {
        let column = OracleColumnInfo::new(format!("{oracle_type:?}"), oracle_type);
        let mapped = oracle_query_column(&column);
        assert_eq!(mapped.data_type, data_type, "{oracle_type:?}");
        assert_eq!(mapped.category, category, "{oracle_type:?}");
    }
}

#[test]
fn oracle_value_to_json_formats_scalar_edges() {
    let valid_rowid = RowId::new(1, 2, 3, 4);

    let cases = [
        (Value::Null, serde_json::Value::Null),
        (Value::String("Ada".into()), serde_json::json!("Ada")),
        (
            Value::Bytes(vec![0, 15, 255]),
            serde_json::json!("0x000fff"),
        ),
        (Value::Integer(42), serde_json::json!(42)),
        (Value::Float(12.5), serde_json::json!(12.5)),
        (Value::Float(f64::NAN), serde_json::Value::Null),
        (
            Value::Number(OracleNumber::new("9223372036854775808")),
            serde_json::json!("9223372036854775808"),
        ),
        (
            Value::Number(OracleNumber::new("12.5")),
            serde_json::json!(12.5),
        ),
        (
            Value::Number(OracleNumber::new("not.number")),
            serde_json::json!("not.number"),
        ),
        (
            Value::Date(OracleDate::new(2026, 6, 8, 9, 10, 11)),
            serde_json::json!("2026-06-08 09:10:11"),
        ),
        (
            Value::Timestamp(OracleTimestamp::with_timezone(
                2026, 6, 8, 9, 10, 11, 1200, 5, 30,
            )),
            serde_json::json!("2026-06-08 09:10:11.001200 +05:30"),
        ),
        (
            Value::RowId(valid_rowid),
            serde_json::json!(valid_rowid.to_string().expect("valid rowid string")),
        ),
        (Value::RowId(RowId::default()), serde_json::Value::Null),
        (Value::Boolean(false), serde_json::json!(false)),
        (
            Value::Json(serde_json::json!({"catalog": "oracle"})),
            serde_json::json!({"catalog": "oracle"}),
        ),
    ];

    for (value, expected) in cases {
        assert_eq!(oracle_value_to_json(&value), expected);
    }
}
