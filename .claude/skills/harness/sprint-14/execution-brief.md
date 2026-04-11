# Sprint Execution Brief: Sprint 14

## Objective

Add Rust backend tests for storage/mod.rs and commands/connection.rs.

## Task Why

Storage/mod.rs handles all persistence (CRUD for connections/groups, password encryption) and commands/connection.rs contains business logic (validation, UUID generation). Both have 0% test coverage and are critical for data integrity.

## Scope Boundary

- Only add `#[cfg(test)] mod tests {}` blocks to existing files
- Do NOT modify production code behavior
- Do NOT change existing tests
- Do NOT add new dependencies

## Invariants

- All 68 existing Rust tests pass
- All 376 frontend tests pass
- cargo fmt + clippy clean

## Done Criteria

1. storage/mod.rs has tests for: load, save, update, delete, duplicate name, password roundtrip, group CRUD, move_connection_to_group
2. commands/connection.rs has tests for: validation, UUID generation, list/save/delete operations
3. All tests pass, clippy clean, fmt clean

## Verification Plan

- Profile: `command`
- Required checks:
  1. `cd src-tauri && cargo test` — exit 0
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — no warnings
  3. `cd src-tauri && cargo fmt --check` — formatted
  4. `pnpm vitest run` — frontend still passes

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- Assumptions made during implementation
- Residual risk or verification gaps

## References

- Contract: `.claude/skills/harness/sprint-14/contract.md`
- Relevant files:
  - `src-tauri/src/storage/mod.rs` — storage CRUD (0% test coverage)
  - `src-tauri/src/storage/crypto.rs` — encryption (has 9 tests, reference for patterns)
  - `src-tauri/src/commands/connection.rs` — connection commands (0% test coverage)
  - `src-tauri/src/commands/query.rs` — has 6 tests (reference for patterns)
  - `src-tauri/src/error.rs` — AppError types (reference)
  - `src-tauri/src/models/connection.rs` — ConnectionConfig, ConnectionGroup (reference)
  - `src-tauri/tests/storage_integration.rs` — existing integration tests (reference for test patterns)
  - `src-tauri/Cargo.toml` — dependencies (tempfile, serial_test already available)

## Key Implementation Notes

### Storage Test Pattern
Storage uses `VIEWTABLE_TEST_DATA_DIR` env var to override data directory. Use `tempfile::tempdir()`:
```rust
use std::env;
use tempfile::TempDir;

fn setup_test_env() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    env::set_var("VIEWTABLE_TEST_DATA_DIR", dir.path());
    dir
}

// Call env::remove_var("VIEWTABLE_TEST_DATA_DIR") in cleanup
```

NOTE: The global `STORAGE_LOCK` mutex means tests must be serialized. Use `#[serial]` from `serial_test` crate.

### Commands Test Pattern
The `#[tauri::command]` functions can be tested by calling them directly (they're regular functions). For sync commands:
```rust
#[test]
fn test_save_connection_empty_name() {
    let conn = ConnectionConfig { name: "  ".into(), ... };
    let result = commands::save_connection(conn, Some(true));
    assert!(matches!(result, Err(AppError::Validation(_))));
}
```

For commands that use `tauri::State`, they need `AppState` injected. However, the sync commands (list_connections, save_connection, delete_connection, list_groups, save_group, delete_group, move_connection_to_group) only depend on storage, not AppState. They can be tested directly.

### Dependencies Available
- `tempfile` 3.0 — already in dev-dependencies
- `serial_test` 3.0 — already in dev-dependencies
