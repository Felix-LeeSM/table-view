//! Issue #1525 — PostgreSQL read-only cross-table value search.
//!
//! Scans the TEXT columns of every base table in the selected schemas for
//! cells matching a search term (case-insensitive substring, ILIKE) and
//! returns the matched schema/table/column/value tuples. Coverage is the
//! built-in `text` / `character varying` / `character` types plus `citext`
//! (a case-insensitive text extension); see `TEXT_COLUMNS_SQL`.
//!
//! Security contract (matches the DDL family's injection floor):
//!   - Schema names arrive from the frontend and are bound as a `text[]`
//!     parameter to the `information_schema` enumeration query — never
//!     interpolated.
//!   - Table/column identifiers come back from `information_schema` (trusted
//!     catalog metadata) and are ANSI-quoted with `quote_identifier` before
//!     interpolation into the per-table SELECT.
//!   - The search term is passed ONLY as the bound `$1` ILIKE pattern; its
//!     `%` / `_` / `\` metacharacters are escaped so it matches literally.
//!   - The generated SQL is SELECT-only (read-only). No write path exists.
//!   - `row_cap` bounds the total matches collected and `cancel` aborts a
//!     long scan cooperatively, so a wide database cannot be scanned
//!     unbounded.

use sqlx::Row;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{ValueSearchMatch, ValueSearchResult};

use super::mutations::{qualified_table, quote_identifier};
use super::PostgresAdapter;

/// Enumerate the TEXT columns of base tables in the selected schemas.
/// `$1` is bound as `text[]` (schema names) — never interpolated. The
/// `ORDER BY` groups columns of one table contiguously so the caller can
/// group with a single linear pass.
///
/// Text-type coverage (#1525): the built-in `text` / `character varying` /
/// `character` types plus `citext`, a contrib **extension** type that
/// `information_schema` reports as `data_type = 'USER-DEFINED'` with
/// `udt_name = 'citext'`. citext is a drop-in case-insensitive text type, so
/// ILIKE applies unchanged (its value casts to `text` for the predicate and
/// decodes as `String`). Types that need an explicit cast to be searchable
/// (`uuid` / `json` / `jsonb` / `xml`) stay out of the "TEXT column" contract.
///
/// The citext branch is narrowed to the type OWNED BY the `citext` extension
/// (`pg_depend` deptype `'e'` → `pg_extension`), matched by both name and
/// schema (`udt_schema`). A user-defined composite/enum/domain that merely
/// shares the name `citext` is NOT a text type — enumerating its column would
/// emit `<citext-composite> ILIKE $1`, which has no operator and would error
/// the whole scan. The subquery makes that column simply not match; on a
/// database without the extension it is likewise inert (matches nothing).
const TEXT_COLUMNS_SQL: &str = "SELECT c.table_schema, c.table_name, c.column_name \
     FROM information_schema.columns c \
     JOIN information_schema.tables t \
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name \
     WHERE c.table_schema = ANY($1) \
       AND t.table_type = 'BASE TABLE' \
       AND (c.data_type IN ('text', 'character varying', 'character') \
            OR (c.data_type = 'USER-DEFINED' AND c.udt_name = 'citext' \
                AND EXISTS ( \
                    SELECT 1 FROM pg_catalog.pg_type ty \
                    JOIN pg_catalog.pg_namespace tn ON tn.oid = ty.typnamespace \
                    JOIN pg_catalog.pg_depend dep ON dep.objid = ty.oid AND dep.deptype = 'e' \
                    JOIN pg_catalog.pg_extension ext ON ext.oid = dep.refobjid \
                    WHERE ty.typname = c.udt_name AND tn.nspname = c.udt_schema \
                      AND ext.extname = 'citext'))) \
     ORDER BY c.table_schema, c.table_name, c.ordinal_position";

/// Longest matched-cell value returned to the UI. A single scanned cell can
/// be megabytes (a `text` column); the result grid only needs a locating
/// snippet, so anything longer is clipped with an ellipsis.
const MAX_VALUE_LEN: usize = 500;

/// Escape ILIKE metacharacters so `term` matches as a literal substring.
/// PostgreSQL's default LIKE/ILIKE escape character is backslash, so `\`,
/// `%` and `_` must each be backslash-escaped. Backslash is escaped first so
/// the escapes added for `%`/`_` are not themselves re-escaped.
pub(crate) fn escape_ilike_term(term: &str) -> String {
    let mut out = String::with_capacity(term.len());
    for ch in term.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Build the bound `$1` ILIKE pattern — `%<escaped>%` — matching the term as
/// a case-insensitive substring anywhere in a cell.
pub(crate) fn ilike_pattern(term: &str) -> String {
    format!("%{}%", escape_ilike_term(term))
}

/// Build the per-table search SQL. `columns` are raw identifiers from
/// `information_schema`; each is ANSI-quoted. The term binds to `$1` (the
/// ILIKE pattern) and the row limit to `$2`. The statement is SELECT-only.
///
/// Shape: `SELECT "c1", "c2" FROM "schema"."table" WHERE "c1" ILIKE $1 OR
/// "c2" ILIKE $1 LIMIT $2`.
pub(crate) fn build_table_search_sql(schema: &str, table: &str, columns: &[String]) -> String {
    let quoted: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
    let predicates: Vec<String> = quoted.iter().map(|c| format!("{} ILIKE $1", c)).collect();
    format!(
        "SELECT {} FROM {} WHERE {} LIMIT $2",
        quoted.join(", "),
        qualified_table(schema, table),
        predicates.join(" OR "),
    )
}

/// Clip an oversized cell value to a locating snippet for the result grid.
fn clip_value(value: &str) -> String {
    if value.chars().count() <= MAX_VALUE_LEN {
        return value.to_string();
    }
    let clipped: String = value.chars().take(MAX_VALUE_LEN).collect();
    format!("{}\u{2026}", clipped)
}

impl PostgresAdapter {
    /// Issue #1525 — see the module docs and the `RdbAdapter::search_values`
    /// trait contract. Read-only: emits only bound-parameter SELECTs.
    pub async fn search_values(
        &self,
        schemas: &[String],
        term: &str,
        cancel: Option<&CancellationToken>,
        row_cap: usize,
    ) -> Result<ValueSearchResult, AppError> {
        let term = term.trim();
        if term.is_empty() {
            return Err(AppError::Validation("Search term cannot be empty".into()));
        }
        if schemas.is_empty() {
            return Err(AppError::Validation(
                "At least one schema must be selected".into(),
            ));
        }

        let pool = self.active_pool().await?;

        // 1. Enumerate the text columns to scan. Schema names bound as $1.
        let col_rows: Vec<(String, String, String)> = sqlx::query_as(TEXT_COLUMNS_SQL)
            .bind(schemas)
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        // Group columns per (schema, table). The ORDER BY makes rows of one
        // table contiguous, so a single linear group-by suffices.
        let mut tables: Vec<((String, String), Vec<String>)> = Vec::new();
        for (schema, table, column) in col_rows {
            match tables.last_mut() {
                Some(((s, t), cols)) if *s == schema && *t == table => cols.push(column),
                _ => tables.push(((schema, table), vec![column])),
            }
        }

        let pattern = ilike_pattern(term);
        let term_lower = term.to_lowercase();
        let mut result = ValueSearchResult::default();

        // 2. Scan each table's text columns with a bound ILIKE. Stop once the
        //    global match cap is reached or the caller cancels.
        for ((schema, table), columns) in &tables {
            if result.matches.len() >= row_cap {
                result.truncated = true;
                break;
            }
            if cancel.map(CancellationToken::is_cancelled).unwrap_or(false) {
                return Err(AppError::Database("Operation cancelled".into()));
            }

            // Bound fetched rows by the remaining match budget so a single
            // wide table cannot monopolise the scan.
            let remaining = (row_cap - result.matches.len()) as i64;
            let sql = build_table_search_sql(schema, table, columns);
            let fetch = async {
                sqlx::query(&sql)
                    .bind(&pattern)
                    .bind(remaining)
                    .fetch_all(&pool)
                    .await
                    .map_err(|e| AppError::Database(e.to_string()))
            };
            let rows = match cancel {
                Some(token) => tokio::select! {
                    r = fetch => r?,
                    _ = token.cancelled() => {
                        return Err(AppError::Database("Operation cancelled".into()))
                    }
                },
                None => fetch.await?,
            };
            result.scanned_tables += 1;

            // Determine which text cell(s) matched (the SQL OR only tells us the
            // row matched). A case-insensitive substring check mirrors ILIKE's
            // literal-substring semantics closely enough for locating the value.
            'rows: for row in &rows {
                for (idx, column) in columns.iter().enumerate() {
                    if result.matches.len() >= row_cap {
                        result.truncated = true;
                        break 'rows;
                    }
                    if let Ok(Some(value)) = row.try_get::<Option<String>, usize>(idx) {
                        if value.to_lowercase().contains(&term_lower) {
                            result.matches.push(ValueSearchMatch {
                                schema: schema.clone(),
                                table: table.clone(),
                                column: column.clone(),
                                value: clip_value(&value),
                            });
                        }
                    }
                }
            }
        }

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── escape_ilike_term — ILIKE metacharacter escaping ─────────────────
    // 작성 이유 (#1525): 검색어가 bind 로만 전달되어도 `%`/`_`/`\` 가
    // escape 안 되면 유저 입력이 wildcard 로 오작동해 "무방비 스캔"/오탐을
    // 유발. 보안·정확성 경계라 negative case (metachar) 를 반드시 동결.

    #[test]
    fn escape_plain_term_unchanged() {
        assert_eq!(escape_ilike_term("hello"), "hello");
    }

    #[test]
    fn escape_percent_is_backslash_escaped() {
        // "50%" must match a literal percent, not "anything after 50".
        assert_eq!(escape_ilike_term("50%"), "50\\%");
    }

    #[test]
    fn escape_underscore_is_backslash_escaped() {
        // "a_b" must match a literal underscore, not "a<any>b".
        assert_eq!(escape_ilike_term("a_b"), "a\\_b");
    }

    #[test]
    fn escape_backslash_is_doubled_first() {
        assert_eq!(escape_ilike_term("a\\b"), "a\\\\b");
    }

    #[test]
    fn escape_all_metacharacters_together() {
        // Order matters: the backslash inserted for `%`/`_` must not be
        // re-escaped. Input `%_\` → each char prefixed with one backslash.
        assert_eq!(escape_ilike_term("%_\\"), "\\%\\_\\\\");
    }

    #[test]
    fn escape_preserves_unicode() {
        assert_eq!(escape_ilike_term("café_x"), "café\\_x");
    }

    // ── ilike_pattern — wraps escaped term in %…% ────────────────────────

    #[test]
    fn pattern_wraps_plain_term() {
        assert_eq!(ilike_pattern("foo"), "%foo%");
    }

    #[test]
    fn pattern_wraps_escaped_term() {
        // The wrapping `%` are literal wildcards; the term's own `%` is escaped.
        assert_eq!(ilike_pattern("a%b"), "%a\\%b%");
    }

    // ── build_table_search_sql — quoting + SELECT-only shape ──────────────

    #[test]
    fn build_sql_multi_column_shape() {
        let sql = build_table_search_sql(
            "public",
            "users",
            &["name".to_string(), "email".to_string()],
        );
        assert_eq!(
            sql,
            "SELECT \"name\", \"email\" FROM \"public\".\"users\" \
             WHERE \"name\" ILIKE $1 OR \"email\" ILIKE $1 LIMIT $2"
        );
    }

    #[test]
    fn build_sql_single_column_shape() {
        let sql = build_table_search_sql("public", "notes", &["body".to_string()]);
        assert_eq!(
            sql,
            "SELECT \"body\" FROM \"public\".\"notes\" WHERE \"body\" ILIKE $1 LIMIT $2"
        );
    }

    #[test]
    fn build_sql_is_select_only() {
        // No write path can be produced — the generator only ever emits SELECT.
        let sql = build_table_search_sql("s", "t", &["c".to_string()]);
        assert!(sql.starts_with("SELECT "));
        let upper = sql.to_uppercase();
        for verb in ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", ";"] {
            assert!(
                !upper.contains(verb),
                "generated SQL must be read-only: {sql}"
            );
        }
    }

    #[test]
    fn build_sql_quotes_injection_bearing_identifiers() {
        // Identifiers carrying `"` are ANSI-quoted (doubled), so a crafted
        // column/table name cannot break out of the identifier context.
        let sql = build_table_search_sql("pub\"lic", "we\"ird", &["a\"b".to_string()]);
        assert!(sql.contains("\"pub\"\"lic\".\"we\"\"ird\""));
        assert!(sql.contains("\"a\"\"b\" ILIKE $1"));
    }

    #[test]
    fn build_sql_matches_via_bound_placeholder_only() {
        // The predicate matches against the `$1` bound placeholder and the SQL
        // carries no literal `%`/`_` pattern — the term is bound at execution,
        // never interpolated into the statement. (The builder has no term
        // parameter, so interpolation is structurally impossible; this locks
        // the placeholder + LIMIT $2 shape against a future edit.)
        let sql = build_table_search_sql("public", "t", &["c".to_string()]);
        assert!(sql.contains("ILIKE $1"));
        assert!(sql.contains("LIMIT $2"));
        assert!(
            !sql.contains('%'),
            "no literal ILIKE pattern in the SQL: {sql}"
        );
    }

    // ── TEXT_COLUMNS_SQL — text-type coverage (#1525) ────────────────────
    // The integration test (`value_search_integration.rs`) proves the citext
    // path end-to-end but silent-skips without Docker. This cheap guard locks
    // the enumeration filter so a regression edit dropping either the built-in
    // types or the citext extension branch fails everywhere.

    #[test]
    fn text_columns_sql_covers_builtin_and_extension_citext() {
        assert!(
            TEXT_COLUMNS_SQL.contains("c.data_type IN ('text', 'character varying', 'character')")
        );
        // citext is an extension type: data_type='USER-DEFINED', udt_name='citext'.
        assert!(TEXT_COLUMNS_SQL.contains("c.data_type = 'USER-DEFINED' AND c.udt_name = 'citext'"));
        // ...but only when owned by the citext EXTENSION, so a user composite/
        // enum/domain named `citext` (ILIKE on which would error the scan) is
        // excluded. Lock the extension-membership predicate.
        assert!(TEXT_COLUMNS_SQL.contains("pg_catalog.pg_extension"));
        assert!(TEXT_COLUMNS_SQL.contains("dep.deptype = 'e'"));
        assert!(TEXT_COLUMNS_SQL.contains("ext.extname = 'citext'"));
    }

    // ── clip_value — oversized cell snippet ──────────────────────────────

    #[test]
    fn clip_short_value_unchanged() {
        assert_eq!(clip_value("short"), "short");
    }

    #[test]
    fn clip_long_value_adds_ellipsis() {
        let long = "x".repeat(MAX_VALUE_LEN + 50);
        let clipped = clip_value(&long);
        assert_eq!(clipped.chars().count(), MAX_VALUE_LEN + 1); // +1 for ellipsis
        assert!(clipped.ends_with('\u{2026}'));
    }

    #[test]
    fn clip_respects_char_boundaries() {
        // Multi-byte chars must not be split mid-codepoint.
        let long = "é".repeat(MAX_VALUE_LEN + 10);
        let clipped = clip_value(&long);
        assert_eq!(clipped.chars().count(), MAX_VALUE_LEN + 1);
    }
}
