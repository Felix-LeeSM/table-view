# Sprint Contract: sprint-180

## Summary

- Goal: Ship the **Doherty + Goal-Gradient** async UX across the four user-perceived async vectors of the app (row data fetch, query execution, schema/structure load, refetch). Today only one vector — RDB query execution via `execute_sql` + the `cancel_query` command — supports backend cancellation and surfaces a Cancel control. This sprint (a) introduces a single shared overlay component (`AsyncProgressOverlay`) that materialises after a 1-second threshold, carries a uniform Cancel control, and reuses the Sprint 176 pointer-event hardening; (b) extends the cancel-token registry pattern from `cancel_query` to `query_table_data`, `get_columns`, `get_table_indexes`, `get_table_constraints` (RDB) and the equivalent Mongo `find` / `aggregate` / `infer_collection_fields` / `list_collections` methods; (c) adds a third `"cancelled"` status to `queryHistoryStore` so cancelled RDB queries are recorded distinctly from success/error; (d) ships an ADR documenting the per-adapter cancel policy (PG cancel = `pg_cancel_backend`; Mongo = `killOp` / driver-level abort; SQLite = best-effort, in-flight cancellation impossible — abort only at statement boundaries).
- Audience: Generator (single agent) — implements; Evaluator — verifies AC + evidence.
- Owner: harness orchestrator
- Verification Profile: `mixed` (browser + command + api). Backend-cancellation evidence is allowed via either (a) live-DB integration tests gated behind an env flag, or (b) Rust unit tests against a fake adapter that observes cancel-token cooperation plus an operator-driven manual smoke for live-DB confirmation. Option (b) is preferred for repo-portability; live-DB CI is optional.

## In Scope

- `AC-180-01`: After approximately 1 second of an in-flight async operation on any of the four vectors (row data fetch / query execution / schema fetch / refetch), a progress affordance with a visible "Cancel" control is reachable on the affected surface. Operations that complete in less than 1 second do NOT show the affordance — no overlay flicker for fast ops. Verifiable via Vitest with fake timers: a controllable promise that hangs through the threshold asserts the overlay appears; a promise that resolves at <500 ms asserts the overlay never renders.
- `AC-180-02`: Activating the Cancel control aborts the in-flight operation. The frontend's `loading` state clears within one frame of the cancel response. The user-visible content reverts to the pre-fetch state — empty/idle if there was no prior content, or the previous data set if this was a refetch. Verifiable via Vitest tests on each of the four vectors: trigger long-running fetch, click Cancel after threshold, assert `loading=false` synchronously after the cancel-response settles AND the previously-rendered content is intact (refetch case) OR the empty/idle state is shown (initial-fetch case).
- `AC-180-03`: For RDB query execution, an aborted query records a history entry whose `status` field carries the value `"cancelled"` (distinct from `"success"` / `"error"`). The `queryHistoryStore`'s `QueryHistoryEntry.status` type widens to `"success" | "error" | "cancelled"`. Existing `addHistoryEntry` callers continue to compile; new "cancelled" entries flow through the same persistence path. Verifiable via Vitest test that simulates the cancel path on `QueryTab` (or the relevant query-execution call site) and inspects `useQueryHistoryStore.getState().globalLog[0].status === "cancelled"`.
- `AC-180-04`: For RDB (PostgreSQL) and Mongo adapters, the backend confirms in-flight cancellation: the trait methods `query_table_data`, `get_columns`, `get_table_indexes`, `get_table_constraints` (RDB) and `find`, `aggregate`, `infer_collection_fields`, `list_collections` (Mongo) accept an `Option<&CancellationToken>` parameter (or carry a per-call cancel registration through the existing `query_tokens` registry pattern), and observably stop server-side work when the token is cancelled. SQLite (and any other adapter that cannot honour mid-flight cancel) declares a best-effort policy — cancellation is honoured only at statement boundaries, not mid-statement — captured in NEW ADR-0018. Verifiable evidence accepted in two equivalent forms:
  - **(b) preferred**: Rust unit tests against a fake `RdbAdapter` / `DocumentAdapter` whose method body awaits the cancel-token (`tokio::select!` style) and observes the early-return path; a documented operator runbook (in `findings.md`) for the live-DB smoke (`SELECT pg_sleep(5)` for PG; a long-running Mongo aggregate for Mongo) confirming server-side work stops.
  - **(a) optional**: live-DB integration tests under `src-tauri/tests/` gated by an env flag (e.g. `PG_TEST_DSN`, `MONGO_TEST_DSN`) that default-skip in CI but run locally for the operator. Generator MAY add (a) but MUST add (b).
- `AC-180-05`: A second attempt at the same operation immediately after cancelling the first proceeds normally. No stuck `loading=true` state, no orphaned cancel-token in the registry, no race surfacing the cancelled response after the second attempt's response. Verifiable via Vitest test on each of the four vectors: trigger op, cancel during overlay-visible window, immediately re-trigger op, assert second attempt resolves with its own data and the registry has no stale entry. Cancel-token cleanup must remove the token from the `query_tokens` map BEFORE invoking `.cancel()` so the second attempt registers a fresh token without contention (the existing `cancel_query` cleanup pattern at `src-tauri/src/commands/rdb/query.rs:139-142` is the reference shape).
- `AC-180-06`: All four async vectors share the same Cancel UX — same button copy (`"Cancel"`, single word per spec Visual Direction), same position relative to the spinner, same keyboard reachability (button is `tabIndex >= 0` and reachable via Tab from the surface's natural focus stop), same accessible name (`"Cancel"` via accessible-name computation), and same `data-testid="async-cancel"` attribute. Verifiable via component test that mounts each of the four host surfaces in a long-async state and asserts `screen.getByTestId("async-cancel")` resolves with the same accessible name across all four.

Files allowed to modify (per spec "Components to Create/Modify"):

- `src/components/feedback/AsyncProgressOverlay.tsx` (new) — shared overlay component. Props: `visible: boolean`, `onCancel: () => void`, `label?: string` (default `"Loading…"`), optional `className` for host-specific positioning. Renders an absolute-inset full-bleed overlay with the existing spinner geometry, a `"Cancel"` button (button copy fixed by spec), `data-testid="async-cancel"`, and the four pointer-event handlers preserving Sprint 176's hardening (`onMouseDown`, `onClick`, `onContextMenu`, `onDoubleClick` each calling `e.preventDefault() + e.stopPropagation()` — see `DataGridTable.tsx:845-880` and `DocumentDataGrid.tsx:335-352` for the canonical shape).
- `src/components/feedback/AsyncProgressOverlay.test.tsx` (new) — covers AC-180-01 (threshold renders/hides), AC-180-02 (Cancel callback fires), AC-180-06 (accessible name + data-testid).
- `src/hooks/useDelayedFlag.ts` (new, optional — Generator's choice) — `useDelayedFlag(active: boolean, delay = 1000): boolean` returns `true` only after `active` has been continuously `true` for `delay` ms; flips back to `false` synchronously when `active` transitions to `false`. If the Generator inlines the threshold logic at each consumer instead, the hook is not required, but the Generator MUST factor the threshold into one place (consumer-by-consumer copy-paste is rejected by the audit). Decision recorded in `findings.md`.
- `src/hooks/useDelayedFlag.test.ts` (new, conditional on the hook existing) — tests with `vi.useFakeTimers()` covering threshold-elapsed (returns true), threshold-not-elapsed (returns false), early-cancel (returns false without ever flipping), repeated cycles (no leaked timer).
- `src/components/datagrid/DataGridTable.tsx` — replace the existing inline `{loading && (...)}` overlay block (currently `src/components/datagrid/DataGridTable.tsx:829-880`) with `<AsyncProgressOverlay visible={…} onCancel={…} />`; the threshold gates `visible`. Pointer-event hardening MUST be preserved (it now lives inside the shared component). Cancel handler invokes the relevant cancel command on the active op-id.
- `src/components/document/DocumentDataGrid.tsx` — same replacement at `src/components/document/DocumentDataGrid.tsx:324-352`. Cancel handler invokes the Mongo cancel-equivalent.
- `src/components/schema/StructurePanel.tsx` — wrap the existing inline `{loading && (...)}` block (`src/components/schema/StructurePanel.tsx:148-160` per the rough audit; Generator confirms exact line range during inventory) with `<AsyncProgressOverlay …>`. Cancel handler aborts the in-flight schema fetch (whichever of `get_columns` / `get_table_indexes` / `get_table_constraints` is active).
- `src/components/rdb/DataGrid.tsx` — refetch path needs `<AsyncProgressOverlay …>`. The current code distinguishes initial-fetch (`{loading && !data && …}` at line 380) from refetch; the overlay is for refetch (initial-fetch keeps its current "skeleton/blank" UX). Cancel handler aborts the in-flight `query_table_data` call.
- `src/components/rdb/DataGrid.test.tsx`, `src/components/datagrid/DataGridTable.test.tsx`, `src/components/document/DocumentDataGrid.test.tsx`, `src/components/schema/StructurePanel.test.tsx` — extend with the AC-180-01 / 02 / 05 / 06 cases per surface (threshold appearance, cancel reverts state, cancel→retry succeeds, accessible name + data-testid uniformity).
- `src/stores/queryHistoryStore.ts` — `status` type widens to `"success" | "error" | "cancelled"`. The `addHistoryEntry` payload accepts the wider type; legacy callers that omit `status` keep their default. The `normaliseEntry` function continues to honour the wider union.
- `src/stores/queryHistoryStore.test.ts` — extend with at least one `"cancelled"` case (insert + filter + recall) covering AC-180-03.
- `src/components/query/QueryLog.tsx`, `src/components/query/GlobalQueryLogPanel.tsx` — these files already branch on `status === "success"` vs `"error"` (see `QueryLog.tsx:110` and `GlobalQueryLogPanel.tsx:187,204`). Add the `"cancelled"` rendering branch (visual treatment Generator's choice — neutral muted color is recommended; spec Visual Direction says cancel is "calm secondary, not destructive"). Tests for both panels gain at least one `"cancelled"` entry rendering case.
- `src-tauri/src/db/mod.rs` — extend the `RdbAdapter` trait so `get_columns`, `query_table_data`, `get_table_indexes`, `get_table_constraints` accept `Option<&'a CancellationToken>` (placement is a final argument, mirroring `execute_sql`'s shape at `src-tauri/src/db/mod.rs:191-195`). Extend `DocumentAdapter` so `find`, `aggregate`, `infer_collection_fields`, `list_collections` accept the same optional cancel-token. Default impls for `list_databases`, `list_views`, `list_functions` etc. that already exist remain untouched in observable behavior. The trait change IS a breaking API change FOR INTERNAL CALL SITES; the Generator updates every call site within `src-tauri/src/`. The Generator MUST NOT change the wire-level Tauri command signatures in a way that invalidates a frontend invocation that already exists — frontend-facing command surfaces add the `query_id` parameter (already present on `execute_query` / `cancel_query`) and route through the registry, but the existing frontend invocation shape for `query_table_data` etc. accepts the additive `query_id?: string` optional parameter.
- `src-tauri/src/db/postgres.rs` — implement cancel-token reception on the four extended `RdbAdapter` methods. The behavior MUST observe `cancel_token.cancelled()` in a `tokio::select!` branch alongside the underlying SQL future (the existing `execute_sql` at `src-tauri/src/db/postgres.rs:443-595` is the reference). On cancel, return `AppError::Cancelled` (or the project's existing equivalent — verify by `grep -rn "Cancelled\|cancelled" src-tauri/src/error.rs`). For `pg_cancel_backend`-style true PG cancellation (so the server stops the work, not just the client), use the established `cancel` channel on the underlying `tokio_postgres::Client` if `execute_sql` already does; otherwise the cancel-token cooperatively releases the future and the next driver-level cleanup applies.
- `src-tauri/src/db/mongodb.rs` — implement cancel-token reception on the four extended `DocumentAdapter` methods. Mongo driver-level cancellation: per AC-180-04, server-side work must observably stop. The Mongo Rust driver supports operation cancellation via a session/`killOperations` admin command; if the project's currently-bundled driver version does not, the Generator MUST document the limitation in the ADR (best-effort: token cancellation aborts the future locally, server-side cleanup is driver-version-dependent).
- `src-tauri/src/commands/rdb/query.rs`, `src-tauri/src/commands/rdb/schema.rs`, `src-tauri/src/commands/rdb/ddl.rs` — frontend-facing commands that wrap the four extended RDB methods accept an optional `query_id: Option<String>`. When supplied, the command registers a `CancellationToken` in `state.query_tokens` (same registry as `cancel_query`), invokes the underlying trait method with `Some(&token)`, and removes the token after completion. The existing `cancel_query` command (`src-tauri/src/commands/rdb/query.rs:130-155`) accepts any `query_id` and cancels the registered token without code change — so the registry is the unifying point. (No new generalized cancel command is required; `cancel_query` is renamed to `cancel_operation` ONLY IF the Generator decides that's clearer — the contract permits both; decision recorded in `findings.md`. Default: keep `cancel_query` and document that it cancels any registered op.)
- `src-tauri/src/commands/document/browse.rs`, `src-tauri/src/commands/document/query.rs`, `src-tauri/src/commands/document/mutate.rs` — same pattern for the four extended Mongo methods. The cancel-side: either reuse `cancel_query` against the same `query_tokens` registry (preferred — single registry across paradigms), or introduce a paradigm-neutral `cancel_operation` command (acceptable). Decision recorded in `findings.md`.
- `src-tauri/src/lib.rs` — handler registration for any new commands (none expected if `cancel_query` covers both paradigms); no change otherwise.
- `memory/decisions/0018-async-cancel-policy/memory.md` (new — verify next free number is `0018` with `ls memory/decisions/`; expected: `0017` is the highest existing) — ADR documenting per-adapter cancel policy. Frontmatter follows the convention in `memory/decisions/memory.md` (`status: Accepted`, date, supersedes if any). Body includes: motivation (Doherty + Goal-Gradient), decision (cooperative `CancellationToken` registry on the four extended methods per paradigm), per-adapter behavior (PG = cooperative + driver-level cancel where supported; Mongo = cooperative + `killOperations` where supported by the bundled driver version; SQLite = best-effort, in-flight serial-execution cannot be interrupted, abort only at statement boundary), trade-offs (no AbortController-at-IPC pattern because Tauri commands don't natively support one — registry pattern is the canonical workaround), and a "Reversibility" note (`Superseded` if a future Tauri version supports IPC AbortController).
- `docs/sprints/sprint-180/findings.md` (new) — Generator notes: shared-component decision (overlay component shape, threshold-hook vs inline), cancel-command decision (`cancel_query` vs new `cancel_operation`), cancel-registry decision (single registry vs per-paradigm), Mongo driver cancel limitations encountered (if any), AC→test mapping, four-surface accessible-name uniformity audit, manual operator smoke replay log, evidence index.
- `docs/sprints/sprint-180/handoff.md` (sprint deliverable; standard harness output).

## Out of Scope

- **Cross-window cancel propagation**: cancelling a query in the workspace window does NOT propagate a cancel signal to a duplicate query in another window. Each window owns its own ops.
- **Toast queue redesign**: the existing `useToast` notification path is reused for any user-visible "cancelled" message; no redesign of the toast layer.
- **Query-history UI changes** beyond the `"cancelled"` rendering branch in `QueryLog` / `GlobalQueryLogPanel`. No new history filter, no new history search, no new history export.
- **SQLite mid-flight cancellation**: SQLite's serial-execution model does not allow interrupting an in-flight statement from another thread without invasive driver work; the ADR documents the policy (best-effort, abort only at statement boundary). Generator MUST NOT attempt a SQLite-specific cancel implementation in this sprint. (Note: SQLite is not yet a wired adapter in the repo per `grep`-confirmed `src-tauri/src/`; the ADR is forward-looking and ensures Phase 9's SQLite adapter inherits the documented policy.)
- **Rust API breaking changes for callers outside the four enumerated methods per paradigm**. The Generator MUST NOT widen the cancel-token contract to other trait methods (e.g. `drop_table`, `alter_table`, `create_index`, `add_constraint`, `update_document`, `delete_document`) in this sprint. Those are short-running DDL/mutation ops; cancel is meaningful only on the four enumerated read/query methods per paradigm.
- **Backend telemetry / metrics** (cancellation rate, observed cancel-to-complete latencies, etc.). Out of scope.
- **AbortController API at the IPC boundary**. Tauri commands do not natively support `AbortController` per `invoke` call — the cancel-token registry pattern is the canonical workaround for this codebase. The Generator MUST NOT introduce a new IPC pattern outside the existing registry.
- **Sprints 176/177/178/179 spec/contract/brief/findings/handoff/labels-audit are NOT touched.**
- **`src/types/connection.ts:15` `Paradigm` type unchanged** — read-only invariant.
- **Existing `cancel_query` command's wire-level signature unchanged** — `cancel_query(query_id: string) -> Result<String>` stays. The renaming option is OPTIONAL and only if the Generator decides paradigm-neutrality is clearer.
- **e2e tests**: an e2e cancel scenario is NOT required this sprint. The contract permits the Generator to add one as a stretch goal but the AC do not require it; `pnpm vitest` + `cargo test` + manual operator smoke is sufficient evidence for AC-180-04.

## Invariants

- **Existing `cancel_query` command unchanged in observable behavior**: `src-tauri/src/commands/rdb/query.rs:130-155` continues to accept `query_id: String`, look up and cancel the registered token, return `Ok(format!("Query '{}' cancelled", …))` on success and `AppError::NotFound` on miss. Its registry semantics extend (it now cancels non-`execute_sql` ops too) but the wire signature does not change.
- **Existing `execute_sql` cancel-token semantics unchanged**: `src-tauri/src/db/postgres.rs:443-595` keeps its current `select!` shape; the cancel-token observation logic is the model for the new methods, not a target of modification.
- **ADR-0005 holds**: plaintext password never leaves the backend. The cancel path does not log connection passwords or queries containing inline credentials.
- **No regression in Sprint 176 hardening**: the four pointer-event handlers (`onMouseDown`, `onClick`, `onContextMenu`, `onDoubleClick`) on the loading overlay continue to call `e.preventDefault() + e.stopPropagation()`. The shared `AsyncProgressOverlay` MUST internalise these handlers — extracting them away from the call site does not relax the behavior. A regression test (Vitest) on `AsyncProgressOverlay` asserts the four handlers exist and that `mouseDown` / `doubleClick` events targeting the overlay region do NOT bubble to a background target.
- **`Paradigm` type at `src/types/connection.ts:15` unchanged** — read but not modified.
- **Non-cancelled paths perform identically**: a fast (sub-second) op MUST NOT incur measurable overhead from the cancel-token plumbing. Generator confirms: the threshold-gated overlay never renders for sub-second ops; the `Option<&CancellationToken>` parameter in trait methods is `None` when the call site does not opt in (legacy / non-user-cancellable paths).
- **`it.skip` / `it.todo` / `xit` skip-zero gate** (AC-GLOBAL-05) holds; touched test files contain none.
- **Strict TS / Rust**: no `any`, no `unwrap()` outside tests, `cargo clippy --all-targets --all-features -- -D warnings` zero, `pnpm tsc --noEmit` zero, `pnpm lint` zero.
- **No new runtime dependencies** on the frontend (`package.json` unchanged); on the Rust side, only existing crates (`tokio_util::sync::CancellationToken` is already in use).
- **`queryHistoryStore` legacy entries continue to load**: existing entries with `status: "success" | "error"` continue to satisfy the type-widened union without migration. The `normaliseEntry` function does not gain a coercion that drops `"cancelled"`.
- **`DOCUMENT_LABELS` / `PARADIGM_VOCABULARY` (Sprint 179) untouched**: cancel button copy is `"Cancel"` literal, paradigm-neutral. (The Sprint 179 vocabulary is for entity nouns, not action verbs.)
- **Existing `QueryLog` / `GlobalQueryLogPanel` tests pass without text-string edits beyond optional new `"cancelled"`-case additions.**

## Acceptance Criteria

- `AC-180-01` — Shared overlay materialises after a 1-second threshold and not before. Vitest with `vi.useFakeTimers()` asserts both directions on each of the four surfaces (or, equivalently, on the `AsyncProgressOverlay` + `useDelayedFlag` unit + a smoke test on each surface confirming the wiring). Sub-second ops produce no overlay.
- `AC-180-02` — Cancel control aborts the in-flight op. `loading=false` is observable within one render frame of cancel-response. Pre-fetch state is restored (refetch keeps existing data; first-fetch falls back to empty/idle). Vitest test on each of the four surfaces.
- `AC-180-03` — `queryHistoryStore.status` widens to include `"cancelled"`. Cancelled RDB query produces a history entry with `status === "cancelled"`. Vitest test on the store + the relevant query-execution call site.
- `AC-180-04` — RDB (`get_columns`, `query_table_data`, `get_table_indexes`, `get_table_constraints`) and Mongo (`find`, `aggregate`, `infer_collection_fields`, `list_collections`) trait methods accept `Option<&CancellationToken>` and observably honor cancel. Evidence: Rust unit tests against a fake adapter that observes the cancel branch (form b, REQUIRED), and operator runbook (in `findings.md`) for live-DB smoke (form a optional). NEW ADR `memory/decisions/0018-async-cancel-policy/memory.md` documents the per-adapter policy including SQLite best-effort.
- `AC-180-05` — Cancel→retry produces a clean second attempt: `loading=true` on retry, no orphaned token, second attempt's response is the visible result, no late cancelled response surfacing. Vitest test on each of the four surfaces.
- `AC-180-06` — All four surfaces' Cancel control share copy (`"Cancel"`), accessible name (`"Cancel"`), `data-testid="async-cancel"`, keyboard reachability (Tab from natural focus stop reaches the button), and visual position (relative to the spinner, defined inside the shared component). Component test mounts each surface in long-async state and asserts uniformity.

## Design Bar / Quality Bar

- **Shared overlay location**: `src/components/feedback/AsyncProgressOverlay.tsx`. The Generator MAY name the directory differently (`src/components/async/`, `src/components/overlays/`) but the component MUST be a single source of truth and MUST live under `src/components/`. Decision recorded in `findings.md`.
- **Threshold mechanism**: Generator picks one of:
  - **Hook**: `useDelayedFlag(active: boolean, delay = 1000): boolean` — pure derivation; uses `setTimeout` + `clearTimeout` in a `useEffect`. Returns `true` only after `active` has been continuously `true` for `delay` ms; flips to `false` synchronously when `active` becomes `false`.
  - **Inline timeout** at each consumer — accepted ONLY IF the threshold logic is identical across all four consumers and is extracted into one helper (still recorded in `findings.md`).
  Both are acceptable. Hook is preferred for testability and audit cleanliness. Whichever is chosen, the threshold logic lives in exactly one module.
- **Cancel-button copy**: literal `"Cancel"` (single word). Spec Visual Direction is firm. The button's accessible name is `"Cancel"` (no aria-override). The `data-testid` is `"async-cancel"` exactly (lowercase, hyphenated).
- **Pointer-event hardening preserved**: `AsyncProgressOverlay` internalises the four handlers (`onMouseDown`, `onClick`, `onContextMenu`, `onDoubleClick`), each calling `e.preventDefault() + e.stopPropagation()`. Reference: `src/components/datagrid/DataGridTable.tsx:845-880` and `src/components/document/DocumentDataGrid.tsx:335-352`. The Cancel button itself, however, must respond to click — this is achieved by the button being a child element with its own click handler that invokes the cancel callback (the parent overlay's stop-propagation does NOT prevent the button's own `onClick`, only background bubbling).
- **Cancel-token registry shape (Rust)**: reuse `state.query_tokens: Mutex<HashMap<String, CancellationToken>>` (defined at `src-tauri/src/commands/connection.rs:80`) — single registry across paradigms. Per-call cancel-token registration follows the `execute_query` shape at `src-tauri/src/commands/rdb/query.rs:73-100`: insert before invoking the trait method, remove after the trait method returns (success, error, OR cancel). On cancel: remove from map BEFORE invoking `.cancel()` so a concurrent retry can register without contention.
- **Cancellation observable in Rust unit tests** (form b for AC-180-04): the fake adapter's method body `tokio::select!`s on the cancel-token's `cancelled()` future against a `tokio::time::sleep(Duration::from_secs(10))` future and returns `AppError::Cancelled` on the cancel branch. The test triggers the trait method, sleeps 100 ms, calls `.cancel()` on the token, and asserts the trait method returns `AppError::Cancelled` within (say) 200 ms. This proves cooperative cancellation; it does NOT prove server-side stop-of-work, which is what the operator runbook covers.
- **History "cancelled" status rendering**: visual treatment is Generator's choice within the spec's "calm secondary, not destructive" tone. Recommended: a neutral muted background (e.g. `bg-muted` or `bg-secondary/50`) and a "—" or "↩" icon (icon Generator's choice). Test asserts the `"cancelled"` branch produces a different visual class from `"error"` (which is `bg-destructive` per `QueryLog.tsx:110`).
- **Per-vector retry test (AC-180-05)**: each of the four surface tests includes a "trigger → cancel → re-trigger" sequence. The test uses `vi.useFakeTimers()` and `vi.advanceTimersByTime(1100)` to cross the 1-second threshold, fires the click on `data-testid="async-cancel"`, advances timers again, re-triggers the surface's fetch, and asserts:
  - `screen.queryByTestId("async-cancel")` returns `null` after cancel completes (overlay disappears).
  - The second attempt's resolution path renders its data (mocked response).
  - No "cancelled" toast or error message appears post-retry.
  - `state.query_tokens` (in a test-scoped backend mock) has one entry during the second attempt and zero entries after second-attempt completion.
- **Tests use user-visible queries** (`getByRole`, `getByText`, `getByTestId`) per project convention. Mock `tauri::invoke` boundaries with the existing test patterns (`src/test-utils/` if present, or the inline pattern used in current `*.test.tsx` files).
- **Each new test gets a Reason + date comment** per the user's auto-memory `feedback_test_documentation.md` (2026-04-28), e.g. `// AC-180-01 — overlay appears after 1s threshold; date 2026-04-30.`
- **Coverage**: ≥ 70% line coverage on the new shared component, the new hook (if any), and the touched lines of the four surfaces, the queryHistoryStore widening, and the four extended Rust trait methods. Project convention; AC-GLOBAL-04.
- **Visual direction**: progress overlay shares the existing loading-overlay's mood (subtle, non-distracting, `bg-background/60`). Cancel control is a calm secondary action, not destructive in tone. Copy: `"Cancel"`.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/feedback/AsyncProgressOverlay.test.tsx src/hooks/useDelayedFlag.test.ts src/stores/queryHistoryStore.test.ts src/components/datagrid/DataGridTable.test.tsx src/components/document/DocumentDataGrid.test.tsx src/components/schema/StructurePanel.test.tsx src/components/rdb/DataGrid.test.tsx src/components/query/QueryLog.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` — runs the new shared-component test, the new hook test (if any), the queryHistoryStore widening test, the four surface tests, and the QueryLog rendering test. Must be green; AC-180-0X covered by `[AC-180-0X]`-prefixed test names.
2. `pnpm vitest run` — full Vitest suite. Must be green (no regression). Watch existing tests on `cancel_query` callers, `queryHistoryStore` consumers, and the four surfaces — none should require text-string edits beyond optional new cases.
3. `pnpm tsc --noEmit` — strict-mode type check. Zero errors. Status-union widening is the load-bearing check.
4. `pnpm lint` — ESLint. Zero errors.
5. `cargo build --manifest-path src-tauri/Cargo.toml` — clean build.
6. `cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings` — zero warnings.
7. `cargo test --manifest-path src-tauri/Cargo.toml` — all Rust unit tests green, including the new fake-adapter cancel-token tests covering AC-180-04 form (b). Project's canonical cargo test invocation per `package.json:scripts.test:docker` is `cd src-tauri && cargo test --test schema_integration --test query_integration`; for this sprint, the simpler `cargo test --manifest-path src-tauri/Cargo.toml` (which runs unit tests embedded in `src/`) is the required gate, and the docker-compose integration tests are NOT required (they need live DBs).
8. Static (Generator-recorded, Evaluator re-runs):
   - File inspection: `src/components/feedback/AsyncProgressOverlay.tsx` exists; exports a typed React component with the prescribed props; `data-testid="async-cancel"` is literally present in JSX. Command: `grep -nE 'data-testid="async-cancel"|preventDefault|stopPropagation' src/components/feedback/AsyncProgressOverlay.tsx`.
   - File inspection: NEW ADR exists. Command: `test -d memory/decisions/0018-async-cancel-policy && test -f memory/decisions/0018-async-cancel-policy/memory.md && head -30 memory/decisions/0018-async-cancel-policy/memory.md`. Must show frontmatter (`status: Accepted`, `date: 2026-04-30`), the body sections (motivation / decision / per-adapter behavior / trade-offs / reversibility).
   - File inspection: ADR index updated. Command: `grep -n '0018' memory/decisions/memory.md`. Must show a row in the "활성 결정" table for ADR-0018.
   - Trait change: `grep -nE 'fn (query_table_data|get_columns|get_table_indexes|get_table_constraints|find|aggregate|infer_collection_fields|list_collections)' src-tauri/src/db/mod.rs` shows each method's signature includes `cancel: Option<&'a CancellationToken>` (or equivalent named parameter).
   - Frontend AC-180-06 uniformity audit: `grep -rn 'data-testid="async-cancel"' src/components/` shows usages in the four host surfaces (or, if the host surfaces only consume `<AsyncProgressOverlay>`, the testid lives in the shared component and the four surfaces' tests assert presence via `getByTestId`).
   - Sprint 176 hardening preserved: `grep -nE 'preventDefault|stopPropagation' src/components/feedback/AsyncProgressOverlay.tsx | wc -l` shows at least 8 occurrences (4 handlers × 2 calls each).
9. Operator browser smoke (operator-driven step list — Generator records observation, Evaluator re-runs):
   1. `pnpm tauri dev`.
   2. With a PostgreSQL connection: open a table, observe quick refetch — overlay does NOT appear (sub-second). Open a slow table or run a slow `query_table_data` (e.g. on a multi-million-row table with no LIMIT) — overlay appears at ~1s with the Cancel button.
   3. Click Cancel; confirm `loading` clears; confirm previous data (refetch case) or empty (initial-fetch case) renders.
   4. Re-trigger the same fetch; confirm the second attempt resolves cleanly with its own data.
   5. Open the SQL tab, run `SELECT pg_sleep(5)`, after ~1s click Cancel; confirm: `pg_stat_activity` view shows no remaining `pg_sleep` query (operator can verify in psql); QueryLog shows the entry with `"cancelled"` status visualisation (calm muted, not destructive).
   6. With a Mongo connection: open a large collection, run an aggregate that takes ≥3s, after ~1s click Cancel; confirm: client `loading` clears; ideally check `db.currentOp()` server-side to confirm the operation is gone (driver-version-dependent — if the bundled Mongo Rust driver supports `killOperations`, the op disappears; otherwise the cooperative cancel returns the future locally and the server completes the work).
   7. Open a connection's structure panel during a slow schema fetch; confirm overlay+Cancel appears at ~1s, click Cancel, confirm idle state restoration.
   8. At min window size 1024×600, confirm overlay+Cancel button does not visually clip; record observation in `findings.md`.

### Required Evidence

- Generator must provide:
  - Changed files (full list with one-line purpose each — at minimum: `AsyncProgressOverlay.tsx`, `AsyncProgressOverlay.test.tsx`, `useDelayedFlag.ts` + `.test.ts` (if hook), four surface `*.tsx` + their `*.test.tsx`, `queryHistoryStore.ts` + `.test.ts`, `QueryLog.tsx` + `GlobalQueryLogPanel.tsx` + their tests, `src-tauri/src/db/mod.rs`, `src-tauri/src/db/postgres.rs`, `src-tauri/src/db/mongodb.rs`, the relevant `src-tauri/src/commands/rdb/*.rs` and `src-tauri/src/commands/document/*.rs` files, `memory/decisions/0018-async-cancel-policy/memory.md`, `memory/decisions/memory.md` index, `findings.md`, `handoff.md`).
  - Vitest output for the targeted test files, with `[AC-180-0X]`-tagged test names visible.
  - Cargo build, clippy, test stdouts (the test stdout must show the new fake-adapter cancel-token tests passing — name them e.g. `test_query_table_data_honors_cancel_token`, `test_find_honors_cancel_token`).
  - For AC-180-01: explicit fake-timers test on `AsyncProgressOverlay` (sub-1s no-render, post-1s render) AND a per-surface test confirming the wiring.
  - For AC-180-02: per-surface Vitest test that simulates cancel mid-fetch and asserts loading clears + pre-fetch state restored.
  - For AC-180-03: queryHistoryStore unit test inserting a `"cancelled"` entry; QueryLog/GlobalQueryLogPanel rendering test for the `"cancelled"` branch.
  - For AC-180-04: Rust unit test on at least one fake `RdbAdapter` and one fake `DocumentAdapter` showing the cancel-token cooperative observation; ADR file inspection; operator runbook in `findings.md` covering the live-DB PG `pg_sleep(N)` cancel and the live-DB Mongo long-aggregate cancel.
  - For AC-180-05: per-surface Vitest cancel→retry test asserting (a) overlay disappears post-cancel, (b) second attempt's data renders, (c) registry has no stale entry post-second-attempt (asserted via the test-scoped backend mock if the Rust registry is exposed through the test harness; otherwise asserted via "no stuck loading" only and explicitly noted in `findings.md`).
  - For AC-180-06: a single Vitest case (or a per-surface case) asserting `screen.getByTestId("async-cancel")` resolves on each of the four surfaces under long-async state, accessible name is `"Cancel"`, button is `tabIndex >= 0` (or naturally focusable as a `<button>`).
  - `findings.md` recording: shared-component decision (location/shape), threshold mechanism (hook vs inline), cancel-command decision (`cancel_query` reused vs new `cancel_operation`), cancel-registry decision (single vs per-paradigm — single is the default unless rationale dictates otherwise), Mongo driver cancel observations (does the bundled driver's version expose `killOperations`?), AC→test mapping, four-surface accessible-name uniformity audit, manual operator smoke replay log, evidence index.
  - `git diff src/types/connection.ts` shows no edit (Paradigm type unchanged invariant).
  - `git diff src-tauri/src/commands/rdb/query.rs` shows the `cancel_query` wire signature unchanged (Generator may add a deprecation/aliasing comment but the input/output types stay).
- Evaluator must cite:
  - Concrete evidence for each AC pass/fail (test name + assertion text or ADR/findings line range).
  - Re-run of `pnpm vitest run …` showing AC-tagged cases pass.
  - Re-run of `cargo build / clippy / test` showing zero warnings, all tests pass.
  - Re-run of the static checks at Verification Plan §Required Checks #8.
  - Confirmation that the four surface tests do NOT delete or modify existing assertions (only add new cases).
  - Confirmation that `it.skip` / `it.todo` / `xit` are absent from touched test files (`grep -nE 'it\.(skip|todo)|xit\(' <touched-test-files>`).
  - Confirmation that `Paradigm` type at `src/types/connection.ts:15` is unchanged (`git diff src/types/connection.ts` empty).
  - Confirmation that ADR-0018 frontmatter is present and the body covers the four required sections (motivation / decision / per-adapter behavior / trade-offs / reversibility); the ADR index `memory/decisions/memory.md` has a new row.
  - Any missing or weak evidence (e.g. AC-180-04 form (b) Rust test claimed but not actually committed; live-DB smoke claimed but no operator runbook in `findings.md`) flagged as a P2 finding.

## Test Requirements

### Unit Tests (필수)

Each AC gets at least one Vitest scenario. Tests live in:

- `src/components/feedback/AsyncProgressOverlay.test.tsx` (new) — threshold appearance, Cancel callback, accessible name, data-testid, pointer-event hardening regression.
- `src/hooks/useDelayedFlag.test.ts` (new, if the hook exists) — fake-timer threshold semantics.
- `src/stores/queryHistoryStore.test.ts` (extend) — `"cancelled"` status entry insert + filter + selector.
- `src/components/datagrid/DataGridTable.test.tsx` (extend) — overlay appearance threshold, cancel reverts to pre-fetch, retry succeeds, Cancel button accessible-name.
- `src/components/document/DocumentDataGrid.test.tsx` (extend) — same.
- `src/components/schema/StructurePanel.test.tsx` (extend) — same; cancel aborts the in-flight schema fetch (whichever method is active).
- `src/components/rdb/DataGrid.test.tsx` (extend) — refetch-path overlay; first-fetch path keeps existing skeleton (no behavior change).
- `src/components/query/QueryLog.test.tsx` (extend) — `"cancelled"` rendering branch.
- `src/components/query/GlobalQueryLogPanel.test.tsx` (extend) — same.
- `src-tauri/src/db/postgres.rs` (extend `#[cfg(test)] mod tests`) — fake-PG-adapter cancel-token tests on the four extended methods (or on a representative subset with a justified rationale recorded in `findings.md` if the implementations share a single `select!` shape; minimum: at least one per method, OR one per method using a parameterized helper).
- `src-tauri/src/db/mongodb.rs` (extend `#[cfg(test)] mod tests`) — fake-Mongo-adapter cancel-token tests on the four extended methods (same minimum).

Each new test carries a Reason + date comment per the 2026-04-28 feedback rule.

- **`AsyncProgressOverlay.test.tsx` cases** (AC-180-01 + AC-180-02 + AC-180-06):
  - `[AC-180-01a] overlay does not render before threshold` — render with `visible={true}` (the prop is the post-threshold flag) and a sub-1s simulated state, assert `screen.queryByTestId("async-cancel")` returns `null`.
  - `[AC-180-01b] overlay renders after threshold` — render with `visible={true}` and an elapsed threshold, assert `screen.getByTestId("async-cancel")` is present.
  - `[AC-180-02a] Cancel button click invokes onCancel` — render with `visible={true}` and `onCancel={vi.fn()}`, click Cancel, assert mock called once.
  - `[AC-180-06a] Cancel button has stable accessible name` — render, assert `screen.getByRole("button", { name: "Cancel" })` resolves.
  - `[AC-180-06b] overlay swallows pointer events on background` — render with `visible={true}`, fire `mouseDown` on the overlay region (not the button), assert the event's `preventDefault` and `stopPropagation` were called (via spy or by asserting a parent `onMouseDown` handler did NOT fire). Sprint 176 regression guard.

- **`useDelayedFlag.test.ts` cases** (AC-180-01 — if hook exists):
  - `[AC-180-01c] returns false before delay elapsed` — `vi.useFakeTimers()`; `renderHook(() => useDelayedFlag(true, 1000))`; advance 500 ms; assert hook returns `false`.
  - `[AC-180-01d] returns true after delay elapsed` — same setup; advance 1100 ms; assert `true`.
  - `[AC-180-01e] resets to false synchronously when active toggles to false` — render with `active=true`, advance past threshold (returns `true`), rerender with `active=false`, assert hook returns `false` synchronously.

- **`queryHistoryStore.test.ts` cases** (AC-180-03):
  - `[AC-180-03a] insert cancelled entry preserves status field` — call `addHistoryEntry({ ..., status: "cancelled" })`; read `globalLog[0].status === "cancelled"`.
  - `[AC-180-03b] cancelled entries flow through filteredGlobalLog` — assert `filteredGlobalLog()` returns the cancelled entry.
  - Type-level assertion (compile-time) — TS rejects `status: "frobnicated"` (negative type test, not a runtime check; covered by `pnpm tsc --noEmit`).

- **Per-surface test extensions** (AC-180-01 + AC-180-02 + AC-180-05 + AC-180-06):
  - `[AC-180-01-<surface>] overlay appears after threshold during long fetch` — render the surface, mock the IPC call to hang, advance fake timers past 1s, assert `getByTestId("async-cancel")` resolves.
  - `[AC-180-02-<surface>] Cancel reverts state` — render surface with prior data (refetch case) or initial state, trigger fetch, advance timers, click Cancel, assert `loading=false` synchronously and prior content (refetch) or empty content (initial-fetch) is visible.
  - `[AC-180-05-<surface>] cancel→retry succeeds with second-attempt data` — trigger fetch, cancel, immediately retrigger fetch, mock the second IPC call to resolve with distinct data, assert second attempt's data renders and overlay does not appear from a stale cancel-token.
  - `[AC-180-06-<surface>] Cancel button uniform across surfaces` — assert the button's accessible name is `"Cancel"` on each of the four surfaces (or, equivalently, a single cross-surface test that mounts all four and asserts uniformity).

- **`QueryLog.test.tsx` / `GlobalQueryLogPanel.test.tsx` extensions** (AC-180-03 visual rendering):
  - `[AC-180-03c] cancelled entry renders with calm muted treatment` — seed history with a `"cancelled"` entry, render the panel, assert the entry's container className includes a non-`bg-destructive` class (e.g. `bg-muted` or the Generator's chosen calm class), AND does NOT include `bg-destructive`.

- **Rust `postgres.rs` / `mongodb.rs` cancel-token tests** (AC-180-04 form b):
  - `test_query_table_data_honors_cancel_token` (and equivalents for `get_columns`, `get_table_indexes`, `get_table_constraints`) — `tokio::test`; create a fake `PostgresAdapter` instance whose method awaits `tokio::select!` on cancel vs a long sleep; spawn the call as a task; cancel the token after 100 ms; assert the task returns `AppError::Cancelled` (or the project's existing error variant) within 200 ms.
  - `test_find_honors_cancel_token` (and equivalents for `aggregate`, `infer_collection_fields`, `list_collections`) — same shape on `MongoAdapter`.

- **Existing-test impact**: existing component/store tests covering RDB-default rendering and `cancel_query` roundtrip continue to pass without text-string edits to assertions. Generator confirms by running existing files unmodified first; if any test breaks (e.g. a `status === "success" || status === "error"` exhaustive type-check now warns about `"cancelled"`), the rationale and rewrite go into `findings.md`. Expected: zero existing tests break (the widening is additive at the type level; runtime values continue to be `"success"` / `"error"` until a cancel path is exercised).

### Coverage Target

- 신규/수정 코드: 라인 70% 이상 (AC-GLOBAL-04, project convention).
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] Happy path — long fetch on each surface produces the overlay at ~1s; sub-second fetch produces no overlay.
- [x] 에러/예외 — cancel mid-flight returns idle state without error toast; second-attempt error after a successful cancel surfaces normally (cancel does not poison the next op).
- [x] 경계 조건 — sub-second fetch (<1s) never shows overlay; rapid cancel→retry cycles do not leak tokens; threshold boundary (exactly 1000 ms) is deterministic under fake timers.
- [x] 동시성/경쟁 — two simultaneous fetches on different surfaces register distinct query_ids; cancelling one does not affect the other.
- [x] 상태 전이 — idle → loading (sub-1s, no overlay) → done (no overlay surface ever rendered); idle → loading → overlay (post-1s) → cancelled → idle; idle → loading → overlay → cancelled → idle → loading → done.
- [x] 기존 기능 회귀 없음 — `cancel_query` wire signature unchanged; `execute_sql` cancel-token path unchanged; Sprint 176 pointer-event hardening preserved; queryHistoryStore existing entries continue to load.

## Test Script / Repro Script

Manual replay for the Evaluator:

1. `pnpm install` (if not already); `cargo fetch --manifest-path src-tauri/Cargo.toml` (if cargo cache is cold).
2. `pnpm vitest run src/components/feedback/AsyncProgressOverlay.test.tsx src/hooks/useDelayedFlag.test.ts src/stores/queryHistoryStore.test.ts src/components/datagrid/DataGridTable.test.tsx src/components/document/DocumentDataGrid.test.tsx src/components/schema/StructurePanel.test.tsx src/components/rdb/DataGrid.test.tsx src/components/query/QueryLog.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` — confirm all `[AC-180-0X]` cases pass.
3. `pnpm vitest run` — confirm full suite still green.
4. `pnpm tsc --noEmit` — zero errors.
5. `pnpm lint` — zero errors.
6. `cargo build --manifest-path src-tauri/Cargo.toml` — clean build.
7. `cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings` — zero warnings.
8. `cargo test --manifest-path src-tauri/Cargo.toml` — confirm cancel-token unit tests pass (look for `test_query_table_data_honors_cancel_token`, `test_find_honors_cancel_token`, etc. in stdout).
9. `grep -nE 'data-testid="async-cancel"|preventDefault|stopPropagation' src/components/feedback/AsyncProgressOverlay.tsx` — confirm shared overlay carries the testid and hardening calls.
10. `test -d memory/decisions/0018-async-cancel-policy && head -30 memory/decisions/0018-async-cancel-policy/memory.md` — confirm ADR file with frontmatter + sections.
11. `grep -n '0018' memory/decisions/memory.md` — confirm ADR index updated.
12. `grep -nE 'fn (query_table_data|get_columns|get_table_indexes|get_table_constraints|find|aggregate|infer_collection_fields|list_collections)' src-tauri/src/db/mod.rs` — confirm trait methods carry the `cancel: Option<&'a CancellationToken>` parameter.
13. `grep -nE 'it\.(skip|todo)|xit\(' src/components/feedback/AsyncProgressOverlay.test.tsx src/components/datagrid/DataGridTable.test.tsx src/components/document/DocumentDataGrid.test.tsx src/components/schema/StructurePanel.test.tsx src/components/rdb/DataGrid.test.tsx src/stores/queryHistoryStore.test.ts` — confirm empty (skip-zero gate).
14. `git diff src/types/connection.ts` — confirm `Paradigm` type unchanged.
15. `git diff src-tauri/src/commands/rdb/query.rs` — confirm `cancel_query` wire signature unchanged (no input/output type drift).
16. `pnpm tauri dev`, follow the operator browser smoke step list in Verification Plan §Required Checks #9.
17. Open `docs/sprints/sprint-180/findings.md` — confirm sections: shared-component decision, threshold-mechanism decision, cancel-command decision, cancel-registry decision, Mongo driver cancel observations, AC→test mapping, four-surface accessible-name uniformity audit, manual operator smoke replay log, evidence index.

## Ownership

- Generator: single agent (one Generator role within the harness).
- Write scope:
  - `src/components/feedback/AsyncProgressOverlay.tsx` (new)
  - `src/components/feedback/AsyncProgressOverlay.test.tsx` (new)
  - `src/hooks/useDelayedFlag.ts` + `.test.ts` (new, conditional)
  - `src/components/datagrid/DataGridTable.tsx` (consume shared overlay; cancel wiring)
  - `src/components/document/DocumentDataGrid.tsx` (consume shared overlay; cancel wiring)
  - `src/components/schema/StructurePanel.tsx` (consume shared overlay; cancel wiring)
  - `src/components/rdb/DataGrid.tsx` (refetch-path consume; cancel wiring)
  - The four surfaces' `*.test.tsx` (extend in place)
  - `src/stores/queryHistoryStore.ts` (status-union widening)
  - `src/stores/queryHistoryStore.test.ts` (cancelled-case)
  - `src/components/query/QueryLog.tsx`, `src/components/query/GlobalQueryLogPanel.tsx` (cancelled rendering branch)
  - The two QueryLog tests (extend in place)
  - `src-tauri/src/db/mod.rs` (trait surface extension)
  - `src-tauri/src/db/postgres.rs` (cancel-token reception on the four extended methods + unit tests)
  - `src-tauri/src/db/mongodb.rs` (cancel-token reception on the four extended methods + unit tests)
  - `src-tauri/src/commands/rdb/query.rs`, `src-tauri/src/commands/rdb/schema.rs` (or wherever the four extended methods are exposed as commands; Generator confirms during inventory) — register cancel-token in `query_tokens`.
  - `src-tauri/src/commands/document/browse.rs`, `src-tauri/src/commands/document/query.rs` (same pattern for Mongo)
  - `memory/decisions/0018-async-cancel-policy/memory.md` (new ADR)
  - `memory/decisions/memory.md` (index update — add ADR-0018 row)
  - `docs/sprints/sprint-180/findings.md` (new)
  - `docs/sprints/sprint-180/handoff.md` (sprint deliverable; standard harness output)
- Untouched: `CLAUDE.md`, the rest of `memory/` (only the decisions index and the new ADR are written), `src/types/connection.ts` (the `Paradigm` type is read, not modified), `src/types/` files outside `connection.ts`, sprints 176 / 177 / 178 / 179 spec/contract/brief/findings/handoff/labels-audit, `src/lib/strings/` (Sprint 179 is shipped), `package.json` (no new runtime dependency), `src-tauri/Cargo.toml` (no new crate dependency — `tokio_util::sync::CancellationToken` is already present), any file outside the write scope above.
- Merge order: this sprint depends on Sprint 176 (already shipped — pointer-event hardening reused inside the shared overlay). It does NOT depend on Sprints 177 / 178 / 179. Land Sprint 180 last in the §A→§E series; the dictionary from Sprint 179 is NOT consumed (cancel button copy is the literal `"Cancel"`, paradigm-neutral).

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1–9 in Verification Plan)
- `memory/decisions/0018-async-cancel-policy/memory.md` exists with the prescribed body sections and frontmatter; ADR index `memory/decisions/memory.md` has a new row.
- `docs/sprints/sprint-180/findings.md` exists and includes shared-component decision + threshold mechanism + cancel-command decision + cancel-registry decision + Mongo driver observations + AC→test mapping + manual operator smoke replay log + evidence index.
- Acceptance criteria evidence linked in `docs/sprints/sprint-180/handoff.md` (one row per AC pointing to the test, evidence file, or manual smoke log entry).
