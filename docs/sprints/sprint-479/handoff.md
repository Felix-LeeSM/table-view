# Sprint 479 Handoff: Language Ownership Matrix

## Completed

- Added `QUERY_LANGUAGE_REGISTRY` keyed by `QueryLanguageId`.
- Recorded parser owner, completion owner, fallback policy, safety analyzer, and
  support-doc path for SQL, mongosh/MQL, Redis commands, Search DSL, and
  deferred future languages.
- Kept SQL and mongosh parser/completion ownership on
  `rust-wasm-language-core` per ADR 0045.
- Labeled TypeScript fallback mirrors as `compatibility-mirror`, not source of
  truth.
- Added focused tests that fail when active profile languages lack owner
  metadata or support docs drift.

## Verification

- `pnpm exec vitest run src/types/dataSource.test.ts src/types/queryLanguage.docs.test.ts`
- `pnpm exec tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

## Follow-Up

- Sprint 481 should consume the registry when broad active profile parity is
  checked.
- Redis/Search execution work should replace `future-language-core-contract`
  owner records with the implemented parser/completion owner before enabling
  query execution.
