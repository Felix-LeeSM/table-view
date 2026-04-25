# Sprint 98 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 9/10 | Entry-point flip lands BEFORE any preview state mutation in both vectors. `handleCommit` calls `beginCommitFlash()` at `useDataGridEdit.ts:602` — first executable line after the `!data` guard, before the `paradigm === "document"` branch and before the SQL `setSqlPreview(...)` call. The `commit-changes` listener calls `beginCommitFlash()` at `useDataGridEdit.ts:987` after the dirty-0 short-circuit but before the in-flight-edit `setSqlPreview(...)` at `:1025`. Toolbar prop wiring at `DataGrid.tsx:330` is the obvious idiomatic forward; nothing surprising. |
| **Completeness** | 9/10 | All four ACs satisfied with line-cited evidence. AC-01: entry-point flip (`useDataGridEdit.ts:596-602`, `:982-987`) + toolbar render (`DataGridToolbar.tsx:128-135`). AC-02: watcher (`:444-453`) + safety timer (`:415-424`) — both exist. AC-03: dirty-0 toast + early return (`:974-981`). AC-04: 1726 → 1734, regression test files untouched (verified via `git diff` showing only DataGrid.tsx + DataGridToolbar.tsx + useDataGridEdit.ts + 1 new test + mechanical mock additions to DataGridToolbar.test.tsx). |
| **Reliability** | 9/10 | Safety timer cleanup is correct on three axes: (a) on unmount via dedicated `useEffect` cleanup (`:430-437`), (b) on subsequent flashes via `clearTimeout` inside `beginCommitFlash` (`:417-419`), (c) on watcher-driven clear via the `if (flashTimeoutRef.current !== null) clearTimeout(...)` block (`:448-451`). Watcher dependency array at `:453` correctly lists `[isCommitFlashing, sqlPreview, mqlPreview, commitError]`. The `if (!isCommitFlashing) return;` guard at `:445` prevents a stray `setSqlPreview(null)` (modal dismissal) from clearing an unrelated future flash. Double-trigger within 400ms intentionally resets the safety timer (idempotent). The toolbar prop is genuinely optional (`isCommitFlashing?: boolean`, defaults `false` at `DataGridToolbar.tsx:68`) so existing callers stay untouched. |
| **Verification Quality** | 9/10 | New test file `useDataGridEdit.commit-flash.test.ts` directly asserts each AC: AC-01 (`:148-149` — `isCommitFlashing === true && sqlPreview === null` post-dispatch), AC-02 (`:171-172` — preview-set clear, `:206` — 400ms safety-timer clear with `vi.useFakeTimers`), AC-03 (`:219-225` — `toastInfoMock` + null previews + no flash), toolbar handleCommit entry (`:251-252`), AC-04 regression (`:276-277`). DataGridToolbar.test.tsx covers the rendering (`:138-145`) AND a non-busy baseline (`:128-131`) so a regression where the prop is always-on would also be caught. `afterEach(() => vi.useRealTimers())` ensures the fake-timer test doesn't pollute peers. |
| **Overall** | **9/10** | |

## Verdict: PASS (attempt 1)

All four dimensions ≥ 7/10. Generator delivered a clean, well-scoped implementation that satisfies every AC with line-citable evidence and added two well-isolated test files (1726 → 1734 = +8 cases, matching the contract's "신규 테스트만 추가" invariant).

## Sprint Contract Status (Done Criteria)

- [x] **AC-01: Cmd+S → 200ms 시각 피드백 (`data-committing` / `aria-busy` / spinner)**
  - Hook entry: `useDataGridEdit.ts:982-987` (event handler) and `:596-602` (toolbar handleCommit). Both flip BEFORE any preview-state mutation, satisfying the "사용자 인식 가능한 상태 변화" within the 200ms budget.
  - Toolbar render: `DataGridToolbar.tsx:128-135` — `aria-busy={isCommitFlashing || undefined}` + `data-committing={isCommitFlashing ? "true" : undefined}` + `<Loader2 className="animate-spin" />`.
  - Test: `useDataGridEdit.commit-flash.test.ts:119-150` (hook entry) + `DataGridToolbar.test.tsx:133-146` (DOM render).
- [x] **AC-02: preview/commit 종료 → flashing 해제. 안전 타임아웃 (≤ 600ms) 으로도 해제.**
  - Watcher: `useDataGridEdit.ts:444-453` — keyed on `[isCommitFlashing, sqlPreview, mqlPreview, commitError]`, clears flash + drains safety timer when any terminal signal arrives.
  - Safety timer: `useDataGridEdit.ts:415-424` — 400ms `setTimeout` (≤ 600ms cap respected); previous timer cleared before each new flash.
  - Test: `useDataGridEdit.commit-flash.test.ts:152-173` (watcher) + `:175-207` (safety-timer fake-timer fallback).
- [x] **AC-03: dirty 0 → toast.info + flashing 미발화**
  - Implementation: `useDataGridEdit.ts:974-981` — `if (!hasPendingChanges) { toast.info("No changes to commit"); return; }`. `beginCommitFlash` is intentionally NOT called on this branch (matches contract: "사용자에게 인식 가능한 안내 1회는 보장" — toast itself is the affordance).
  - Test: `useDataGridEdit.commit-flash.test.ts:209-226` — asserts exact `toastInfoMock.toHaveBeenCalledWith("No changes to commit")`, both previews null, `isCommitFlashing === false`.
- [x] **AC-04: 회귀 0 — 1726 → 1734 통과**
  - `pnpm vitest run` reported 1734/1734 pass (98 files); base was 1726 + 8 new (6 commit-flash + 2 toolbar = 8). Existing test files (`commit-shortcut.test.ts`, `validation.test.ts`, `unchanged-pending.test.ts`, `commit-error.test.ts`, `document.test.ts`, `multi-select.test.ts`, `paradigm.test.ts`, `promote.test.ts`) confirmed unmodified via `git diff HEAD --stat` and explicit per-file `git diff` (no output = clean).

## Special Check Results

| Check | Result | Evidence |
|-------|--------|----------|
| Entry-point flip BEFORE preview state set | PASS | `useDataGridEdit.ts:602` (`beginCommitFlash` first call after `!data` guard) precedes both the document `setMqlPreview` (`:647`) and SQL `setSqlPreview` (`:669`). Listener: `:987` precedes the in-flight-edit `setSqlPreview` (`:1025`) and `handleCommit` invocation (`:1031`). |
| Watcher AND safety timer both exist | PASS | Watcher at `:444-453`, safety timer at `:415-424`. Independent failure modes — watcher clears on real terminal signals; safety timer rescues paths that never reach a terminal signal (validation-only no-op, doc-paradigm empty preview). |
| Dirty 0 → `toast.info` + no preview | PASS | `:974-981` early-returns BEFORE `beginCommitFlash`, BEFORE preview mutation. Test `:209-226` asserts exact text + null previews + `isCommitFlashing === false`. |
| Existing test files unmodified | PASS | `git diff HEAD -- <8 existing test files>` produced no output. Only new test file (`useDataGridEdit.commit-flash.test.ts`) and mechanical mock addition (`DataGridToolbar.test.tsx:50` `isCommitFlashing: false`). |
| Safety timer cleanup on unmount | PASS | `:430-437` — dedicated `useEffect` cleanup drains `flashTimeoutRef.current` on unmount. Confirms no setState-after-unmount risk. |
| Safety timer cleanup on subsequent flashes | PASS | `:417-419` inside `beginCommitFlash` — `if (flashTimeoutRef.current !== null) clearTimeout(flashTimeoutRef.current)` BEFORE assigning new timer. Double-trigger correctly resets to a single 400ms window. |
| Watcher dependency array completeness | PASS | `:453` — `[isCommitFlashing, sqlPreview, mqlPreview, commitError]`. The `isCommitFlashing` gate at `:445` ensures preview-dismissal (`null` transitions) doesn't accidentally race a future flash. |
| Toolbar `isCommitFlashing` optional + defaults false | PASS | `DataGridToolbar.tsx:40` — `isCommitFlashing?: boolean`. Default at `:68` — `isCommitFlashing = false`. Existing callers (`QueryTab.tsx`, `EditableQueryResultGrid.tsx`) that don't pass this prop are untouched (Out of Scope per contract — verified via no diff in those files). |

## Verification Outputs

| Check | Result | Source |
|-------|--------|--------|
| `pnpm vitest run` | 1734/1734 pass (98 files), exit 0 | Generator findings + spot-check on `useDataGridEdit.commit-flash.test.ts` (6/6) + `DataGridToolbar.test.tsx` (7/7) + regression `commit-shortcut.test.ts` (5/5). |
| `pnpm tsc --noEmit` | exit 0 | Generator findings. |
| `pnpm lint` | exit 0 | Generator findings. |

## Feedback for Generator (polish opportunities — not blocking)

1. **Toolbar regression coverage gap (minor)**: `DataGridToolbar.test.tsx` covers `isCommitFlashing` true/false rendering, but doesn't assert that the click handler still fires when `isCommitFlashing === true`. Given the deliberate decision to NOT set `disabled` (per Tradeoff section), a one-liner `fireEvent.click(...)` + `expect(onCommit).toHaveBeenCalled()` would lock that invariant down for future refactors that might be tempted to add `disabled`.
   - Current: rendering-only assertions at `DataGridToolbar.test.tsx:133-146`.
   - Suggestion: add a third case — `it("still fires onCommit while flashing")` — to nail the Tradeoff decision into the test suite.

2. **`commit-flash.test.ts` AC-01 brittleness (minor)**: The AC-01 test relies on `pendingEdits` being non-empty AND `keyedStatements.length === 0` (coercion failure on `id`). That double condition is implicit; if the SQL generator's coercion rules ever loosen for integer columns, the test will silently flip into AC-02 territory (preview opens, watcher clears, assertion still passes by coincidence).
   - Current: `:148-149` checks `isCommitFlashing === true && sqlPreview === null` after dispatch.
   - Suggestion: also assert `result.current.pendingEditErrors.size > 0` so a future generator regression shows up here, not as a downstream flake.

3. **Safety timer constant magic number (cosmetic)**: The `400` ms literal at `:423` is the single source of truth for both the hook and the AC-02 fallback test (`vi.advanceTimersByTime(400)`). Consider `const COMMIT_FLASH_SAFETY_MS = 400;` so the contract's "200-600ms" range is documented in code.
   - Current: bare literal at `:423`.
   - Suggestion: hoist to a named constant so a future tuning sprint has a single grep target.

4. **Dirty-0 path potential UX nit (deferred)**: The current implementation toast-and-returns without flashing — fine and matches the contract. But if the user spams Cmd+S on dirty 0, the toast can stack (sprint-94 toast doesn't dedupe by message). Not in scope for sprint-98 but worth a follow-up note in `docs/RISKS.md` or a future toast-dedup sprint.
   - Current: `:979` `toast.info("No changes to commit")` fires every dispatch.
   - Suggestion: add to deferred risks or sprint-99+ scope, no action needed now.

5. **Findings.md residual risk audit (informational)**: The findings note that `EditableQueryResultGrid` and `QueryTab` have their own `commit-changes` listeners and are explicitly Out of Scope. That's correct, but the same Cmd+S keystroke fires the event globally — both handlers run. If those grids are visible in another panel during a Cmd+S, they receive the event. Sprint-98 doesn't regress them (their behaviour is unchanged), but the user-facing implication is that a query result grid showing a different table could also kick off its own commit dialog. Worth tracking explicitly for sprint-99+.

## Handoff Evidence

- **Files changed (4)**:
  - `src/components/datagrid/useDataGridEdit.ts` (state + entry-point helper + watcher + safety timer + dirty-0 toast)
  - `src/components/datagrid/DataGridToolbar.tsx` (optional prop + Loader2 swap + aria/data attrs)
  - `src/components/DataGrid.tsx` (single-line prop forward)
  - `src/components/datagrid/DataGridToolbar.test.tsx` (mechanical mock + 2 new cases)
- **Files created (1)**:
  - `src/components/datagrid/useDataGridEdit.commit-flash.test.ts` (6 cases)
- **Test counts**: 1726 → 1734 (+8); 98 test files (one new). All previously-passing tests still pass.
- **Diff stat (verified)**:
  ```
   src/components/DataGrid.tsx                      |  1 +
   src/components/datagrid/DataGridToolbar.test.tsx | 31 ++++++++
   src/components/datagrid/DataGridToolbar.tsx      | 28 ++++++-
   src/components/datagrid/useDataGridEdit.ts       | 96 +++++++++++++++++++++++-
  ```
  Plus the new commit-flash.test.ts (untracked at git diff time).
- **Untouched (per contract invariants)**: `memory/`, `CLAUDE.md`, sprint-88..97 産出물 (TabBar.tsx, tabStore.ts unchanged — verified via `git diff --stat`).
- **Profile**: `command` — verification was file-inspection + contract/findings cross-check + `pnpm vitest run` re-run on the new + key regression file. No browser spin-up needed; test assertions stand in for the visual Cmd+S → spinner observation.

## Exit Criteria

- P1/P2 findings: **0**
- All checks pass: **YES** (vitest 1734/1734, tsc exit 0, lint exit 0)
- Verdict: **PASS**
