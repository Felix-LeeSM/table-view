//! App-side `storage` shim (#1769).
//!
//! The storage implementation moved down to `table_view_core::storage`. The two
//! modules left here are boot glue, so they reach back into `crate::commands::` —
//! pushing them down to core would mean inverting that direction with trait
//! injection, which was judged not worth it, so they stay in the app.
//!
//! The glob re-export keeps existing paths such as `crate::storage::local::…`
//! alive, along with the integration tests that use
//! `table_view_lib::storage::history_audit::…`.

pub use table_view_core::storage::*;

pub mod history_audit;
pub mod history_retention_boot;
