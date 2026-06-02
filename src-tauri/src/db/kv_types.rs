use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KvKeyType {
    String,
    List,
    Set,
    ZSet,
    Hash,
    Stream,
    Json,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvTtl {
    pub state: KvTtlState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seconds: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KvTtlState {
    Missing,
    Persistent,
    Expires,
}

impl KvTtl {
    pub fn from_redis_ttl(seconds: i64) -> Self {
        match seconds {
            -2 => Self {
                state: KvTtlState::Missing,
                seconds: None,
            },
            -1 => Self {
                state: KvTtlState::Persistent,
                seconds: None,
            },
            n => Self {
                state: KvTtlState::Expires,
                seconds: Some(n),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvDatabaseInfo {
    pub name: String,
    pub index: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_count: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvKeyMetadata {
    pub key: String,
    pub key_type: KvKeyType,
    pub ttl: KvTtl,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvKeyScanRequest {
    #[serde(default)]
    pub database: Option<u16>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub pattern: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvKeyScanPage {
    pub database: u16,
    pub cursor: String,
    pub next_cursor: String,
    pub done: bool,
    pub limit: u32,
    pub keys: Vec<KvKeyMetadata>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvValueReadRequest {
    pub key: String,
    #[serde(default)]
    pub database: Option<u16>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvCommandRequest {
    pub command: String,
    #[serde(default)]
    pub database: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirm_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvValueEnvelope {
    pub key: String,
    pub metadata: KvKeyMetadata,
    pub value: KvValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum KvValue {
    String(KvStringValue),
    List(KvListValue),
    Set(KvSetValue),
    ZSet(KvZSetValue),
    Hash(KvHashValue),
    Stream(KvStreamReadResult),
    Json(KvJsonValue),
    Unsupported { message: String },
    Missing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvStringValue {
    pub encoding: KvStringEncoding,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hex: Option<String>,
    pub byte_length: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KvStringEncoding {
    Utf8,
    Binary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvListValue {
    pub entries: Vec<KvIndexedValue>,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvIndexedValue {
    pub index: i64,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvSetValue {
    pub members: Vec<String>,
    pub cursor: String,
    pub next_cursor: String,
    pub done: bool,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvZSetValue {
    pub entries: Vec<KvScoredValue>,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvScoredValue {
    pub member: String,
    pub score: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvHashValue {
    pub fields: Vec<KvHashField>,
    pub cursor: String,
    pub next_cursor: String,
    pub done: bool,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvHashField {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvJsonValue {
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvStreamReadRequest {
    pub key: String,
    #[serde(default)]
    pub database: Option<u16>,
    #[serde(default)]
    pub start: Option<String>,
    #[serde(default)]
    pub end: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvStreamReadResult {
    pub key: String,
    pub entries: Vec<KvStreamEntry>,
    pub start: String,
    pub end: String,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvStreamEntry {
    pub id: String,
    pub fields: Vec<KvHashField>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvSetStringRequest {
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub database: Option<u16>,
    #[serde(default)]
    pub ttl_seconds: Option<u64>,
    #[serde(default)]
    pub safety: KvWriteSafety,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum KvWriteSafety {
    #[default]
    RejectOverwrite,
    AllowOverwrite,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvDeleteRequest {
    pub key: String,
    #[serde(default)]
    pub database: Option<u16>,
    pub confirm_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvTtlUpdateRequest {
    pub key: String,
    #[serde(default)]
    pub database: Option<u16>,
    pub update: KvTtlUpdate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum KvTtlUpdate {
    Expire {
        seconds: u64,
    },
    Persist {
        #[serde(rename = "confirmKey")]
        confirm_key: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvMutationResult {
    pub key: String,
    pub changed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttl: Option<KvTtl>,
}

pub fn bytes_to_kv_string(bytes: Vec<u8>) -> KvStringValue {
    let byte_length = bytes.len();
    match String::from_utf8(bytes) {
        Ok(text) => KvStringValue {
            encoding: KvStringEncoding::Utf8,
            text: Some(text),
            hex: None,
            byte_length,
        },
        Err(err) => {
            let bytes = err.into_bytes();
            KvStringValue {
                encoding: KvStringEncoding::Binary,
                text: None,
                hex: Some(bytes.iter().map(|b| format!("{b:02x}")).collect()),
                byte_length,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Purpose: KV wire envelopes are the cross-language Redis/Valkey contract
    // for sprint 465-468 (2026-05-24).

    #[test]
    fn kv_scan_page_serializes_public_keys_as_camel_case() {
        // Reason: key browser UI must not consume raw snake_case Rust fields (2026-05-24).
        let page = KvKeyScanPage {
            database: 0,
            cursor: "0".into(),
            next_cursor: "17".into(),
            done: false,
            limit: 100,
            keys: vec![KvKeyMetadata {
                key: "user:1".into(),
                key_type: KvKeyType::String,
                ttl: KvTtl::from_redis_ttl(30),
                length: Some(5),
                memory_bytes: Some(64),
            }],
        };

        let json = serde_json::to_value(page).unwrap();
        assert_eq!(json["nextCursor"], "17");
        assert!(json.get("next_cursor").is_none());
        assert_eq!(json["keys"][0]["keyType"], "string");
        assert!(json["keys"][0].get("key_type").is_none());
        assert_eq!(json["keys"][0]["ttl"]["state"], "expires");
    }

    #[test]
    fn kv_command_request_serializes_confirm_key_as_camel_case() {
        let request = KvCommandRequest {
            command: "DEL session:1".into(),
            database: Some(0),
            confirm_key: Some("session:1".into()),
        };

        let json = serde_json::to_value(request).unwrap();
        assert_eq!(json["confirmKey"], "session:1");
        assert!(json.get("confirm_key").is_none());
    }

    #[test]
    fn kv_value_envelope_uses_typed_variant_tag() {
        // Reason: value renderers dispatch by `value.type`, not ad hoc key type strings (2026-05-24).
        let envelope = KvValueEnvelope {
            key: "counter".into(),
            metadata: KvKeyMetadata {
                key: "counter".into(),
                key_type: KvKeyType::String,
                ttl: KvTtl::from_redis_ttl(-1),
                length: Some(1),
                memory_bytes: None,
            },
            value: KvValue::String(KvStringValue {
                encoding: KvStringEncoding::Utf8,
                text: Some("1".into()),
                hex: None,
                byte_length: 1,
            }),
        };

        let json = serde_json::to_value(envelope).unwrap();
        assert_eq!(json["value"]["type"], "string");
        assert_eq!(json["value"]["encoding"], "utf8");
        assert_eq!(json["metadata"]["ttl"]["state"], "persistent");
    }

    #[test]
    fn redis_ttl_magic_numbers_are_typed() {
        // Reason: UI safety copy must distinguish missing, persistent, and expiring keys (2026-05-24).
        assert_eq!(KvTtl::from_redis_ttl(-2).state, KvTtlState::Missing);
        assert_eq!(KvTtl::from_redis_ttl(-1).state, KvTtlState::Persistent);
        assert_eq!(KvTtl::from_redis_ttl(12).seconds, Some(12));
    }

    #[test]
    fn binary_string_value_renders_hex_without_utf8_loss() {
        // Reason: Redis string values may be arbitrary bytes, not always UTF-8 text (2026-05-24).
        let value = bytes_to_kv_string(vec![0xff, 0x00, 0x41]);
        assert_eq!(value.encoding, KvStringEncoding::Binary);
        assert_eq!(value.hex.as_deref(), Some("ff0041"));
        assert_eq!(value.byte_length, 3);
    }
}
