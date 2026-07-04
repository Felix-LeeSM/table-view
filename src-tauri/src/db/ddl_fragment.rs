//! Shared validation for raw DDL fragments (issue #1108).
//!
//! Column `data_type`, `DEFAULT` values, and `USING` cast expressions are raw
//! SQL that every adapter interpolates verbatim into generated DDL — unlike
//! identifiers, which each dialect neutralizes via `quote_ident` /
//! `quote_identifier`. These fragments originate from the structure-editor UI
//! (a semi-trusted boundary — the user edits their own DB), but raw
//! interpolation still lets a malformed value break out of its clause and
//! append unintended statements (e.g. `int; DROP TABLE audit`) under drivers
//! that accept the simple/multi-statement query protocol.
//!
//! We reject the small set of tokens that enable such a breakout — statement
//! separators and comment lead-ins — rather than allowlisting a type grammar,
//! because an allowlist risks rejecting legitimate exotic types/expressions
//! (`timestamp with time zone`, `numeric(10,2)`, `int[]`, `col::newtype`,
//! `enum('a','b')`, domain/custom types). The denylist blocks the injection
//! vector while leaving legitimate fragments untouched.
//!
//! Accepted residual: a legitimate value whose *content* embeds one of these
//! tokens (e.g. `DEFAULT '; literal'` or a comment string inside a default) is
//! rejected. Such values are rare on this boundary; callers needing them can
//! go through a future explicit raw-SQL path.

use crate::error::AppError;

/// Substrings that let a raw fragment escape its clause and be treated as new
/// SQL: the statement separator `;`, the SQL line comment `--`, the block
/// comment delimiters `/*` and `*/`, and the MySQL line comment `#`. A NUL
/// byte never belongs in DDL text and can truncate the statement at the C
/// boundary, so it is rejected too.
const FORBIDDEN_SEQUENCES: &[(&str, &str)] = &[
    (";", "';'"),
    ("--", "'--'"),
    ("/*", "'/*'"),
    ("*/", "'*/'"),
    ("#", "'#'"),
    ("\0", "a NUL byte"),
];

/// Reject a raw DDL fragment (`data_type`, `DEFAULT` value, or `USING`
/// expression) that contains a statement-breakout token. `label` names the
/// fragment class for the error message (e.g. `"Data type"`).
pub(crate) fn validate_ddl_fragment(value: &str, label: &str) -> Result<(), AppError> {
    for (seq, shown) in FORBIDDEN_SEQUENCES {
        if value.contains(seq) {
            return Err(AppError::Validation(format!(
                "{label} must not contain {shown} \
                 (statement separators and comment tokens are rejected to prevent DDL injection)"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_legitimate_types_and_expressions() {
        for ok in [
            "int",
            "varchar(255)",
            "numeric(10,2)",
            "timestamp with time zone",
            "double precision",
            "int[]",
            "enum('a','b')",
            "geometry",
            "\"custom\".\"type\"",
            "col::bigint",
            "0",
            "'literal default'",
            "now()",
            "", // empty is handled by separate non-empty checks
        ] {
            assert!(
                validate_ddl_fragment(ok, "Data type").is_ok(),
                "expected {ok:?} to pass"
            );
        }
    }

    #[test]
    fn rejects_statement_and_comment_breakouts() {
        for bad in [
            "int; DROP TABLE audit",
            "int DEFAULT 0; DROP TABLE x",
            "int -- comment",
            "int /* block */",
            "text */",
            "int # mysql comment",
            "int\0",
        ] {
            let err = validate_ddl_fragment(bad, "Data type").unwrap_err();
            assert!(
                err.to_string().contains("must not contain"),
                "expected {bad:?} to be rejected, got {err}"
            );
        }
    }
}
