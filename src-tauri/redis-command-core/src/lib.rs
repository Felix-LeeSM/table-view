//! redis-command-core — Redis/Valkey command completion vocabulary SOT (#1805).
//!
//! This crate compiles to two targets from one source tree:
//!
//! 1. **Native rlib** — `table-view-core` pulls it in as a dev-dependency for
//!    the drift guard (`table-view-core/src/db/redis/tests.rs`), which parses
//!    every row's `probe` through the backend allowlist parser and asserts the
//!    effect tiers agree. That guard is what keeps this table a subset of
//!    `parse_redis_command`.
//! 2. **`wasm32-unknown-unknown` cdylib** built by `wasm-pack` and
//!    lazy-loaded by `src/lib/redis/redisCommandCore.ts`; `main.tsx` preloads
//!    it so the CodeMirror completion source stays synchronous.
//!
//! The table below is the single source of truth for command name, effect
//! tier, arity, argument shape, snippet, summary, and key-argument position.
//! It replaces the TypeScript copy that used to live in
//! `src/features/completion/redis/redisCommandCompletion.ts`. Current-DB key
//! suggestions stay a TypeScript runtime concern (catalog scan cache), and
//! command *execution* stays in `table-view-core`'s
//! `db/redis/command_parser.rs` — this crate is vocabulary, not dispatch.
//!
//! No Tauri / tokio / std::io / regex deps — load-bearing invariant that lets
//! the same table reach the browser via WASM.

#![deny(unsafe_code)]

use serde::Serialize;

/// Effect tier. Serialized to the exact strings the frontend's completion
/// boost/warning mapping switches on; the drift guard asserts it agrees with
/// the backend parser's `RedisCommandEffect` for every row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RedisCommandEffect {
    Read,
    Write,
    Ttl,
    Stream,
    Destructive,
}

/// Where the first key argument sits for a command.
///
/// - `None` — the command takes no key operand (`SCAN` cursor / `KEYS`
///   pattern are patterns, not keys).
/// - `Any` — the first argument is a key of any type.
/// - `VariadicAny` — variadic keys (`EXISTS key [key ...]`); any argument
///   position is a key.
/// - `KeyTypes` — the first argument must be a key whose type is one of
///   `key_types`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RedisKeyArgument {
    None,
    Any,
    VariadicAny,
    KeyTypes,
}

/// One editor completion row. `probe` is omitted from the WASM payload — it
/// exists only for the native drift guard, which feeds it to the backend
/// parser as a minimal valid invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisCommandSpec {
    pub name: &'static str,
    pub effect: RedisCommandEffect,
    pub arity: &'static str,
    pub arguments: &'static [&'static str],
    pub snippet: &'static str,
    pub summary: &'static str,
    pub key_argument: RedisKeyArgument,
    pub key_types: &'static [&'static str],
    /// `true` for the proven Valkey rows recorded in
    /// `e2e/fixtures/valkey.redis-compatibility.json` (`completionSupport`).
    pub valkey_proven: bool,
    #[serde(skip)]
    pub probe: &'static str,
}

/// Order is the suggestion order the editor surfaces for an empty prefix.
pub fn command_specs() -> &'static [RedisCommandSpec] {
    COMMANDS
}

pub fn command_spec(name: &str) -> Option<&'static RedisCommandSpec> {
    COMMANDS.iter().find(|spec| spec.name == name)
}

/// Row order and content pin the vocabulary the editor surfaces. Content
/// mirrors `REDIS_COMMAND_COMPLETIONS` as it stood at #1805; the drift guard
/// in `table-view-core` proves every row parses against the backend allowlist.
#[rustfmt::skip]
static COMMANDS: &[RedisCommandSpec] = &[
    RedisCommandSpec {
        name: "SCAN",
        effect: RedisCommandEffect::Read,
        arity: "cursor [MATCH pattern] [COUNT n]",
        arguments: &["cursor", "MATCH", "COUNT"],
        snippet: "SCAN 0 MATCH ${pattern} COUNT 100",
        summary: "Incrementally scan the keyspace.",
        key_argument: RedisKeyArgument::None,
        key_types: &[],
        valkey_proven: false,
        probe: "SCAN 0",
    },
    RedisCommandSpec {
        name: "KEYS",
        effect: RedisCommandEffect::Read,
        arity: "pattern",
        arguments: &["pattern"],
        snippet: "KEYS ${pattern}",
        summary: "Scan the full keyspace; Safe Mode gates this command.",
        key_argument: RedisKeyArgument::None,
        key_types: &[],
        valkey_proven: false,
        probe: "KEYS *",
    },
    RedisCommandSpec {
        name: "GET",
        effect: RedisCommandEffect::Read,
        arity: "1 key",
        arguments: &["key"],
        snippet: "GET ${key}",
        summary: "Read a string value.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["string"],
        valkey_proven: true,
        probe: "GET k",
    },
    RedisCommandSpec {
        name: "HGETALL",
        effect: RedisCommandEffect::Read,
        arity: "1 key",
        arguments: &["key"],
        snippet: "HGETALL ${key}",
        summary: "Read every field in a hash.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["hash"],
        valkey_proven: true,
        probe: "HGETALL k",
    },
    RedisCommandSpec {
        name: "LRANGE",
        effect: RedisCommandEffect::Read,
        arity: "key start stop",
        arguments: &["key", "start", "stop"],
        snippet: "LRANGE ${key} 0 99",
        summary: "Read a bounded list range.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["list"],
        valkey_proven: true,
        probe: "LRANGE k 0 99",
    },
    RedisCommandSpec {
        name: "SMEMBERS",
        effect: RedisCommandEffect::Read,
        arity: "1 key",
        arguments: &["key"],
        snippet: "SMEMBERS ${key}",
        summary: "Read members from a set.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["set"],
        valkey_proven: true,
        probe: "SMEMBERS k",
    },
    RedisCommandSpec {
        name: "ZRANGE",
        effect: RedisCommandEffect::Read,
        arity: "key start stop [WITHSCORES]",
        arguments: &["key", "start", "stop", "WITHSCORES"],
        snippet: "ZRANGE ${key} 0 99 WITHSCORES",
        summary: "Read a bounded sorted-set range.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["zSet"],
        valkey_proven: true,
        probe: "ZRANGE k 0 99",
    },
    RedisCommandSpec {
        name: "XRANGE",
        effect: RedisCommandEffect::Stream,
        arity: "key start end [COUNT n]",
        arguments: &["key", "start", "end", "COUNT"],
        snippet: "XRANGE ${key} - + COUNT 100",
        summary: "Read a bounded stream range.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["stream"],
        valkey_proven: true,
        probe: "XRANGE k - +",
    },
    RedisCommandSpec {
        name: "TYPE",
        effect: RedisCommandEffect::Read,
        arity: "1 key",
        arguments: &["key"],
        snippet: "TYPE ${key}",
        summary: "Inspect a key type.",
        key_argument: RedisKeyArgument::Any,
        key_types: &[],
        valkey_proven: true,
        probe: "TYPE k",
    },
    RedisCommandSpec {
        name: "TTL",
        effect: RedisCommandEffect::Ttl,
        arity: "1 key",
        arguments: &["key"],
        snippet: "TTL ${key}",
        summary: "Read remaining TTL seconds.",
        key_argument: RedisKeyArgument::Any,
        key_types: &[],
        valkey_proven: true,
        probe: "TTL k",
    },
    RedisCommandSpec {
        name: "EXISTS",
        effect: RedisCommandEffect::Read,
        arity: "1+ keys",
        arguments: &["key", "key ..."],
        snippet: "EXISTS ${key}",
        summary: "Check whether one or more keys exist.",
        key_argument: RedisKeyArgument::VariadicAny,
        key_types: &[],
        valkey_proven: true,
        probe: "EXISTS k",
    },
    RedisCommandSpec {
        name: "SET",
        effect: RedisCommandEffect::Write,
        arity: "key value [EX seconds]",
        arguments: &["key", "value", "EX"],
        snippet: "SET ${key} ${value}",
        summary: "Write a string value; NX/XX stay in typed controls.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["string"],
        valkey_proven: true,
        probe: "SET k v",
    },
    RedisCommandSpec {
        name: "HSET",
        effect: RedisCommandEffect::Write,
        arity: "key field value",
        arguments: &["key", "field", "value"],
        snippet: "HSET ${key} ${field} ${value}",
        summary: "Set one hash field.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["hash"],
        valkey_proven: false,
        probe: "HSET k f v",
    },
    RedisCommandSpec {
        name: "LPUSH",
        effect: RedisCommandEffect::Write,
        arity: "key value [value ...]",
        arguments: &["key", "value", "value ..."],
        snippet: "LPUSH ${key} ${value}",
        summary: "Push values to the head of a list.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["list"],
        valkey_proven: false,
        probe: "LPUSH k v",
    },
    RedisCommandSpec {
        name: "RPUSH",
        effect: RedisCommandEffect::Write,
        arity: "key value [value ...]",
        arguments: &["key", "value", "value ..."],
        snippet: "RPUSH ${key} ${value}",
        summary: "Push values to the tail of a list.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["list"],
        valkey_proven: false,
        probe: "RPUSH k v",
    },
    RedisCommandSpec {
        name: "SADD",
        effect: RedisCommandEffect::Write,
        arity: "key member [member ...]",
        arguments: &["key", "member", "member ..."],
        snippet: "SADD ${key} ${member}",
        summary: "Add members to a set.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["set"],
        valkey_proven: false,
        probe: "SADD k m",
    },
    RedisCommandSpec {
        name: "ZADD",
        effect: RedisCommandEffect::Write,
        arity: "key score member",
        arguments: &["key", "score", "member"],
        snippet: "ZADD ${key} 1 ${member}",
        summary: "Add one sorted-set member.",
        key_argument: RedisKeyArgument::KeyTypes,
        key_types: &["zSet"],
        valkey_proven: false,
        probe: "ZADD k 1 m",
    },
    RedisCommandSpec {
        name: "EXPIRE",
        effect: RedisCommandEffect::Ttl,
        arity: "key seconds",
        arguments: &["key", "seconds"],
        snippet: "EXPIRE ${key} 60",
        summary: "Set a positive TTL.",
        key_argument: RedisKeyArgument::Any,
        key_types: &[],
        valkey_proven: true,
        probe: "EXPIRE k 60",
    },
    RedisCommandSpec {
        name: "PERSIST",
        effect: RedisCommandEffect::Ttl,
        arity: "1 key + exact confirmKey",
        arguments: &["key"],
        snippet: "PERSIST ${key}",
        summary: "Remove TTL; backend requires exact key confirmation.",
        key_argument: RedisKeyArgument::Any,
        key_types: &[],
        valkey_proven: true,
        probe: "PERSIST k",
    },
    RedisCommandSpec {
        name: "DEL",
        effect: RedisCommandEffect::Destructive,
        arity: "1 key + exact confirmKey",
        arguments: &["key"],
        snippet: "DEL ${key}",
        summary: "Delete one key; backend requires exact key confirmation.",
        key_argument: RedisKeyArgument::Any,
        key_types: &[],
        valkey_proven: true,
        probe: "DEL k",
    },
];

/// WASM bridge. Gated behind the `wasm` feature so the native build does
/// not pull `wasm-bindgen` into its dep graph. `wasm-pack build` passes
/// `--features wasm` (the pnpm script does this).
#[cfg(feature = "wasm")]
mod wasm_bridge {
    use serde::Serialize;
    use wasm_bindgen::prelude::*;

    /// Full vocabulary as a JSON-compatible array of row objects. The
    /// frontend narrows this to `RedisCommandCoreRow` in
    /// `src/lib/redis/redisCommandCore.ts`.
    #[wasm_bindgen]
    pub fn redis_command_completion_vocabulary() -> JsValue {
        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        super::command_specs()
            .serialize(&serializer)
            .unwrap_or(JsValue::NULL)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // `src/types/kv.ts` `KvKeyType` — `key_types` filters that union, so a
    // misspelled tier (e.g. "zset") would silently match nothing.
    const KV_KEY_TYPES: &[&str] = &[
        "string", "list", "set", "zSet", "hash", "stream", "json", "unknown",
    ];

    #[test]
    fn vocabulary_pins_the_bounded_editor_slice_in_order() {
        let names: Vec<&str> = command_specs().iter().map(|s| s.name).collect();
        assert_eq!(
            names,
            [
                "SCAN", "KEYS", "GET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "XRANGE", "TYPE",
                "TTL", "EXISTS", "SET", "HSET", "LPUSH", "RPUSH", "SADD", "ZADD", "EXPIRE",
                "PERSIST", "DEL",
            ]
        );
    }

    #[test]
    fn valkey_proven_rows_pin_the_recorded_proven_slice() {
        let proven: Vec<&str> = command_specs()
            .iter()
            .filter(|s| s.valkey_proven)
            .map(|s| s.name)
            .collect();
        assert_eq!(
            proven,
            [
                "GET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "XRANGE", "TYPE", "TTL",
                "EXISTS", "SET", "EXPIRE", "PERSIST", "DEL",
            ]
        );
    }

    #[test]
    fn key_argument_mode_agrees_with_key_types() {
        for spec in command_specs() {
            match spec.key_argument {
                RedisKeyArgument::KeyTypes => {
                    assert!(
                        !spec.key_types.is_empty(),
                        "{} declares KeyTypes with no tiers",
                        spec.name
                    );
                }
                _ => assert!(
                    spec.key_types.is_empty(),
                    "{} carries key types without the KeyTypes mode",
                    spec.name
                ),
            }
            for tier in spec.key_types {
                assert!(
                    KV_KEY_TYPES.contains(tier),
                    "{} key type {tier} is not a KvKeyType spelling",
                    spec.name
                );
            }
        }
    }

    #[test]
    fn every_probe_starts_with_its_command_name() {
        for spec in command_specs() {
            let name = spec.name.split_once('.').map_or(spec.name, |(n, _)| n);
            assert!(
                spec.probe.starts_with(name),
                "{} probe {:?} does not exercise the command",
                spec.name,
                spec.probe
            );
        }
    }

    #[test]
    fn command_spec_finds_rows_case_sensitively() {
        assert!(command_spec("GET").is_some());
        assert!(command_spec("get").is_none());
        assert!(command_spec("FLUSHALL").is_none());
    }
}
