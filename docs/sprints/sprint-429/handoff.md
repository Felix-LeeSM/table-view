# Sprint 429 Handoff: Completion Reference Drift Tests

## Completed

- Added SQL Rust official-reference smoke tests for PostgreSQL/psql,
  MySQL/MariaDB/mysql-client, and SQLite/sqlite-cli built-in vocabulary.
- Added Mongo vocabulary drift tests that compare the Rust/WASM snapshot against
  the TypeScript fallback mirror.
- Added Mongo sentinel coverage for query/projection/update operators,
  aggregation stages, accumulators, expressions, BSON tags, mongosh collection
  methods, db-level methods, and admin commands.
- Kept scope to coverage hardening only; runtime completion behavior is
  unchanged.

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml completion::completion_tests`
- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml`
- `pnpm vitest run src/lib/mongo/mongoCompletionVocabulary.test.ts`
- `pnpm vitest run src/lib/mongo/mongoCompletionVocabulary.test.ts src/lib/mongo/mongoAutocomplete.test.ts`
- `pnpm exec tsc -b --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm wasm:size`

## Follow-Up

- Sprint 430 should finalize the support matrix language around "100%" coverage,
  version/capability gates, and parser semantic gaps.
