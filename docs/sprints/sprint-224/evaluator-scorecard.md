# Sprint 224 Evaluation Scorecard (P10 step 3a — connectionStore hydrateFromSession extraction)

Date: 2026-05-06
Rubric: System (non-UI module/refactor)
PASS_THRESHOLD: 7.0

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | Body byte-equivalent (only `set` → `useConnectionStore.setState` external entry, semantically identical). 16-method interface preserved (count = 32 — 16 decl + 16 impl). Persist 3 site / SYNCED_KEYS / IPC bridge attach byte-equivalent (grep checks 2/1/1, SYNCED_KEYS array no diff hunk). Boot ordering preserved via dynamic-import sequencing in main.tsx (verified: full suite 2728/2728 + cross-window 15/15). |
| Completeness | 9/10 | All 5 ACs satisfied. All 22 contract checks pass. 2 verbatim cases migrated + 2 partial-session edge cases added (coverage bonus, test-only). Two test-files outside explicit freeze list (`useWindowFocusHydration.test.ts`, `WorkspacePage.test.tsx`) modified — verified as structurally necessary mock-target swaps (original `vi.spyOn(getState(), "hydrateFromSession")` would never fire after production swap), no semantic shift in assertions. |
| Reliability | 9/10 | Module purity verified (0 effects/timers/listeners/subscribes). `useCallback`-only React import (allowed pattern). No new `any`, no `eslint-disable*`, no `it.only`/`it.skip`, no silent catch. Circular import between store ↔ hook safe under ESM lazy function-body evaluation (verified by tsc + full test pass). Cross-window regression untouched + passing. |
| Verification Quality | 9/10 | Generator handoff explicitly documents both unexpected test modifications under "Note on...", lists exact diff stats, and explains structural necessity. 22 checks documented with concrete results. byte-equivalence claim independently verified by character-level comparison of original `hydrateFromSession` body (lines 225-237 of HEAD) vs new `hydrateConnectionSession` body (lines 36-48). Boot ordering safety verified by reading the import graph end-to-end. |
| **Overall** | **9.00/10** | Weighted: 9×0.35 + 9×0.25 + 9×0.20 + 9×0.20 = 9.00 |

## Verdict: PASS

## Sprint Contract Status (Done Criteria)

- [x] **AC-01 (store body shrink)**: `hydrateFromSession` body 13 LOC → 1 LOC. `git diff --stat src/stores/connectionStore.ts` shows -18 / +3 (15+ deletions). `grep Pick<ConnectionState,` = 0.
- [x] **AC-02 (module + 2 exports)**: `useConnectionSessionHydration.ts` exists. `hydrateConnectionSession` (line 36) + `useConnectionSessionHydration` (line 50) — Option C. Module purity 0 effects.
- [x] **AC-03 (module test ≥ 2 case)**: 4 cases pass. 2 verbatim case names migrated (store 0 / module 4 grep). `vi.hoisted` + factory mock pattern.
- [x] **AC-04 (caller swap 2 site)**: `getState().hydrateFromSession()` actual code calls = 0 (excl store file). 33 `hydrateConnectionSession` matches across 7 files. main.tsx + useWindowFocusHydration both swap.
- [x] **AC-05 (invariants)**: persist 3 site grep 2/1; IPC bridge attach grep 1; SYNCED_KEYS byte-equivalent; sibling diff 0 (all 11 listed files); cross-window regression 15/15; `ConnectionState.hydrateFromSession: () => void` signature preserved.

## CRITICAL FREEZE Verification

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `persistActiveStatuses(get().activeStatuses)` count | = 2 | 2 | OK |
| `persistFocusedConnId(id)` count | = 1 | 1 | OK |
| `attachZustandIpcBridge<ConnectionState>` count | = 1 | 1 | OK |
| `Pick<ConnectionState,` in store | = 0 | 0 | OK |
| SYNCED_KEYS array body byte-equivalent | yes | yes (no diff hunk for lines 90-95) | OK |
| `ConnectionState.hydrateFromSession: () => void` | preserved | preserved at line 45 | OK |

## Test File Modification Adjudication

- `src/hooks/useWindowFocusHydration.test.ts` (+27/-14, 6 spy-target swaps): **structural necessity, accepted**. Original `vi.spyOn(useConnectionStore.getState(), "hydrateFromSession")` would never fire after the production swap — production code now bypasses the store action. Modifications are mechanical mock-target migrations; all 12 case assertions byte-equivalent (call counts 1/3/0/10/1/2/2/1/1).
- `src/pages/WorkspacePage.test.tsx` (+19/-6, 2 spy-target swaps): **same structural necessity, accepted**. 2 spy-on-store assertions migrated to spy-on-module pattern via `vi.importActual` + `vi.fn(actual.hydrateConnectionSession)`. All 11 cases pass with byte-equivalent assertions.

Both files are NOT in the spec's explicit freeze list. The spec did require
`useWindowFocusHydration.ts` (production) to be modified, which broke the spy
pattern and required these test-only follow-ups. No new test cases added; no
semantic shift in assertions. Per "행동 변경 0" — production behaviour is
byte-equivalent and the tests now assert that with a spy that actually fires.

## Required Checks (22)

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run useConnectionSessionHydration.test.ts` | 4/4 pass |
| 2 | `pnpm vitest run connectionStore.test.ts` | 42/42 pass (-2 from baseline) |
| 3 | `pnpm vitest run useWindowFocusHydration.test.ts` | 12/12 pass |
| 4 | cross-window + window-lifecycle regression | 15/15 pass |
| 5 | sibling tests (Sprint 219/223 freeze) | 50/50 pass |
| 6 | `pnpm vitest run` (full suite) | 2728/2728 pass, 214 files (+2) |
| 7 | `pnpm tsc --noEmit` | exit 0 |
| 8 | `pnpm lint` | exit 0 |
| 9 | `git diff --stat src/stores/connectionStore.ts` `-` count | -18 (≥ 10) |
| 10 | `grep Pick<ConnectionState,` | 0 |
| 11 | persist 3 site grep | 2 / 1 |
| 12 | IPC bridge attach + SYNCED_KEYS byte-equivalent | 1 / preserved |
| 13 | module + module test files exist | both yes |
| 14 | named exports | both = 1 |
| 15 | `hydrateConnectionSession` matches | 33 (≥ 3) |
| 16 | legacy caller pattern (excl store) | 0 actual code calls (3 doc comments only) |
| 17 | `hydrateConnectionSession` in main.tsx + useWindowFocusHydration.ts | 3 / 2 |
| 18 | 2 verbatim case names migrated | store 0 / module 4 |
| 19 | sibling hooks freeze | all 0 |
| 20 | schemaStore + lib freeze | all 0 |
| 21 | cross-window + window-lifecycle freeze | both 0 |
| 22 | module purity / no eslint-disable / no it.only.skip / no any | all 0 |

## Feedback for Generator

No P1/P2 findings. Implementation is clean and contract-compliant. Minor procedural notes:

1. **Process — explicit handoff transparency on adjacent modifications**: Generator's
   `handoff.md` correctly flags both `useWindowFocusHydration.test.ts` and
   `WorkspacePage.test.tsx` modifications under explicit "Note on..." sections,
   explaining the structural necessity and listing diff stats. This is the
   pattern future Generators should follow for test-spy adjacencies.
   - Current: handoff documents the modifications, the rationale, and 23/23
     case pass count.
   - Expected: same — no change needed.
   - Suggestion: in future spec/contract drafts, planner can pre-declare these
     adjacencies under a "Modify (test-only mock-target swap)" subsection to
     remove audit ambiguity. This is a planner improvement, not a Generator one.

2. **Coverage bonus — partial-session edge cases**: The 2 extra cases
   (`focusedConnId only` / `activeStatuses only`) are valuable additions that
   pin down the partial-patch shape. Spec allowed "≥ 2 case", so 4 is OK.

3. **Boot path comment** (`main.tsx:46-48`): the inline comment explaining
   why the dynamic import preserves `attachZustandIpcBridge` ordering is
   load-bearing — preserve in future cleanups.

## Residual Risk

- None at P0/P1/P2.
- Cosmetic circular import (store ↔ hook) is safe under ESM lazy function-body
  evaluation. Mitigation: keep both modules' top-level code free of cross-module
  side-effect calls (current state).
