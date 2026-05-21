# Sprint 428 Handoff: Rust Vocabulary SOT

## Completed

- SQL built-in keyword/function/shell command vocabulary moved into
  `src-tauri/sql-parser-core/src/completion/vocabulary.rs`.
- Mongo MQL/mongosh/admin completion label vocabulary moved into
  `src-tauri/mongosh-parser-core/src/completion.rs`.
- Mongo WASM vocabulary export uses a packed string; TypeScript unpacks it in
  `src/lib/mongo/mongoshAst/index.ts` and keeps fallback mirrors for cold-load.
- Mongo operator metadata and shell completion metadata are TS adapters, not
  canonical vocabulary owners.
- Mongo WASM budget updated to 53 KiB gzip and documented.

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml completion::completion_tests`
- `cargo test --manifest-path src-tauri/mongosh-parser-core/Cargo.toml`
- `pnpm exec tsc -b --pretty false`
- `pnpm lint`
- `pnpm test`
- `pnpm wasm:size`

## Follow-Up

- Sprint 429 should add official-reference drift tests for MySQL/MariaDB
  built-ins, psql/mysql/sqlite shell commands, and Mongo operator/stage groups.
- Sprint 430 should tighten support docs around version/capability gating and
  parser semantic gaps.
