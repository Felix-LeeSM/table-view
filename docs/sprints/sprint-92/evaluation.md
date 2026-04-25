# Sprint 92 — Evaluation (Evaluator)

**Verification Profile**: `command` (file inspection + orchestrator-confirmed command outputs).
**Sprint type**: System (state model + DOM stability invariant). Using **System rubric**.

---

## Sprint 92 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 9/10 | 4-state discriminated union is implemented exactly per spec at `ConnectionDialog.tsx:50-54`. `handleTest` publishes `pending` first (`:111`) then transitions to `success` (`:115`) or `error` (`:117`). The `data-slot="test-feedback"` wrapper at `:569-572` is rendered unconditionally as a sibling JSX block (no surrounding `{cond && …}`); only the inner subtree is gated by `testResult.status` ternaries (`:573, 582, 591`). The legacy `testing: boolean` is now a pure derived value (`:76: const testing = testResult.status === "pending"`), eliminating the ambiguous (testing=true, testResult≠null) corner that motivated the sprint. The save-error block (`error` state at `:610-617`) is intentionally kept conditional and explicitly called out as out-of-scope in the comment — defensible scoping but does mean the "dialog height jump 0" guarantee is bounded to test-feedback transitions, not save-error transitions (acknowledged in residual risk). |
| **Completeness** | 9/10 | All 5 ACs traceable to specific lines (see Done Criteria below). 4-state union, always-mounted slot, pending spinner+text, `expectNodeStable` triple-snapshot, 3-click race, regression 0 — every contract line has a corresponding test case in the new "Sprint 92" describe block (`test:856-1038`). One small over-delivery: a 6th test ("removes pending content when transitioning back to success") at `test:1013-1037` — useful, not scope creep, but worth noting it duplicates part of the idle→pending→success identity case. |
| **Reliability** | 8/10 | Pending state is published synchronously before the `await` (`:111` precedes `:114`), so there is no observable window where the slot is stale during a click. Race for 3 rapid clicks is covered with deferred resolvers + identity assertion at every transition (`test:932-991`). Stale-response handling is implicit: each click overwrites `testResult` with a fresh `pending`, and the resolved value of an in-flight prior promise will overwrite a later state — this is **not** explicitly guarded (no request-id token), but the sprint contract does not require last-write-wins semantics and the existing test only asserts identity, not message correctness, across overlapping in-flight promises. Acceptable given scope, but worth flagging. |
| **Verification Quality** | 9/10 | Required checks all pass per orchestrator: `pnpm vitest run` 1654/1654, `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0. Grep checks satisfied (`data-slot="test-feedback"` at `:570`, all 4 `status: "..."` literals at `:51-54`, `Testing...` at `:589`). `expectNodeStable` is correctly imported (`test:13`) and called for the slot getter (`test:882, 913, 945`). Pending text matches `/Testing/` (`Testing...`) and lives inside the slot — verified by `slot.textContent.toContain("Testing...")` at `test:1010` and by spinner being queried via `slot.querySelector(".animate-spin")` at `test:1007`. The pending text is **not** the Test button label (button label is `"Test Connection"` at `:633`, distinct). One minor gap: jsdom `offsetHeight` cannot be measured, so AC-02 ("높이 점프 0") is enforced via DOM-identity proxy only — explicitly negotiated in the contract verification profile, but the residual risk that a class change still causes visual jump is real; flagged in findings. |
| **Overall** | **8.75/10** | All dimensions ≥ 7. Evidence is concrete and reproducible. |

---

## Verdict: **PASS**

All four dimensions ≥ 7. All 5 ACs have line-cited evidence in source and test. Required commands pass. No P1/P2 findings.

---

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** alert slot identity at mount / pending / response.
  - Source: `src/components/connection/ConnectionDialog.tsx:569-572` — `<div data-slot="test-feedback" className="border-t border-border px-4 py-3">` rendered unconditionally as a JSX sibling (no conditional wrapper).
  - Assertion: `src/components/connection/ConnectionDialog.test.tsx:882` (`const stable = expectNodeStable(getSlot)`), `:889` (`stable.assertStillSame("after pending")`), `:901` (`stable.assertStillSame("after success")`). Three snapshots, one identity.
- [x] **AC-02** 4-state discriminated union.
  - Source: `src/components/connection/ConnectionDialog.tsx:50-54` — all four literals (`"idle"`, `"pending"`, `"success"`, `"error"`) present on a `status:` field.
  - Usage: `:73-75` (initial state), `:111` (idle→pending), `:115` (success), `:117` (error), `:573, 582, 591, 596, 601` (render-time discriminator). `testing` reduced to derived (`:76`).
  - Implicit assertion: every test that drives transitions uses these literal status values; type-check passes (`pnpm tsc --noEmit` exit 0).
- [x] **AC-03** pending spinner + "Testing..." text inside slot.
  - Source: `ConnectionDialog.tsx:582-590` — `Loader2` with `animate-spin` (`:588`) and `<span>Testing...</span>` (`:589`) inside the `<div role="status" aria-live="polite">` which is itself inside the always-mounted `[data-slot="test-feedback"]` wrapper.
  - Assertion: `ConnectionDialog.test.tsx:1004-1010` — `slot.querySelector(".animate-spin")` non-null and `slot.textContent.toContain("Testing...")`. Also `:890, :919` for the in-context cases. The text is inside the slot, not on the Test button (button label = `"Test Connection"` at `:633`).
- [x] **AC-04** 3-click identity preservation.
  - Assertion: `ConnectionDialog.test.tsx:932-991` — three clicks with deferred resolvers, six identity assertions (pending + success per click), all using the same `stable` handle captured at mount. Mock `testConnection` transitions through pending→success per click via independent resolvers (`:937-942`).
  - Source path: same as AC-01 (slot remains the same JSX element across all renders).
- [x] **AC-05** Happy-path regression 0.
  - Orchestrator-confirmed: `pnpm vitest run` → 1654/1654 pass (1648 baseline + 6 new sprint-92 tests).
  - Pre-existing happy-path tests still present and passing: `test:232` (`shows success result when test connection succeeds`), `test:245` (`shows error result when test connection fails`), `test:259` (`disables Test Connection button while testing`), `test:831` (`marks Test result alert as aria-live='polite' for screen readers`).

---

## Required Verification Checks (orchestrator-confirmed)

| Check | Result |
|---|---|
| `pnpm vitest run` | 1654 / 1654 pass (90 files, 0 failures) |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `grep 'data-slot="test-feedback"\|status:.*pending\|Testing' ConnectionDialog.tsx` | 6 lines (47, 52, 109, 111, 570, 589) — slot attr + pending literal + "Testing..." all present |
| `grep "expectNodeStable\|test-feedback\|pending\|Testing" ConnectionDialog.test.tsx` | Import at `:13`, 6 new test cases in describe block at `:856-1038` |

---

## Specific Verifier Spot-Checks (per orchestrator instruction)

1. **Alert slot truly always-mounted (no conditional around `data-slot="test-feedback"`)?** **Yes.** The wrapper `<div data-slot="test-feedback" …>` at `:569-572` is a direct JSX sibling of the scrollable form container (`</div>` at `:557`) and the save-error block (`{error && …}` at `:610`). It is **not** wrapped in any `{condition && …}` or `{condition ? <div…> : null}`. Only its inner subtree is conditional via the `testResult.status === …` ternary chain at `:573, 582, 591`. Confirmed by re-reading `:555-572` directly.
2. **Is `expectNodeStable` actually imported and called for the slot getter?** **Yes.** Imported at `test:13` (`import { expectNodeStable } from "@/__tests__/utils/expectNodeStable"`). Called for the slot getter at `test:882, 913, 945` with the same `getSlot = () => document.querySelector('[data-slot="test-feedback"]') as HTMLElement` defined at `test:857-858`. `assertStillSame()` invoked 11 times across the new describe block (6 of those in the 3-click case alone).
3. **Does the union include all 4 literal states?** **Yes.** `ConnectionDialog.tsx:50-54` has `{ status: "idle" } | { status: "pending" } | { status: "success"; message: string } | { status: "error"; message: string }`. All four literals present and unique; success/error carry a `message: string` per spec.
4. **Is the pending text inside the slot, not on the Test button?** **Yes.** The button label at `:633` is `"Test Connection"` (no "Testing" text on the button at all — only `<Loader2>` swaps in via the `testing` derived flag at `:628-632`). The "Testing..." span at `:589` lives inside the `<div role="status">` which lives inside the `[data-slot="test-feedback"]` wrapper. Test asserts this directly: `slot.textContent.toContain("Testing...")` at `test:1010`. Pattern `/Testing/` matches.

---

## Feedback for Generator

(All items below are non-blocking polish — verdict remains **PASS**.)

1. **[Reliability — stale response]**: The current `handleTest` does not guard against an earlier in-flight `testConnection` resolving **after** a later click has set `pending` again. If click 1's promise resolves slowly while click 2 is pending, click 1's success message will overwrite the click-2 pending state.
   - Current: `handleTest` does not track a request token. The 3-click test serializes resolution order and so doesn't catch the race.
   - Expected: out-of-order resolution should be ignored, OR the contract should explicitly state "last-click semantics not required".
   - Suggestion: either add a `requestIdRef` + `if (requestIdRef.current !== myId) return` guard inside the `try` block, or add a sentence to the contract residual risk acknowledging stale-response is out of scope. This is a follow-up for a future sprint; AC-04 as written is satisfied.

2. **[Verification — height proxy]**: AC-02 of the spec ("offsetHeight 동일") is enforced via DOM identity, which is a sufficient but not equivalent proxy. A future class-name change to e.g. `min-h-[3rem]` on one branch could break visual stability without breaking identity.
   - Current: jsdom test only asserts `===` reference equality of the wrapper.
   - Expected: contract explicitly negotiated this proxy ("jsdom 한계로 identity 단언으로 대체"), so this is acknowledged.
   - Suggestion: add a tiny secondary assertion on the wrapper's className stability (`stable.initial.className` snapshot before/after) so a future regression in the `min-h-[2.25rem]` reserve gets caught at the unit level. Optional polish.

3. **[Test — duplicate coverage]**: The 6th test at `test:1013-1037` ("removes pending content when transitioning back to success state") partially overlaps with the AC-01 happy-path test at `:870-902`, which already covers idle→pending→success and asserts `Testing...` is shown during pending and the success message is shown after.
   - Current: 6 tests, last one covers a subset of test 1.
   - Expected: not a defect, but DRY-er with one fewer test.
   - Suggestion: keep as a focused regression for the "pending content cleared after success" invariant, or merge the cleanup assertion (`expect(queryByText("Testing...")).not.toBeInTheDocument()`) into the existing success test. Style preference only.

4. **[Doc — `error` slot scope]**: The save-error block at `:610-617` is intentionally kept conditional (per findings §1). This is defensible, but the comment at `:567-568` says "save-error region remains conditional because it has no pending intermediate state of its own" — this rationale is sound but means the dialog **will** still height-jump on save errors, contradicting the looser reading of "dialog height jump 0".
   - Current: implementation matches the documented decision; spec scoping (`#CONN-DIALOG-6` is specifically about test-feedback) supports it.
   - Expected: a future sprint should either reserve height for the save-error block too, or document in `RISKS.md` that height jumps on save errors are accepted.
   - Suggestion: add an entry to `docs/RISKS.md` (status: `deferred`) referencing the trade-off. Out of scope for this sprint.

5. **[Style — `border-t` on always-mounted slot]**: The wrapper at `:571` has `border-t border-border px-4 py-3` even when the slot is in the idle (placeholder) state. This means a horizontal divider line is drawn under an empty 2.25rem region in idle state — possibly creating a small visible "stripe" above the footer when the dialog is freshly opened.
   - Current: idle slot is `aria-hidden` but still has `border-t` + padding (`:571`) and a 2.25rem inner placeholder (`:579`).
   - Expected: the divider line may be intentional (consistency with the surrounding rhythm) or an oversight.
   - Suggestion: confirm in real-browser testing (out of scope for `command` profile) whether the idle border looks right. If it visually pops as an empty band, consider conditional border (`testResult.status === "idle" ? "" : "border-t border-border"`). Cosmetic, deferrable.

---

## Handoff (for `handoff.md`)

- **Sprint**: 92
- **Verdict**: PASS
- **Open P1/P2 findings**: 0
- **Required checks**: all green (vitest 1654/1654, tsc exit 0, lint exit 0)
- **AC coverage**: 5/5 with file:line citations above
- **Residual risks (for future sprints)**:
  1. Stale-response race in `handleTest` (no request-id guard).
  2. Save-error block still height-jumps; out of `#CONN-DIALOG-6` scope.
  3. jsdom cannot measure `offsetHeight`; visual height regression must be caught by Playwright e2e or human review.
- **Recommended follow-ups**:
  - Add `RISKS.md` entry for save-error height jump (deferred).
  - Optional: stable-className snapshot in `expectNodeStable` consumers to catch silent class regressions.
  - Optional: serialize `testConnection` calls with a request-id ref if last-click semantics become a real user complaint.
