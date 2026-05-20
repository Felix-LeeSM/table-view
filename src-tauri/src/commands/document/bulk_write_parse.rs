use crate::db::BulkWriteOp;
use crate::error::AppError;

fn json_to_bson_document(
    value: serde_json::Value,
    field: &str,
) -> Result<bson::Document, AppError> {
    let obj = match value {
        serde_json::Value::Object(map) => map,
        other => {
            return Err(AppError::Validation(format!(
                "bulkWrite {field} must be a JSON object, got {}",
                match other {
                    serde_json::Value::Null => "null",
                    serde_json::Value::Bool(_) => "boolean",
                    serde_json::Value::Number(_) => "number",
                    serde_json::Value::String(_) => "string",
                    serde_json::Value::Array(_) => "array",
                    serde_json::Value::Object(_) => unreachable!(),
                }
            )))
        }
    };

    bson::Document::try_from(obj).map_err(|e| {
        AppError::Validation(format!("invalid extended-JSON in bulkWrite {field}: {e}"))
    })
}

fn json_to_bool(value: Option<serde_json::Value>, field: &str) -> Result<bool, AppError> {
    match value {
        None => Ok(false),
        Some(serde_json::Value::Bool(v)) => Ok(v),
        Some(_) => Err(AppError::Validation(format!(
            "bulkWrite {field} must be a boolean"
        ))),
    }
}

fn required_field(
    map: &mut serde_json::Map<String, serde_json::Value>,
    op: &str,
    field: &str,
) -> Result<serde_json::Value, AppError> {
    map.remove(field)
        .ok_or_else(|| AppError::Validation(format!("bulkWrite {op} operation is missing {field}")))
}

pub(super) fn parse_bulk_write_operations(
    operations: Vec<serde_json::Value>,
) -> Result<Vec<BulkWriteOp>, AppError> {
    operations
        .into_iter()
        .enumerate()
        .map(|(idx, value)| {
            let mut map = match value {
                serde_json::Value::Object(map) => map,
                _ => {
                    return Err(AppError::Validation(format!(
                        "bulkWrite operation {idx} must be a JSON object"
                    )))
                }
            };

            let op = required_field(&mut map, "operation", "op")?;
            let op = op.as_str().ok_or_else(|| {
                AppError::Validation(format!("bulkWrite operation {idx} op must be a string"))
            })?;
            match op {
                "insertOne" => Ok(BulkWriteOp::InsertOne {
                    document: json_to_bson_document(
                        required_field(&mut map, op, "document")?,
                        "insertOne.document",
                    )?,
                }),
                "updateOne" => Ok(BulkWriteOp::UpdateOne {
                    filter: json_to_bson_document(
                        required_field(&mut map, op, "filter")?,
                        "updateOne.filter",
                    )?,
                    update: json_to_bson_document(
                        required_field(&mut map, op, "update")?,
                        "updateOne.update",
                    )?,
                    upsert: json_to_bool(map.remove("upsert"), "updateOne.upsert")?,
                }),
                "updateMany" => Ok(BulkWriteOp::UpdateMany {
                    filter: json_to_bson_document(
                        required_field(&mut map, op, "filter")?,
                        "updateMany.filter",
                    )?,
                    update: json_to_bson_document(
                        required_field(&mut map, op, "update")?,
                        "updateMany.update",
                    )?,
                    upsert: json_to_bool(map.remove("upsert"), "updateMany.upsert")?,
                }),
                "deleteOne" => Ok(BulkWriteOp::DeleteOne {
                    filter: json_to_bson_document(
                        required_field(&mut map, op, "filter")?,
                        "deleteOne.filter",
                    )?,
                }),
                "deleteMany" => Ok(BulkWriteOp::DeleteMany {
                    filter: json_to_bson_document(
                        required_field(&mut map, op, "filter")?,
                        "deleteMany.filter",
                    )?,
                }),
                "replaceOne" => Ok(BulkWriteOp::ReplaceOne {
                    filter: json_to_bson_document(
                        required_field(&mut map, op, "filter")?,
                        "replaceOne.filter",
                    )?,
                    replacement: json_to_bson_document(
                        required_field(&mut map, op, "replacement")?,
                        "replaceOne.replacement",
                    )?,
                    upsert: json_to_bool(map.remove("upsert"), "replaceOne.upsert")?,
                }),
                _ => Err(AppError::Validation(format!(
                    "unsupported bulkWrite operation: {op}"
                ))),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use bson::{doc, Bson};
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_extended_json_object_id_filter() {
        let parsed = parse_bulk_write_operations(vec![json!({
            "op": "updateOne",
            "filter": { "_id": { "$oid": "65abcdef0123456789abcdef" } },
            "update": { "$set": { "name": "Ada" } }
        })])
        .expect("operation should parse");

        let BulkWriteOp::UpdateOne { filter, update, .. } = &parsed[0] else {
            panic!("expected updateOne");
        };
        assert!(matches!(filter.get("_id"), Some(Bson::ObjectId(_))));
        assert_eq!(update, &doc! { "$set": { "name": "Ada" } });
    }
}
