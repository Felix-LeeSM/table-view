# Sprint 153 — Evaluator Findings

## Sprint 153 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness (35%) | 9/10 | All four stores opt in on distinct channels (`tab-sync`, `mru-sync`, `theme-sync`, `favorites-sync`) with correct `SYNCED_KEYS` allowlists. `tabStore` workspace-only attach guard at `tabStore.ts:713` matches AC-153-01 verbatim and is exercised by `cross-window-store-sync.test.tsx:331` (re-imports tabStore as launcher and asserts no listener attached). `appShellStore` left un-bridged with explicit grep-anchor comment + `@deprecated` JSDoc on `AppShellScreen`/`screen`/`setScreen`. The `themeStore` post-merge subscriber (`themeStore.ts:106-119`) is justified — bridge `setState` skips actions, so DOM `data-theme` attribute would otherwise diverge — and it is loop-guarded by a `lastApplied` string cache and a referential-equality check on `resolvedMode` before pushing back. No correctness defects observed. |
| Completeness (25%) | 9/10 | All 11 ACs covered. 5 stores export `SYNCED_KEYS` (call-site grep returns exactly 5 files via `^\s*void attachZustandIpcBridge`). All 4 newly-wired stores have a SYNCED_KEYS membership regression (`tabStore` 3 cases incl. `dirtyTabIds`/`closedTabHistory` exclusions; `themeStore` 2 cases incl. `resolvedMode` exclusion; `mru`/`favorites` 1 each). TDD red-state log records 9 failed / 6 passed pre-implementation. `appShellStore.screen` deprecation chose option (b) with documented Sprint 154 retirement plan — acceptable per the contract's "deprecate or window-scope" wording, though option (a) was preferred. |
| Reliability (20%) | 8/10 | Error path coverage solid: 4 malformed-payload assertions per channel (`null`, garbage string, missing `state`, `null` state, unknown keys), all asserted as no-throw + state preserved. Loop guard inherits Sprint 151's `applyingInbound` flag plus per-store distinct `originId` (`getCurrentWindowLabel() ?? "unknown"`), honoring Sprint 152 advisory #1. The `themeStore` subscriber's recursive `setState` (line 116) is guarded by `state.resolvedMode !== resolved` so it cannot loop. One residual fragility: the `themeStore` subscriber's `lastApplied` cache key is `themeId|mode` only — a contributor adding a third DOM-bound field would have to extend it. Documented in handoff residual risks. |
| Verification Quality (20%) | 9/10 | All 13 verification-plan checks executed independently and pass: `cross-window-store-sync.test.tsx` 15/15, per-store suite 129/129, `connection-sot.ac142.test.tsx` 6/6, full suite **2293 passed + 5 todo** (matches Generator's claim and exceeds 2271 baseline by 22 new), `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0, skip-grep on touched files empty (only matches in untouched `window-lifecycle.ac141.test.tsx`), `git diff` on protected scope empty except for the two excepted files. The two excepted-file diffs (`App.test.tsx`, `window-bootstrap.test.tsx`) are TRULY mock-only — single `emit: vi.fn(() => Promise.resolve())` line plus a comment block; no production logic, no test logic touched. TDD red-state log present and correctly maps the 9 failures to the wirings introduced. |
| **Overall** | **8.75/10** | Pass with all 4 dimensions ≥ 7. |

## Verdict: **PASS**

## Sprint Contract Status (Done Criteria)

- [x] **AC-153-01** — `tabStore.ts` opts into `tab-sync` with workspace-only attach guard at `tabStore.ts:713-721` (`if (getCurrentWindowLabel() === "workspace")`). Tested by `cross-window-store-sync.test.tsx:192` (workspace emit), `:227` (inbound apply), `:331` (launcher-no-attach via `vi.resetModules`+`vi.doMock`).
- [x] **AC-153-02** — `mruStore.ts` opts in symmetrically on `mru-sync` (`mruStore.ts:94-101`). Tested by `cross-window-store-sync.test.tsx:404, 422, 433`.
- [x] **AC-153-03** — `themeStore.ts` opts in symmetrically on `theme-sync` (`themeStore.ts:126-132`); post-merge DOM subscriber at `:106-119`. Tested by `cross-window-store-sync.test.tsx:453, 473, 485`.
- [x] **AC-153-04** — `favoritesStore.ts` opts in symmetrically on `favorites-sync` (`favoritesStore.ts:157-163`). Tested by `cross-window-store-sync.test.tsx:508, 527, 547`.
- [x] **AC-153-05** — `appShellStore.screen` decision recorded as option (b): `@deprecated` JSDoc on `AppShellScreen` (`:23`), `screen` field (`:42`), and `setScreen` action (`:52`); window-local; explicitly NOT bridge-wired (call-site grep verified). Sprint 154 retirement plan documented inline. Test: `cross-window-store-sync.test.tsx:570` asserts no broadcast on any sync channel.
- [x] **AC-153-06** — Each opted-in store exports a `SYNCED_KEYS` constant; each `*.test.ts` has a membership regression test (tab 3, mru 1, theme 2, favorites 1).
- [x] **AC-153-07** — `cross-window-store-sync.test.tsx` covers per-store sync direction, allowlist filtering (tab `dirtyTabIds`/`closedTabHistory` exclusion, line 254), error path (4 malformed payload variants per channel), and tab-store workspace-only semantics.
- [x] **AC-153-08** — TDD red-state proof at `docs/sprints/sprint-153/tdd-evidence/red-state.log` (9 failed / 6 passed). The 6 pre-implementation passes are no-op malformed-payload + appShell-no-broadcast cases; the 9 failures are the actual wiring proofs.
- [x] **AC-153-09** — `pnpm vitest run` 2293 PASS + 5 todo; `pnpm tsc --noEmit` exit 0; `pnpm lint` exit 0.
- [x] **AC-153-10** — `connection-sot.ac142.test.tsx` runs green (6/6).
- [x] **AC-153-11** — No new `it.skip` / `this.skip()` / `it.todo` / `xit` / `describe.skip`. Skip-grep on touched files returns empty; the only matches are the pre-existing Sprint 150 baseline in `window-lifecycle.ac141.test.tsx`, which was NOT touched.

## Verification Evidence Summary

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx` | 15/15 PASS |
| 2 | `pnpm vitest run src/stores/{tab,mru,theme,favorites,appShell}.test.ts` | 129/129 PASS |
| 3 | `pnpm vitest run src/__tests__/connection-sot.ac142.test.tsx` | 6/6 PASS |
| 4 | `pnpm vitest run` (full suite) | 152 files; **2293 passed + 5 todo** (≥ 2271 + 22 new — matches Generator claim exactly) |
| 5 | `pnpm tsc --noEmit` | exit 0 |
| 6 | `pnpm lint` | exit 0 |
| 7 | skip/todo grep on touched files | empty |
| 8 | `git diff HEAD -- <Sprint 150/151/152 outputs except App.test.tsx + window-bootstrap.test.tsx>` | empty |
| 8b | `git diff HEAD -- src/App.test.tsx src/__tests__/window-bootstrap.test.tsx` | mock-only `emit: vi.fn(() => Promise.resolve())` addition + comment in each file. No production/test-logic edits. Authorized by execution brief precedent. |
| 9 | `grep -lrE "^\s*void attachZustandIpcBridge" src/stores/` | exactly 5 files (`connectionStore`, `tabStore`, `mruStore`, `themeStore`, `favoritesStore`) |
| 10 | `SYNCED_KEYS` export inspection | All 5 stores export the constant with sensible membership and inline justification. |
| 11 | `appShellStore.screen` decision | option (b) deprecate-and-narrow; `@deprecated` JSDoc on three symbols + Sprint 154 retirement plan; NOT bridge-wired (verified via call-site grep). |

## Critical Things Inspected (per evaluator brief)

1. **`emit` mock additions are TRULY mock-only.** Confirmed. Both diffs are exactly:
   - One added line: `emit: vi.fn(() => Promise.resolve()),`
   - One added comment block explaining the Sprint 152 precedent.
   No production logic, no other test edits.
2. **`tabStore` workspace-only attach guard.** Present (`tabStore.ts:713`) and tested via `vi.resetModules` + `vi.doMock` (`cross-window-store-sync.test.tsx:331-396`). The launcher-side fresh import asserts `tabs.length === 0` after a workspace-emit, proving no listener was registered.
3. **`themeStore` DOM subscriber necessity.** Genuine bug fix, not scope creep. Bridge `setState({themeId, mode})` shallow-merges and skips `setTheme`/`setMode` actions, so the DOM `data-theme` attribute would lag the store. Loop guard verified: `lastApplied` string cache + `state.resolvedMode !== resolved` referential check before pushing back.
4. **`SYNCED_KEYS` allowlist judgement.** All correct:
   - `tabStore` excludes `dirtyTabIds` (Set, non-serializable) and `closedTabHistory` (per-window undo).
   - `themeStore` excludes `resolvedMode` (per-window derived from `prefers-color-scheme`).
   - `mruStore`/`favoritesStore` have only one synced key each — no exclusions needed.
5. **`appShellStore.screen` deprecation rationale.** `@deprecated` JSDoc tags present on `AppShellScreen` type (line 16), `screen` field (line 32), and `setScreen` action (line 52). Sprint 154 retirement plan documented inline. Generator's choice of (b) over (a) justified — option (a) would have touched 7+ files outside the store-only sprint scope. Acceptable per contract wording.
6. **Test counter.** Verified `2293 passed + 5 todo` (152 test files). Matches Generator's claim exactly.
7. **Sprint 152 protected scope.** `git diff HEAD -- src/__tests__/cross-window-connection-sync.test.tsx src/stores/connectionStore.ts src/stores/connectionStore.test.ts` empty.
8. **Distinct channel names.** Verified 5 distinct channels: `connection-sync`, `tab-sync`, `mru-sync`, `theme-sync`, `favorites-sync`.

## Feedback for Generator

This implementation is high quality and merge-ready. Two non-blocking observations for future sprints:

1. **`appShellStore.screen` removal in Sprint 154**: The `@deprecated` tags carry the retirement plan but this remains a deferred chore. Make sure Sprint 154's contract explicitly lists `appShellStore.screen` removal as in-scope, with the 7+ touch targets enumerated (App.tsx, HomePage.tsx, WorkspacePage.tsx, App.test.tsx, HomePage.test.tsx, WorkspacePage.test.tsx, window-lifecycle.ac141.test.tsx, connection-sot.ac142.test.tsx). Otherwise the deprecation will rot.
   - Current: deprecation comments + JSDoc.
   - Expected (Sprint 154): field gone; `App.tsx` mounting decision driven by `getCurrentWindowLabel()`.
   - Suggestion: pin the removal task into the Sprint 154 contract's "In Scope" list now.

2. **`themeStore` subscriber generality**: The `lastApplied` cache key (`${themeId}|${mode}`) is correct today but a future contributor adding a third DOM-bound field (e.g. font-scale) would silently bypass the cache. The handoff already calls this out as a residual risk; consider extracting a tiny helper (`buildThemeCacheKey(state)`) that's the single edit point if a third field is ever added.
   - Current: inline string concat, ad-hoc cache key.
   - Expected: single source of truth for the cache key.
   - Suggestion: extract to `function applyThemeCacheKey(s: Pick<ThemeStoreState, 'themeId'|'mode'>) { return ${s.themeId}|${s.mode}; }` and use it both at `lastApplied` init and in the subscriber. ~6 LOC.

3. **`window-bootstrap.test.tsx` as a "Sprint 150 protected file"**: The execution brief authorized the mock-only edit, but the contract's protected-file list doesn't carve out the exception. This is a contract-vs-brief mismatch. If future sprints re-touch test mocks the same way, we'll have to re-evaluate the carve-out each time. Consider noting in the Sprint 154 contract that "test mocks may be edited when a new module-load side-effect requires a stub" with a one-line precedent reference.
   - Current: brief allows it, contract calls it protected.
   - Expected: a single source of truth.
   - Suggestion: in the Sprint 154 contract's Invariants, replace "X test files unchanged" with "X test files unchanged except for additive `vi.mock` stubs that compensate for new bridge subscribers; no test logic edits".

## Done Criteria Checklist

- [x] Four stores opt in (tab/mru/theme/favorites) with channel names `tab-sync` / `mru-sync` / `theme-sync` / `favorites-sync`.
- [x] `tabStore` workspace-only via attach guard `if (getCurrentWindowLabel() === "workspace")`.
- [x] Each opted-in store exports `SYNCED_KEYS`; each `*.test.ts` has a membership regression.
- [x] `appShellStore.screen` either removed or window-scoped + documented.
- [x] `cross-window-store-sync.test.tsx` covers per-store sync, allowlist filter, error path, tab workspace-only.
- [x] TDD red-state proof at `docs/sprints/sprint-153/tdd-evidence/red-state.log`.
- [x] `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` exit 0; total ≥ 2271 + N new; 5 todos retained.
- [x] `git diff HEAD <Sprint 150/151/152 outputs>` empty (modulo the two authorized mock-only edits).
- [x] `grep attachZustandIpcBridge src/stores/` (call-site form) returns exactly 5 files.

## Exit Criteria

- Open P1/P2 findings: **0**.
- All 13 required checks: **passing**.
- TDD red-state proof: **captured**.
- No new `it.skip` / `it.todo`: **confirmed**.
- 4 dimensions ≥ 7/10: **all four ≥ 8**.

**Sprint 153 is APPROVED for merge. Proceed to Sprint 154.**
