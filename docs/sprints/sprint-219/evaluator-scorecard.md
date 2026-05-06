# Sprint 219 Evaluator Scorecard

## Verdict: **PASS**

22/22 contract checks pass independently. All 5 Acceptance Criteria met. 0 P1/P2 findings.

## Scorecard (System Rubric)

| Dimension | Weight | Score | Weighted | Notes |
|---|---|---|---|---|
| **Correctness** | 35% | 9/10 | 3.15 | All 4 toast text variants byte-equivalent (3 verbatim, 1 documented `saved.name`→`draft.name` divergence with explicit spec sanction). Snapshot ordering for `removeConnection` correct (synchronous lookup BEFORE await; verified at hook lines 56-72). Store action signatures frozen; tsc exit 0. Cross-window invariant preserved (15 tests pass). 1 point withheld for the `saved.name`→`draft.name` divergence — works today (tauri.saveConnection echoes name) but introduces a documented residual risk. |
| **Completeness** | 25% | 9/10 | 2.25 | 5/5 AC pass; 22/22 contract checks pass; 6 test cases (1 above the 5 required); 14/14 sibling files frozen + main.tsx; +2 files / +6 tests delta meets the bar. 1 point withheld for the contract check 14 strict-vs-generous reading: the spec explicitly mandates 3 selectors in the hook, but the contract check 14 says "0 매치" across `src/components/` AND `src/hooks/` — Generator made the only consistent choice (exclude the new hook), which I endorse, but a stricter Planner could rewrite check 14 to be unambiguous. |
| **Reliability** | 20% | 9/10 | 1.80 | Hook is pure orchestration — 0 new effects / listeners / subscriptions / timers (verified). Store throw path tested (test #5 pins toast count = 0). Snapshot ordering pinned by test #6 (regression guard for future drift). `useCallback` deps complete (storeAdd/storeUpdate/storeRemove are stable Zustand action refs; `useConnectionStore.getState` is module-static). Cross-window race documented in handoff.md § Residual Risk #2. 1 point withheld for the `updateConnection` saved.name divergence: a future backend normalization step would silently break byte-equivalence — Generator proposed P10 step 5 mitigation but didn't add a guard (e.g. dev-mode invariant check). |
| **Verification Quality** | 20% | 10/10 | 2.00 | Generator ran all 22 checks, captured exit codes, and produced concrete evidence in handoff.md. Independent re-run confirmed all 22. Test mocks match `useConnectionLifecycle.test.ts` baseline pattern verbatim — leakage 0. The single bonus test case (#6 — name-snapshot ordering) is exemplary defensive testing for an invariant that would silently fail under refactoring. |
| **Overall (weighted)** | 100% | **9.20/10** | | All dimensions ≥ 7. Weighted total = 0.35×9 + 0.25×9 + 0.20×9 + 0.20×10 = 3.15 + 2.25 + 1.80 + 2.00 = **9.20**. |

PASS_THRESHOLD = 7.0. **All 4 dimensions ≥ 7. Weighted score 9.20.** **PASS.**

## Sprint Contract Status (Done Criteria)

- [x] AC-01 — store body shrink: `import { toast }` removed; 3 `toast.success(...)` removed; toast-only `removed` lookup removed. -11 LOC. `grep -c 'toast'` = 0.
- [x] AC-02 — hook surface: `useConnectionMutations` named export with 3 methods byte-equivalent to store action signatures. 0 new effects / listeners.
- [x] AC-03 — hook test ≥ 5 cases: 6 pass. `vi.hoisted` + factory mock pattern matches `useConnectionLifecycle.test.ts`.
- [x] AC-04 — 2 component swap: ConnectionDialog (2-key destructure) + ConnectionItem (1-key destructure). 0 consumer-side `useConnectionStore((s) => s.[mutator])` matches.
- [x] AC-05 — invariants + sibling diff = 0: 14 sibling files + main.tsx all 0; cross-window regression 15/15 pass; store action signatures frozen.

## 22 Contract Checks Results

| # | Result | # | Result | # | Result | # | Result |
|---|---|---|---|---|---|---|---|
| 1 | PASS | 7 | PASS | 13 | PASS | 19 | PASS |
| 2 | PASS | 8 | PASS | 14 | PASS* | 20 | PASS |
| 3 | PASS | 9 | PASS | 15 | PASS | 21 | PASS |
| 4 | PASS | 10 | PASS | 16 | PASS | 22 | PASS |
| 5 | PASS | 11 | PASS | 17 | PASS | | |
| 6 | PASS | 12 | PASS | 18 | PASS | | |

\* Check 14: Generous-reading PASS (consumer side = 0 matches; the 3 matches inside `src/hooks/useConnectionMutations.ts` are the migration target per spec § AC-2). Strict-reading FAIL — but spec § AC-2 mandates the 3 selectors in the hook, so the strict reading is mutually contradictory with the spec. Recommendation for the Planner: amend check 14 to exclude `src/hooks/useConnectionMutations.ts`.

## Feedback for Generator

### P3 (informational, no action required for this sprint)

1. **Handoff LOC discrepancy** (test file)
   - Current: handoff.md says `+189 LOC` for `useConnectionMutations.test.ts`
   - Actual: `wc -l` reports 217 lines
   - Suggestion: post-sprint, regenerate handoff stats from final files (e.g. `wc -l <file> | awk '{print $1}'`) rather than estimating mid-implementation. Non-load-bearing for this sprint, but the harness depends on accurate handoffs.

2. **Optional dev-mode invariant for `updateConnection` divergence**
   - Current: hook uses `draft.name` because the store discards `saved` for updateConnection (residual risk #1).
   - Expected: byte-equivalence holds iff `tauri.saveConnection` echoes `name` verbatim. There is no runtime guard against a future backend change.
   - Suggestion: in a future sprint (P10 step 5 per handoff), either change the store action to return `ConnectionConfig` (and the hook to use `saved.name`), OR add a dev-mode `console.warn` if `saved.name !== draft.name`. Defer to a follow-up sprint — out of scope here.

3. **Contract check 14 wording (Planner-side)**
   - Current: check 14 says "매치 0" across `src/components/` AND `src/hooks/`, but the spec § AC-2 mandates the 3 selectors inside the new hook.
   - Expected: unambiguous wording that excludes the new hook from the search.
   - Suggestion (for Planner): rewrite check 14 to: `grep -rnE '...' src/components/ src/hooks/ | grep -v useConnectionMutations.ts` 매치 0. This is a Planner amendment, not a Generator failure.

### Strengths Observed

- Mock pattern is **identical** to the lifecycle hook test — zero invented patterns.
- Test #6 (name-snapshot ordering guard) is exemplary defensive testing.
- Removed exactly the right 11 lines from the store: 1 import + 3 toast calls + 1 toast-only `removed` lookup + 6 lines of toast-scoped WHY comments. Other store body (set / tauri / persistActiveStatuses / pickFallbackFocus / IPC bridge / initEventListeners) byte-identical.
- Documented assumptions in handoff.md § Assumptions — calibration is precise (4 explicit, 4 residual risks with mitigation paths).
- 0 P1/P2 findings. Sprint is mergeable as-is.

## Exit Criteria Status

- Open `P1`/`P2` findings: **0**
- Required checks (1-22) passing: **yes** (22/22)
- Acceptance criteria evidence linked in `handoff.md`: **yes**
- **P10 step 1 closed.** Sprint 223+ may proceed with the next P10 step (schemaStore optimistic refresh / connectionStore session persistence / IPC bridge separation).

## References

- Findings: `docs/sprints/sprint-219/findings.md`
- Handoff: `docs/sprints/sprint-219/handoff.md`
- Spec: `docs/sprints/sprint-219/spec.md`
- Contract: `docs/sprints/sprint-219/contract.md`
- Execution Brief: `docs/sprints/sprint-219/execution-brief.md`
