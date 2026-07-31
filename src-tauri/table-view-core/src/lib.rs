//! table-view 의 headless core.
//!
//! DB adapter (`db`), wire model (`models`), 로컬 저장소 (`storage`), 그리고
//! 그 셋이 공유하는 에러 타입 (`error`) 을 담는다. **Tauri 에 의존하지 않는
//! 것이 이 crate 의 계약이다** — `cargo tree -i tauri` 가 빈 결과여야 하고,
//! ADR 0061 의 `tvw` CLI 가 webview 없이 이 crate 만 링크한다.
//!
//! 앱 쪽 (`table_view_lib`) 은 `pub use table_view_core::{db, error, models}`
//! 로 그대로 re-export 하므로 기존 `crate::db::…` 경로는 유지된다. `storage`
//! 만 앱 쪽에 shim 이 있다: boot 글루인 `storage::history_audit` /
//! `storage::history_retention_boot` 가 `crate::commands::` 를 역참조해서
//! core 로 못 내려온다.

#![deny(unsafe_code)]
// #1368 — block new `.unwrap()` in production paths. `-D warnings` (CI clippy
// gate) turns this into a hard error; `allow-unwrap-in-tests = true`
// (table-view-core/clippy.toml) keeps test-code unwraps legal.
#![warn(clippy::unwrap_used)]

pub mod db;
pub mod error;
pub mod models;
pub mod storage;
