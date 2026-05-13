//! PostgreSQL DDL mutations — drop / rename / alter table, index lifecycle,
//! constraint lifecycle.
//!
//! Sprint 202 split from `db/postgres.rs`. Identifier validation/quoting
//! helpers (`validate_identifier`, `quote_identifier`, `qualified_table`)
//! live here since DDL is the only path that builds raw SQL by string
//! interpolation — every other sub-file uses parameterised queries.

use tracing::info;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnChange, ConstraintDefinition,
    CreateIndexRequest, CreateTableRequest, CreateTriggerRequest, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, DropTriggerRequest,
    RenameTableRequest, SchemaChangeResult,
};

use super::PostgresAdapter;

/// PG `NAMEDATALEN` default — identifiers longer than 63 bytes are
/// truncated by the server. Sprint 235 surfaces the 63-byte boundary as
/// an explicit `AppError::Validation` so the dialog can render the
/// failure inline rather than letting PG silently truncate.
const PG_IDENTIFIER_MAX_BYTES: usize = 63;

/// Validate a SQL identifier (table name, column name, index name, constraint name)
/// to prevent SQL injection. Only allows `[a-zA-Z_][a-zA-Z0-9_]*` with
/// length ≤ 63 bytes (PG's `NAMEDATALEN` default — Sprint 235).
///
/// Embedded NULL bytes (`\0`), embedded `"`, and embedded whitespace are
/// implicitly rejected by the alphanumeric-or-underscore body rule.
fn validate_identifier(name: &str, label: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{} must not be empty", label)));
    }
    if trimmed.len() > PG_IDENTIFIER_MAX_BYTES {
        return Err(AppError::Validation(format!(
            "{} must not exceed {} bytes",
            label, PG_IDENTIFIER_MAX_BYTES
        )));
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        // Unreachable: `is_empty()` above guarantees a leading char.
        // Surface Validation rather than panic on invariant break.
        return Err(AppError::Validation(format!("{} must not be empty", label)));
    };
    if !first.is_ascii_alphabetic() && first != '_' {
        return Err(AppError::Validation(format!(
            "{} must start with a letter or underscore",
            label
        )));
    }
    for ch in chars {
        if !ch.is_ascii_alphanumeric() && ch != '_' {
            return Err(AppError::Validation(format!(
                "{} must contain only alphanumeric characters and underscores",
                label
            )));
        }
    }
    Ok(())
}

/// Quote a SQL identifier with double quotes, escaping internal double quotes.
pub(super) fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Build a qualified table reference: `"schema"."table"`.
pub(super) fn qualified_table(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_identifier(schema), quote_identifier(table))
}

/// Sprint 273 — PG canonical timing whitelist for `CREATE TRIGGER`.
/// Case-sensitive uppercase; caller (frontend dialog) sends canonical
/// strings — mismatches are rejected via `AppError::Validation`.
const TRIGGER_TIMINGS: &[&str] = &["BEFORE", "AFTER", "INSTEAD OF"];

/// Sprint 273 — PG canonical orientation whitelist.
const TRIGGER_ORIENTATIONS: &[&str] = &["ROW", "STATEMENT"];

/// Sprint 273 — canonical event order. The SQL emitter sorts the
/// caller's `events` input against this order before joining with ` OR `
/// so the emitted SQL is deterministic regardless of payload order.
/// TRUNCATE is intentionally absent — master spec § 7 hides TRUNCATE
/// from the CREATE dialog and rejects it as an invalid event here.
const TRIGGER_EVENT_CANONICAL_ORDER: &[&str] = &["INSERT", "UPDATE", "DELETE"];

/// Sprint 273 — `CREATE TRIGGER` SQL emitter (pure helper, no pool
/// access so it is unit-testable from `#[cfg(test)]` fixtures without a
/// running PG).
///
/// Emission shape:
///
///   `CREATE TRIGGER "<name>" {BEFORE|AFTER|INSTEAD OF} <events> ON
///    "<schema>"."<table>" FOR EACH {ROW|STATEMENT} [WHEN (<expr>)]
///    EXECUTE FUNCTION "<fn_schema>"."<fn_name>"(<args>)`
///
/// Validation order (each returns `AppError::Validation` on failure):
///   1. `trigger_name`, `schema`, `table`, `function_schema`,
///      `function_name` pass `validate_identifier`.
///   2. `timing` ∈ `TRIGGER_TIMINGS`.
///   3. `orientation` ∈ `TRIGGER_ORIENTATIONS`.
///   4. `events` non-empty and every element ∈
///      `TRIGGER_EVENT_CANONICAL_ORDER`.
///   5. `INSTEAD OF + STATEMENT` rejected.
///   6. `INSTEAD OF + multi-event` rejected (PG itself does not accept
///      `INSTEAD OF INSERT OR UPDATE`, but we surface the error
///      pre-dispatch so the dialog can render it inline).
///
/// `function_arguments`: every `'` in the free-text input is doubled
/// (`'` → `''`) before being interpolated into `(args)`. Closes Sprint
/// 272 findings § P3 — without this, an argument literal `O'Brien`
/// would unbalance the quoting and either fail PG parse or, in the
/// worst case, allow injection through trailing fragments. Identifier
/// validation rejects embedded `"` / NUL / whitespace upstream, so
/// `function_arguments` is the only free-text input we have to
/// re-escape.
///
/// `when_expression`: parenthesised verbatim (`WHEN (<expr>)`); empty /
/// whitespace-only string is treated as "no clause" and omitted. PG
/// surfaces any verbatim parse error.
fn build_create_trigger_sql(req: &CreateTriggerRequest) -> Result<String, AppError> {
    validate_identifier(&req.trigger_name, "Trigger name")?;
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    validate_identifier(&req.function_schema, "Function schema")?;
    validate_identifier(&req.function_name, "Function name")?;

    if !TRIGGER_TIMINGS.contains(&req.timing.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid trigger timing: {} (expected one of BEFORE / AFTER / INSTEAD OF)",
            req.timing
        )));
    }

    if !TRIGGER_ORIENTATIONS.contains(&req.orientation.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid trigger orientation: {} (expected ROW or STATEMENT)",
            req.orientation
        )));
    }

    if req.events.is_empty() {
        return Err(AppError::Validation(
            "Trigger must declare at least one event (INSERT / UPDATE / DELETE)".into(),
        ));
    }

    for event in &req.events {
        if !TRIGGER_EVENT_CANONICAL_ORDER.contains(&event.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid trigger event: {} (expected INSERT / UPDATE / DELETE)",
                event
            )));
        }
    }

    // INSTEAD OF cannot combine with STATEMENT — PG itself rejects
    // `INSTEAD OF ... FOR EACH STATEMENT` because INSTEAD OF triggers
    // fire per-row on a view. Reject pre-dispatch so the dialog can
    // render the failure inline (the modal's STATEMENT radio is also
    // disabled when timing == INSTEAD OF as a defense-in-depth UX
    // hint).
    if req.timing == "INSTEAD OF" && req.orientation == "STATEMENT" {
        return Err(AppError::Validation(
            "INSTEAD OF triggers must use FOR EACH ROW (PG does not accept STATEMENT here)".into(),
        ));
    }

    // INSTEAD OF cannot combine with multi-event — PG rejects
    // `INSTEAD OF INSERT OR UPDATE` because INSTEAD OF fires per-row
    // against a specific operation. Reject pre-dispatch for the same
    // dialog inline-feedback reason.
    if req.timing == "INSTEAD OF" && req.events.len() > 1 {
        return Err(AppError::Validation(
            "INSTEAD OF triggers must declare exactly one event (not multi-event)".into(),
        ));
    }

    // Canonical event order: walk the canonical list in order and
    // append any event the caller declared. Set-style dedupe is implicit
    // — duplicates in the input are emitted at most once. Output order
    // is byte-stable regardless of payload order (fixture iv in the
    // contract Test Requirements).
    let mut ordered_events: Vec<&str> = Vec::with_capacity(req.events.len());
    for canonical in TRIGGER_EVENT_CANONICAL_ORDER {
        if req.events.iter().any(|e| e == canonical) {
            ordered_events.push(canonical);
        }
    }
    let events_clause = ordered_events.join(" OR ");

    // Sprint 272 findings § P3 — single-quote re-escape on
    // `function_arguments`. Identifier validation already rejected
    // embedded `"` / NUL for the schema/name pair, so the only free-text
    // tail that could unbalance the quoting is the argument list.
    let args_clause = match req.function_arguments.as_deref() {
        None => String::new(),
        Some(s) => s.replace('\'', "''"),
    };

    let when_clause = match req.when_expression.as_deref() {
        None => String::new(),
        Some(expr) => {
            let trimmed = expr.trim();
            if trimmed.is_empty() {
                String::new()
            } else {
                // Free-text passthrough — PG surfaces parse errors
                // verbatim. Parenthesised so the WHEN clause is a
                // well-formed boolean sub-expression regardless of the
                // caller's wrapping.
                format!(" WHEN ({})", trimmed)
            }
        }
    };

    let qualified_target = qualified_table(&req.schema, &req.table);
    let qualified_function = format!(
        "{}.{}",
        quote_identifier(&req.function_schema),
        quote_identifier(&req.function_name)
    );

    let sql = format!(
        "CREATE TRIGGER {} {} {} ON {} FOR EACH {}{} EXECUTE FUNCTION {}({})",
        quote_identifier(&req.trigger_name),
        req.timing,
        events_clause,
        qualified_target,
        req.orientation,
        when_clause,
        qualified_function,
        args_clause,
    );
    Ok(sql)
}

/// Sprint 274 — `DROP TRIGGER` SQL emitter (pure helper, no pool access
/// so it is unit-testable from `#[cfg(test)]` fixtures without a running
/// PG).
///
/// Emission shape:
///
///   `DROP TRIGGER "<name>" ON "<schema>"."<table>"` (+ trailing
///   ` CASCADE` when `req.cascade == true`).
///
/// Validation order (each returns `AppError::Validation` on failure):
///   1. `trigger_name` passes `validate_identifier`.
///   2. `schema` passes `validate_identifier`.
///   3. `table` passes `validate_identifier`.
///
/// No `IF EXISTS` keyword — let PG surface its native `trigger "X" for
/// relation "Y" does not exist` error verbatim (mirrors Sprint 235
/// `drop_table` policy).
fn build_drop_trigger_sql(req: &DropTriggerRequest) -> Result<String, AppError> {
    validate_identifier(&req.trigger_name, "Trigger name")?;
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;

    let qualified_target = qualified_table(&req.schema, &req.table);
    let sql = if req.cascade {
        format!(
            "DROP TRIGGER {} ON {} CASCADE",
            quote_identifier(&req.trigger_name),
            qualified_target,
        )
    } else {
        format!(
            "DROP TRIGGER {} ON {}",
            quote_identifier(&req.trigger_name),
            qualified_target,
        )
    };
    Ok(sql)
}

/// Sprint 229 — closed whitelist of PG canonical referential actions
/// for FK ON DELETE / ON UPDATE clauses (case-sensitive uppercase).
const REFERENTIAL_ACTIONS: &[&str] = &[
    "NO ACTION",
    "RESTRICT",
    "CASCADE",
    "SET NULL",
    "SET DEFAULT",
];

/// Format a referential action clause (`" ON DELETE CASCADE"` etc.)
/// when the action is `Some`. Validates against the closed whitelist
/// `{NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT}` —
/// case-sensitive uppercase, PG canonical form. Returns the empty
/// string when `None` so the calling SQL emitter can append
/// unconditionally without trailing whitespace when both clauses are
/// omitted (Sprint 226+227+228 byte-equivalence).
fn format_referential_action_clause(
    action: Option<&str>,
    keyword: &str,
) -> Result<String, AppError> {
    match action {
        None => Ok(String::new()),
        Some(value) => {
            if !REFERENTIAL_ACTIONS.contains(&value) {
                return Err(AppError::Validation(format!(
                    "Invalid {} action: {}",
                    keyword, value
                )));
            }
            Ok(format!(" {} {}", keyword, value))
        }
    }
}

impl PostgresAdapter {
    /// Drop a table permanently — Sprint 235 request-shaped variant.
    ///
    /// SQL emission:
    ///   `req.cascade == false` →  `DROP TABLE "<schema>"."<table>"`
    ///   `req.cascade == true`  →  `DROP TABLE "<schema>"."<table>" CASCADE`
    ///
    /// Note no `RESTRICT` keyword on the non-cascade branch — PG defaults
    /// to RESTRICT and byte-equivalence with the implicit form is locked
    /// by the Sprint 235 fixtures.
    ///
    /// `req.preview_only=true` returns the built SQL without touching
    /// the database. `req.preview_only=false` runs the statement inside
    /// a `BEGIN/COMMIT` transaction for parity with `create_table` /
    /// `alter_table`.
    ///
    /// The pre-existence check (`information_schema.tables` lookup that
    /// the legacy body performed) is REMOVED — let PG surface its native
    /// `relation "X" does not exist` error verbatim. This mirrors
    /// `create_table`'s "no client-side dependency analysis" stance and
    /// flips the error type for "drop a non-existent table" from
    /// `AppError::NotFound` to `AppError::Database`.
    pub async fn drop_table(&self, req: &DropTableRequest) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;

        let qualified = qualified_table(&req.schema, &req.table);
        let sql = if req.cascade {
            format!("DROP TABLE {} CASCADE", qualified)
        } else {
            format!("DROP TABLE {}", qualified)
        };

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        // BEGIN/COMMIT mirrors the `create_table` / `alter_table` shape
        // so a failure (e.g. PG's verbatim `relation does not exist` or
        // an FK reference blocking the implicit RESTRICT) leaves no
        // partial state behind.
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Err(e) = sqlx::query(&sql).execute(&mut *tx).await {
            // Best-effort rollback. The original DB error is the
            // user-facing failure; rollback errors are discarded so the
            // message stays clean (mirrors `create_table`).
            let _ = tx.rollback().await;
            return Err(AppError::Database(e.to_string()));
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("commit failed: {}", e)))?;

        info!("Dropped table {}.{}", req.schema, req.table);
        Ok(SchemaChangeResult { sql })
    }

    /// Rename a table — Sprint 235 request-shaped variant.
    ///
    /// SQL emission: `ALTER TABLE "<schema>"."<table>" RENAME TO "<new_name>"`.
    /// Identifier validation routes through the shared
    /// `validate_identifier` helper (single-sourced — no ad-hoc validator
    /// drift). `req.preview_only` toggles between SQL emission and
    /// `BEGIN/COMMIT` execution.
    ///
    /// Backend stays permissive on rename-to-self — the SQL is emitted
    /// even when `req.new_name == req.table`, mirroring PG's own
    /// behaviour for direct IPC callers. The dialog's Apply button
    /// disables on rename-to-self as a UX optimisation.
    pub async fn rename_table(
        &self,
        req: &RenameTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.new_name, "New table name")?;

        let qualified_old = qualified_table(&req.schema, &req.table);
        let quoted_new = quote_identifier(req.new_name.trim());
        let sql = format!("ALTER TABLE {} RENAME TO {}", qualified_old, quoted_new);

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Err(e) = sqlx::query(&sql).execute(&mut *tx).await {
            let _ = tx.rollback().await;
            return Err(AppError::Database(e.to_string()));
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("commit failed: {}", e)))?;

        info!(
            "Renamed table {}.{} to {}",
            req.schema,
            req.table,
            req.new_name.trim()
        );
        Ok(SchemaChangeResult { sql })
    }

    /// Sprint 236 — request-shaped `ALTER TABLE … ADD COLUMN`.
    ///
    /// SQL emission shape:
    ///
    ///   `ALTER TABLE "<schema>"."<table>" ADD COLUMN "<name>" <type>
    ///       [NOT NULL] [DEFAULT <expr>] [CHECK (<expr>)]`
    ///
    /// Single statement. Locked emission order. NOT NULL keyword
    /// emitted iff `!req.column.nullable`. DEFAULT clause emitted iff
    /// `req.column.default_value.is_some() && trim().is_non_empty()`
    /// (mirrors `create_table`). CHECK clause emitted iff
    /// `req.check_expression.is_some() && trim().is_non_empty()` —
    /// free-text passthrough (no escaping, no syntax check).
    ///
    /// `ColumnDefinition.comment` flows through deserialization but is
    /// silently ignored by the emitter — Sprint 237 polish adds the
    /// `COMMENT ON COLUMN` chain (atomic policy = C, mirroring Sprint
    /// 227 `create_table`).
    ///
    /// `req.preview_only=true` returns the built SQL without touching
    /// the database. `req.preview_only=false` runs the statement inside
    /// a `BEGIN/COMMIT` transaction (mirrors `rename_table` /
    /// `drop_table` / `create_table`).
    pub async fn add_column(&self, req: &AddColumnRequest) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.column.name, "Column name")?;
        if req.column.data_type.trim().is_empty() {
            return Err(AppError::Validation(format!(
                "Column '{}' must have a non-empty data type",
                req.column.name
            )));
        }

        let qualified = qualified_table(&req.schema, &req.table);
        let mut col_def = format!(
            "{} {}",
            quote_identifier(&req.column.name),
            req.column.data_type.trim()
        );
        // Sprint 242 — IDENTITY mirrors the `create_table` branch:
        // forced NOT NULL, default_value silently dropped (the
        // sequence is the default).
        if req.column.is_identity {
            col_def.push_str(" GENERATED BY DEFAULT AS IDENTITY NOT NULL");
        } else {
            if !req.column.nullable {
                col_def.push_str(" NOT NULL");
            }
            if let Some(default) = &req.column.default_value {
                let trimmed = default.trim();
                if !trimmed.is_empty() {
                    col_def.push_str(&format!(" DEFAULT {}", trimmed));
                }
            }
        }
        if let Some(expr) = &req.check_expression {
            let trimmed = expr.trim();
            if !trimmed.is_empty() {
                col_def.push_str(&format!(" CHECK ({})", trimmed));
            }
        }

        let sql = format!("ALTER TABLE {} ADD COLUMN {}", qualified, col_def);

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Err(e) = sqlx::query(&sql).execute(&mut *tx).await {
            let _ = tx.rollback().await;
            return Err(AppError::Database(e.to_string()));
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("commit failed: {}", e)))?;

        info!(
            "Added column {} on {}.{}",
            req.column.name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    /// Sprint 236 — request-shaped `ALTER TABLE … DROP COLUMN`.
    ///
    /// SQL emission:
    ///   `req.cascade == false` → `ALTER TABLE "<schema>"."<table>"
    ///       DROP COLUMN "<column_name>"`
    ///   `req.cascade == true`  → `... DROP COLUMN "<column_name>" CASCADE`
    ///
    /// Note: NO `RESTRICT` keyword on the non-cascade branch — PG
    /// defaults to RESTRICT and byte-equivalence with the implicit
    /// form is locked by fixture (mirrors Sprint 235 `drop_table`).
    ///
    /// No pre-existence check — let PG surface its native `column
    /// "X" of relation "Y" does not exist` error verbatim (mirrors
    /// Sprint 235 drop pre-existence removal).
    pub async fn drop_column(
        &self,
        req: &DropColumnRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.column_name, "Column name")?;

        let qualified = qualified_table(&req.schema, &req.table);
        let quoted_col = quote_identifier(&req.column_name);
        let sql = if req.cascade {
            format!(
                "ALTER TABLE {} DROP COLUMN {} CASCADE",
                qualified, quoted_col
            )
        } else {
            format!("ALTER TABLE {} DROP COLUMN {}", qualified, quoted_col)
        };

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Err(e) = sqlx::query(&sql).execute(&mut *tx).await {
            let _ = tx.rollback().await;
            return Err(AppError::Database(e.to_string()));
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("commit failed: {}", e)))?;

        info!(
            "Dropped column {} from {}.{}",
            req.column_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    // ── Schema change operations ──────────────────────────────────────

    /// CREATE TABLE — Sprint 226.
    ///
    /// Identifier validation reuses the same `validate_identifier` helper
    /// that `alter_table` / `rename_table` (via `validate_identifier`)
    /// already enforce: whitespace-trimmed, non-empty, leading
    /// letter/underscore, alphanumeric + underscore body. SQL emission
    /// follows the PG ANSI form
    ///
    ///   `CREATE TABLE "<schema>"."<name>" ("<col1>" <type1> [NOT NULL]
    ///   [DEFAULT …], …, PRIMARY KEY ("<pkcol>", …))`
    ///
    /// `preview_only=true` returns the built SQL without touching the
    /// database. `preview_only=false` runs the statement inside a
    /// `BEGIN/COMMIT` transaction so a failure rolls back rather than
    /// leaving a half-created object.
    pub async fn create_table(
        &self,
        req: &CreateTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.name, "Table name")?;

        if req.columns.is_empty() {
            return Err(AppError::Validation(
                "Table must have at least one column".into(),
            ));
        }

        for col in &req.columns {
            validate_identifier(&col.name, "Column name")?;
            if col.data_type.trim().is_empty() {
                return Err(AppError::Validation(format!(
                    "Column '{}' must have a non-empty data type",
                    col.name
                )));
            }
        }

        // PK columns must be drawn from the declared column list.
        // Defending here mirrors the frontend pre-validation so a stale
        // PK reference (e.g. user removed a column row after marking it
        // PK) still gets rejected even if the modal were bypassed.
        if let Some(pk_cols) = &req.primary_key {
            for pk in pk_cols {
                validate_identifier(pk, "Primary key column name")?;
                if !req.columns.iter().any(|c| c.name == *pk) {
                    return Err(AppError::Validation(format!(
                        "Primary key column '{}' is not declared in the column list",
                        pk
                    )));
                }
            }
        }

        let qualified = qualified_table(&req.schema, &req.name);

        let mut col_defs: Vec<String> = Vec::with_capacity(req.columns.len() + 1);
        for col in &req.columns {
            let mut def = format!("{} {}", quote_identifier(&col.name), col.data_type.trim());
            // Sprint 242 — IDENTITY columns are SQL-standard NOT NULL
            // (the spec requires it; PG enforces it). The IDENTITY
            // sequence acts as the column default, so a caller-supplied
            // `default_value` is silently dropped — emitting both would
            // be a syntax error.
            if col.is_identity {
                def.push_str(" GENERATED BY DEFAULT AS IDENTITY NOT NULL");
            } else {
                if !col.nullable {
                    def.push_str(" NOT NULL");
                }
                if let Some(default) = &col.default_value {
                    let trimmed = default.trim();
                    if !trimmed.is_empty() {
                        def.push_str(&format!(" DEFAULT {}", trimmed));
                    }
                }
            }
            col_defs.push(def);
        }

        if let Some(pk_cols) = &req.primary_key {
            if !pk_cols.is_empty() {
                let quoted: Vec<String> = pk_cols.iter().map(|c| quote_identifier(c)).collect();
                col_defs.push(format!("PRIMARY KEY ({})", quoted.join(", ")));
            }
        }

        let create_sql = format!("CREATE TABLE {} ({})", qualified, col_defs.join(", "));

        // Sprint 227 — emit `COMMENT ON COLUMN` per column whose
        // post-trim comment is non-empty. Single-quote escape doubles
        // any internal `'` (`O'Brien` → `'O''Brien'`). Empty /
        // whitespace-only comments emit no statement (column-comment
        // SQL is *additive* — 0-comment forms must remain
        // byte-equivalent to the Sprint 226 fixture).
        //
        // Atomic policy = C: the comment statements are appended to the
        // CREATE TABLE statement in column-declaration order and
        // executed inside the same transaction, so a CREATE TABLE
        // failure rolls back the comments and a comment failure rolls
        // back the table. The full multi-statement payload returned
        // from `preview_only` mirrors the executed batch byte-for-byte.
        let mut comment_stmts: Vec<String> = Vec::new();
        // Sprint 234 — table-level COMMENT ON TABLE statement, emitted
        // FIRST so the chain order is `table comment → column comments`
        // (Sprint 226-233 caller invariant: `table_comment = None` keeps
        // the SQL byte-equivalent because no statement is appended).
        // Single-quote escape mirrors the per-column comment rule below.
        if let Some(raw) = &req.table_comment {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                let escaped = trimmed.replace('\'', "''");
                comment_stmts.push(format!("COMMENT ON TABLE {} IS '{}'", qualified, escaped));
            }
        }
        for col in &req.columns {
            if let Some(raw) = &col.comment {
                let trimmed = raw.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let escaped = trimmed.replace('\'', "''");
                comment_stmts.push(format!(
                    "COMMENT ON COLUMN {}.{} IS '{}'",
                    qualified,
                    quote_identifier(&col.name),
                    escaped
                ));
            }
        }

        let sql = if comment_stmts.is_empty() {
            create_sql.clone()
        } else {
            // Each statement separated by `; ` (one space after the
            // semicolon mirrors the multi-statement convention used by
            // `alter_table`'s comma-joined parts) and a trailing `;`
            // after the final comment so the executed batch is a
            // syntactically clean script. The CREATE TABLE itself
            // remains unterminated when no comments exist (Sprint 226
            // byte-equivalence requires no trailing `;`).
            let mut s = create_sql.clone();
            for stmt in &comment_stmts {
                s.push_str("; ");
                s.push_str(stmt);
            }
            s.push(';');
            s
        };

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        // Wrap the execute in BEGIN/COMMIT so a failure (e.g. table
        // already exists, type-check rejection, comment on missing
        // column) leaves no partial state behind. CREATE TABLE itself
        // is implicitly transactional in PG, but the explicit
        // transaction is required for the additional `COMMENT ON
        // COLUMN` statements emitted in Sprint 227 — they must roll
        // back together with the CREATE TABLE if any leg fails.
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Err(e) = sqlx::query(&create_sql).execute(&mut *tx).await {
            // Best-effort rollback. The original DB error is the
            // user-facing failure; rollback errors are discarded so
            // the message stays clean.
            let _ = tx.rollback().await;
            return Err(AppError::Database(e.to_string()));
        }

        for stmt in &comment_stmts {
            if let Err(e) = sqlx::query(stmt).execute(&mut *tx).await {
                let _ = tx.rollback().await;
                return Err(AppError::Database(e.to_string()));
            }
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("commit failed: {}", e)))?;

        info!("Created table {}.{}", req.schema, req.name);
        Ok(SchemaChangeResult { sql })
    }

    /// ALTER TABLE: add, modify, or drop columns in batch.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn alter_table(
        &self,
        req: &AlterTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;

        if req.changes.is_empty() {
            return Err(AppError::Validation(
                "At least one column change is required".into(),
            ));
        }

        // Validate all column names in changes
        for change in &req.changes {
            match change {
                ColumnChange::Add { name, .. } => validate_identifier(name, "Column name")?,
                ColumnChange::Modify { name, .. } => validate_identifier(name, "Column name")?,
                ColumnChange::Drop { name } => validate_identifier(name, "Column name")?,
            }
        }

        let qualified = qualified_table(&req.schema, &req.table);

        let mut parts: Vec<String> = Vec::new();

        for change in &req.changes {
            match change {
                ColumnChange::Add {
                    name,
                    data_type,
                    nullable,
                    default_value,
                } => {
                    let mut sql = format!("ADD COLUMN {} {}", quote_identifier(name), data_type);
                    if !nullable {
                        sql.push_str(" NOT NULL");
                    }
                    if let Some(default) = default_value {
                        sql.push_str(&format!(" DEFAULT {}", default));
                    }
                    parts.push(sql);
                }
                ColumnChange::Modify {
                    name,
                    new_data_type,
                    new_nullable,
                    new_default_value,
                } => {
                    let quoted_name = quote_identifier(name);
                    if let Some(dt) = new_data_type {
                        parts.push(format!("ALTER COLUMN {} TYPE {}", quoted_name, dt));
                    }
                    if let Some(nullable) = new_nullable {
                        if *nullable {
                            parts.push(format!("ALTER COLUMN {} DROP NOT NULL", quoted_name));
                        } else {
                            parts.push(format!("ALTER COLUMN {} SET NOT NULL", quoted_name));
                        }
                    }
                    if let Some(default) = new_default_value {
                        parts.push(format!(
                            "ALTER COLUMN {} SET DEFAULT {}",
                            quoted_name, default
                        ));
                    }
                }
                ColumnChange::Drop { name } => {
                    parts.push(format!("DROP COLUMN {}", quote_identifier(name)));
                }
            }
        }

        let sql = format!("ALTER TABLE {} {}", qualified, parts.join(", "));

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Altered table {}.{}", req.schema, req.table);
        Ok(SchemaChangeResult { sql })
    }

    /// Create an index on a table.
    /// Supports index types: btree, hash, gist, gin, brin.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn create_index(
        &self,
        req: &CreateIndexRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.index_name, "Index name")?;

        if req.columns.is_empty() {
            return Err(AppError::Validation(
                "At least one column is required for an index".into(),
            ));
        }

        for col in &req.columns {
            validate_identifier(col, "Index column name")?;
        }

        // Validate index type
        let valid_index_types = ["btree", "hash", "gist", "gin", "brin"];
        let index_type_lower = req.index_type.to_lowercase();
        if !valid_index_types.contains(&index_type_lower.as_str()) {
            return Err(AppError::Validation(format!(
                "Index type must be one of: {}",
                valid_index_types.join(", ")
            )));
        }

        let qualified = qualified_table(&req.schema, &req.table);
        let columns: Vec<String> = req.columns.iter().map(|c| quote_identifier(c)).collect();

        let unique = if req.is_unique { "UNIQUE " } else { "" };
        let sql = format!(
            "CREATE {}INDEX {} ON {} USING {} ({})",
            unique,
            quote_identifier(&req.index_name),
            qualified,
            index_type_lower,
            columns.join(", ")
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!(
            "Created index {} on {}.{}",
            req.index_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    /// Drop an index.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn drop_index(&self, req: &DropIndexRequest) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.index_name, "Index name")?;

        let if_exists = if req.if_exists { "IF EXISTS " } else { "" };
        let sql = format!(
            "DROP INDEX {}.{}{}",
            quote_identifier(&req.schema),
            if_exists,
            quote_identifier(&req.index_name)
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Dropped index {}.{}", req.schema, req.index_name);
        Ok(SchemaChangeResult { sql })
    }

    /// Add a constraint to a table.
    /// Supports: PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn add_constraint(
        &self,
        req: &AddConstraintRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.constraint_name, "Constraint name")?;

        let qualified = qualified_table(&req.schema, &req.table);
        let constraint_name = quote_identifier(&req.constraint_name);

        let constraint_sql = match &req.definition {
            ConstraintDefinition::PrimaryKey { columns } => {
                if columns.is_empty() {
                    return Err(AppError::Validation(
                        "Primary key requires at least one column".into(),
                    ));
                }
                for col in columns {
                    validate_identifier(col, "Primary key column name")?;
                }
                let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
                format!("PRIMARY KEY ({})", cols.join(", "))
            }
            ConstraintDefinition::ForeignKey {
                columns,
                reference_table,
                reference_columns,
                on_delete,
                on_update,
            } => {
                if columns.is_empty() {
                    return Err(AppError::Validation(
                        "Foreign key requires at least one column".into(),
                    ));
                }
                for col in columns {
                    validate_identifier(col, "Foreign key column name")?;
                }
                validate_identifier(reference_table, "Foreign key reference table name")?;
                for col in reference_columns {
                    validate_identifier(col, "Foreign key reference column name")?;
                }
                let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
                let ref_cols: Vec<String> = reference_columns
                    .iter()
                    .map(|c| quote_identifier(c))
                    .collect();
                // Sprint 229 — append optional ON DELETE / ON UPDATE
                // clauses when the field is `Some(action)` AND the
                // action matches the closed PG-canonical whitelist
                // `{NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT}`
                // (case-sensitive uppercase). Anything else →
                // `AppError::Validation`. When `None`, the clause is
                // omitted (Sprint 226+227+228 byte-equivalence — the
                // pre-existing `add_constraint_preview_foreign_key`
                // fixture's emitted SQL stays unchanged because both
                // fields default to `None`).
                let on_delete_clause =
                    format_referential_action_clause(on_delete.as_deref(), "ON DELETE")?;
                let on_update_clause =
                    format_referential_action_clause(on_update.as_deref(), "ON UPDATE")?;
                format!(
                    "FOREIGN KEY ({}) REFERENCES {} ({}){}{}",
                    cols.join(", "),
                    quote_identifier(reference_table),
                    ref_cols.join(", "),
                    on_delete_clause,
                    on_update_clause,
                )
            }
            ConstraintDefinition::Unique { columns } => {
                if columns.is_empty() {
                    return Err(AppError::Validation(
                        "Unique constraint requires at least one column".into(),
                    ));
                }
                for col in columns {
                    validate_identifier(col, "Unique constraint column name")?;
                }
                let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
                format!("UNIQUE ({})", cols.join(", "))
            }
            ConstraintDefinition::Check { expression } => {
                if expression.trim().is_empty() {
                    return Err(AppError::Validation(
                        "Check constraint expression must not be empty".into(),
                    ));
                }
                format!("CHECK ({})", expression)
            }
        };

        let sql = format!(
            "ALTER TABLE {} ADD CONSTRAINT {} {}",
            qualified, constraint_name, constraint_sql
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!(
            "Added constraint {} on {}.{}",
            req.constraint_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    /// Drop a constraint from a table.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn drop_constraint(
        &self,
        req: &DropConstraintRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.constraint_name, "Constraint name")?;

        let qualified = qualified_table(&req.schema, &req.table);
        let sql = format!(
            "ALTER TABLE {} DROP CONSTRAINT {}",
            qualified,
            quote_identifier(&req.constraint_name)
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!(
            "Dropped constraint {} from {}.{}",
            req.constraint_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    /// Sprint 273 — `CREATE TRIGGER` SQL emitter + execute.
    ///
    /// Builds the canonical SQL via `build_create_trigger_sql` (identifier
    /// validation, whitelist, canonical event ordering, single-quote
    /// re-escape on `function_arguments`, INSTEAD OF rejection paths).
    /// `req.preview_only=true` returns the built SQL without touching the
    /// database. `req.preview_only=false` wraps the single statement in
    /// `BEGIN; <sql>; COMMIT;` for parity with the rest of the Phase 24-26
    /// DDL family — a failure rolls back rather than leaving a half-created
    /// trigger.
    pub async fn create_trigger(
        &self,
        req: &CreateTriggerRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_create_trigger_sql(req)?;

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Err(e) = sqlx::query(&sql).execute(&mut *tx).await {
            // Best-effort rollback — see `drop_table` for the rationale
            // (the original DB error is the user-facing failure).
            let _ = tx.rollback().await;
            return Err(AppError::Database(e.to_string()));
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("commit failed: {}", e)))?;

        info!(
            "Created trigger {} on {}.{}",
            req.trigger_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    /// Sprint 274 — `DROP TRIGGER` SQL emitter + execute.
    ///
    /// Builds the canonical SQL via `build_drop_trigger_sql` (identifier
    /// validation, CASCADE branch). `req.preview_only=true` returns the
    /// built SQL without touching the database. `req.preview_only=false`
    /// wraps the single statement in `sqlx::Transaction::begin/commit`
    /// for parity with `drop_table` / `create_trigger` — a failure rolls
    /// back rather than leaving a partial state.
    ///
    /// No pre-existence check — let PG surface its native `trigger "X"
    /// for relation "Y" does not exist` error verbatim (mirrors Sprint
    /// 235 `drop_table` pre-existence removal).
    pub async fn drop_trigger(
        &self,
        req: &DropTriggerRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_drop_trigger_sql(req)?;

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Err(e) = sqlx::query(&sql).execute(&mut *tx).await {
            // Best-effort rollback — see `drop_table` for the rationale
            // (the original DB error is the user-facing failure).
            let _ = tx.rollback().await;
            return Err(AppError::Database(e.to_string()));
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("commit failed: {}", e)))?;

        info!(
            "Dropped trigger {} on {}.{}",
            req.trigger_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::postgres::PostgresAdapter;
    use crate::models::{
        AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnDefinition,
        ConstraintDefinition, CreateIndexRequest, CreateTableRequest, CreateTriggerRequest,
        DropColumnRequest, DropConstraintRequest, DropIndexRequest, DropTableRequest,
        DropTriggerRequest, RenameTableRequest,
    };

    // ── drop_table / rename_table — Sprint 235 fixtures ──────────────
    //
    // Sprint 235 mechanically rewrote the legacy positional-args fixtures
    // to the new `*Request` shapes. Original test intents (rejection of
    // empty / whitespace / invalid-char / digit-start / connection-stage
    // failure) preserved verbatim; new fixtures lock the byte-equivalent
    // SQL emission, the CASCADE branch, the rename-to-self permissive
    // path, and the 63-byte / embedded-NULL / embedded-quote rejections.

    fn drop_req(schema: &str, table: &str, cascade: bool, preview_only: bool) -> DropTableRequest {
        DropTableRequest {
            connection_id: "conn1".to_string(),
            schema: schema.to_string(),
            table: table.to_string(),
            cascade,
            preview_only,
            expected_database: None,
        }
    }

    fn rename_req(
        schema: &str,
        table: &str,
        new_name: &str,
        preview_only: bool,
    ) -> RenameTableRequest {
        RenameTableRequest {
            connection_id: "conn1".to_string(),
            schema: schema.to_string(),
            table: table.to_string(),
            new_name: new_name.to_string(),
            preview_only,
            expected_database: None,
        }
    }

    #[tokio::test]
    async fn drop_table_without_connection_fails_non_preview() {
        // Sprint 235 — execute branch (preview_only=false) requires a
        // live pool; without one the call surfaces the connection
        // sentinel before any DB work happens.
        let adapter = PostgresAdapter::new();
        let req = drop_req("public", "users", false, false);
        let result = adapter.drop_table(&req).await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = rename_req("public", "users", "people", false);
        let result = adapter.rename_table(&req).await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_empty_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = rename_req("public", "users", "", true);
        let result = adapter.rename_table(&req).await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not be empty"),
            "Expected empty name validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_whitespace_only_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = rename_req("public", "users", "   ", true);
        let result = adapter.rename_table(&req).await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not be empty"),
            "Expected empty name validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_invalid_characters_fails() {
        let adapter = PostgresAdapter::new();
        let req = rename_req("public", "users", "bad-name!", true);
        let result = adapter.rename_table(&req).await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("alphanumeric"),
            "Expected alphanumeric validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_starts_with_digit_fails() {
        let adapter = PostgresAdapter::new();
        let req = rename_req("public", "users", "123bad", true);
        let result = adapter.rename_table(&req).await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        // Sprint 235 unified validator surfaces "must start with a letter
        // or underscore" via `validate_identifier` — replaces the
        // pre-Sprint 235 ad-hoc "must not start with a digit" message.
        assert!(
            err_msg.contains("must start with a letter or underscore"),
            "Expected leading-letter validation error, got: {err_msg}"
        );
    }

    /// Sprint 235 — byte-equivalent SQL for the canonical preview path.
    /// Locks the ANSI-quoted form `ALTER TABLE "schema"."old" RENAME TO
    /// "new"` — any whitespace / quoting drift breaks this assertion
    /// before the dialog reaches a user.
    #[tokio::test]
    async fn rename_table_preview_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = rename_req("public", "users", "people", true);
        let result = adapter.rename_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"ALTER TABLE "public"."users" RENAME TO "people""#
        );
    }

    /// Sprint 235 — preview branch returns SQL even when no live pool
    /// exists. The check confirms `preview_only=true` short-circuits
    /// before the `active_pool().await?` call.
    #[tokio::test]
    async fn rename_table_preview_only_does_not_execute() {
        let adapter = PostgresAdapter::new();
        let req = rename_req("public", "users", "people", true);
        let result = adapter.rename_table(&req).await;
        assert!(result.is_ok(), "Expected Ok preview, got {:?}", result);
    }

    /// Sprint 235 — table-driven rejection cases for invalid `new_name`
    /// values. Embedded space / embedded `"` / length > 63 / leading
    /// digit all surface `AppError::Validation`.
    #[tokio::test]
    async fn rename_table_invalid_new_name_rejected() {
        let adapter = PostgresAdapter::new();

        // Case 1 — embedded space.
        let req = rename_req("public", "users", "bad name", true);
        let r = adapter.rename_table(&req).await;
        assert!(r.is_err(), "Expected Err for embedded space");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));

        // Case 2 — embedded `"` (PG identifiers escape via doubling, but
        // the validator rejects them outright before they reach the
        // quoter).
        let req = rename_req("public", "users", "bad\"name", true);
        let r = adapter.rename_table(&req).await;
        assert!(r.is_err(), "Expected Err for embedded quote");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));

        // Case 3 — length > 63 bytes (PG NAMEDATALEN limit).
        let too_long = "a".repeat(64);
        let req = rename_req("public", "users", &too_long, true);
        let r = adapter.rename_table(&req).await;
        assert!(r.is_err(), "Expected Err for >63 byte name");
        let err_msg = r.unwrap_err().to_string();
        assert!(
            err_msg.contains("63 bytes") || err_msg.contains("must not exceed"),
            "Expected 63-byte boundary error, got: {err_msg}"
        );

        // Case 4 — leading digit.
        let req = rename_req("public", "users", "1bad", true);
        let r = adapter.rename_table(&req).await;
        assert!(r.is_err(), "Expected Err for leading digit");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));
    }

    /// Sprint 235 — rename-to-self stays permissive at the backend.
    /// Frontend disables Apply, but direct IPC callers get the SQL
    /// emitted exactly as if it were a real rename — PG itself
    /// surfaces the no-op verbatim.
    #[tokio::test]
    async fn rename_table_same_name_emits_sql() {
        let adapter = PostgresAdapter::new();
        let req = rename_req("public", "users", "users", true);
        let result = adapter.rename_table(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            r#"ALTER TABLE "public"."users" RENAME TO "users""#
        );
    }

    /// Sprint 235 — embedded NULL byte rejection (defense-in-depth
    /// against any caller that bypassed the frontend regex).
    #[tokio::test]
    async fn rename_table_embedded_null_byte_rejected() {
        let adapter = PostgresAdapter::new();
        let with_null = "bad\0name";
        let req = rename_req("public", "users", with_null, true);
        let r = adapter.rename_table(&req).await;
        assert!(r.is_err(), "Expected Err for embedded NULL byte");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));
    }

    /// Sprint 235 — DROP TABLE byte-equivalent (no CASCADE). Confirms the
    /// implicit-RESTRICT form — no `RESTRICT` keyword in the emitted SQL.
    #[tokio::test]
    async fn drop_table_preview_no_cascade_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = drop_req("public", "users", false, true);
        let result = adapter.drop_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(result.unwrap().sql, r#"DROP TABLE "public"."users""#);
    }

    /// Sprint 235 — DROP TABLE … CASCADE byte-equivalent.
    #[tokio::test]
    async fn drop_table_preview_cascade_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = drop_req("public", "users", true, true);
        let result = adapter.drop_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"DROP TABLE "public"."users" CASCADE"#
        );
    }

    /// Sprint 235 — preview branch returns SQL even without a live pool.
    #[tokio::test]
    async fn drop_table_preview_only_does_not_execute() {
        let adapter = PostgresAdapter::new();
        let req = drop_req("public", "users", false, true);
        let result = adapter.drop_table(&req).await;
        assert!(result.is_ok(), "Expected Ok preview, got {:?}", result);
    }

    /// Sprint 235 — invalid table-name rejections. Same identifier
    /// validator as `rename_table`. Three cases (embedded space /
    /// embedded quote / empty post-trim).
    #[tokio::test]
    async fn drop_table_invalid_table_name_rejected() {
        let adapter = PostgresAdapter::new();

        let req = drop_req("public", "bad table", false, true);
        let r = adapter.drop_table(&req).await;
        assert!(r.is_err(), "Expected Err for embedded space");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));

        let req = drop_req("public", "bad\"name", false, true);
        let r = adapter.drop_table(&req).await;
        assert!(r.is_err(), "Expected Err for embedded quote");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));

        let req = drop_req("public", "   ", false, true);
        let r = adapter.drop_table(&req).await;
        assert!(r.is_err(), "Expected Err for empty post-trim");
        let err_msg = r.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not be empty"),
            "Expected empty-name error, got: {err_msg}"
        );
    }

    // ── add_column / drop_column — Sprint 236 fixtures ────────────────
    //
    // Locks the byte-equivalent SQL emission for the new
    // `add_column` / `drop_column` paths. Mirrors Sprint 235 fixture
    // structure (request builder helpers + table-driven invalid-name
    // rejections + preview-only-without-pool short circuit).

    fn add_col_req(
        schema: &str,
        table: &str,
        col: ColumnDefinition,
        check_expression: Option<&str>,
        preview_only: bool,
    ) -> AddColumnRequest {
        AddColumnRequest {
            connection_id: "conn1".to_string(),
            schema: schema.to_string(),
            table: table.to_string(),
            column: col,
            check_expression: check_expression.map(|s| s.to_string()),
            preview_only,
            expected_database: None,
        }
    }

    fn drop_col_req(
        schema: &str,
        table: &str,
        column_name: &str,
        cascade: bool,
        preview_only: bool,
    ) -> DropColumnRequest {
        DropColumnRequest {
            connection_id: "conn1".to_string(),
            schema: schema.to_string(),
            table: table.to_string(),
            column_name: column_name.to_string(),
            cascade,
            preview_only,
            expected_database: None,
        }
    }

    fn coldef(
        name: &str,
        data_type: &str,
        nullable: bool,
        default_value: Option<&str>,
    ) -> ColumnDefinition {
        ColumnDefinition {
            name: name.to_string(),
            data_type: data_type.to_string(),
            nullable,
            default_value: default_value.map(|s| s.to_string()),
            comment: None,
            is_identity: false,
        }
    }

    /// Sprint 236 — basic ADD COLUMN, nullable, no default, no check.
    /// Locks the canonical preview output; any whitespace / quoting
    /// drift trips this assertion before reaching the dialog.
    #[tokio::test]
    async fn add_column_preview_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = add_col_req(
            "public",
            "users",
            coldef("email", "varchar(255)", true, None),
            None,
            true,
        );
        let result = adapter.add_column(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"ALTER TABLE "public"."users" ADD COLUMN "email" varchar(255)"#
        );
    }

    /// Sprint 236 — NOT NULL keyword emitted iff `!nullable`.
    #[tokio::test]
    async fn add_column_preview_with_not_null_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = add_col_req(
            "public",
            "users",
            coldef("email", "varchar(255)", false, None),
            None,
            true,
        );
        let result = adapter.add_column(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"ALTER TABLE "public"."users" ADD COLUMN "email" varchar(255) NOT NULL"#
        );
    }

    /// Sprint 236 — DEFAULT clause emitted iff trimmed default is
    /// non-empty (mirrors Sprint 226 `create_table` rule).
    #[tokio::test]
    async fn add_column_preview_with_default_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = add_col_req(
            "public",
            "users",
            coldef("created_at", "timestamptz", true, Some("now()")),
            None,
            true,
        );
        let result = adapter.add_column(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"ALTER TABLE "public"."users" ADD COLUMN "created_at" timestamptz DEFAULT now()"#
        );
    }

    /// Sprint 236 — inline CHECK clause emitted iff trimmed
    /// check_expression is non-empty. Free-text passthrough — verbatim
    /// interpolation, no escaping.
    #[tokio::test]
    async fn add_column_preview_with_check_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = add_col_req(
            "public",
            "users",
            coldef("age", "int", true, None),
            Some("age >= 0"),
            true,
        );
        let result = adapter.add_column(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"ALTER TABLE "public"."users" ADD COLUMN "age" int CHECK (age >= 0)"#
        );
    }

    /// Sprint 236 — locked emission order verified end-to-end:
    /// `<name> <type> NOT NULL DEFAULT <expr> CHECK (<expr>)`.
    #[tokio::test]
    async fn add_column_preview_full_combo_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = add_col_req(
            "public",
            "users",
            coldef("age", "int", false, Some("0")),
            Some("age >= 0"),
            true,
        );
        let result = adapter.add_column(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"ALTER TABLE "public"."users" ADD COLUMN "age" int NOT NULL DEFAULT 0 CHECK (age >= 0)"#
        );
    }

    /// Sprint 236 — preview branch returns SQL even without a live
    /// pool. Confirms the `preview_only=true` short-circuit before
    /// `active_pool().await?`.
    #[tokio::test]
    async fn add_column_preview_only_does_not_execute() {
        let adapter = PostgresAdapter::new();
        let req = add_col_req(
            "public",
            "users",
            coldef("email", "varchar(255)", true, None),
            None,
            true,
        );
        let result = adapter.add_column(&req).await;
        assert!(result.is_ok(), "Expected Ok preview, got {:?}", result);
    }

    /// Sprint 236 — table-driven rejection of invalid column names.
    /// Embedded space / embedded `"` / leading digit / >63 bytes /
    /// embedded NULL byte all surface `AppError::Validation`. Mirrors
    /// the Sprint 235 `rename_table_invalid_new_name_rejected` shape.
    #[tokio::test]
    async fn add_column_invalid_column_name_rejected() {
        let adapter = PostgresAdapter::new();

        // Case 1 — embedded space.
        let req = add_col_req(
            "public",
            "users",
            coldef("bad name", "int", true, None),
            None,
            true,
        );
        let r = adapter.add_column(&req).await;
        assert!(r.is_err(), "Expected Err for embedded space");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));

        // Case 2 — embedded `"`.
        let req = add_col_req(
            "public",
            "users",
            coldef("bad\"name", "int", true, None),
            None,
            true,
        );
        let r = adapter.add_column(&req).await;
        assert!(r.is_err(), "Expected Err for embedded quote");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));

        // Case 3 — leading digit.
        let req = add_col_req(
            "public",
            "users",
            coldef("1bad", "int", true, None),
            None,
            true,
        );
        let r = adapter.add_column(&req).await;
        assert!(r.is_err(), "Expected Err for leading digit");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));

        // Case 4 — length > 63 bytes.
        let too_long = "a".repeat(64);
        let req = add_col_req(
            "public",
            "users",
            coldef(&too_long, "int", true, None),
            None,
            true,
        );
        let r = adapter.add_column(&req).await;
        assert!(r.is_err(), "Expected Err for >63 byte name");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));

        // Case 5 — embedded NULL byte.
        let with_null = "bad\0name";
        let req = add_col_req(
            "public",
            "users",
            coldef(with_null, "int", true, None),
            None,
            true,
        );
        let r = adapter.add_column(&req).await;
        assert!(r.is_err(), "Expected Err for embedded NULL byte");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));

        // Case 6 — empty post-trim.
        let req = add_col_req(
            "public",
            "users",
            coldef("   ", "int", true, None),
            None,
            true,
        );
        let r = adapter.add_column(&req).await;
        assert!(r.is_err(), "Expected Err for empty post-trim name");
        let err_msg = r.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not be empty"),
            "Expected empty-name error, got: {err_msg}"
        );
    }

    /// Sprint 236 — empty `data_type.trim()` rejected with
    /// `AppError::Validation`. Mirrors the Sprint 226 `create_table`
    /// rule for column definitions.
    #[tokio::test]
    async fn add_column_empty_data_type_rejected() {
        let adapter = PostgresAdapter::new();
        let req = add_col_req(
            "public",
            "users",
            coldef("email", "   ", true, None),
            None,
            true,
        );
        let r = adapter.add_column(&req).await;
        assert!(r.is_err(), "Expected Err for empty data_type");
        let err_msg = r.unwrap_err().to_string();
        assert!(
            err_msg.contains("must have a non-empty data type"),
            "Expected empty-data-type error, got: {err_msg}"
        );
    }

    /// Sprint 236 — DEFAULT free-text passthrough (no auto-doubling).
    /// Locks the user-responsible escaping decision: an embedded `'`
    /// in the DEFAULT clause is forwarded verbatim to PG, which will
    /// reject the SQL with a syntax error — the error surfaces in
    /// `previewError` (mirrors Sprint 229 CHECK contract).
    #[tokio::test]
    async fn add_column_default_with_embedded_quote_passthrough() {
        let adapter = PostgresAdapter::new();
        let req = add_col_req(
            "public",
            "users",
            coldef("name", "varchar(255)", true, Some("'O'Brien'")),
            None,
            true,
        );
        let result = adapter.add_column(&req).await;
        assert!(result.is_ok(), "Expected Ok preview, got {:?}", result);
        // Verbatim — no auto-doubling, no escaping.
        assert_eq!(
            result.unwrap().sql,
            r#"ALTER TABLE "public"."users" ADD COLUMN "name" varchar(255) DEFAULT 'O'Brien'"#
        );
    }

    /// Sprint 236 — DROP COLUMN byte-equivalent (no CASCADE). Confirms
    /// the implicit-RESTRICT form — no `RESTRICT` keyword in the
    /// emitted SQL (mirrors Sprint 235 `drop_table` convention).
    #[tokio::test]
    async fn drop_column_preview_no_cascade_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = drop_col_req("public", "users", "email", false, true);
        let result = adapter.drop_column(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"ALTER TABLE "public"."users" DROP COLUMN "email""#
        );
    }

    /// Sprint 236 — DROP COLUMN … CASCADE byte-equivalent.
    #[tokio::test]
    async fn drop_column_preview_cascade_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = drop_col_req("public", "users", "email", true, true);
        let result = adapter.drop_column(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"ALTER TABLE "public"."users" DROP COLUMN "email" CASCADE"#
        );
    }

    /// Sprint 236 — preview branch returns SQL without a live pool.
    #[tokio::test]
    async fn drop_column_preview_only_does_not_execute() {
        let adapter = PostgresAdapter::new();
        let req = drop_col_req("public", "users", "email", false, true);
        let result = adapter.drop_column(&req).await;
        assert!(result.is_ok(), "Expected Ok preview, got {:?}", result);
    }

    /// Sprint 236 — invalid column-name rejection (defense-in-depth
    /// against any caller that bypassed the frontend regex). Three
    /// table-driven sub-cases.
    #[tokio::test]
    async fn drop_column_invalid_column_name_rejected() {
        let adapter = PostgresAdapter::new();

        // Empty post-trim.
        let req = drop_col_req("public", "users", "   ", false, true);
        let r = adapter.drop_column(&req).await;
        assert!(r.is_err(), "Expected Err for empty post-trim name");
        let err_msg = r.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not be empty"),
            "Expected empty-name error, got: {err_msg}"
        );

        // Embedded quote.
        let req = drop_col_req("public", "users", "bad\"name", false, true);
        let r = adapter.drop_column(&req).await;
        assert!(r.is_err(), "Expected Err for embedded quote");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));

        // Leading digit.
        let req = drop_col_req("public", "users", "1bad", false, true);
        let r = adapter.drop_column(&req).await;
        assert!(r.is_err(), "Expected Err for leading digit");
        assert!(matches!(r.unwrap_err(), AppError::Validation(_)));
    }

    // ── validate_identifier tests ─────────────────────────────────────

    #[test]
    fn validate_identifier_valid_names() {
        assert!(validate_identifier("users", "test").is_ok());
        assert!(validate_identifier("_private", "test").is_ok());
        assert!(validate_identifier("table_1", "test").is_ok());
        assert!(validate_identifier("CamelCase", "test").is_ok());
    }

    #[test]
    fn validate_identifier_empty_fails() {
        let result = validate_identifier("", "Table name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must not be empty"));
    }

    #[test]
    fn validate_identifier_whitespace_only_fails() {
        let result = validate_identifier("   ", "Column name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must not be empty"));
    }

    #[test]
    fn validate_identifier_starts_with_digit_fails() {
        let result = validate_identifier("1table", "Table name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must start with a letter or underscore"));
    }

    #[test]
    fn validate_identifier_special_chars_fails() {
        let result = validate_identifier("bad-name", "Table name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must contain only alphanumeric characters and underscores"));
    }

    #[test]
    fn validate_identifier_with_space_fails() {
        let result = validate_identifier("bad name", "Table name");
        assert!(result.is_err());
    }

    // ── quote_identifier tests ────────────────────────────────────────

    #[test]
    fn quote_identifier_simple() {
        assert_eq!(quote_identifier("users"), "\"users\"");
    }

    #[test]
    fn quote_identifier_with_embedded_quote() {
        assert_eq!(quote_identifier("my\"table"), "\"my\"\"table\"");
    }

    // ── qualified_table tests ─────────────────────────────────────────

    #[test]
    fn qualified_table_format() {
        assert_eq!(qualified_table("public", "users"), "\"public\".\"users\"");
    }

    // ── alter_table tests ─────────────────────────────────────────────

    #[tokio::test]
    async fn alter_table_preview_only_returns_sql() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "email".to_string(),
                data_type: "varchar(255)".to_string(),
                nullable: false,
                default_value: None,
            }],
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" varchar(255) NOT NULL"
        );
    }

    #[tokio::test]
    async fn alter_table_preview_add_with_default() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "created_at".to_string(),
                data_type: "timestamp".to_string(),
                nullable: true,
                default_value: Some("now()".to_string()),
            }],
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ADD COLUMN \"created_at\" timestamp DEFAULT now()"
        );
    }

    #[tokio::test]
    async fn alter_table_preview_modify_column() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Modify {
                name: "age".to_string(),
                new_data_type: Some("bigint".to_string()),
                new_nullable: Some(false),
                new_default_value: Some("0".to_string()),
            }],
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ALTER COLUMN \"age\" TYPE bigint, ALTER COLUMN \"age\" SET NOT NULL, ALTER COLUMN \"age\" SET DEFAULT 0"
        );
    }

    #[tokio::test]
    async fn alter_table_preview_drop_column() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Drop {
                name: "legacy".to_string(),
            }],
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" DROP COLUMN \"legacy\""
        );
    }

    #[tokio::test]
    async fn alter_table_preview_batch_changes() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![
                ColumnChange::Add {
                    name: "email".to_string(),
                    data_type: "text".to_string(),
                    nullable: true,
                    default_value: None,
                },
                ColumnChange::Drop {
                    name: "old_col".to_string(),
                },
            ],
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" text, DROP COLUMN \"old_col\""
        );
    }

    #[tokio::test]
    async fn alter_table_empty_changes_fails() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![],
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("At least one column change"));
    }

    #[tokio::test]
    async fn alter_table_invalid_table_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "bad table!".to_string(),
            changes: vec![ColumnChange::Add {
                name: "email".to_string(),
                data_type: "text".to_string(),
                nullable: true,
                default_value: None,
            }],
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn alter_table_invalid_column_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "bad column!".to_string(),
                data_type: "text".to_string(),
                nullable: true,
                default_value: None,
            }],
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn alter_table_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "email".to_string(),
                data_type: "text".to_string(),
                nullable: true,
                default_value: None,
            }],
            preview_only: false,
            expected_database: None,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── create_index tests ────────────────────────────────────────────

    #[tokio::test]
    async fn create_index_preview_btree() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_users_email".to_string(),
            columns: vec!["email".to_string()],
            index_type: "btree".to_string(),
            is_unique: true,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE UNIQUE INDEX \"idx_users_email\" ON \"public\".\"users\" USING btree (\"email\")"
        );
    }

    #[tokio::test]
    async fn create_index_preview_hash_non_unique() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_users_data".to_string(),
            columns: vec!["data".to_string()],
            index_type: "hash".to_string(),
            is_unique: false,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE INDEX \"idx_users_data\" ON \"public\".\"users\" USING hash (\"data\")"
        );
    }

    #[tokio::test]
    async fn create_index_preview_multi_column() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            index_name: "idx_orders_composite".to_string(),
            columns: vec!["user_id".to_string(), "created_at".to_string()],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE INDEX \"idx_orders_composite\" ON \"public\".\"orders\" USING btree (\"user_id\", \"created_at\")"
        );
    }

    /// Sprint 228 — explicit byte-string fixture for `gin`. The
    /// pre-existing `create_index_all_types_accepted` loop only asserts
    /// `is_ok()` for each type; this case locks the actual SQL output
    /// so a future refactor (e.g. lowercase normalisation, identifier
    /// quoting tweak) can't silently regress the gin path the
    /// CreateTableDialog Indexes-tab editor exposes to users.
    #[tokio::test]
    async fn create_index_preview_gin_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "documents".to_string(),
            index_name: "idx_docs_search".to_string(),
            columns: vec!["search_tsv".to_string()],
            index_type: "gin".to_string(),
            is_unique: false,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE INDEX \"idx_docs_search\" ON \"public\".\"documents\" USING gin (\"search_tsv\")"
        );
    }

    /// Sprint 228 — explicit byte-string fixture for `gist`. Companion
    /// to `create_index_preview_gin_byte_equivalent` — together they
    /// cover the two UI-exposed types (gin/gist) that previously only
    /// existed inside the all-types-acceptance loop.
    #[tokio::test]
    async fn create_index_preview_gist_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "regions".to_string(),
            index_name: "idx_regions_geom".to_string(),
            columns: vec!["geom".to_string()],
            index_type: "gist".to_string(),
            is_unique: false,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE INDEX \"idx_regions_geom\" ON \"public\".\"regions\" USING gist (\"geom\")"
        );
    }

    #[tokio::test]
    async fn create_index_all_types_accepted() {
        let adapter = PostgresAdapter::new();
        for itype in &["btree", "hash", "gist", "gin", "brin"] {
            let req = CreateIndexRequest {
                connection_id: "conn1".to_string(),
                schema: "public".to_string(),
                table: "users".to_string(),
                index_name: "idx_test".to_string(),
                columns: vec!["col1".to_string()],
                index_type: itype.to_string(),
                is_unique: false,
                preview_only: true,
                expected_database: None,
            };
            assert!(
                adapter.create_index(&req).await.is_ok(),
                "Failed for type {}",
                itype
            );
        }
    }

    #[tokio::test]
    async fn create_index_invalid_type_fails() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_test".to_string(),
            columns: vec!["col1".to_string()],
            index_type: "invalid_type".to_string(),
            is_unique: false,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Index type must be one of"));
    }

    #[tokio::test]
    async fn create_index_empty_columns_fails() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_test".to_string(),
            columns: vec![],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("At least one column"));
    }

    #[tokio::test]
    async fn create_index_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "bad name!".to_string(),
            columns: vec!["col1".to_string()],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn create_index_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_test".to_string(),
            columns: vec!["col1".to_string()],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: false,
            expected_database: None,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── drop_index tests ──────────────────────────────────────────────

    #[tokio::test]
    async fn drop_index_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "idx_users_email".to_string(),
            if_exists: false,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "DROP INDEX \"public\".\"idx_users_email\""
        );
    }

    #[tokio::test]
    async fn drop_index_preview_if_exists() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "idx_users_email".to_string(),
            if_exists: true,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "DROP INDEX \"public\".IF EXISTS \"idx_users_email\""
        );
    }

    #[tokio::test]
    async fn drop_index_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "bad;name".to_string(),
            if_exists: false,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn drop_index_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "idx_test".to_string(),
            if_exists: false,
            preview_only: false,
            expected_database: None,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── add_constraint tests ──────────────────────────────────────────

    #[tokio::test]
    async fn add_constraint_preview_primary_key() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "pk_users".to_string(),
            definition: ConstraintDefinition::PrimaryKey {
                columns: vec!["id".to_string()],
            },
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"pk_users\" PRIMARY KEY (\"id\")"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_foreign_key() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            constraint_name: "fk_orders_user".to_string(),
            definition: ConstraintDefinition::ForeignKey {
                columns: vec!["user_id".to_string()],
                reference_table: "users".to_string(),
                reference_columns: vec!["id".to_string()],
                // Sprint 229 — Rust syntax requires complete field
                // listings even when `#[serde(default)]` is set; the
                // 2-line `None` initializer keeps the emitted SQL
                // (asserted below) byte-equivalent to Sprint 228.
                on_delete: None,
                on_update: None,
            },
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"fk_orders_user\" FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\")"
        );
    }

    // ── Sprint 229 — ON DELETE / ON UPDATE referential actions ─────────

    #[tokio::test]
    async fn add_constraint_preview_foreign_key_on_delete_cascade() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            constraint_name: "fk_orders_user".to_string(),
            definition: ConstraintDefinition::ForeignKey {
                columns: vec!["user_id".to_string()],
                reference_table: "users".to_string(),
                reference_columns: vec!["id".to_string()],
                on_delete: Some("CASCADE".to_string()),
                on_update: None,
            },
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"fk_orders_user\" FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\") ON DELETE CASCADE"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_foreign_key_on_update_set_null_with_on_delete_restrict() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            constraint_name: "fk_orders_user".to_string(),
            definition: ConstraintDefinition::ForeignKey {
                columns: vec!["user_id".to_string()],
                reference_table: "users".to_string(),
                reference_columns: vec!["id".to_string()],
                on_delete: Some("RESTRICT".to_string()),
                on_update: Some("SET NULL".to_string()),
            },
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        // Both clauses present, ON DELETE first then ON UPDATE
        // (declaration order is locked: emitter renders ON DELETE then
        // ON UPDATE so the byte-string is deterministic across calls).
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"fk_orders_user\" FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\") ON DELETE RESTRICT ON UPDATE SET NULL"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_foreign_key_invalid_on_delete_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            constraint_name: "fk_orders_user".to_string(),
            definition: ConstraintDefinition::ForeignKey {
                columns: vec!["user_id".to_string()],
                reference_table: "users".to_string(),
                reference_columns: vec!["id".to_string()],
                on_delete: Some("INVALID".to_string()),
                on_update: None,
            },
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid ON DELETE action"));
    }

    #[tokio::test]
    async fn add_constraint_preview_unique() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_users_email".to_string(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["email".to_string()],
            },
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"uq_users_email\" UNIQUE (\"email\")"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_check() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "chk_users_age".to_string(),
            definition: ConstraintDefinition::Check {
                expression: "age >= 0".to_string(),
            },
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"chk_users_age\" CHECK (age >= 0)"
        );
    }

    #[tokio::test]
    async fn add_constraint_empty_pk_columns_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "pk_test".to_string(),
            definition: ConstraintDefinition::PrimaryKey { columns: vec![] },
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("at least one column"));
    }

    #[tokio::test]
    async fn add_constraint_empty_check_expression_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "chk_test".to_string(),
            definition: ConstraintDefinition::Check {
                expression: "  ".to_string(),
            },
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must not be empty"));
    }

    #[tokio::test]
    async fn add_constraint_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "bad;name".to_string(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["email".to_string()],
            },
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn add_constraint_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_test".to_string(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["email".to_string()],
            },
            preview_only: false,
            expected_database: None,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── drop_constraint tests ─────────────────────────────────────────

    #[tokio::test]
    async fn drop_constraint_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_users_email".to_string(),
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.drop_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" DROP CONSTRAINT \"uq_users_email\""
        );
    }

    #[tokio::test]
    async fn drop_constraint_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = DropConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "bad;name".to_string(),
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.drop_constraint(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn drop_constraint_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_test".to_string(),
            preview_only: false,
            expected_database: None,
        };
        let result = adapter.drop_constraint(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── create_table tests (Sprint 226) ───────────────────────────────

    fn col(name: &str, ty: &str, nullable: bool, default: Option<&str>) -> ColumnDefinition {
        ColumnDefinition {
            name: name.to_string(),
            data_type: ty.to_string(),
            nullable,
            default_value: default.map(|s| s.to_string()),
            comment: None,
            is_identity: false,
        }
    }

    /// Sprint 227 — `col` variant with a comment string. Mirrors `col`
    /// (no `comment` argument) but appends a non-empty `comment` for the
    /// `COMMENT ON COLUMN` emission tests.
    fn col_with_comment(
        name: &str,
        ty: &str,
        nullable: bool,
        default: Option<&str>,
        comment: &str,
    ) -> ColumnDefinition {
        ColumnDefinition {
            name: name.to_string(),
            data_type: ty.to_string(),
            nullable,
            default_value: default.map(|s| s.to_string()),
            comment: Some(comment.to_string()),
            is_identity: false,
        }
    }

    #[tokio::test]
    async fn create_table_preview_one_column_no_pk() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![col("id", "integer", true, None)],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer)"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_three_column_composite_pk_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "memberships".to_string(),
            columns: vec![
                col("user_id", "integer", false, None),
                col("group_id", "integer", false, None),
                col("joined_at", "timestamp", true, Some("now()")),
            ],
            primary_key: Some(vec!["user_id".to_string(), "group_id".to_string()]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        // Byte-equivalent canonical fixture (RFC-style determinism per
        // spec Verification Hint #2). Any whitespace / quoting drift
        // breaks this test.
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."memberships" ("user_id" integer NOT NULL, "group_id" integer NOT NULL, "joined_at" timestamp DEFAULT now(), PRIMARY KEY ("user_id", "group_id"))"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_not_null_with_default() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "audit_log".to_string(),
            columns: vec![
                col("id", "bigserial", false, None),
                col("created_at", "timestamp", false, Some("now()")),
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."audit_log" ("id" bigserial NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), PRIMARY KEY ("id"))"#
        );
    }

    #[tokio::test]
    async fn create_table_empty_columns_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "noop".to_string(),
            columns: vec![],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("Table must have at least one column"),
            "Expected empty-columns error, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_table_pk_references_undeclared_column_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "stale_pk".to_string(),
            columns: vec![col("id", "integer", false, None)],
            primary_key: Some(vec!["nonexistent".to_string()]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("not declared"),
            "Expected PK-undeclared error, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_table_table_name_with_embedded_space_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "foo bar".to_string(),
            columns: vec![col("id", "integer", false, None)],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        // Validator surfaces "alphanumeric characters and underscores"
        // when an internal whitespace breaks the body charset rule.
        assert!(
            err.contains("alphanumeric") || err.contains("must start"),
            "Expected identifier-validation error, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_table_column_name_with_embedded_quote_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "tbl".to_string(),
            columns: vec![col("bad\"col", "text", true, None)],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn create_table_empty_table_name_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "   ".to_string(),
            columns: vec![col("id", "integer", false, None)],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("must not be empty"),
            "Expected empty-name error, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_table_empty_data_type_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "tbl".to_string(),
            columns: vec![col("id", "   ", false, None)],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("non-empty data type"),
            "Expected empty-type error, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_table_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "users".to_string(),
            columns: vec![col("id", "integer", false, None)],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: false,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    #[tokio::test]
    async fn create_table_preview_no_pk_field_omits_clause() {
        // primary_key Some([]) should still omit the PRIMARY KEY clause —
        // empty pk vector behaves the same as None.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![col("id", "integer", true, None)],
            primary_key: Some(vec![]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer)"#
        );
    }

    // ── create_table tests (Sprint 227) ───────────────────────────────

    #[tokio::test]
    async fn create_table_preview_zero_comment_byte_equivalent_to_sprint_226() {
        // Sprint 227 additive regression proof — when no column carries
        // a `comment`, the emitted SQL must remain byte-equivalent to
        // the Sprint 226 composite-PK fixture. This test mirrors
        // `create_table_preview_three_column_composite_pk_byte_equivalent`
        // exactly but exercises the Sprint 227 codepath (which now
        // walks the column list looking for comments). If the codepath
        // accidentally appends a trailing `;` or stray space, this
        // test breaks before the Sprint 226 fixture even runs.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "memberships".to_string(),
            columns: vec![
                col("user_id", "integer", false, None),
                col("group_id", "integer", false, None),
                col("joined_at", "timestamp", true, Some("now()")),
            ],
            primary_key: Some(vec!["user_id".to_string(), "group_id".to_string()]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."memberships" ("user_id" integer NOT NULL, "group_id" integer NOT NULL, "joined_at" timestamp DEFAULT now(), PRIMARY KEY ("user_id", "group_id"))"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_two_columns_one_comment_byte_equivalent() {
        // Sprint 227 — single-column comment emission. The emitted SQL
        // is `CREATE TABLE …; COMMENT ON COLUMN "<schema>"."<table>"."<col>" IS '<text>';`
        // joined with `"; "` and terminated with a trailing `;`. The
        // uncommented column emits no `COMMENT ON` statement.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![
                col_with_comment("id", "integer", false, None, "primary key"),
                col("name", "text", true, None),
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer NOT NULL, "name" text, PRIMARY KEY ("id")); COMMENT ON COLUMN "public"."events"."id" IS 'primary key';"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_single_quote_escape_byte_equivalent() {
        // Sprint 227 — `O'Brien`-style single-quote escape proof. The
        // SQL literal must double the single quote to `''` so PG
        // accepts it as a literal character (not the literal
        // terminator). This case also covers a 3-column form with two
        // commented columns to lock the column-declaration ordering of
        // emitted COMMENT ON statements.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "people".to_string(),
            columns: vec![
                col_with_comment("id", "integer", false, None, "row id"),
                col_with_comment("surname", "text", true, None, "O'Brien-safe"),
                col("nickname", "text", true, None),
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."people" ("id" integer NOT NULL, "surname" text, "nickname" text, PRIMARY KEY ("id")); COMMENT ON COLUMN "public"."people"."id" IS 'row id'; COMMENT ON COLUMN "public"."people"."surname" IS 'O''Brien-safe';"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_whitespace_comment_emits_no_statement() {
        // Sprint 227 — whitespace-only / empty comment string emits no
        // `COMMENT ON COLUMN` statement (post-trim check). The SQL must
        // remain byte-equivalent to the no-comment form.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![col_with_comment("id", "integer", true, None, "   ")],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer)"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_comment_with_semicolon_does_not_split() {
        // Sprint 227 — comment string containing `;` is emitted verbatim
        // inside the literal. The `;` is NOT a statement boundary; PG's
        // simple-query protocol parses single-quoted literals as a
        // contiguous token. The frontend `useDdlPreviewExecution` hook's
        // naive `;`-split is acceptable here because Safe Mode's
        // `analyzeStatement` only flags DDL keywords (CREATE / DROP /
        // ALTER / TRUNCATE) at the *start* of each split fragment —
        // comment-internal semicolons surface as additional safe-tier
        // fragments that are no-op'd by the backend's batch executor.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "tbl".to_string(),
            columns: vec![col_with_comment("id", "integer", true, None, "a;b;c")],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."tbl" ("id" integer); COMMENT ON COLUMN "public"."tbl"."id" IS 'a;b;c';"#
        );
    }

    // ── create_table tests (Sprint 234 — table_comment) ────────────────

    #[tokio::test]
    async fn create_table_preview_table_comment_byte_equivalent() {
        // Sprint 234 — table-level COMMENT ON TABLE statement appended
        // FIRST in the comment chain. With a single column and no
        // per-column comment the emitted SQL is the canonical
        // CREATE TABLE … followed by `; COMMENT ON TABLE …;` and the
        // trailing semicolon (Sprint 227 multi-statement convention).
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "users".to_string(),
            columns: vec![col("id", "integer", true, None)],
            primary_key: None,
            preview_only: true,
            table_comment: Some("user accounts".to_string()),
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."users" ("id" integer); COMMENT ON TABLE "public"."users" IS 'user accounts';"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_table_and_column_comments_byte_equivalent() {
        // Sprint 234 — when both a table comment and a per-column comment
        // are supplied, the table-level COMMENT ON TABLE statement comes
        // FIRST, then per-column COMMENT ON COLUMN in declared order.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![
                col_with_comment("id", "integer", false, None, "primary key"),
                col("name", "text", true, None),
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: Some("event log".to_string()),
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer NOT NULL, "name" text, PRIMARY KEY ("id")); COMMENT ON TABLE "public"."events" IS 'event log'; COMMENT ON COLUMN "public"."events"."id" IS 'primary key';"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_table_comment_single_quote() {
        // Sprint 234 — single-quote escape doubles internally to `''` so
        // PG accepts the literal verbatim. Same rule as the per-column
        // comment escape from Sprint 227.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "people".to_string(),
            columns: vec![col("id", "integer", true, None)],
            primary_key: None,
            preview_only: true,
            table_comment: Some("O'Brien's table".to_string()),
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."people" ("id" integer); COMMENT ON TABLE "public"."people" IS 'O''Brien''s table';"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_zero_table_comment_byte_equivalent_to_sprint_226() {
        // Sprint 234 additive regression proof — when `table_comment` is
        // None (Sprint 226-233 caller default), the emitted SQL must
        // remain byte-equivalent to the Sprint 226 composite-PK fixture.
        // Mirrors `create_table_preview_three_column_composite_pk_
        // byte_equivalent` exactly but exercises the Sprint 234 codepath.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "memberships".to_string(),
            columns: vec![
                col("user_id", "integer", false, None),
                col("group_id", "integer", false, None),
                col("joined_at", "timestamp", true, Some("now()")),
            ],
            primary_key: Some(vec!["user_id".to_string(), "group_id".to_string()]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."memberships" ("user_id" integer NOT NULL, "group_id" integer NOT NULL, "joined_at" timestamp DEFAULT now(), PRIMARY KEY ("user_id", "group_id"))"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_whitespace_table_comment_emits_no_statement() {
        // Sprint 234 — whitespace-only `table_comment` emits NO COMMENT
        // ON TABLE statement (post-trim guard). SQL stays byte-equivalent
        // to the no-comment form.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![col("id", "integer", true, None)],
            primary_key: None,
            preview_only: true,
            table_comment: Some("   ".to_string()),
            expected_database: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer)"#
        );
    }

    // ── Sprint 242 — IDENTITY column emission ─────────────────────────

    fn col_identity(name: &str, ty: &str) -> ColumnDefinition {
        ColumnDefinition {
            name: name.to_string(),
            data_type: ty.to_string(),
            nullable: true,
            default_value: None,
            comment: None,
            is_identity: true,
        }
    }

    #[tokio::test]
    async fn create_table_identity_column_emits_generated_by_default_as_identity() {
        // Sprint 242 — `is_identity: true` triggers SQL-standard
        // `GENERATED BY DEFAULT AS IDENTITY` (PG 10+). The clause forces
        // NOT NULL and overrides the column-level NULL/DEFAULT branch.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![
                col_identity("id", "bigint"),
                col("name", "text", true, None),
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await.expect("emit OK");
        assert_eq!(
            result.sql,
            r#"CREATE TABLE "public"."events" ("id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL, "name" text, PRIMARY KEY ("id"))"#
        );
    }

    #[tokio::test]
    async fn create_table_identity_column_drops_caller_default_value() {
        // `is_identity` makes the IDENTITY sequence the column default;
        // any caller-supplied `default_value` would be a syntax error
        // alongside it, so the emitter silently drops the user value.
        let adapter = PostgresAdapter::new();
        let mut id_col = col_identity("id", "integer");
        id_col.default_value = Some("42".to_string());
        id_col.nullable = true; // also force-overridden to NOT NULL
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![id_col],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let result = adapter.create_table(&req).await.expect("emit OK");
        assert_eq!(
            result.sql,
            r#"CREATE TABLE "public"."events" ("id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL)"#
        );
    }

    #[tokio::test]
    async fn add_column_identity_emits_generated_by_default_as_identity() {
        // Sprint 242 — single-column `add_column` IPC mirrors
        // `create_table` for IDENTITY emission (same per-column branch).
        let adapter = PostgresAdapter::new();
        let req = AddColumnRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "events".to_string(),
            column: ColumnDefinition {
                name: "id".to_string(),
                data_type: "bigint".to_string(),
                nullable: true,
                default_value: None,
                comment: None,
                is_identity: true,
            },
            check_expression: None,
            preview_only: true,
            expected_database: None,
        };
        let result = adapter.add_column(&req).await.expect("emit OK");
        assert_eq!(
            result.sql,
            r#"ALTER TABLE "public"."events" ADD COLUMN "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL"#
        );
    }

    // ── create_trigger — Sprint 273 fixtures ─────────────────────────
    //
    // Locks `build_create_trigger_sql` emission shape against the master
    // spec § 6 SQL form. Validation order (identifier → timing →
    // orientation → events non-empty → events whitelist → INSTEAD OF
    // exclusions) is exercised by the rejection group below; happy-path
    // emission is exercised by the SQL-emission group. `preview_only` is
    // implicitly true for every fixture because `build_create_trigger_sql`
    // is the pure helper — the execute branch is covered by the
    // `commands/rdb/ddl.rs` mismatch / wiring tests where the StubAdapter
    // sees the request object.

    // The trigger request carries 10 fields; the builder mirrors them
    // 1:1 so the test fixtures stay readable.
    #[allow(clippy::too_many_arguments)]
    fn create_trigger_req(
        trigger_name: &str,
        schema: &str,
        table: &str,
        timing: &str,
        events: Vec<&str>,
        orientation: &str,
        when_expression: Option<&str>,
        function_schema: &str,
        function_name: &str,
        function_arguments: Option<&str>,
    ) -> CreateTriggerRequest {
        CreateTriggerRequest {
            connection_id: "conn1".to_string(),
            schema: schema.to_string(),
            table: table.to_string(),
            trigger_name: trigger_name.to_string(),
            timing: timing.to_string(),
            events: events.into_iter().map(str::to_string).collect(),
            orientation: orientation.to_string(),
            when_expression: when_expression.map(str::to_string),
            function_schema: function_schema.to_string(),
            function_name: function_name.to_string(),
            function_arguments: function_arguments.map(str::to_string),
            preview_only: true,
            expected_database: None,
        }
    }

    #[test]
    fn create_trigger_before_insert_row_no_when_no_args() {
        // Master spec § 6 fixture (i) — minimal happy path. No WHEN,
        // empty arguments list, single event. Locks the canonical
        // `EXECUTE FUNCTION "schema"."name"()` tail with empty parens.
        let req = create_trigger_req(
            "tg_audit",
            "public",
            "users",
            "BEFORE",
            vec!["INSERT"],
            "ROW",
            None,
            "audit",
            "log",
            None,
        );
        let sql = build_create_trigger_sql(&req).expect("emit OK");
        assert_eq!(
            sql,
            r#"CREATE TRIGGER "tg_audit" BEFORE INSERT ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "audit"."log"()"#
        );
    }

    #[test]
    fn create_trigger_after_insert_update_delete_statement() {
        // Master spec § 6 fixture (ii) — multi-event + STATEMENT
        // orientation. Locks `INSERT OR UPDATE OR DELETE` join + `FOR
        // EACH STATEMENT`.
        let req = create_trigger_req(
            "tg_changes",
            "public",
            "orders",
            "AFTER",
            vec!["INSERT", "UPDATE", "DELETE"],
            "STATEMENT",
            None,
            "audit",
            "log_changes",
            None,
        );
        let sql = build_create_trigger_sql(&req).expect("emit OK");
        assert_eq!(
            sql,
            r#"CREATE TRIGGER "tg_changes" AFTER INSERT OR UPDATE OR DELETE ON "public"."orders" FOR EACH STATEMENT EXECUTE FUNCTION "audit"."log_changes"()"#
        );
    }

    #[test]
    fn create_trigger_instead_of_insert_row_when_with_quoted_args() {
        // Master spec § 6 fixture (iii) — INSTEAD OF + WHEN + arguments
        // containing a single quote (`O'Brien`). The emitter must double
        // every `'` in `function_arguments` per Sprint 272 findings § P3
        // — without this the generated SQL would either be a PG parse
        // error or, worse, allow trailing-quote injection through the
        // argument list.
        let req = create_trigger_req(
            "tg_view_redirect",
            "public",
            "user_view",
            "INSTEAD OF",
            vec!["INSERT"],
            "ROW",
            Some("(NEW.x IS NOT NULL)"),
            "audit",
            "redirect",
            Some("'O'Brien', audit_users"),
        );
        let sql = build_create_trigger_sql(&req).expect("emit OK");
        // `'O'Brien'` → `''O''Brien''` after `'` → `''` doubling.
        assert_eq!(
            sql,
            r#"CREATE TRIGGER "tg_view_redirect" INSTEAD OF INSERT ON "public"."user_view" FOR EACH ROW WHEN ((NEW.x IS NOT NULL)) EXECUTE FUNCTION "audit"."redirect"(''O''Brien'', audit_users)"#
        );
    }

    #[test]
    fn create_trigger_canonical_event_ordering_independent_of_input_order() {
        // Master spec § 6 fixture (iv) — caller submits events in
        // `[DELETE, UPDATE, INSERT]` order; emitted SQL must contain
        // canonical `INSERT OR UPDATE OR DELETE`. Locks the
        // canonical-walk approach in `build_create_trigger_sql` so the
        // SQL is byte-stable across UI checkbox iteration order.
        let req = create_trigger_req(
            "tg_changes",
            "public",
            "orders",
            "AFTER",
            vec!["DELETE", "UPDATE", "INSERT"],
            "STATEMENT",
            None,
            "audit",
            "log_changes",
            None,
        );
        let sql = build_create_trigger_sql(&req).expect("emit OK");
        assert!(
            sql.contains("AFTER INSERT OR UPDATE OR DELETE ON"),
            "Expected canonical event order in SQL, got: {sql}"
        );
    }

    #[test]
    fn create_trigger_emits_when_clause_with_outer_parens() {
        // Locks the `WHEN (<expr>)` wrapping — the emitter parenthesises
        // the caller's verbatim expression. With caller input `NEW.x > 0`
        // (no caller parens) we expect `WHEN (NEW.x > 0)`.
        let req = create_trigger_req(
            "tg_guard",
            "public",
            "events",
            "BEFORE",
            vec!["UPDATE"],
            "ROW",
            Some("NEW.x > 0"),
            "public",
            "noop",
            None,
        );
        let sql = build_create_trigger_sql(&req).expect("emit OK");
        assert_eq!(
            sql,
            r#"CREATE TRIGGER "tg_guard" BEFORE UPDATE ON "public"."events" FOR EACH ROW WHEN (NEW.x > 0) EXECUTE FUNCTION "public"."noop"()"#
        );
    }

    #[test]
    fn create_trigger_omits_when_clause_for_whitespace_expression() {
        // `when_expression == Some("   ")` is treated as "no clause" —
        // the dialog can submit the field unconditionally and the
        // emitter still produces a well-formed statement.
        let req = create_trigger_req(
            "tg_audit",
            "public",
            "users",
            "BEFORE",
            vec!["INSERT"],
            "ROW",
            Some("   "),
            "audit",
            "log",
            None,
        );
        let sql = build_create_trigger_sql(&req).expect("emit OK");
        assert_eq!(
            sql,
            r#"CREATE TRIGGER "tg_audit" BEFORE INSERT ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "audit"."log"()"#
        );
    }

    // ── Rejection paths — each returns `AppError::Validation` ────────

    #[test]
    fn create_trigger_rejects_empty_events() {
        let req = create_trigger_req(
            "tg_audit",
            "public",
            "users",
            "BEFORE",
            vec![],
            "ROW",
            None,
            "audit",
            "log",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(
            matches!(err, AppError::Validation(_)),
            "Expected Validation error, got: {err:?}"
        );
        assert!(err.to_string().contains("at least one event"));
    }

    #[test]
    fn create_trigger_rejects_invalid_timing() {
        let req = create_trigger_req(
            "tg_audit",
            "public",
            "users",
            "DURING",
            vec!["INSERT"],
            "ROW",
            None,
            "audit",
            "log",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Invalid trigger timing"));
    }

    #[test]
    fn create_trigger_rejects_invalid_orientation() {
        let req = create_trigger_req(
            "tg_audit",
            "public",
            "users",
            "BEFORE",
            vec!["INSERT"],
            "BATCH",
            None,
            "audit",
            "log",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Invalid trigger orientation"));
    }

    #[test]
    fn create_trigger_rejects_invalid_event() {
        let req = create_trigger_req(
            "tg_audit",
            "public",
            "users",
            "BEFORE",
            vec!["TRUNCATE"],
            "STATEMENT",
            None,
            "audit",
            "log",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Invalid trigger event"));
    }

    #[test]
    fn create_trigger_rejects_invalid_trigger_name() {
        // Identifier validation rejects digit-start names.
        let req = create_trigger_req(
            "9bad",
            "public",
            "users",
            "BEFORE",
            vec!["INSERT"],
            "ROW",
            None,
            "audit",
            "log",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Trigger name"));
    }

    #[test]
    fn create_trigger_rejects_invalid_schema() {
        let req = create_trigger_req(
            "tg_audit",
            "bad schema",
            "users",
            "BEFORE",
            vec!["INSERT"],
            "ROW",
            None,
            "audit",
            "log",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Schema name"));
    }

    #[test]
    fn create_trigger_rejects_invalid_table() {
        let req = create_trigger_req(
            "tg_audit",
            "public",
            "user\"s",
            "BEFORE",
            vec!["INSERT"],
            "ROW",
            None,
            "audit",
            "log",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Table name"));
    }

    #[test]
    fn create_trigger_rejects_invalid_function_schema() {
        let req = create_trigger_req(
            "tg_audit",
            "public",
            "users",
            "BEFORE",
            vec!["INSERT"],
            "ROW",
            None,
            "bad schema",
            "log",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Function schema"));
    }

    #[test]
    fn create_trigger_rejects_invalid_function_name() {
        let req = create_trigger_req(
            "tg_audit",
            "public",
            "users",
            "BEFORE",
            vec!["INSERT"],
            "ROW",
            None,
            "audit",
            "9bad",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Function name"));
    }

    #[test]
    fn create_trigger_rejects_instead_of_with_statement_orientation() {
        // INSTEAD OF triggers must use FOR EACH ROW — PG itself rejects
        // INSTEAD OF + STATEMENT because INSTEAD OF fires per-row on a
        // view. Pre-dispatch rejection lets the dialog surface the error
        // inline.
        let req = create_trigger_req(
            "tg_view_redirect",
            "public",
            "user_view",
            "INSTEAD OF",
            vec!["INSERT"],
            "STATEMENT",
            None,
            "audit",
            "redirect",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err
            .to_string()
            .contains("INSTEAD OF triggers must use FOR EACH ROW"));
    }

    #[test]
    fn create_trigger_rejects_instead_of_with_multi_event() {
        // INSTEAD OF cannot combine with multi-event — PG rejects
        // `INSTEAD OF INSERT OR UPDATE` because INSTEAD OF fires per-row
        // against a specific operation.
        let req = create_trigger_req(
            "tg_view_redirect",
            "public",
            "user_view",
            "INSTEAD OF",
            vec!["INSERT", "UPDATE"],
            "ROW",
            None,
            "audit",
            "redirect",
            None,
        );
        let err = build_create_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err
            .to_string()
            .contains("INSTEAD OF triggers must declare exactly one event"));
    }

    // ── Sprint 274 — build_drop_trigger_sql fixtures ─────────────────
    //
    // 작성 이유 (2026-05-13): trigger DROP 의 SQL emission 을 cascade on/off
    // 두 분기로 박제 + identifier validation 3 식별자 (trigger_name /
    // schema / table) 의 거부 경로를 단언. `build_drop_trigger_sql` 은
    // pool-free 순수 헬퍼이므로 fixture 만으로 검증 가능. preview vs.
    // execute 분기는 `commands/rdb/ddl.rs` 의 wiring / mismatch 테스트가
    // 담당.

    fn drop_trigger_req(
        trigger_name: &str,
        schema: &str,
        table: &str,
        cascade: bool,
    ) -> DropTriggerRequest {
        DropTriggerRequest {
            connection_id: "conn1".to_string(),
            schema: schema.to_string(),
            table: table.to_string(),
            trigger_name: trigger_name.to_string(),
            cascade,
            preview_only: true,
            expected_database: None,
        }
    }

    #[test]
    fn drop_trigger_no_cascade_byte_equivalent() {
        // Master spec § AC-274-02 fixture — minimal happy path emits
        // `DROP TRIGGER "name" ON "schema"."table"` with no trailing
        // keyword. Quoting via `validate_identifier` + `quote_identifier`
        // is byte-stable.
        let req = drop_trigger_req("tg_audit", "public", "users", false);
        let sql = build_drop_trigger_sql(&req).expect("emit OK");
        assert_eq!(sql, r#"DROP TRIGGER "tg_audit" ON "public"."users""#);
    }

    #[test]
    fn drop_trigger_cascade_byte_equivalent() {
        // Master spec § AC-274-02 fixture — CASCADE branch appends a
        // trailing ` CASCADE` keyword separated by a single space (the
        // statement is otherwise byte-equivalent to the no-CASCADE
        // form).
        let req = drop_trigger_req("tg_audit", "public", "users", true);
        let sql = build_drop_trigger_sql(&req).expect("emit OK");
        assert_eq!(
            sql,
            r#"DROP TRIGGER "tg_audit" ON "public"."users" CASCADE"#
        );
    }

    #[test]
    fn drop_trigger_rejects_invalid_trigger_name() {
        // Identifier validation rejects embedded double-quote characters
        // (the helper whitelist allows only `[a-zA-Z_][a-zA-Z0-9_]*`).
        // Without rejection, an embedded `"` could close the quoted
        // identifier and inject syntax.
        let req = drop_trigger_req("bad\"name", "public", "users", false);
        let err = build_drop_trigger_sql(&req).unwrap_err();
        assert!(
            matches!(err, AppError::Validation(_)),
            "Expected Validation error, got: {err:?}"
        );
        assert!(err.to_string().contains("Trigger name"));
    }

    #[test]
    fn drop_trigger_rejects_invalid_schema() {
        // Identifier validation rejects whitespace in schema names —
        // `bad schema` fails the body-character whitelist.
        let req = drop_trigger_req("tg_audit", "bad schema", "users", false);
        let err = build_drop_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Schema name"));
    }

    #[test]
    fn drop_trigger_rejects_invalid_table() {
        // 65-byte table name exceeds NAMEDATALEN (63) and is rejected
        // before SQL emission so PG never sees the over-length value.
        let long_table = "t".repeat(65);
        let req = drop_trigger_req("tg_audit", "public", &long_table, false);
        let err = build_drop_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Table name"));
        assert!(err.to_string().contains("63 bytes"));
    }

    #[test]
    fn drop_trigger_rejects_empty_trigger_name() {
        // Empty trigger_name surfaces "must not be empty" — Sprint 235
        // identifier helper rule.
        let req = drop_trigger_req("", "public", "users", false);
        let err = build_drop_trigger_sql(&req).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("Trigger name"));
        assert!(err.to_string().contains("must not be empty"));
    }

    #[tokio::test]
    async fn drop_trigger_without_connection_fails_non_preview() {
        // Sprint 274 — execute branch (preview_only=false) requires a
        // live pool; without one the call surfaces the connection
        // sentinel before any DB work happens (mirrors Sprint 235
        // `drop_table_without_connection_fails_non_preview`).
        let adapter = PostgresAdapter::new();
        let req = DropTriggerRequest {
            connection_id: "conn1".into(),
            schema: "public".into(),
            table: "users".into(),
            trigger_name: "tg_audit".into(),
            cascade: false,
            preview_only: false,
            expected_database: None,
        };
        let result = adapter.drop_trigger(&req).await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn drop_trigger_preview_only_does_not_execute() {
        // preview_only=true returns the built SQL without touching the
        // pool. Mirrors the Sprint 235 `drop_table_preview_only_does_not_execute`
        // pattern — the adapter has no pool but preview still succeeds.
        let adapter = PostgresAdapter::new();
        let req = drop_trigger_req("tg_audit", "public", "users", false);
        let result = adapter.drop_trigger(&req).await.expect("preview OK");
        assert_eq!(result.sql, r#"DROP TRIGGER "tg_audit" ON "public"."users""#);
    }
}
