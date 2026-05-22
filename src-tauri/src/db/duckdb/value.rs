use duckdb::types::{TimeUnit, Value, ValueRef};

pub(super) fn value_ref_to_json(value: ValueRef<'_>) -> serde_json::Value {
    value_to_json(value.to_owned())
}

fn value_to_json(value: Value) -> serde_json::Value {
    match value {
        Value::Null => serde_json::Value::Null,
        Value::Boolean(v) => serde_json::Value::Bool(v),
        Value::TinyInt(v) => serde_json::Value::Number(v.into()),
        Value::SmallInt(v) => serde_json::Value::Number(v.into()),
        Value::Int(v) => serde_json::Value::Number(v.into()),
        Value::BigInt(v) => serde_json::Value::Number(v.into()),
        Value::HugeInt(v) => i64::try_from(v)
            .map(|n| serde_json::Value::Number(n.into()))
            .unwrap_or_else(|_| serde_json::Value::String(v.to_string())),
        Value::UTinyInt(v) => serde_json::Value::Number(v.into()),
        Value::USmallInt(v) => serde_json::Value::Number(v.into()),
        Value::UInt(v) => serde_json::Value::Number(v.into()),
        Value::UBigInt(v) => i64::try_from(v)
            .map(|n| serde_json::Value::Number(n.into()))
            .unwrap_or_else(|_| serde_json::Value::String(v.to_string())),
        Value::Float(v) => serde_json::Number::from_f64(v as f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Double(v) => serde_json::Number::from_f64(v)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Decimal(v) => serde_json::Value::String(v.to_string()),
        Value::Timestamp(unit, v) => {
            serde_json::Value::String(format!("{} {}", time_unit_label(unit), v))
        }
        Value::Text(v) => serde_json::Value::String(v),
        Value::Blob(v) => serde_json::Value::String(format!("0x{}", hex_encode(&v))),
        Value::Date32(v) => serde_json::Value::String(format!("date32:{v}")),
        Value::Time64(unit, v) => {
            serde_json::Value::String(format!("{} {}", time_unit_label(unit), v))
        }
        Value::Interval {
            months,
            days,
            nanos,
        } => serde_json::json!({ "months": months, "days": days, "nanos": nanos }),
        Value::List(values) | Value::Array(values) => {
            serde_json::Value::Array(values.into_iter().map(value_to_json).collect())
        }
        Value::Enum(v) => serde_json::Value::String(v),
        Value::Struct(fields) => serde_json::Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), value_to_json(value.clone())))
                .collect(),
        ),
        Value::Map(entries) => serde_json::Value::Object(
            entries
                .iter()
                .map(|(key, value)| {
                    (
                        value_to_json(key.clone()).to_string(),
                        value_to_json(value.clone()),
                    )
                })
                .collect(),
        ),
        Value::Union(value) => value_to_json(*value),
    }
}

fn time_unit_label(unit: TimeUnit) -> &'static str {
    match unit {
        TimeUnit::Second => "seconds",
        TimeUnit::Millisecond => "milliseconds",
        TimeUnit::Microsecond => "microseconds",
        TimeUnit::Nanosecond => "nanoseconds",
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(*b >> 4) as usize] as char);
        out.push(HEX[(*b & 0x0f) as usize] as char);
    }
    out
}
