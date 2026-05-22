# Sprint 479 Contract: Language Registry And Completion Ownership Matrix

## Goal

Make parser/completion ownership explicit for SQL, mongosh/MQL, Redis commands,
Search DSL, and future languages so TypeScript fallback code does not become the
long-term vocabulary source.

## Dependencies

- Depends on: 443, 477.
- Parallel lane: language/shared.
- Blocks: 481.

## Scope

- Define a language registry keyed by `QueryLanguageId`.
- Record parser owner, completion owner, fallback policy, safety analyzer, and
  supported syntax docs for each active language.
- Keep Rust/WASM as hot-path owner where ADR 0045 applies.
- Add tests for language lookup and missing-owner failures.

## Acceptance Criteria

- AC-479-01: Every active query language has an owner record.
- AC-479-02: Completion vocabulary ownership is explicit.
- AC-479-03: TypeScript fallback mirrors are labeled compatibility, not SOT.
- AC-479-04: Missing language metadata fails tests.

## Out of Scope

- Implementing every language parser.
- Broad completion rewrite.
- Editor redesign.

## Verification Plan

1. Language registry tests.
2. Query-language support docs check.
3. Typecheck.
