use crate::error::AppError;
use crate::models::{CreateTriggerRequest, DropTriggerRequest};

use super::{qualified_table, quote_identifier, validate_identifier};

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
pub(super) fn build_create_trigger_sql(req: &CreateTriggerRequest) -> Result<String, AppError> {
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
pub(super) fn build_drop_trigger_sql(req: &DropTriggerRequest) -> Result<String, AppError> {
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
