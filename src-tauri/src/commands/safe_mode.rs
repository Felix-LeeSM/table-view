//! Issue #1112 — RDB Safe Mode backend gate (IPC chokepoint).
//!
//! Safe Mode's 3-tier policy (`strict` / `warn` / `off`) was, before this
//! change, enforced *only* by the frontend pure function
//! `decideSafeModeAction` (`src/lib/safeMode.ts`). A direct IPC `invoke`, a
//! frontend hydration race, or a tampered webview could reach
//! `execute_query` / `execute_query_batch` / the DDL commands with a
//! destructive statement and run it with no warning. This module is the
//! backend chokepoint: every destructive RDB execution path re-reads the
//! Safe Mode setting **and** the target connection's `environment` from the
//! backend's own SQLite store (immune to frontend hydration state) and
//! refuses a destructive statement that carries no confirmation proof.
//!
//! Classification reuses `sql-parser-core` natively (the same crate the
//! frontend compiles to WASM), so backend and frontend project the SAME
//! parse AST — divergence is structurally prevented for everything the AST
//! covers. See `sql_parser_core::safety` for the danger set and the one
//! documented divergence (frontend dynamic dry-run WARN→danger escalation
//! is UI-only and intentionally not reproduced here).
//!
//! Proof mechanism: mirrors the Mongo `safety_confirmed: bool` pattern
//! (`commands/document/mutate.rs`) — the frontend passes an explicit
//! `safety_confirmed` flag AFTER its confirm dialog is satisfied. The
//! backend rejects the `destructive + not-confirmed` combination only; a
//! non-destructive statement, or a destructive one the matrix allows
//! (non-production + warn/off), passes regardless of the flag.

use sqlx::SqlitePool;

use crate::commands::snapshot::{SafeMode, SafeModeStore};
use crate::error::AppError;

/// Result of the Safe Mode decision matrix for a single danger evaluation.
pub enum GateOutcome {
    Allow,
    ConfirmRequired(String),
}

/// Native port of the `severity === "danger"` branch of the frontend
/// `decideSafeModeAction` (`src/lib/safeMode.ts`). Only the danger tier is
/// gated — `Info` / `Warn` callers pass `is_danger = false` and always get
/// `Allow`, exactly as the frontend matrix passes those tiers through.
///
/// Matrix (danger statements only):
///
/// | mode   | non-production | production |
/// |--------|----------------|------------|
/// | strict | ConfirmRequired| ConfirmRequired |
/// | warn   | Allow          | ConfirmRequired |
/// | off    | Allow          | ConfirmRequired |
///
/// `environment == None` (untagged / unset connection) is treated as
/// non-production — byte-identical to the frontend's `environment === null
/// → non-production / allow` rule. The production reversal (`off` still
/// confirms on a production-tagged connection) is preserved.
pub fn decide(mode: SafeMode, environment: Option<&str>, is_danger: bool) -> GateOutcome {
    if !is_danger {
        return GateOutcome::Allow;
    }

    let is_production = environment == Some("production");
    if is_production {
        // strict / warn / off all confirm on production. `off` cannot bypass
        // a production-tagged connection (Sprint 190 hard-auto policy, kept
        // by ADR 0022 Phase 1).
        return GateOutcome::ConfirmRequired(
            "destructive statement on a production connection requires confirmation".into(),
        );
    }

    match mode {
        // Non-production strict opts every environment into the dialog
        // (shared-staging / learning environments — ADR 0022 M.1).
        SafeMode::Strict => GateOutcome::ConfirmRequired(
            "destructive statement blocked by Safe Mode (strict) in non-production".into(),
        ),
        // Non-production warn / off leave dev workflows unguarded.
        SafeMode::Warn | SafeMode::Off => GateOutcome::Allow,
    }
}

/// Gate a single raw SQL string (`execute_query`).
pub async fn enforce_rdb_sql(
    pool: &SqlitePool,
    connection_id: &str,
    sql: &str,
    safety_confirmed: bool,
) -> Result<(), AppError> {
    enforce(
        pool,
        connection_id,
        sql_parser_core::safety::is_danger(sql),
        safety_confirmed,
    )
    .await
}

/// Gate a batch of raw SQL statements (`execute_query_batch`). Worst tier
/// wins — a single destructive statement anywhere in the batch requires
/// confirmation for the whole batch (the batch commits atomically).
pub async fn enforce_rdb_batch(
    pool: &SqlitePool,
    connection_id: &str,
    statements: &[String],
    safety_confirmed: bool,
) -> Result<(), AppError> {
    let any_danger = statements
        .iter()
        .any(|sql| sql_parser_core::safety::is_danger(sql));
    enforce(pool, connection_id, any_danger, safety_confirmed).await
}

/// Gate an operation already known to be destructive — either a structured
/// DDL command classified by command identity (`drop_table`, `drop_column`,
/// `alter_table … DROP`, …) or a raw statement the caller already ran
/// through `sql_parser_core::safety::is_danger`. No (re-)classification.
pub async fn enforce_rdb_danger(
    pool: &SqlitePool,
    connection_id: &str,
    safety_confirmed: bool,
) -> Result<(), AppError> {
    enforce(pool, connection_id, true, safety_confirmed).await
}

/// Gate a Search (Elasticsearch / OpenSearch) live `_delete_by_query`
/// execution (#1076). Delete-by-query is unconditionally destructive, so this
/// forces the danger tier through the SAME [`decide`] matrix the RDB paths
/// use: a direct IPC `invoke` cannot run a live delete unconfirmed in a
/// confirm-required context (strict non-production, or any production-tagged
/// connection). Sibling of [`enforce_rdb_danger`] — identical policy, named
/// per paradigm so call sites read honestly.
pub async fn enforce_search_danger(
    pool: &SqlitePool,
    connection_id: &str,
    safety_confirmed: bool,
) -> Result<(), AppError> {
    enforce(pool, connection_id, true, safety_confirmed).await
}

/// Shared core — reads the persisted Safe Mode + connection environment and
/// applies [`decide`]. Reads are skipped entirely for non-danger inputs so
/// the common (read / additive) path adds no SQLite round-trip.
async fn enforce(
    pool: &SqlitePool,
    connection_id: &str,
    is_danger: bool,
    safety_confirmed: bool,
) -> Result<(), AppError> {
    if !is_danger {
        return Ok(());
    }

    let mode = read_safe_mode(pool).await;
    let environment = read_connection_environment(pool, connection_id).await;

    match decide(mode, environment.as_deref(), true) {
        GateOutcome::Allow => Ok(()),
        GateOutcome::ConfirmRequired(_) if safety_confirmed => Ok(()),
        GateOutcome::ConfirmRequired(reason) => {
            Err(AppError::Validation(format!("Safe Mode: {reason}")))
        }
    }
}

/// Read the persisted Safe Mode. Tolerant of BOTH the boot-snapshot object
/// shape (`{"mode":"strict"}`) and the frontend `persistSettingValue` bare
/// string shape (`"strict"` — issue #1190). Honoring the bare string is
/// load-bearing for the gate: the non-production **strict** confirm requires
/// reading the real user setting, and `persistSettingValue` stores it as a
/// bare string. Unreadable / unrecognised values fall back to the #1113
/// default (`warn`).
async fn read_safe_mode(pool: &SqlitePool) -> SafeMode {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value_json FROM settings WHERE key = 'safe_mode'")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    match row {
        Some((json,)) => parse_safe_mode(&json),
        None => SafeMode::default(),
    }
}

fn parse_safe_mode(json: &str) -> SafeMode {
    // Object shape first (boot snapshot / dual-write).
    if let Ok(store) = serde_json::from_str::<SafeModeStore>(json) {
        return store.mode;
    }
    // Bare string shape (frontend `persistSettingValue`, #1190). `SafeMode`
    // deserialize never errors (`#[serde(other)]` → warn fallback), so this
    // also absorbs legacy / unrecognised values.
    serde_json::from_str::<SafeMode>(json).unwrap_or_default()
}

/// Read the target connection's `environment` tag from the backend store.
/// `NULL` / empty / missing row → `None` (treated as non-production, per the
/// frontend `environment === null` rule).
async fn read_connection_environment(pool: &SqlitePool, connection_id: &str) -> Option<String> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT environment FROM connections WHERE id = ?")
            .bind(connection_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    row.and_then(|(env,)| env)
        .filter(|env| !env.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::local;
    use serial_test::serial;
    use tempfile::TempDir;

    fn is_confirm(outcome: GateOutcome) -> bool {
        matches!(outcome, GateOutcome::ConfirmRequired(_))
    }

    // ---- decision matrix (mode × environment × severity) ------------------

    #[test]
    fn non_danger_always_allows() {
        for mode in [SafeMode::Strict, SafeMode::Warn, SafeMode::Off] {
            for env in [None, Some("production"), Some("staging")] {
                assert!(
                    matches!(decide(mode, env, false), GateOutcome::Allow),
                    "non-danger must allow: mode={mode:?} env={env:?}"
                );
            }
        }
    }

    #[test]
    fn production_confirms_danger_in_every_mode() {
        // The production reversal: even `off` confirms on production.
        for mode in [SafeMode::Strict, SafeMode::Warn, SafeMode::Off] {
            assert!(
                is_confirm(decide(mode, Some("production"), true)),
                "production danger must confirm: mode={mode:?}"
            );
        }
    }

    #[test]
    fn non_production_gates_only_strict() {
        for env in [None, Some("staging"), Some("development"), Some("")] {
            assert!(
                is_confirm(decide(SafeMode::Strict, env, true)),
                "non-prod strict danger must confirm: env={env:?}"
            );
            assert!(
                matches!(decide(SafeMode::Warn, env, true), GateOutcome::Allow),
                "non-prod warn danger must allow: env={env:?}"
            );
            assert!(
                matches!(decide(SafeMode::Off, env, true), GateOutcome::Allow),
                "non-prod off danger must allow: env={env:?}"
            );
        }
    }

    // Issue #1351 — the dialect-aware danger for Oracle PL/SQL / admin DDL
    // (classified by `sql_parser_core::oracle`) must drive the SAME gate the
    // generic danger set does: strict + production → ConfirmRequired. This
    // binds the classifier verdict to the gate outcome the `execute_query`
    // path (`rdb_sql_is_danger` → `enforce_rdb_danger` → `decide`) produces,
    // so a direct IPC call cannot run these unconfirmed.
    #[test]
    fn oracle_plsql_and_admin_ddl_confirm_in_strict_production() {
        use sql_parser_core::oracle::is_oracle_danger;
        for sql in [
            // The exact #1351 repro — the shared classifier calls this Info.
            "BEGIN EXECUTE IMMEDIATE 'DROP TABLE payroll'; END;",
            "DECLARE v NUMBER; BEGIN NULL; END;",
            "EXEC payroll_pkg.wipe()",
            "ALTER SYSTEM SET processes = 300",
            "DROP USER hr CASCADE",
            "AUDIT SELECT ON app.orders",
            "CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;",
        ] {
            assert!(is_oracle_danger(sql), "{sql} must classify Oracle-danger");
            assert!(
                is_confirm(decide(
                    SafeMode::Strict,
                    Some("production"),
                    is_oracle_danger(sql)
                )),
                "{sql} must gate in strict+production"
            );
            // Production reversal: even `off` cannot bypass these.
            assert!(
                is_confirm(decide(
                    SafeMode::Off,
                    Some("production"),
                    is_oracle_danger(sql)
                )),
                "{sql} must gate on production even with Safe Mode off"
            );
        }
        // A supported Oracle read stays Allow — no over-gating.
        assert!(!is_oracle_danger("SELECT * FROM dual"));
        assert!(matches!(
            decide(
                SafeMode::Strict,
                Some("production"),
                is_oracle_danger("SELECT * FROM dual"),
            ),
            GateOutcome::Allow
        ));
    }

    #[test]
    fn untagged_environment_is_non_production() {
        // `None` behaves like the frontend `environment === null` → non-prod.
        assert!(matches!(
            decide(SafeMode::Warn, None, true),
            GateOutcome::Allow
        ));
        assert!(is_confirm(decide(SafeMode::Strict, None, true)));
    }

    // ---- safe_mode parsing (object + bare string, #1190) ------------------

    #[test]
    fn parse_safe_mode_accepts_object_and_bare_string() {
        assert_eq!(parse_safe_mode(r#"{"mode":"off"}"#), SafeMode::Off);
        assert_eq!(parse_safe_mode(r#"{"mode":"strict"}"#), SafeMode::Strict);
        // Bare string (frontend persistSettingValue shape).
        assert_eq!(parse_safe_mode(r#""off""#), SafeMode::Off);
        assert_eq!(parse_safe_mode(r#""strict""#), SafeMode::Strict);
        // Legacy / unrecognised → warn (#1113 default).
        assert_eq!(parse_safe_mode(r#""on""#), SafeMode::Warn);
        assert_eq!(parse_safe_mode("garbage"), SafeMode::Warn);
    }

    // ---- storage readers + end-to-end enforce -----------------------------

    async fn pool_setup() -> (TempDir, SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        (dir, pool)
    }

    fn pool_cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    async fn seed_connection(pool: &SqlitePool, id: &str, environment: Option<&str>) {
        sqlx::query(
            "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, database, \
             sort_order, created_at, updated_at, environment) \
             VALUES (?, ?, 'postgresql', 'localhost', 5432, 'u', '', 'db', 0, 1, 1, ?)",
        )
        .bind(id)
        .bind(id)
        .bind(environment)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn set_safe_mode(pool: &SqlitePool, value_json: &str) {
        sqlx::query(
            "INSERT INTO settings(key, value_json, updated_at) VALUES ('safe_mode', ?, 1) \
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        )
        .bind(value_json)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    #[serial]
    async fn destructive_unconfirmed_on_production_is_rejected() {
        let (_dir, pool) = pool_setup().await;
        seed_connection(&pool, "c-prod", Some("production")).await;
        // Default safe_mode (no row) = warn; production forces confirm.
        let err = enforce_rdb_sql(&pool, "c-prod", "DROP TABLE users", false)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn destructive_confirmed_on_production_passes() {
        let (_dir, pool) = pool_setup().await;
        seed_connection(&pool, "c-prod", Some("production")).await;
        enforce_rdb_sql(&pool, "c-prod", "DROP TABLE users", true)
            .await
            .expect("confirmed destructive must pass");
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn non_destructive_never_reads_settings_and_passes() {
        let (_dir, pool) = pool_setup().await;
        // No connection row seeded — a non-danger statement must not even
        // require the environment lookup.
        enforce_rdb_sql(&pool, "missing-conn", "SELECT * FROM users", false)
            .await
            .expect("select must pass");
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn destructive_unconfirmed_non_prod_off_passes() {
        let (_dir, pool) = pool_setup().await;
        seed_connection(&pool, "c-dev", Some("development")).await;
        set_safe_mode(&pool, r#""off""#).await; // bare string shape
        enforce_rdb_sql(&pool, "c-dev", "DROP TABLE users", false)
            .await
            .expect("non-prod off destructive must pass unconfirmed");
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn destructive_unconfirmed_non_prod_strict_is_rejected() {
        let (_dir, pool) = pool_setup().await;
        seed_connection(&pool, "c-dev", Some("development")).await;
        set_safe_mode(&pool, r#""strict""#).await; // bare string, honored via #1190 tolerance
        let err = enforce_rdb_sql(&pool, "c-dev", "TRUNCATE TABLE users", false)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn batch_with_trailing_drop_requires_confirmation_on_prod() {
        let (_dir, pool) = pool_setup().await;
        seed_connection(&pool, "c-prod", Some("production")).await;
        let statements = vec!["SELECT 1".to_string(), "DROP TABLE users".to_string()];
        let err = enforce_rdb_batch(&pool, "c-prod", &statements, false)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        // Same batch confirmed → passes.
        enforce_rdb_batch(&pool, "c-prod", &statements, true)
            .await
            .expect("confirmed batch must pass");
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn ddl_destructive_identity_gate_on_prod() {
        let (_dir, pool) = pool_setup().await;
        seed_connection(&pool, "c-prod", Some("production")).await;
        let err = enforce_rdb_danger(&pool, "c-prod", false)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        enforce_rdb_danger(&pool, "c-prod", true)
            .await
            .expect("confirmed DDL must pass");
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn search_delete_by_query_danger_gate_on_prod() {
        // #1076 — the Search live `_delete_by_query` chokepoint reuses the same
        // matrix: an unconfirmed live delete on a production connection is
        // rejected, and the confirmed one passes. This is the backend proof
        // that a direct IPC `invoke` cannot bypass the frontend confirm.
        let (_dir, pool) = pool_setup().await;
        seed_connection(&pool, "c-prod", Some("production")).await;
        let err = enforce_search_danger(&pool, "c-prod", false)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        enforce_search_danger(&pool, "c-prod", true)
            .await
            .expect("confirmed search delete-by-query must pass");
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn search_delete_by_query_non_prod_strict_rejects_unconfirmed() {
        let (_dir, pool) = pool_setup().await;
        seed_connection(&pool, "c-dev", Some("development")).await;
        set_safe_mode(&pool, r#""strict""#).await;
        let err = enforce_search_danger(&pool, "c-dev", false)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn untagged_connection_treated_as_non_production() {
        let (_dir, pool) = pool_setup().await;
        seed_connection(&pool, "c-untagged", None).await;
        // Default warn + non-prod → destructive allowed unconfirmed.
        enforce_rdb_sql(&pool, "c-untagged", "DROP TABLE users", false)
            .await
            .expect("untagged (non-prod) warn destructive must pass");
        pool_cleanup();
    }
}
