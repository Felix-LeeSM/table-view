# Sprint 423 Contract: SQL WASM-First Completion Source

## Goal

Switch the live SQL CodeMirror popup to prefer the Rust/WASM completion core
while preserving the existing TypeScript sources as fallback.

## Acceptance Criteria

- AC-423-01: SQL completion source builds the normalized request from
  CodeMirror state and the active completion context.
- AC-423-02: Preloaded WASM results are used synchronously when available.
- AC-423-03: Async WASM load path is supported for first-use completion.
- AC-423-04: Empty/error WASM output falls back to the existing TypeScript
  schema/update/alias/CTE sources.
- AC-423-05: The shadow-only request source is removed from live editor wiring.

## Validation

```bash
pnpm vitest run src/lib/sql/sqlHybridCompletionSource.test.ts \
  src/lib/sql/sqlCodeMirrorCompletionAdapter.test.ts
```
