use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewInfo {
    pub name: String,
    pub schema: String,
    pub definition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionInfo {
    pub name: String,
    pub schema: String,
    pub arguments: Option<String>,
    pub return_type: Option<String>,
    pub language: Option<String>,
    pub source: Option<String>,
    pub kind: String, // "function", "procedure", "aggregate", "window"
}

/// Sprint 273 — request payload for `tauri.create_trigger`.
///
/// Carries the canonical trigger fields required by PG `CREATE TRIGGER`:
///   - `trigger_name`, `schema`, `table`, `function_schema`, `function_name`
///     — all validated by the shared `validate_identifier` helper
///     (NAMEDATALEN-63 byte limit + `[a-zA-Z_][a-zA-Z0-9_]*` body).
///   - `timing`, `orientation`, `events` — whitelisted (PG canonical
///     uppercase) by the SQL emitter. Caller MUST send canonical
///     uppercase; mismatches are rejected via `AppError::Validation`.
///   - `events` is required to be a non-empty subset of
///     `["INSERT", "UPDATE", "DELETE"]`. TRUNCATE is hidden from the
///     CREATE dialog per master spec § 7 and not whitelisted here.
///   - `when_expression: Option<String>` — verbatim PG expression that
///     the emitter wraps in `WHEN (...)`. Free-text passthrough
///     (no escaping, PG surfaces parse errors verbatim).
///   - `function_arguments: Option<String>` — verbatim argument list
///     for the `EXECUTE FUNCTION "schema"."name"(args)` clause. The
///     emitter doubles single quotes (`'` → `''`) before embedding so
///     SQL injection through unbalanced quotes is impossible
///     (closes Sprint 272 findings § P3).
///
/// `preview_only: bool` toggles SQL emission vs. `BEGIN/COMMIT`
/// execution. `expected_database: Option<String>` opt-in DbMismatch
/// guard mirroring the rest of the Phase 24-26 DDL family.
///
/// Wire shape: `#[serde(rename_all = "camelCase")]` so the TS mirror in
/// `src/types/schema.ts` consumes payloads with `connectionId`,
/// `triggerName`, `whenExpression`, `functionSchema`, `functionName`,
/// `functionArguments`, `previewOnly`, `expectedDatabase`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTriggerRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub trigger_name: String,
    /// Whitelist: `"BEFORE" | "AFTER" | "INSTEAD OF"`.
    pub timing: String,
    /// Non-empty subset of `["INSERT", "UPDATE", "DELETE"]`. Canonical
    /// uppercase. Emitter sorts to canonical order
    /// (INSERT, UPDATE, DELETE) before joining with ` OR ` so the SQL
    /// string is deterministic regardless of payload order.
    pub events: Vec<String>,
    /// Whitelist: `"ROW" | "STATEMENT"`. `INSTEAD OF` requires `"ROW"`.
    pub orientation: String,
    /// Optional `WHEN (<expr>)` clause. Free-text passthrough; emitter
    /// wraps in parentheses verbatim.
    #[serde(default)]
    pub when_expression: Option<String>,
    pub function_schema: String,
    pub function_name: String,
    /// Optional comma-separated argument list for the
    /// `EXECUTE FUNCTION "schema"."name"(args)` clause. The emitter
    /// doubles single quotes inside this string before embedding
    /// (Sprint 272 findings § P3 fix).
    #[serde(default)]
    pub function_arguments: Option<String>,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Sprint 274 — request payload for `DROP TRIGGER`. PG emitter validates
/// `trigger_name`, `schema`, and `table` via the shared
/// `validate_identifier` helper, then builds
/// `DROP TRIGGER "<name>" ON "<schema>"."<table>"` (+ trailing ` CASCADE`
/// when `cascade == true`).
///
/// `cascade` is opt-in (default `false` → PG's implicit RESTRICT, byte-
/// equivalent SQL emission omits the `RESTRICT` keyword; mirrors Sprint
/// 235 `DropTableRequest` convention). `preview_only` toggles SQL
/// emission vs. `sqlx::Transaction::begin/commit` execution.
/// `expected_database` opt-in DbMismatch guard (Sprint 271c).
///
/// Wire shape: `#[serde(rename_all = "camelCase")]` so the TS mirror in
/// `src/types/schema.ts` consumes payloads with `connectionId`,
/// `triggerName`, `cascade`, `previewOnly`, `expectedDatabase`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropTriggerRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub trigger_name: String,
    #[serde(default)]
    pub cascade: bool,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Sprint 272 — single trigger entry returned by
/// `list_triggers(connection_id, schema, table, expected_database?)`.
///
/// Sourced from `pg_catalog.pg_trigger ⨝ pg_proc ⨝ pg_namespace ⨝ pg_class`
/// with `NOT t.tgisinternal`. The `tgtype` int2 bitmask is decoded into the
/// explicit fields below by [`crate::db::postgres::schema::decode_tgtype`]:
///   - `0x40` → `INSTEAD OF` (else `0x02` → BEFORE, otherwise AFTER)
///   - events from `0x04` (INSERT) / `0x08` (DELETE) / `0x10` (UPDATE);
///     `0x20` TRUNCATE is dropped from the event list (Sprint 272 hides
///     TRUNCATE from the user-visible trigger UI per master spec § 6).
///   - `0x01` → ROW (else STATEMENT).
///
/// `arguments` carries the raw `tgargs` blob decoded as PG's `\0`-delimited
/// list rendered as `'arg1', 'arg2'`. `when_expression` carries the
/// `pg_get_expr(tgqual, tgrelid)` result for the WHEN clause (`None` when
/// `tgqual` is null). `definition` is the full `pg_get_triggerdef(t.oid)`
/// string so the read-only Structure tab can render canonical SQL.
///
/// Wire shape: `#[serde(rename_all = "camelCase")]` so the TS mirror in
/// `src/types/schema.ts` (Sprint 272) consumes payloads with
/// `name`, `schema`, `table`, `timing`, `events`, `orientation`,
/// `functionSchema`, `functionName`, `arguments`, `whenExpression`,
/// `definition`. Older callers that omit `arguments` / `whenExpression`
/// deserialize cleanly via `Option<String>`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInfo {
    pub name: String,
    pub schema: String,
    pub table: String,
    /// Whitelist: `"BEFORE" | "AFTER" | "INSTEAD OF"`.
    pub timing: String,
    /// Whitelisted subset of `["INSERT", "UPDATE", "DELETE"]`. TRUNCATE
    /// event triggers (`0x20`) are dropped from this list by the decoder;
    /// if a trigger fires ONLY on TRUNCATE the entire row is filtered out
    /// upstream so this vector is never empty for surfaced triggers.
    pub events: Vec<String>,
    /// Whitelist: `"ROW" | "STATEMENT"`.
    pub orientation: String,
    pub function_schema: String,
    pub function_name: String,
    pub arguments: Option<String>,
    pub when_expression: Option<String>,
    pub definition: String,
}

/// Sprint 230 — single Postgres type entry returned by
/// `list_postgres_types(connection_id)`. Sourced from
/// `pg_catalog.pg_type` joined with `pg_catalog.pg_namespace`.
///
/// The `type_kind` field maps the PG `pg_type.typtype` column through a
/// closed whitelist:
///   `'b'` → `"base"`     (built-in scalar / extension types)
///   `'d'` → `"domain"`   (`CREATE DOMAIN`)
///   `'e'` → `"enum"`     (`CREATE TYPE … AS ENUM`)
///   `'r'` → `"range"`    (`CREATE TYPE … AS RANGE`)
///   `'c'` → `"composite"` (`CREATE TYPE … AS (…)`; auto row types
///                          are excluded by the SQL filter)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostgresTypeInfo {
    pub schema: String,
    pub name: String,
    pub type_kind: String,
}
