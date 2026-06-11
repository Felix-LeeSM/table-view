//! Legacy SQLite adapter module path.
//!
//! The implementation lives at `db::adapters::sqlite`. Keep this shim until
//! downstream call sites have migrated to the canonical adapter topology.

pub use super::adapters::sqlite::*;
