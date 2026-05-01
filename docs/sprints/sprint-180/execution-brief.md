# Sprint Execution Brief: sprint-180

## Objective

- Ship the **Doherty + Goal-Gradient** async UX across the four user-perceived async vectors (row data fetch, query execution, schema/structure load, refetch). Today only one vector — RDB query execution via `execute_sql` + the `cancel_query` command — supports backend cancellation. This sprint (a) introduces a shared overlay component (`AsyncProgressOverlay`) that materialises after a 1-second threshold, carries a uniform `"Cancel"` control, and reuses Sprint 176's pointer-event hardening; (b) extends the cancel-token registry pattern from `cancel_query` to `query_table_data`, `get_columns`, `get_table_indexes`, `get_table_constraints` (RDB) and the Mongo equivalents `find` / `aggregate` / `infer_collection_fields` / `list_collections`; (c) adds a third `"cancelled"` status to `queryHistoryStore` so cancelled RDB queries are recorded distinctly; (d) ships ADR-0018 documenting the per-adapter cancel policy (PG cooperative + driver-level cancel; Mongo cooperative + `killOperations` where supported; SQLite best-effort, abort only at statement boundaries).

## Task Why

- **UX law: Doherty Threshold.** A user-visible operation that takes longer than ~1 second without feedback breaks the user's perception of responsiveness; with feedback (overlay + Cancel) the perceived response shifts from "stuck" to "in progress, recoverable." This sprint installs that 1-second deadline as a visible affordance across all four async vectors.
- **UX law: Goal-Gradient.** When a wait exceeds the 1-second threshold, a visible Cancel control restores the user's sense of agency: instead of an opaque indeterminate wait, the user can re-aim or back out. The Cancel control turns the wait from "passive endurance" into "active choice," which preserves motivation when latency is unavoidable (e.g. a slow `query_table_data` on a multi-million-row table).
- The infrastructure for this work is mostly in place — `cancel_query` already exists, `CancellationToken` plumbing through `execute_sql` is shipped at `src-tauri/src/db/postgres.rs:443-595`, and the `query_tokens: Mutex<HashMap<String, CancellationToken>>` registry is defined at `src-tauri/src/commands/connection.rs:80`. This sprint extends that proven pattern to the three remaining vectors and ships the unified frontend overlay.

## Scope Boundary

- **HARD: do NOT touch SQLite mid-flight cancellation.** SQLite's serial-execution model does not allow interrupting an in-flight statement from another thread without invasive driver work. The ADR documents the policy (best-effort, abort only at statement boundary). No SQLite-specific cancel implementation in this sprint. (SQLite is not yet wired as an adapter in the repo; the ADR is forward-looking for Phase 9's SQLite integration.)
- **HARD: do NOT redesign the toast queue.** Reuse the existing `useToast` notification path for any user-visible "cancelled" message. No new toast layer.
- **HARD: do NOT break existing `cancel_query`.** The wire-level signature `cancel_query(query_id: string) -> Result<String>` is preserved. The Generator MAY add a doc comment that `cancel_query` now also cancels non-`execute_sql` ops (because the `query_tokens` registry is now shared across paradigms), but the input/output types do not drift. A renaming to `cancel_operation` is OPTIONAL and only if clearer; default decision: keep `cancel_query`.
- **HARD: do NOT introduce a new IPC pattern outside the cancel-token registry.** Tauri commands do not natively support `AbortController` per `invoke` call. The cancel-token registry pattern (`query_tokens: Mutex<HashMap<String, CancellationToken>>`) is the canonical workaround for this codebase. The Generator MUST NOT add a new IPC primitive (e.g. an event-channel-based cancel, a separate Tauri command per cancellable op).
- **HARD: do NOT widen the cancel-token contract beyond the four enumerated methods per paradigm.** No cancel on `drop_table`, `alter_table`, `create_index`, `add_constraint`, `update_document`, `delete_document`, etc. Those are short-running DDL/mutation ops; cancel is meaningful only on the four enumerated read/query methods per paradigm.
- **HARD: do NOT modify the `Paradigm` type at `src/types/connection.ts:15`.** Read-only invariant.
- **HARD: do NOT regress Sprint 176 hardening.** The four pointer-event handlers (`onMouseDown`, `onClick`, `onContextMenu`, `onDoubleClick`) on the loading overlay continue to call `e.preventDefault() + e.stopPropagation()`. The shared overlay internalises these handlers — extracting them away from the host call sites does not relax the behavior.
- **SOFT (deferred): cross-window cancel propagation.** A query cancelled in the workspace window does NOT propagate cancel to a duplicate query in another window. Each window owns its own ops.
- **SOFT (deferred): query-history UI changes** beyond the `"cancelled"` rendering branch in `QueryLog` / `GlobalQueryLogPanel`. No new history filter, search, or export.
- **SOFT (deferred): backend telemetry / metrics** (cancellation rate, observed latencies). Not this sprint.
- **SOFT (deferred): e2e cancel scenario.** Not required; permitted as a stretch goal.

## Invariants

- **Existing `cancel_query` command unchanged in observable behavior**: `src-tauri/src/commands/rdb/query.rs:130-155` keeps its wire signature; its registry semantics extend transparently.
- **Existing `execute_sql` cancel-token semantics unchanged**: `src-tauri/src/db/postgres.rs:443-595` is the reference shape for the new method implementations, not a target of modification.
- **ADR-0005 holds**: plaintext password never leaves the backend; the cancel path does not log connection passwords or queries with inline credentials.
- **Sprint 176 pointer-event hardening preserved**: a Vitest regression test on `AsyncProgressOverlay` asserts the four handlers exist and that `mouseDown` / `doubleClick` events targeting the overlay do NOT bubble to a background target. The Cancel button itself responds to click — the parent overlay's stop-propagation only blocks background bubbling, not the button's own `onClick`.
- **`Paradigm` type unchanged**: `src/types/connection.ts:15` read-only.
- **Non-cancelled paths perform identically**: a fast (sub-second) op MUST NOT incur measurable overhead from the cancel-token plumbing. Threshold-gated overlay never renders for sub-second ops; trait methods accept `Option<&CancellationToken>` and `None` is the legacy default for non-user-cancellable call sites.
- **Skip-zero gate holds** (AC-GLOBAL-05): touched test files contain no `it.skip` / `it.todo` / `xit`.
- **Strict TS / Rust**: no `any`, no `unwrap()` outside tests, `pnpm tsc --noEmit` zero, `pnpm lint` zero, `cargo clippy --all-targets --all-features -- -D warnings` zero.
- **No new runtime dependencies**: `package.json` and `src-tauri/Cargo.toml` unchanged. `tokio_util::sync::CancellationToken` is already in use.
- **`queryHistoryStore` legacy entries continue to load**: existing entries with `status: "success" | "error"` continue to satisfy the type-widened union without migration.
- **`DOCUMENT_LABELS` / `PARADIGM_VOCABULARY` (Sprint 179) untouched**: cancel button copy is the literal `"Cancel"`, paradigm-neutral.

## Done Criteria

1. `src/components/feedback/AsyncProgressOverlay.tsx` (or equivalent location under `src/components/`) exists. It exports a typed React component with props `visible: boolean`, `onCancel: () => void`, optional `label?: string` (default `"Loading…"`). The component renders an absolute-inset overlay carrying the four pointer-event handlers from Sprint 176 (`onMouseDown`, `onClick`, `onContextMenu`, `onDoubleClick`, each with `preventDefault() + stopPropagation()`), a Cancel button with literal copy `"Cancel"`, accessible name `"Cancel"`, and `data-testid="async-cancel"`. (AC-180-01, AC-180-02, AC-180-06)
2. The 1-second threshold is implemented in exactly one place — either a `useDelayedFlag(active, 1000)` hook at `src/hooks/useDelayedFlag.ts` (preferred) or a single inline helper that all four consumers share. Decision recorded in `findings.md`. Sub-1s ops produce no overlay flicker; >1s ops produce the overlay. (AC-180-01)
3. The four host surfaces (`DataGridTable.tsx`, `DocumentDataGrid.tsx`, `StructurePanel.tsx`, `rdb/DataGrid.tsx` refetch path) consume `<AsyncProgressOverlay>` with the threshold gating `visible`. The cancel handler invokes the backend cancel command (`cancel_query` or its renamed equivalent) on the active op-id. (AC-180-02, AC-180-06)
4. The Rust trait surface in `src-tauri/src/db/mod.rs` extends:
   - `RdbAdapter::query_table_data`, `get_columns`, `get_table_indexes`, `get_table_constraints` accept `Option<&'a CancellationToken>`.
   - `DocumentAdapter::find`, `aggregate`, `infer_collection_fields`, `list_collections` accept the same.
   The `PostgresAdapter` and `MongoAdapter` impls observe the cancel token cooperatively (`tokio::select!` against the underlying future), returning the project's existing cancellation error variant on the cancel branch. (AC-180-04)
5. `queryHistoryStore.ts` `QueryHistoryEntry.status` widens to `"success" | "error" | "cancelled"`. Existing callers compile unchanged. The `normaliseEntry` function preserves the wider union. Cancelled RDB queries record an entry with `status === "cancelled"`. (AC-180-03)
6. `QueryLog.tsx` and `GlobalQueryLogPanel.tsx` render the `"cancelled"` branch with a calm muted treatment (Generator's choice, distinct from `bg-destructive`). Tests assert the visual class is non-destructive. (AC-180-03)
7. Cancel→retry succeeds on each of the four surfaces: second attempt resolves cleanly with its own data; no orphaned token in `query_tokens`; no late cancelled response surfacing post-retry. The cancel path removes the token from the registry BEFORE invoking `.cancel()` so a concurrent retry can register without contention. (AC-180-05)
8. NEW ADR `memory/decisions/0018-async-cancel-policy/memory.md` exists with frontmatter (`status: Accepted`, `date: 2026-04-30`) and body sections: motivation (Doherty + Goal-Gradient), decision (cooperative `CancellationToken` registry on the four extended methods per paradigm), per-adapter behavior (PG / Mongo / SQLite), trade-offs (no IPC AbortController; registry pattern is the canonical workaround), reversibility (`Superseded` if a future Tauri version supports IPC AbortController). The ADR index `memory/decisions/memory.md` carries a new row for ADR-0018. (AC-180-04)
9. Required checks pass:
   - `pnpm vitest run` (full suite) green.
   - `pnpm tsc --noEmit` zero.
   - `pnpm lint` zero.
   - `cargo build --manifest-path src-tauri/Cargo.toml` clean.
   - `cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings` zero.
   - `cargo test --manifest-path src-tauri/Cargo.toml` green, including the new fake-adapter cancel-token unit tests covering AC-180-04 form (b).
   - Static checks at Verification Plan §Required Checks #8 pass.
   - Operator browser smoke at #9 records observations in `findings.md`.
10. `findings.md` records: shared-component decision (location/shape), threshold mechanism (hook vs inline), cancel-command decision (`cancel_query` reused vs new `cancel_operation`), cancel-registry decision (single vs per-paradigm), Mongo driver cancel observations, AC→test mapping, four-surface accessible-name uniformity audit, manual operator smoke replay log, evidence index.

## Verification Plan

- **Profile**: `mixed` (browser + command + api). Backend-cancellation evidence is permitted via either (a) live-DB integration tests gated behind an env flag, or (b) Rust unit tests against a fake adapter that observes cancel-token cooperation, plus an operator-driven manual smoke for live-DB confirmation. Form (b) is REQUIRED; form (a) is OPTIONAL.
- **Required checks**:
  1. `pnpm vitest run src/components/feedback/AsyncProgressOverlay.test.tsx src/hooks/useDelayedFlag.test.ts src/stores/queryHistoryStore.test.ts src/components/datagrid/DataGridTable.test.tsx src/components/document/DocumentDataGrid.test.tsx src/components/schema/StructurePanel.test.tsx src/components/rdb/DataGrid.test.tsx src/components/query/QueryLog.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` — green; `[AC-180-0X]`-prefixed test names visible.
  2. `pnpm vitest run` — full suite green (no regression).
  3. `pnpm tsc --noEmit` — zero errors.
  4. `pnpm lint` — zero errors.
  5. `cargo build --manifest-path src-tauri/Cargo.toml` — clean build.
  6. `cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings` — zero warnings.
  7. `cargo test --manifest-path src-tauri/Cargo.toml` — green, with new fake-adapter cancel-token tests (`test_query_table_data_honors_cancel_token`, `test_find_honors_cancel_token`, etc.).
  8. Static — `grep -nE 'data-testid="async-cancel"|preventDefault|stopPropagation' src/components/feedback/AsyncProgressOverlay.tsx` shows the testid + ≥8 hardening calls; `test -d memory/decisions/0018-async-cancel-policy && head -30 memory/decisions/0018-async-cancel-policy/memory.md` shows ADR; `grep -n '0018' memory/decisions/memory.md` shows index updated; `grep -nE 'fn (query_table_data|get_columns|get_table_indexes|get_table_constraints|find|aggregate|infer_collection_fields|list_collections)' src-tauri/src/db/mod.rs` shows trait methods carrying `cancel: Option<&'a CancellationToken>`.
  9. Operator browser smoke — `pnpm tauri dev`, run each of the four surfaces under a long-fetch condition, observe the overlay+Cancel at ~1s, click Cancel, confirm idle restoration, retry, confirm second attempt's data renders. PG smoke: `SELECT pg_sleep(5)` cancelled at 1.5s — verify in `pg_stat_activity` that the query is gone. Mongo smoke: long aggregate cancelled — verify in `db.currentOp()` (driver-version-dependent — record observation either way). At min window size 1024×600, confirm overlay does not visually clip.
- **Required evidence**:
  - Changed files list with one-line purpose each (AsyncProgressOverlay.tsx + .test.tsx, useDelayedFlag.ts + .test.ts if hook, four surface .tsx + .test.tsx, queryHistoryStore.ts + .test.ts, QueryLog.tsx + GlobalQueryLogPanel.tsx + their tests, src-tauri/src/db/mod.rs, postgres.rs, mongodb.rs, the relevant src-tauri/src/commands/rdb/*.rs and src-tauri/src/commands/document/*.rs files, ADR file, ADR index, findings.md, handoff.md).
  - Vitest output for the targeted test files; `[AC-180-0X]`-tagged cases visible.
  - Cargo build / clippy / test stdouts (the test stdout must show the new fake-adapter cancel-token tests passing).
  - For AC-180-01: explicit fake-timers test on `AsyncProgressOverlay` (sub-1s no-render, post-1s render) AND a per-surface test confirming the wiring.
  - For AC-180-02: per-surface Vitest test that simulates cancel mid-fetch and asserts loading clears + pre-fetch state restored.
  - For AC-180-03: queryHistoryStore unit test inserting a `"cancelled"` entry; QueryLog/GlobalQueryLogPanel rendering test for the `"cancelled"` branch.
  - For AC-180-04: Rust unit test on at least one fake `RdbAdapter` and one fake `DocumentAdapter` showing cooperative cancel-token observation; ADR file inspection; operator runbook in `findings.md` covering live-DB PG `pg_sleep(N)` cancel and Mongo long-aggregate cancel.
  - For AC-180-05: per-surface Vitest cancel→retry test asserting overlay disappears post-cancel, second attempt's data renders, no stuck state.
  - For AC-180-06: cross-surface Vitest case (or per-surface case) asserting `screen.getByTestId("async-cancel")` resolves, accessible name is `"Cancel"`, button is keyboard-focusable.
  - `findings.md` recording: shared-component decision (location/shape), threshold mechanism, cancel-command decision, cancel-registry decision, Mongo driver cancel observations, AC→test mapping, four-surface accessible-name uniformity audit, manual operator smoke replay log, evidence index.
  - `git diff src/types/connection.ts` empty (Paradigm unchanged).
  - `git diff src-tauri/src/commands/rdb/query.rs` shows `cancel_query` wire signature unchanged.
  - `grep -nE 'it\.(skip|todo)|xit\(' <touched-test-files>` empty (skip-zero gate).

## Evidence To Return

- Changed files and one-line purpose per file.
- Checks run and outcomes (Vitest stdout summary, tsc result, lint result, cargo build/clippy/test results, static-check stdouts).
- Done criteria coverage: AC-180-01..06 with concrete test names and evidence pointers (ADR path for AC-180-04, manual smoke log line range, fake-adapter Rust test names).
- Assumptions made during implementation (e.g. chosen threshold mechanism hook-vs-inline, chosen cancel-command name `cancel_query` vs `cancel_operation`, chosen cancel-registry shape single-vs-per-paradigm, chosen Mongo driver cancel approach given the bundled driver version's capabilities, chosen visual treatment for the `"cancelled"` history rendering branch).
- Residual risk or verification gaps (e.g. live-DB Mongo cancel behavior dependent on bundled driver version; live-DB PG smoke run on operator's local PG instance and observation logged in `findings.md`; SQLite policy is forward-looking — no SQLite adapter exists yet; cross-window cancel propagation explicitly out of scope and noted).

## References

- Contract: `docs/sprints/sprint-180/contract.md`
- Master spec: `docs/sprints/sprint-176/spec.md` (Sprint 180 section, Global ACs, Discrepancies §E.10–§E.11, Verification Hints, Additional Risks)
- Findings (Generator output): `docs/sprints/sprint-180/findings.md`
- Handoff (Generator output): `docs/sprints/sprint-180/handoff.md`
- New ADR (Generator output): `memory/decisions/0018-async-cancel-policy/memory.md`
- Relevant Rust source files:
  - `src-tauri/src/db/mod.rs` — trait surface; extend the cancel-token contract on the four enumerated methods per paradigm.
  - `src-tauri/src/db/postgres.rs:443-595` — reference shape for cooperative cancel-token observation in the adapter implementation.
  - `src-tauri/src/db/mongodb.rs` — Mongo adapter; extend the four enumerated methods.
  - `src-tauri/src/commands/connection.rs:80` — `query_tokens: Mutex<HashMap<String, CancellationToken>>` registry; reuse across paradigms.
  - `src-tauri/src/commands/rdb/query.rs:73-100` — reference shape for per-call token registration and cleanup.
  - `src-tauri/src/commands/rdb/query.rs:130-155` — `cancel_query` command; wire signature preserved; registry semantics extend.
  - `src-tauri/src/commands/rdb/schema.rs`, `src-tauri/src/commands/document/browse.rs`, `src-tauri/src/commands/document/query.rs` — host commands for the four enumerated methods per paradigm; register cancel-tokens.
- Relevant frontend source files:
  - `src/components/datagrid/DataGridTable.tsx:829-880` — existing Sprint 176-hardened overlay; replace inline block with shared component.
  - `src/components/document/DocumentDataGrid.tsx:316-352` — same.
  - `src/components/schema/StructurePanel.tsx:148-160` — existing inline `{loading && (...)}` block; wrap with shared component (Generator confirms exact line range during inventory).
  - `src/components/rdb/DataGrid.tsx:380-400` — refetch-path branch; wrap with shared component.
  - `src/stores/queryHistoryStore.ts:23` — `status` union; widen to include `"cancelled"`.
  - `src/components/query/QueryLog.tsx:110`, `src/components/query/GlobalQueryLogPanel.tsx:187,204` — existing `status === "success" | "error"` rendering branches; add `"cancelled"` branch.
- Reference style: `docs/sprints/sprint-179/contract.md`, `docs/sprints/sprint-179/execution-brief.md`.
- Project conventions: `memory/conventions/memory.md`; testing rule: `.claude/rules/testing.md`; React rule: `.claude/rules/react-conventions.md`; Rust rule: `.claude/rules/rust-conventions.md`; test-scenarios rule: `.claude/rules/test-scenarios.md`.
- ADR convention: `memory/decisions/memory.md` (numbering, slug, frontmatter, body-frozen rule).
