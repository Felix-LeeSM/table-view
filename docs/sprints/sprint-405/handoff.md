# Sprint Handoff: sprint-405

## Delivered

- Native cancel IPC now returns a typed `AppError::Cancel` envelope instead of
  JSON embedded in an `AppError::Database` string.
- Frontend cancel parsing accepts only that typed envelope and treats ordinary
  database strings as `NetworkError` fallbacks.
- Postgres/MySQL concrete `query_table_data` methods now own cancellation,
  including direct inherent callsites.

## Evidence

- `pnpm test src/lib/tauri/cancel.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `cargo check --manifest-path src-tauri/Cargo.toml --tests`
- `cargo test --manifest-path src-tauri/Cargo.toml --test cancel_error_classes`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml --test query_integration test_query_table_data_cancel_token_interrupts_in_flight_raw_where`
- `cargo test --manifest-path src-tauri/Cargo.toml --test mysql_integration test_mysql_query_table_data_cancel_token_interrupts_in_flight_raw_where`
- `cargo test --manifest-path src-tauri/Cargo.toml --test cancel_pg --test cancel_mysql`

## Follow-Up

- None for sprint-405. sprint-406 remains the next backlog item:
  `@lib/tauri` test mock unification.
