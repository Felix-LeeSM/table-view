# Sprint Contract: Sprint 14

## Summary

- Goal: Add Rust backend tests for storage/mod.rs and commands/connection.rs (0% → 60%+)
- Audience: Generator / Evaluator
- Owner: Orchestrator
- Verification Profile: `command`

## In Scope

1. **storage/mod.rs tests** — CRUD operations, password encryption/decryption roundtrip, duplicate name rejection, delete not-found error, group operations, move_connection_to_group, default storage creation
2. **commands/connection.rs tests** — AppState initialization, list_connections, save_connection validation (empty name/host), save_connection with is_new (UUID generation), delete_connection, list_groups, save_group validation, delete_group, move_connection_to_group

## Out of Scope

- commands/schema.rs (thin wrappers, needs live DB for meaningful tests)
- db/postgres.rs integration tests (needs live DB)
- keep_alive_loop async testing (complex Tauri AppHandle mocking)
- Frontend tests
- Coverage threshold changes

## Invariants

- All 68 existing Rust tests continue to pass
- All 376 frontend tests continue to pass
- `cargo fmt --check` passes
- `cargo clippy` passes with no warnings
- No changes to production code behavior

## Acceptance Criteria

- `AC-01`: storage::load_storage creates default empty storage when file doesn't exist
- `AC-02`: storage::save_connection adds new connection and can load it back
- `AC-03`: storage::save_connection updates existing connection by id
- `AC-04`: storage::save_connection rejects duplicate name (different id, same name)
- `AC-05`: storage::delete_connection removes connection by id
- `AC-06`: storage::delete_connection returns NotFound for non-existent id
- `AC-07`: storage password encryption/decryption roundtrip (save with password, load retrieves plaintext)
- `AC-08`: storage::save_group adds and updates groups
- `AC-09`: storage::delete_group moves orphaned connections to root
- `AC-10`: storage::move_connection_to_group changes group_id
- `AC-11`: commands::save_connection validates empty name and empty host
- `AC-12`: commands::save_connection with is_new=true generates UUID
- `AC-13`: commands::list_groups returns groups from storage
- `AC-14`: commands::save_group validates empty name
- `AC-15`: All tests pass: `cargo test`, `cargo clippy`, `cargo fmt --check`

## Design Bar / Quality Bar

- Tests use `tempfile::tempdir()` for isolation (existing pattern in storage_integration.rs)
- Use `TABLE_VIEW_TEST_DATA_DIR` env var for test data directory
- No `unwrap()` in test code is acceptable (tests can use unwrap)
- Test functions named `test_<behavior>_<condition>_<expected>`
- `serial_test` for tests that share the global STORAGE_LOCK

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo test` — all tests pass
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — no warnings
3. `cd src-tauri && cargo fmt --check` — formatted
4. `pnpm vitest run` — frontend tests still pass

### Required Evidence

- Generator must provide changed files with purpose
- Command outputs showing clean runs

## Test Requirements

### Unit Tests (필수)
- 각 AC 항목에 대응하는 최소 1개 테스트 작성
- 에러/예외 케이스 최소 1개 테스트 작성

### Coverage Target
- storage/mod.rs: 70%+ 라인 커버리지
- commands/connection.rs: 60%+ 라인 커버리지 (async Tauri commands)

## Test Script / Repro Script

1. `cd src-tauri && cargo test` — all tests pass
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — no warnings
3. `cd src-tauri && cargo fmt --check` — formatted
4. `pnpm vitest run` — frontend tests pass

## Ownership

- Generator: Sprint 14 Generator Agent
- Write scope: `src-tauri/src/storage/mod.rs` (add test module), `src-tauri/src/commands/connection.rs` (add test module)
- Merge order: direct to main

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in handoff.md
