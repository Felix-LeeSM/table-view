# Sprint 428 Contract: Rust Vocabulary SOT

## Goal

Move built-in completion vocabulary ownership to Rust/WASM for the current SQL
and Mongo completion surfaces. TypeScript may keep fallback mirrors and
CodeMirror metadata, but Rust is the canonical source for keyword/function,
shell command, MQL operator/stage/expression, BSON tag, and whitelisted mongosh
method/admin command labels.

## Scope

- SQL completion core owns dialect-specific keyword/function/shell vocabulary
  for PostgreSQL, MySQL/MariaDB, and SQLite.
- Mongo completion vocabulary is exported from `mongosh-parser-core` and
  unpacked by the TypeScript facade.
- TypeScript fallback constants remain for WASM cold-load and legacy imports.
- Support docs define "100% completion coverage" as current UI vocabulary
  groups, not server semantic validation for every dialect feature.

## WASM Budget

Validation command: `pnpm wasm:size`.

| Artifact | Budget | Sprint 428 measured |
|---|---:|---:|
| SQL parser WASM | 80 KiB gzip / 81,920 bytes | 77,538 bytes |
| Mongo parser WASM | 53 KiB gzip / 54,272 bytes | 52,169 bytes |

The Mongo budget moved from 50 KiB to 53 KiB because Rust now owns the official
completion vocabulary snapshot. The export is packed as a single string to
avoid struct/array serialization overhead.

## Acceptance Criteria

- AC-428-01: SQL completion returns PostgreSQL/MySQL/MariaDB/SQLite built-ins
  from Rust even when request vocabulary arrays are empty.
- AC-428-02: Mongo completion vocabulary loads from Rust/WASM and TS computes
  the CodeMirror candidate arrays from that snapshot.
- AC-428-03: Mongo collection/db/admin command labels are included in the Rust
  vocabulary snapshot.
- AC-428-04: `pnpm wasm:size`, `pnpm exec tsc -b --pretty false`, `pnpm lint`,
  and `pnpm test` pass.
- AC-428-05: `docs/PLAN.md`, `docs/phases/phase-31.md`, and
  `docs/query-language-support.md` reflect the Rust vocabulary SOT.
