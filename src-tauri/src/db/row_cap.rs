//! Issue #1231 — raw query result row cap.
//!
//! A JOIN with no LIMIT can materialise millions of rows into the Rust
//! `Vec<Vec<Value>>` (then the IPC payload, then the zustand store) — the
//! user-reported "memory explosion". This module holds the process-global
//! ceiling every RDB/Document adapter applies at **fetch time** (streaming
//! break, not a post-hoc `Vec` truncate) so the buffer never grows past the
//! cap in the first place.
//!
//! Wiring: the `execute_query` command reads the persisted `query_row_cap`
//! setting from SQLite once per query and stores it here via [`set`]; each
//! adapter reads [`current`] at the start of its SELECT fetch loop.

use std::sync::atomic::{AtomicUsize, Ordering};

/// Default ceiling for a fresh install (TablePlus-class convention).
pub const DEFAULT_ROW_CAP: usize = 10_000;
/// Lower bound the settings UI enforces — below this the grid is useless.
pub const MIN_ROW_CAP: usize = 100;
/// Upper bound the settings UI enforces.
pub const MAX_ROW_CAP: usize = 1_000_000;

// ponytail: process-global with a benign race — the `execute_query` command
// stores the freshly-read persisted value right before dispatch, and each
// adapter reads it once at fetch start. All windows/queries share this one
// cell, so a cap change (or a concurrent query that just published a
// different value) can affect an in-flight query's fetch loop, not only the
// next one. That is bounded and harmless for a display ceiling: every writer
// stores a value validated into [MIN, MAX], and a query reads a cap at least
// as fresh as its own dispatch. Per-query threading would churn the whole
// `execute_sql` trait surface for no correctness gain here.
static ROW_CAP: AtomicUsize = AtomicUsize::new(DEFAULT_ROW_CAP);

/// The cap the next fetch loop should apply.
pub fn current() -> usize {
    ROW_CAP.load(Ordering::Relaxed)
}

/// Set the active cap. Stores the value verbatim — clamping to the valid
/// range is a settings-read concern ([`parse_setting`]); tests set small
/// caps directly.
pub fn set(cap: usize) {
    ROW_CAP.store(cap, Ordering::Relaxed);
}

/// Parse a persisted `query_row_cap` setting value into a clamped cap.
///
/// Accepts the frontend `persistSettingValue` shape (a bare JSON number,
/// e.g. `50000`). Non-numeric / out-of-range / unparseable values fall back
/// to [`DEFAULT_ROW_CAP`]; in-range values are clamped to
/// `[MIN_ROW_CAP, MAX_ROW_CAP]`.
pub fn parse_setting(value_json: &str) -> usize {
    serde_json::from_str::<f64>(value_json)
        .ok()
        .filter(|n| n.is_finite() && *n >= 0.0)
        .map(|n| (n as usize).clamp(MIN_ROW_CAP, MAX_ROW_CAP))
        .unwrap_or(DEFAULT_ROW_CAP)
}

/// Read the persisted cap from the settings store. Missing row / read error
/// falls back to [`DEFAULT_ROW_CAP`]; a stored value is clamped via
/// [`parse_setting`].
pub async fn read_from_settings(pool: &sqlx::SqlitePool) -> usize {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value_json FROM settings WHERE key = 'query_row_cap'")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    row.map(|(v,)| parse_setting(&v)).unwrap_or(DEFAULT_ROW_CAP)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_setting_clamps_and_defaults() {
        assert_eq!(parse_setting("50000"), 50_000);
        // below MIN → clamp up
        assert_eq!(parse_setting("5"), MIN_ROW_CAP);
        // above MAX → clamp down
        assert_eq!(parse_setting("99999999"), MAX_ROW_CAP);
        // unparseable / wrong shape → default
        assert_eq!(parse_setting("\"garbage\""), DEFAULT_ROW_CAP);
        assert_eq!(parse_setting("not json"), DEFAULT_ROW_CAP);
        assert_eq!(parse_setting("-1"), DEFAULT_ROW_CAP);
    }

    #[test]
    fn set_stores_verbatim_for_tests() {
        set(7);
        assert_eq!(current(), 7);
        set(DEFAULT_ROW_CAP);
        assert_eq!(current(), DEFAULT_ROW_CAP);
    }
}
