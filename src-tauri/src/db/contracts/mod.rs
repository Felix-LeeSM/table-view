//! Backend adapter contract surface.
//!
//! `db::contracts` is the canonical module for trait and DTO contracts shared
//! across adapter paradigms. Legacy `db::traits` and `db::types` modules stay
//! public so existing call sites keep compiling while imports migrate.

pub use super::kv_trait::KvAdapter;
pub use super::traits::{DbAdapter, DocumentAdapter, RdbAdapter, SearchAdapter};
pub use super::types::*;
