//! mongosh-parser-core — pure-Rust mongosh statement parser (sprint-401).
//!
//! This crate compiles to two targets from one source tree:
//!
//! 1. **Native rlib** (sprint-402+ may consume — sprint-401 does not register
//!    a Tauri command; backend already accepts the extended-JSON shape via
//!    `extjson_to_bson_document` from sprint-384).
//! 2. **`wasm32-unknown-unknown` cdylib** built by `wasm-pack` and eager-
//!    loaded from `src/main.tsx` after React mounts (`src/lib/mongo/
//!    mongoshAst/index.ts`).
//!
//! Sprint 401 ships **grammar parity** with the TS implementation it replaces.
//! Grammar widening (regex literals, multi-statement, variable refs, ...) is
//! sprint-402+.
//!
//! No Tauri / tokio / std::io / regex deps — load-bearing invariant that lets
//! the same code reach the browser via WASM.

#![deny(unsafe_code)]

pub mod ast;
pub mod completion;
pub mod lexer;
pub mod parser;

pub use ast::{AdminCommandName, MongoshErrorKind, MongoshStatement};
pub use completion::{completion_vocabulary, MongoshCompletionVocabulary};
pub use parser::parse;

/// Public entry — convenience wrapper around `parser::parse`. Both native
/// and WASM callers go through here.
pub fn parse_mongosh(input: &str) -> MongoshStatement {
    parser::parse(input)
}

/// WASM bridge. Gated behind the `wasm` feature so the native build does
/// not pull `wasm-bindgen` into its dep graph. `wasm-pack build` passes
/// `--features wasm` (the pnpm script does this).
///
/// Like sprint-385's `parse_sql`, this returns a `JsValue` representing the
/// tagged union directly — errors are an `Error` variant, not a thrown
/// exception, so the TS facade narrows without try/catch.
#[cfg(feature = "wasm")]
mod wasm_bridge {
    use serde::Serialize;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn parse_mongosh(input: &str) -> JsValue {
        let result = super::parse_mongosh(input);
        // `serde_wasm_bindgen`의 default Serializer 는 `serde_json::Map`을
        // JS `Map` 으로 변환한다 — TS-side 의 `Record<string, unknown>`
        // 기대와 어긋남. `.serialize_maps_as_objects(true)` 로 plain
        // object 를 emit 하게 강제 (sprint-384 의 backend 도 동일 plain-
        // object shape 만 받음).
        // `json_compatible()` enables both `serialize_maps_as_objects` (so
        // `serde_json::Map` becomes a JS plain object instead of `Map`) and
        // `serialize_missing_as_null` (so `serde_json::Value::Null` lands
        // as JS `null` instead of `undefined`). The TS facade's contract
        // — and the existing 47 `mongoshAst.test.ts` cases — require both.
        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        // Serialization only fails on a serialization bug in our own AST.
        // Map that to `JsValue::NULL` so the TS facade can detect + report
        // rather than panicking the WASM module (which would kill the page).
        result.serialize(&serializer).unwrap_or(JsValue::NULL)
    }

    #[wasm_bindgen]
    pub fn mongo_completion_vocabulary() -> JsValue {
        JsValue::from_str(super::completion_vocabulary())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_admin_command_round_trips() {
        let result = parse_mongosh("db.runCommand({ping: 1})");
        let json = serde_json::to_string(&result).expect("serialize");
        let back: MongoshStatement = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(result, back);
    }

    #[test]
    fn smoke_collection_command_serialization_shape() {
        let result = parse_mongosh("db.users.find({_id: 1})");
        let json = serde_json::to_value(&result).expect("serialize");
        assert_eq!(json["kind"], "collection-command");
        assert_eq!(json["collection"], "users");
        assert_eq!(json["method"], "find");
    }

    #[test]
    fn smoke_error_serialization_shape() {
        let result = parse_mongosh("let x = 1");
        let json = serde_json::to_value(&result).expect("serialize");
        assert_eq!(json["kind"], "error");
        assert_eq!(json["errorKind"], "variable-declaration");
    }

    #[test]
    fn smoke_completion_vocabulary_serialization_shape() {
        let result = completion_vocabulary();
        let groups: Vec<&str> = result.split('\u{1f}').collect();
        assert_eq!(groups.len(), 10);
        assert!(groups[0].contains("$eq"));
        assert!(groups[3].contains("$match"));
        assert!(groups[7].contains("find"));
        assert!(groups[9].contains("serverStatus"));
    }
}
