# Sprint Contract: sprint-405

## Summary

- Goal: stabilize native cancel IPC by replacing JSON-in-string cancel errors
  with a typed `AppError::Cancel` envelope, and move `query_table_data`
  cancel-token handling into the concrete Postgres/MySQL inherent methods.
- Audience: `cancel_query_native` frontend wrapper and RDB table data readers.
- Owner: Generator (sprint-405).
- Verification Profile: mixed (`pnpm` unit/type/build/lint + Rust unit,
  integration, clippy/pre-push gates).

## In Scope

- `src-tauri/src/error.rs`: shared `CancelError` enum and `AppError::Cancel`
  variant.
- `src-tauri/src/commands/cancel_query.rs`: return `AppError::Cancel` from
  `cancel_query_native`.
- `src/lib/tauri/cancel.ts`: parse only typed cancel envelopes:
  `{ "type": "Cancel", "payload": { "type": "AlreadyCompleted" | "PermissionDenied" | "NetworkError", ... } }`.
- `src-tauri/src/db/{postgres,mysql}/queries.rs`: accept
  `Option<&CancellationToken>` on inherent `query_table_data`.
- Existing direct concrete `query_table_data` callers: pass `None` unless they
  own a cancellation token.
- Tests for typed cancel serialization, TS parsing, database-string regression,
  pre-cancel short-circuit, and in-flight query-table-data cancellation.

## Out of Scope

- Changing the user-facing cancel classes from sprint-359.
- Changing non-cancel `AppError` serialization; those variants remain strings.
- New UI behavior for cancel toast handling.

## Invariants

- `AlreadyCompleted` remains the only silent cancel class.
- `PermissionDenied` and `NetworkError` keep message payloads.
- Non-cancel database errors that happen to contain JSON must not be parsed as
  cancel classes.
- `query_table_data(..., Some(token))` must return
  `AppError::Database("Operation cancelled")` when the token fires.

## Acceptance Criteria

- `AC-405-01`: `AppError::Cancel` serializes as top-level
  `{ "type": "Cancel", "payload": <CancelError> }`.
- `AC-405-02`: TS `parseCancelError` checks `type === "Cancel"` without
  prefix stripping.
- `AC-405-03`: concrete `query_table_data(..., Some(token))` exits within
  5 seconds when cancellation fires before or during DB work.
- `AC-405-04`: existing PG/MySQL native cancel e2e tests pass.
- `AC-405-05`: `AppError::Database("{...}")` style strings cannot be mistaken
  for cancel errors.

## Verification Plan

- `pnpm test src/lib/tauri/cancel.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --tests`
- `cargo test --manifest-path src-tauri/Cargo.toml --test cancel_error_classes`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml --test query_integration test_query_table_data_cancel_token_interrupts_in_flight_raw_where`
- `cargo test --manifest-path src-tauri/Cargo.toml --test mysql_integration test_mysql_query_table_data_cancel_token_interrupts_in_flight_raw_where`
- `cargo test --manifest-path src-tauri/Cargo.toml --test cancel_pg --test cancel_mysql`
