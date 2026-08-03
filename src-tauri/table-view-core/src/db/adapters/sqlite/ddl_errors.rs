//! SQLite `ALTER TABLE` restriction → cause + remedy (#1804).
//!
//! Native `ADD COLUMN` / `DROP COLUMN` are opened without a pre-flight check
//! (owner decision, 2026-07-25): SQLite refuses a restricted statement
//! atomically, so a rejected attempt leaves the schema untouched, and a
//! `sqlite_schema` parser would only duplicate — less accurately — a judgement
//! the engine already makes. What the engine's text does not carry is what the
//! user should do next, so this module prepends the cause and the remedy and
//! keeps the driver text appended. Nothing downstream rewrites it: the frontend
//! classifier (`src/lib/errors/driverErrorHints.ts`) matches none of these
//! strings and fails open. `AppError::Database`'s `Display` does prefix
//! `"Database error: "` (`crate::error`), so the sentence reaches the user with
//! that prefix but otherwise intact.
//!
//! Every arm below is pinned to a string emitted by the bundled SQLite
//! (3.46.0, `libsqlite3-sys 0.30.1`) and is driven through a real database file
//! by `ddl_native_live_tests.rs`. An unrecognised failure returns `None` and
//! keeps its raw text — a mis-classified error is worse than an unadorned one.

use crate::error::AppError;

/// Wrap a failed DDL statement. `column` is the column the statement targets
/// when it is a single-column `ALTER TABLE` — SQLite's `ADD COLUMN` errors
/// never name it, so the batch runner carries it in from the request.
pub(super) fn ddl_failure(column: Option<&str>, raw: &str) -> AppError {
    match restriction_advice(column, raw) {
        Some(advice) => AppError::Database(format!("{advice} (SQLite: {raw})")),
        None => AppError::Database(format!("SQLite DDL failed: {raw}")),
    }
}

/// Cause + remedy for the documented restrictions, or `None` when the failure
/// is something else (a missing table, a syntax error, a busy file …).
fn restriction_advice(column: Option<&str>, raw: &str) -> Option<String> {
    drop_column_advice(column, raw).or_else(|| add_column_advice(column, raw))
}

/// `DROP COLUMN` restrictions. The first three arms read the column out of
/// SQLite's own text; the dependent-object arms do not get one there, so they
/// take the request's column — AC2 asks for the blocking reason *and* the
/// column in the sentence, not only in the driver text appended after it.
fn drop_column_advice(column: Option<&str>, raw: &str) -> Option<String> {
    if let Some(column) = quoted_after(raw, "cannot drop PRIMARY KEY column:") {
        return Some(format!(
            "Cannot drop column \"{column}\": it belongs to the table's PRIMARY KEY. \
             SQLite can only remove a PRIMARY KEY column by rebuilding the whole table, \
             which this app does not do — recreate the table without the column instead."
        ));
    }
    if let Some(column) = quoted_after(raw, "cannot drop UNIQUE column:") {
        return Some(format!(
            "Cannot drop column \"{column}\": a UNIQUE constraint covers it. \
             SQLite can only remove it by rebuilding the whole table, which this app does not \
             do — recreate the table without the column instead."
        ));
    }
    if let Some(column) = quoted_after(raw, "cannot drop column") {
        if raw.contains("no other columns exist") {
            return Some(format!(
                "Cannot drop column \"{column}\": it is the table's only column. \
                 Drop the table instead."
            ));
        }
    }
    if let Some((kind, name)) = dependent_object(raw) {
        let (subject, remedy) = match kind {
            "index" => (
                format!("index \"{name}\" still indexes it"),
                format!("Drop or redefine index \"{name}\" first."),
            ),
            "view" => (
                format!("view \"{name}\" still selects it"),
                format!("Drop or redefine view \"{name}\" first."),
            ),
            "trigger" => (
                format!("trigger \"{name}\" still reads it"),
                format!("Drop or redefine trigger \"{name}\" first."),
            ),
            // `error in table <name> …`. The blocker is a definition in that
            // same table which SQLite cannot re-resolve. Two engine texts reach
            // here, both driven by the live cases: a generated column or a
            // CHECK gives `no such column: <col>`, a FOREIGN KEY clause naming
            // the dropped column gives `unknown column "<col>" in foreign key
            // definition`. Only the second names the kind of definition, and
            // none of them names the remedy, which is why all three are spelled
            // out below. `<name>` is the table being altered: a *child* table's
            // FK into the dropped column does not arrive here, because an FK's
            // parent column is a PRIMARY KEY or UNIQUE column whose own arm
            // fires first, and where it is neither the drop just succeeds.
            "table" => (
                format!("a definition in table \"{name}\" still references it"),
                format!(
                    "Remove or redefine it in table \"{name}\" first — a generated column, a \
                     CHECK, or a FOREIGN KEY clause."
                ),
            ),
            _ => return None,
        };
        let subject_column = match column {
            Some(name) => format!("Cannot drop column \"{name}\""),
            None => "Cannot drop the column".to_string(),
        };
        return Some(format!(
            "{subject_column}: {subject}. {remedy} SQLite refuses the drop because the leftover \
             definition would no longer resolve."
        ));
    }
    None
}

/// `ADD COLUMN` restrictions reachable through this adapter. SQLite applies
/// them only once the table holds rows — on an empty table the same statement
/// succeeds, so these cannot be decided up front from the request alone.
///
/// The `PRIMARY KEY` / `UNIQUE` / `STORED` / `REFERENCES` restrictions are not
/// listed: `build_column_definition` rejects those tokens inside a `data_type`
/// or `DEFAULT` before any SQL is emitted, so they surface as a validation
/// error naming the token and never reach the engine.
fn add_column_advice(column: Option<&str>, raw: &str) -> Option<String> {
    let subject = match column {
        Some(name) => format!("Cannot add column \"{name}\""),
        None => "Cannot add the column".to_string(),
    };
    if raw.contains("Cannot add a NOT NULL column with default value NULL") {
        return Some(format!(
            "{subject}: the table already has rows, and SQLite must give each of them a value. \
             A NOT NULL column therefore needs a DEFAULT — set one, or make the column nullable."
        ));
    }
    if raw.contains("Cannot add a column with non-constant default") {
        return Some(format!(
            "{subject}: the table already has rows, and SQLite backfills them with one stored \
             value, so the DEFAULT must be a constant. Expressions such as CURRENT_TIMESTAMP or \
             (datetime('now')) are rejected — use a literal default."
        ));
    }
    None
}

/// The identifier in `… <needle> "<ident>"`. The span runs to the *last* quote
/// of the segment, not the first one after the opener, so an identifier that
/// SQLite echoed back with its inner quote doubled survives intact.
fn quoted_after(raw: &str, needle: &str) -> Option<String> {
    let rest = raw.split(needle).nth(1)?;
    let open = rest.find('"')?;
    let close = rest.rfind('"')?;
    if close <= open {
        return None;
    }
    Some(rest[open + 1..close].replace("\"\"", "\""))
}

/// `error in <kind> <name> after drop column: …` — the object whose definition
/// would break. Returns the kind (`index` / `view` / `trigger` / `table`) and
/// its name.
///
/// Both markers are required. SQLite emits the same `error in <kind> <name>: …`
/// opener when re-parsing the schema after a RENAME too, and this advice is
/// applied to every failed statement the DDL runner sees, so matching on the
/// opener alone would dress an unrelated failure as a DROP COLUMN restriction.
fn dependent_object(raw: &str) -> Option<(&str, &str)> {
    let rest = raw.split("error in ").nth(1)?;
    let (head, _) = rest.split_once(" after drop column")?;
    head.split_once(' ')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verbatim `sqlx::Error` display strings captured from SQLite 3.46.0.
    /// Re-capture them if `libsqlite3-sys` moves: the arms match on this text.
    const DROP_PRIMARY_KEY: &str =
        "error returned from database: (code: 1) cannot drop PRIMARY KEY column: \"id\"";
    const DROP_UNIQUE: &str =
        "error returned from database: (code: 1) cannot drop UNIQUE column: \"email\"";
    const DROP_INDEXED: &str = "error returned from database: (code: 1) \
         error in index ix after drop column: no such column: name";
    const DROP_VIEWED: &str = "error returned from database: (code: 1) \
         error in view v after drop column: no such column: name";
    const DROP_TRIGGERED: &str = "error returned from database: (code: 1) \
         error in trigger tg after drop column: no such column: NEW.name";
    const DROP_GENERATED: &str = "error returned from database: (code: 1) \
         error in table t after drop column: no such column: name";
    const DROP_FOREIGN_KEY: &str = "error returned from database: (code: 1) \
         error in table t after drop column: unknown column \"name\" in foreign key definition";
    const DROP_LAST_COLUMN: &str = "error returned from database: (code: 1) \
         cannot drop column \"name\": no other columns exist";
    const ADD_NOT_NULL: &str = "error returned from database: (code: 1) \
         Cannot add a NOT NULL column with default value NULL";
    const ADD_NON_CONSTANT_DEFAULT: &str = "error returned from database: (code: 1) \
         Cannot add a column with non-constant default";

    fn advice(column: Option<&str>, raw: &str) -> String {
        restriction_advice(column, raw)
            .unwrap_or_else(|| panic!("expected a restriction match for {raw:?}"))
    }

    #[test]
    fn drop_column_arms_name_the_column_and_the_blocking_reason() {
        let pk = advice(None, DROP_PRIMARY_KEY);
        assert!(pk.contains("\"id\""), "{pk}");
        assert!(pk.contains("PRIMARY KEY"), "{pk}");

        let unique = advice(None, DROP_UNIQUE);
        assert!(unique.contains("\"email\""), "{unique}");
        assert!(unique.contains("UNIQUE"), "{unique}");

        let last = advice(None, DROP_LAST_COLUMN);
        assert!(last.contains("\"name\""), "{last}");
        assert!(last.contains("only column"), "{last}");
    }

    #[test]
    fn drop_column_arms_name_the_dependent_object_and_the_request_column() {
        for (raw, kind, name) in [
            (DROP_INDEXED, "index", "ix"),
            (DROP_VIEWED, "view", "v"),
            (DROP_TRIGGERED, "trigger", "tg"),
            (DROP_GENERATED, "table", "t"),
        ] {
            let message = advice(Some("legacy"), raw);
            assert!(message.contains(kind), "{kind}: {message}");
            assert!(
                message.contains(&format!("\"{name}\"")),
                "{kind}: {message}"
            );
            // AC2 — the sentence itself names the column, not just the driver
            // text appended after it. SQLite never names it in these four arms.
            assert!(
                message.starts_with("Cannot drop column \"legacy\":"),
                "{kind}: {message}"
            );
            assert!(!raw.contains("legacy"), "{kind}: needle leaked from raw");
        }
    }

    /// The `table` arm names all three definitions that can reach it. SQLite's
    /// own text names at most the FOREIGN KEY one and never says what to do, so
    /// a user who is given only the engine's sentence has to guess which of the
    /// three to go looking for.
    #[test]
    fn the_table_arm_names_every_definition_that_can_block_the_drop() {
        for raw in [DROP_GENERATED, DROP_FOREIGN_KEY] {
            let message = advice(Some("legacy"), raw);

            assert!(message.contains("generated column"), "{message}");
            assert!(message.contains("CHECK"), "{message}");
            assert!(message.contains("FOREIGN KEY"), "{message}");
            // The remedy points at the table SQLite named and nowhere else.
            // That it is the altered table is the live module's case to make.
            assert!(message.contains("in table \"t\" first"), "{message}");
        }
    }

    #[test]
    fn add_column_arms_name_the_request_column_and_the_remedy() {
        let not_null = advice(Some("nickname"), ADD_NOT_NULL);
        assert!(not_null.contains("\"nickname\""), "{not_null}");
        assert!(not_null.contains("DEFAULT"), "{not_null}");

        let non_constant = advice(Some("created_at"), ADD_NON_CONSTANT_DEFAULT);
        assert!(non_constant.contains("\"created_at\""), "{non_constant}");
        assert!(non_constant.contains("constant"), "{non_constant}");
    }

    /// Fail-open: an unrelated driver failure keeps its full text, so a
    /// diagnosis is never traded for a wrong-but-friendly sentence.
    #[test]
    fn unrelated_failures_are_not_reclassified() {
        for raw in [
            "error returned from database: (code: 1) no such table: nosuch",
            "error returned from database: (code: 1) near \"FROM\": syntax error",
            "error returned from database: (code: 5) database is locked",
        ] {
            assert!(restriction_advice(Some("any"), raw).is_none(), "{raw}");
            let AppError::Database(message) = ddl_failure(Some("any"), raw) else {
                panic!("expected AppError::Database for {raw:?}");
            };
            assert!(message.contains(raw), "{message}");
        }
    }

    /// The wrapper keeps the driver text even when it does classify, so the
    /// original diagnosis survives alongside the advice.
    #[test]
    fn classified_failures_still_carry_the_driver_text() {
        let AppError::Database(message) = ddl_failure(None, DROP_UNIQUE) else {
            panic!("expected AppError::Database");
        };
        assert!(message.contains("UNIQUE constraint covers it"), "{message}");
        assert!(message.contains(DROP_UNIQUE), "{message}");
    }

    /// SQLite doubles an embedded quote in the identifier it echoes back.
    #[test]
    fn quoted_identifiers_are_unescaped() {
        let raw = "error returned from database: (code: 1) \
                   cannot drop UNIQUE column: \"od\"\"d\"";
        let message = advice(None, raw);
        assert!(message.contains("\"od\"d\""), "{message}");
    }
}
