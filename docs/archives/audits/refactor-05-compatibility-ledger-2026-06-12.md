# Refactor 05 compatibility ledger

Issue: #758
Parent: #576
Milestone: 09.50 - Refactor 05 - Docs/Memory SOT Alignment
Base: `042d419158d8e0b7ed340e4c1825f3d17c718cdd`

This audit reconciles retained compatibility and fallback paths after the
Refactor 02/03/04 inventories. It is not a product support-claim ledger.
Product-facing support wording belongs to #759.

## Source evidence

| Source | Status | Evidence used |
|---|---|---|
| #734 / PR #804 | closed / merged | Frontend compatibility inventory and static guard. |
| #744 / PR #824 | closed / merged | Typed Tauri error envelopes and legacy error fallback normalizer. |
| #748 / PR #830 | closed / merged | Backend adapter topology and legacy import-path shim evidence. |
| #746 / PR #831 | closed / merged | RDB command dispatch split preserving IPC/error behavior. |
| #771 / PR #842 | closed / merged | E2E seed fixture loader compatibility shim and removal guard. |

## Compatibility types

| Type | Meaning | Removal rule |
|---|---|---|
| `permanent-wire-compatibility` | The path preserves stored data, IPC/wire shape, import/export files, browser/runtime behavior, or documented support-boundary behavior. | Do not remove without a replacement contract and targeted regression tests. |
| `migration-only` | The path exists only to bridge a refactor migration or import-path move. | Remove when the named owner issue/migration completes and callers no longer depend on it. |
| `removable-debt` | The path is retained only because immediate removal is risky or outside this issue. | Remove or route through the named follow-up before parent closure. |

## Required-field map

The frontend ledger from #734 is accepted as part of this #758 reconciliation
instead of being duplicated here.

| Source table | Path | Compatibility type | Owner | Test evidence | Removal horizon | Follow-up issue |
|---|---|---|---|---|---|---|
| `docs/archives/audits/refactor-02-frontend-compat-inventory-2026-06-10.md` | `Path` | `Classification` | `Owner` | `Tests` | `Horizon` | `Follow-up` |
| Cross-surface table below | `Path` | `Compatibility type` | `Owner` | `Test evidence` | `Removal horizon` | `Follow-up issue` |

Frontend reconciliation result from the #734 table:

| Compatibility type | Rows | Reconciliation |
|---|---:|---|
| `permanent-wire-compatibility` | 23 | Preserve. Each row already has owner, test evidence, horizon, and follow-up issue evidence. |
| `migration-only` | 40 | Keep tied to the existing Refactor 02 owner issues listed in the table. |
| `removable-debt` | 2 | Keep routed to #742/#758; no behavior removed in this issue. |

The frontend static policy parses that table and fails when rows are stale,
untriaged, missing required evidence, or missing same-milestone migration issue
coverage.

## Cross-surface compatibility ledger

| Path | Compatibility type | Owner | Test evidence | Removal horizon | Follow-up issue |
|---|---|---|---|---|---|
| `src-tauri/src/error.rs` | `permanent-wire-compatibility` | IPC error contract | `src-tauri/src/error.rs` unit tests; `src-tauri/tests/cancel_error_classes.rs`; `src/lib/tauri/error.test.ts` | Preserve typed `Cancel`/`DbMismatch` envelopes plus legacy string serialization for other `AppError` variants until a future typed-error migration replaces every caller boundary. | #744, #758; future typed-error migration issue required before removal. |
| `src/lib/tauri/error.ts` | `permanent-wire-compatibility` | Frontend Tauri error boundary | `src/lib/tauri/error.test.ts`; representative DbMismatch consumer tests from PR #824 | Preserve typed envelope, JSON-stringified envelope, legacy Display-string, `Error`, string, and unknown-object normalization while backend can emit mixed error shapes. | #744, #758; future typed-error migration issue required before removal. |
| `src-tauri/src/db/sqlite.rs` | `migration-only` | Backend adapter topology | `src-tauri/src/db/adapters/tests.rs`; PR #830 Rust adapter topology checks | Remove after SQLite callers import the canonical `src-tauri/src/db/adapters/sqlite` path or stable root contract path and no legacy `db::sqlite::*` import compatibility remains. | #748; future adapter topology cleanup if the shim survives later DBMS moves. |
| `src-tauri/src/db/mod.rs` root adapter and contract re-exports | `migration-only` | Backend adapter topology | `src-tauri/src/db/adapters/tests.rs`; `src-tauri/tests/backend_adapter_contract_profile.rs`; `src-tauri/tests/backend_safety_capability_contract.rs`; `src-tauri/tests/data_source_profile_parity.rs` | Keep while backend modules migrate one DBMS at a time. Reclassify any root re-export as permanent only if it remains the intentional public contract after topology migration. | #748; #765/#766/#767/#768 for later backend contract deltas. |
| `src-tauri/src/commands/rdb/query/mysql_scripting.rs` | `permanent-wire-compatibility` | RDB query support-boundary contract | `cargo test --manifest-path src-tauri/Cargo.toml --lib rdb::query::tests -- --nocapture`; PR #831 evidence | Preserve until Table View intentionally implements MySQL/MariaDB client scripting, import workflow, routine bodies, or control-flow execution with product/support-claim updates. | #746; #759 owns future user-visible support wording. |
| `src-tauri/src/commands/rdb/query.rs` | `permanent-wire-compatibility` | RDB query IPC command boundary | `cargo test --manifest-path src-tauri/Cargo.toml --lib rdb::query::tests -- --nocapture`; PR #831 pre-push Rust gates | Preserve command signatures, cancellation registration/release ordering, `expected_database` DbMismatch guard, and adapter error propagation until a request-envelope migration lands with equivalent tests. | #746, #758. |
| `src-tauri/src/commands/rdb/schema/contract.rs` | `permanent-wire-compatibility` | RDB schema IPC command boundary | `cargo test --manifest-path src-tauri/Cargo.toml rdb::schema -- --nocapture`; PR #831 pre-push Rust gates | Preserve schema lookup, RDB guard, expected-database check, and adapter dispatch behavior until command request envelopes change under a targeted issue. | #746, #758. |
| `src-tauri/src/commands/rdb/ddl/dispatch.rs` | `permanent-wire-compatibility` | RDB DDL IPC command boundary | `cargo test --manifest-path src-tauri/Cargo.toml rdb::ddl -- --nocapture`; PR #831 pre-push Rust gates | Preserve DDL request lookup, RDB guard, expected-database check, and adapter dispatch behavior until command request envelopes change under a targeted issue. | #746, #758. |
| `scripts/fixtures/e2e-seed-paths.ts` | `removable-debt` | Fixture loader topology | `scripts/fixtures/e2e-seed-paths.test.ts`; `scripts/fixtures/dbms-seeds.test.ts`; PR #842 evidence | Current repository has no legacy moved seed files, and #755 plus milestone #40 are closed. Keep only while dependent branches may still reference old seed paths; otherwise remove the fallback or route cleanup before parent #576 closes. | #771, #755, #760. |

## Verification inventory commands

```bash
rg -n "legacy|deprecated|back-compat|backward compat|backward compatibility|backward-compat|backwards compatibility|backwards-compatible|compat wrapper|compat surface|compatibility[- ]mirror|compatibility projection" src/components src/features src/lib src/stores src/types --glob '*.{ts,tsx}' --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/*.spec.ts' --glob '!**/__tests__/**' --glob '!src/lib/*/wasm/*.d.ts'
rg -n "legacy|fallback|compat|backward|deprecated|shim" src-tauri/src src-tauri/tests scripts e2e/fixtures tests/fixtures --glob '!src-tauri/target/**'
pnpm exec tsx scripts/check-eslint-static-policy.ts
```

## Scope decisions

- No compatibility path is removed in #758.
- No product support claim text changes in #758; #759 owns support-claim wording.
- No `docs/ROADMAP.md` or `docs/PLAN.md` routing changes in #758; #757 already
  closed that audit.
- No new static guard is added here. Existing static policy already guards the
  frontend table; backend/fixture rows are reconciled through targeted tests and
  issue evidence.
