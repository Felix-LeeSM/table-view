//! Headless core of table-view.
//!
//! Holds the DB adapter (`db`), the wire model (`models`), local storage
//! (`storage`), and the error type (`error`) those three share. **Not depending
//! on Tauri is this crate's contract** — `cargo tree -p table-view-core -i tauri`
//! must exit 101 (`did not match any packages`), and ADR 0061's `tvw` CLI links
//! only this crate, with no webview.
//!
//! The app side (`table_view_lib`) re-exports them unchanged via
//! `pub use table_view_core::{db, error, models}`, so existing `crate::db::…`
//! paths stay valid. Only `storage` has a shim on the app side: the boot glue
//! `storage::history_audit` / `storage::history_retention_boot` reaches back into
//! `crate::commands::`, so it cannot move down into core.

#![deny(unsafe_code)]
// #1368 — block new `.unwrap()` in production paths. `-D warnings` (CI clippy
// gate) turns this into a hard error; `allow-unwrap-in-tests = true`
// (table-view-core/clippy.toml) keeps test-code unwraps legal.
#![warn(clippy::unwrap_used)]

pub mod db;
pub mod error;
pub mod models;
pub mod storage;
