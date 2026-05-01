# Sprint Contract: sprint-176

## Summary

- Goal: Prevent user pointer events on grid cells from passing through a refetch-loading overlay, and prevent the structure panel from flashing an empty-state message during its first fetch. Resolves RISK-009 + RISK-035.
- Audience: Generator (single agent) — implements; Evaluator — verifies AC + evidence.
- Owner: harness orchestrator
- Verification Profile: `mixed` (browser + command)

## In Scope

- `AC-176-01`: While an RDB grid is in the "refetch" loading state (data already present, new fetch in flight), pointer events targeting visible row cells underneath the loading overlay do not reach the underlying grid handlers (no row selection, no double-click cell-edit entry, no context menu). Verifiable via a Vitest assertion that fires `mouseDown`/`doubleClick` on the overlay region and asserts the grid's row handler was NOT invoked, AND verifiable in the running app by hovering during a slow refetch (the overlay swallows the click).
- `AC-176-02`: Every other loading overlay surfaced by the audit (currently `DocumentDataGrid` and any further matches found by grepping for absolute-positioned full-bleed loading layers in `src/components`) follows the same blocking behavior. The audit result (file path + line) is committed to the sprint findings document so the Evaluator can re-grep and confirm coverage.
- `AC-176-03`: The `StructurePanel` does NOT render any "no columns / no indexes / no constraints found" empty-state message during the time window between the panel mounting and its first fetch resolving. Verifiable via a Vitest test that mounts the panel with a never-resolving fetch and asserts none of the empty-state strings (e.g. `"No columns found"`) appear in the DOM.
- `AC-176-04`: After all changes, the loading spinner's visual position, color, size, and animation are unchanged from the current behavior — confirmed by running the app and by component snapshot tests for the DataGridTable / DocumentDataGrid loading branch.
- `AC-176-05`: `RISK-009` and `RISK-035` are moved from "active" to "resolved" in `docs/RISKS.md` with Resolution Log entries that name this sprint.

Files allowed to modify (per spec "Components to Create/Modify"):
- `src/components/datagrid/DataGridTable.tsx`
- `src/components/document/DocumentDataGrid.tsx`
- `src/components/schema/StructurePanel.tsx`
- `docs/sprints/sprint-176/findings.md` (new)
- `docs/RISKS.md`
- Sibling `*.test.tsx` files for the three components above (new tests + extensions covering AC-176-01..04).

## Out of Scope

- Anything in Sprints 177–180 (paradigm-aware QueryLog highlighting, ConnectionDialog URL normalization, paradigm vocabulary dictionary, Doherty + Goal-Gradient cancel overlay).
- General loading-state refactor — only the specific overlays surfaced by the audit are touched. No introduction of a shared `<LoadingOverlay>` component, no new props beyond what the AC require.
- Design changes to spinner visuals — color, geometry, opacity, animation, blur, and `bg-background/60` backdrop must remain pixel-identical (AC-176-04 polices this).
- Any backend / IPC change — Sprint 176 is pure DOM/state per spec §Data Flow.
- Any change to the unified progress-with-cancel overlay — that is Sprint 180's surface; Sprint 176 leaves the spinner without a cancel button.

## Invariants

- Existing spinner geometry / colors / animation unchanged (AC-176-04). Specifically: the `Loader2 ... size={24}`, `text-muted-foreground`, `animate-spin`, `absolute inset-0 z-20`, `bg-background/60` classes survive untouched. Only pointer-event behavior is added.
- The existing test count must not decrease. Every existing assertion in `DataGridTable.*.test.tsx`, `DocumentDataGrid.test.tsx`, and `StructurePanel.test.tsx` continues to pass without modification beyond extension.
- E2E suite shards already passing on `main` keep passing — no e2e selector relies on overlay click-through (spec §Edge Cases §A.4 calls this out).
- `RISK-009` and `RISK-035` reference targets in `docs/RISKS.md` are the only risks touched by this sprint; the rest of the register is untouched.
- No new `it.skip` / `it.todo` / `xit` (skip-zero gate, AC-GLOBAL-05).
- No `any` (TS strict). No `unwrap()` (Rust — N/A this sprint, but the rule stands).
- No `console.log` left in production paths.

## Acceptance Criteria

- `AC-176-01` (overlay blocks pointer events on RDB grid; refetch state)
- `AC-176-02` (every full-bleed loading overlay in `src/components` covered + listed in `findings.md`)
- `AC-176-03` (`StructurePanel` never flashes "No columns/indexes/constraints found" before first fetch settles)
- `AC-176-04` (spinner visual unchanged; snapshot or DOM-class assertion)
- `AC-176-05` (`RISK-009` + `RISK-035` moved to `resolved` in `docs/RISKS.md` with Resolution Log entries naming sprint-176)

## Design Bar / Quality Bar

- Implementation prefers minimal blast radius: prefer a single Tailwind/CSS class addition (e.g. ensuring the overlay's `<div>` intercepts pointer events while children remain interactive if/when needed) over restructuring the overlay tree. The spec is silent on mechanism; the Generator chooses but must justify in `findings.md`.
- For `StructurePanel`: a `hasFetched` boolean (or equivalent guard) is the canonical fix shape — empty-state branches are gated behind "first fetch settled" so the empty list (length 0) does not paint until at least one fetch has completed.
- Tests use user-visible queries (`getByRole`, `getByText`) per `.claude/rules/react-conventions.md` and `memory/conventions/memory.md`. `getByTestId` only when no role/text query is workable.
- Each new test gets a top-of-file or top-of-`describe` comment with the reason ("guards AC-176-0X — overlay click-through") and date — per the user's auto-memory `feedback_test_documentation.md` (2026-04-28).
- New code targets ≥ 70% line coverage on touched files (project convention; AC-GLOBAL-04).

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/datagrid/DataGridTable src/components/document/DocumentDataGrid src/components/schema/StructurePanel` — runs all sibling `*.test.tsx` for the three components. Must be green.
2. `pnpm vitest run` — full Vitest suite. Must be green (no regression).
3. `pnpm tsc --noEmit` — strict-mode type check. Zero errors.
4. `pnpm lint` — ESLint. Zero errors.
5. Audit grep — `grep -RnE 'absolute inset-0' /Users/felix/Desktop/study/view-table/src/components` and confirm every match listed in `docs/sprints/sprint-176/findings.md` either (a) is hardened by this sprint or (b) is excluded with reason.
6. Manual browser verification — `pnpm tauri dev`, open an RDB connection, trigger a refetch on a slow-fetching table, attempt to click and double-click on a row underneath the spinner, confirm no row selection / no cell-edit entry / no context menu fires. (Documented in `findings.md` under "Manual smoke".)
7. RISKS.md inspection — `grep -nE 'RISK-009|RISK-035' /Users/felix/Desktop/study/view-table/docs/RISKS.md` shows both rows in `resolved` status with Resolution Log entries citing sprint-176.

### Required Evidence

- Generator must provide:
  - Changed files (full list with one-line purpose each).
  - `docs/sprints/sprint-176/findings.md` containing:
    - The audit table — every `absolute inset-0` overlay match in `src/components` with file path + line + classification (hardened / excluded with reason).
    - Manual smoke summary (steps run, observed result, machine info).
    - Mechanism note — what code change blocks pointer events and why it preserves the spinner visuals (AC-176-04 justification).
  - Vitest output for the new + touched tests, including AC IDs each test covers (a `[AC-176-0X]` prefix in the test name is acceptable).
  - Snapshot diff or absence-of-diff proof for the spinner branch — either a serialized snapshot test added under the touched component, OR a DOM-class assertion proving `Loader2 ... animate-spin text-muted-foreground` survives at the same position.
  - `docs/RISKS.md` diff snippet showing both `RISK-009` and `RISK-035` rows transitioned to `resolved` with Resolution Log entries naming sprint-176.
- Evaluator must cite:
  - Concrete evidence for each AC pass/fail (test name + assertion text or screenshot path).
  - Re-run grep result confirming `findings.md` audit is complete.
  - Any missing or weak evidence (e.g. spinner unchanged claim without a DOM-level assertion) flagged as a P2 finding.

## Test Requirements

### Unit Tests (필수)

Each AC gets at least one Vitest scenario. All tests live in sibling `*.test.tsx` next to the component, use RTL queries, and carry a Reason + date comment per the 2026-04-28 feedback rule.

- **AC-176-01 — overlay blocks pointer events (RDB grid)**:
  - Mount `DataGridTable` with `data` populated AND `loading={true}` (refetch state).
  - Spy on the row's click / dblClick / contextmenu handler (e.g. `onRowSelect`, `onCellDoubleClick` props or the underlying handler).
  - Fire `mouseDown`, `click`, `doubleClick`, `contextmenu` on the overlay region.
  - Assert spy NOT called. Assert the overlay element is in the DOM (`role="status"` or queried by a stable selector). NEGATIVE TEST — this is the load-bearing assertion.

- **AC-176-02 — overlay blocks pointer events (DocumentDataGrid)**:
  - Same shape as AC-176-01 but on `DocumentDataGrid`.
  - Plus: `findings.md` audit entry covering every `absolute inset-0` match in `src/components` (the only currently-known matches per spec are `DataGridTable.tsx:830` and `DocumentDataGrid.tsx:325`).

- **AC-176-03 — first-render empty-state flash**:
  - Mount `StructurePanel` where `getTableColumns` returns a never-resolving Promise.
  - Assert NONE of the strings `"No columns found"`, `"No indexes found"`, `"No constraints found"` (or whatever the current `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` empty-state copy is) appear in the DOM.
  - Then resolve the promise with `[]` and assert the empty-state copy DOES appear (this proves the gate releases).

- **AC-176-04 — spinner visual unchanged**:
  - Either snapshot-test the loading branch of `DataGridTable` and `DocumentDataGrid`, OR assert by class — `Loader2` element exists with classes `animate-spin text-muted-foreground` and the wrapper carries `absolute inset-0 z-20 ... bg-background/60`. The snapshot/assertion locks in size, color, position.

- **AC-176-05 — RISKS.md transition**:
  - Not test-coverable; verified by Evaluator inspection of the diff.

### Coverage Target

- 신규/수정 코드: 라인 70% 이상 (AC-GLOBAL-04, project convention).
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] Happy path — overlay present, click swallowed; first fetch resolves with rows, content renders normally.
- [x] 에러/예외 — first fetch rejects; `StructurePanel` shows the error UI but does NOT briefly show "No columns found" first (covered by AC-176-03 + a sibling rejection test).
- [x] 경계 조건 — never-resolving fetch (AC-176-03 negative case); refetch with empty result (`data.rows = []` AND `loading = true`) — overlay still blocks; rapid double-click during refetch.
- [x] 기존 기능 회귀 없음 — when `loading === false`, all pointer events reach the row handlers as before (regression guard); existing `DataGridTable.*` and `StructurePanel.test.tsx` assertions unchanged.

## Test Script / Repro Script

Manual replay for the Evaluator:

1. `pnpm install` (if not already).
2. `pnpm vitest run src/components/datagrid/DataGridTable src/components/document/DocumentDataGrid src/components/schema/StructurePanel` — confirm all AC-tagged tests pass.
3. `pnpm vitest run` — confirm full suite still green.
4. `pnpm tsc --noEmit` — zero errors.
5. `pnpm lint` — zero errors.
6. `grep -RnE 'absolute inset-0' /Users/felix/Desktop/study/view-table/src/components` — cross-reference every match against `docs/sprints/sprint-176/findings.md`. Confirm 1:1 coverage.
7. `pnpm tauri dev`, open an RDB connection (PG seed is fine), navigate to a table with > 1k rows, click the refresh affordance, attempt to click a row while the overlay spinner is visible. Confirm: no row selection, no double-click cell-edit entry, no context menu opens. Compare spinner visuals against `main` (a `git stash` toggle is acceptable).
8. `git diff main -- docs/RISKS.md` — confirm `RISK-009` and `RISK-035` transition to `resolved` with Resolution Log entries naming sprint-176.
9. Open `docs/sprints/sprint-176/findings.md` — confirm sections: audit table, mechanism note, manual smoke, evidence index.

## Ownership

- Generator: single agent (one Generator role within the harness).
- Write scope:
  - `src/components/datagrid/DataGridTable.tsx`
  - `src/components/document/DocumentDataGrid.tsx`
  - `src/components/schema/StructurePanel.tsx`
  - Sibling `*.test.tsx` files for the three components above (new + extension).
  - `docs/sprints/sprint-176/findings.md` (new)
  - `docs/sprints/sprint-176/handoff.md` (sprint deliverable; standard harness output)
  - `docs/RISKS.md`
- Untouched: `memory/`, `CLAUDE.md`, sprints 177–180 spec/contract/brief, any file outside the write scope above.
- Merge order: this sprint merges before Sprint 180 (Sprint 180's cancel button depends on the hardened overlay surface — spec line 100).

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (1–7 in Verification Plan).
- `docs/sprints/sprint-176/findings.md` exists and includes the overlay audit + mechanism note + manual smoke evidence.
- `docs/RISKS.md` updated — `RISK-009` and `RISK-035` in `resolved` with Resolution Log entries naming sprint-176.
- Acceptance criteria evidence linked in `docs/sprints/sprint-176/handoff.md` (one row per AC pointing to the test or evidence file).
