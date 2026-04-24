//! Commands scoped to the relational-database (RDB) paradigm.
//!
//! Sprint 64 split the former flat `commands/{schema,query}.rs` into three
//! submodules under `commands/rdb/`:
//!   - `schema` — read-only catalog introspection (list_schemas, list_tables,
//!     get_table_columns, list_schema_columns, get_table_indexes,
//!     get_table_constraints, list_views, list_functions, get_view_definition,
//!     get_view_columns, get_function_source).
//!   - `query`  — query execution/cancellation and tabular paging
//!     (`execute_query`, `cancel_query`, `query_table_data`).
//!   - `ddl`    — schema-changing operations (drop_table, rename_table,
//!     alter_table, create_index, drop_index, add_constraint, drop_constraint).
//!
//! All command function names are preserved unchanged so that frontend
//! `invoke("…")` call sites remain valid after the reorganization.

pub mod ddl;
pub mod query;
pub mod schema;
