# Sprint 350 — Evaluator Findings

Date: 2026-05-15
Evaluator: harness Evaluator (rigorous mode)

## Sprint 350 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Design Quality | 7/10 | Sub-tab bars match the RDB pattern verbatim (border-b primary underline, `text-xs font-medium`, `bg-secondary` chrome, `transition-colors`). Indexes panel chrome is cohesive with the design system — `text-3xs uppercase tracking-wider` primary chip, `font-mono` for name/columns, `Loader2` spinner with `aria-hidden`, error region styled via `border-destructive/40 bg-destructive/5`. Loses points for two small gaps: (a) the panel header `gap-2` is mounted at the section level but the inner `<table>` lacks any padding wrapper so the header→table transition reads slightly tight; (b) no hover/focus ring on `<th>` columns and table row hover state is absent, while the RDB index grid does paint a row-hover background. |
| Completeness | 6/10 | AC-350-01, 03, 04, 05 are met cleanly. **AC-350-02 partially fails**: the contract's literal wording requires the inner Indexes/Validator selection to "survive Structure-tab re-activation" — the implementation unmounts `MongoStructurePanel` whenever the user toggles outer Records ↔ Structure and the inner state resets to `Indexes` on remount. Generator flagged this in their handoff and argued the out-of-scope clause covers it, but the out-of-scope clause is scoped to "across app restarts", not in-session outer-toggle. See Detailed Findings §A. |
| Functionality | 7/10 | All other observable behaviors work as specified: IPC fires exactly once per `(conn, db, coll)` mount (`toHaveBeenCalledTimes(1)` asserted line 66 of `MongoIndexesPanel.test.tsx`), empty/error/loading states paint distinct testids, `aria-busy` gated on `useDelayedFlag(loading, 1000)` validated with fake timers (lines 120-159), keyboard `ArrowLeft`/`ArrowRight` toggle works. No new failures introduced; full suite delta is +0 net new failures vs the pre-existing 4 (themes + autocomplete). Roving tabindex tracks selection but `.focus()` is not called on the newly selected tab — same a11y gap that exists in the RDB tab bar, so consistency is preserved but the gap is real (Detailed Findings §C). |
| Accessibility & Responsiveness | 7/10 | `role="tablist"` on both bars with `aria-label`, `role="tab"` + `aria-selected` + roving `tabindex` on every button, `role="alert"` on IPC error region, `role="status"` on empty state, `aria-busy` gated by `useDelayedFlag` so sub-second reads do not announce busy. Misses: `aria-controls` linking each tab to its panel, no `id` on the panel region, no `<Loader2 aria-hidden />` on the spinner inside the badge wrapper (actually present — confirmed line 76). The tablist does not implement `Home`/`End` keys (WAI-ARIA APG recommends them for tablists) but the RDB bar in `MainArea` has the same gap, so consistency is preserved. |
| **Overall** | **6.75/10** | Threshold for pass is **≥7 on every dimension**. Completeness scores 6 due to the AC-350-02 outer-toggle interpretation. |

## Verdict: FAIL

The Completeness dimension scores 6/10 which is below the 7/10 threshold defined for this harness. The Generator must either:
1. Fix AC-350-02 by lifting the inner Indexes/Validator selection one level (component-local but kept across an outer Records/Structure re-mount via the parent component holding the state, or via a per-tab field on the workspace store), OR
2. Get the contract amended (explicit user/Planner approval) to weaken AC-350-02 to the inner-only interpretation.

The other AC are met; the rest of the implementation is solid.

## Sprint Contract Status (Done Criteria)

- [x] `AC-350-01` Records/Structure tablist with Records default — verified by `MainArea.test.tsx` line 842 `"AC-350-01 — renders Records/Structure sub-tab bar with Records selected by default for document paradigm"`. The test asserts the tablist has `role="tablist"`, `aria-selected="true"` on Records, `aria-selected="false"` on Structure, `mock-document-datagrid` mounted, `mock-mongo-structure` absent. Implementation: `MainArea.tsx` lines 46-94 (new document branch).
- [ ] `AC-350-02` — **PARTIAL FAIL**. Inner `mongo-structure-subsubtab-bar` exists with `Indexes` default (verified by `MongoStructurePanel.test.tsx` lines 41-61). Mouse switch verified by `MongoStructurePanel.test.tsx` lines 63-86. Keyboard ArrowLeft/Right verified by lines 88-113. **But the contract sentence "the inner selection survives Structure-tab re-activation" is not satisfied** — `MainArea.tsx` line 102-108 mounts `<MongoStructurePanel ... />` conditionally, so toggling the outer Records ↔ Structure cycle remounts the panel and `useState<SubSubTab>("indexes")` resets the inner choice. There is no test asserting outer-toggle survival because the implementation cannot satisfy it. Generator self-flagged this in their handoff line 40.
- [x] `AC-350-03` IPC exactly once + row mapping + empty + error + delayed loading — verified by `MongoIndexesPanel.test.tsx`:
  - `toHaveBeenCalledTimes(1)` on line 66.
  - Row mapping (`_id_`, `primary` chip, `email_1`, `tags_text`, `text` index_type) — lines 67-74.
  - Empty state — lines 76-90, asserts `testid="mongo-indexes-empty"` and `/no indexes/i`.
  - `role="alert"` on IPC failure — lines 92-107, asserts panel root still mounted.
  - Delayed loading gate — lines 120-159, uses `vi.useFakeTimers()`, asserts `aria-busy != "true"` initially, advances 1100ms, then asserts `aria-busy === "true"`.
  - `database === ""` no-fetch guard — lines 109-118.
- [x] `AC-350-04` Validator mounts existing `ValidatorPanel` — verified by `MongoStructurePanel.test.tsx` line 63 `"switches to the Validator sub-sub-tab on click and mounts ValidatorPanel verbatim"`, asserts `screen.getByTestId("validator-panel")` after clicking the Validator tab. `ValidatorPanel.tsx` body confirmed unmodified — `git diff HEAD -- src/components/document/ValidatorPanel.tsx` returns empty; last touching commit is `0d4671f feat(sprint-333)` from a prior sprint.
- [x] `AC-350-05` RDB regression — verified by `MainArea.test.tsx` line 904 `"AC-350-05 — RDB regression guard: rdb tab still renders the existing 'Table view' tab bar and mongo testids stay absent"`. Asserts `tablist` with `aria-label="Table view"` present, `mongo-table-subtab-bar` testid absent, `mock-mongo-structure` absent, `mock-document-datagrid` absent, `mock-datagrid` present. Plus 8 pre-existing RDB sub-tab assertions in the same file remain green.

## Verification Plan Execution

| Check | Status | Notes |
|-------|--------|-------|
| `pnpm tsc --noEmit` | Pass (exit 0) | Evaluator-rerun confirmed. |
| `pnpm lint` | Pass (exit 0) | Evaluator-rerun confirmed. |
| Focused: `MongoStructurePanel.test.tsx + MongoIndexesPanel.test.tsx + MainArea.test.tsx` | Pass | 46 tests / 3 files / 0 failures (Generator reported 46 = 4 + 5 + 37; matches). |
| RDB regression: `StructurePanel.columns.test.tsx + StructurePanel.constraints.test.tsx` | Pass | 39 tests / 2 files / 0 failures (Generator reported 39; matches). |
| Full `pnpm vitest run` | 3920 pass / 4 fail / 11 skipped | The 4 failures live in `src/themes.test.ts` (Sprint 257 syntax palette derivation, 2 tests) and `src/lib/editor/autocompleteTheme.test.ts` (autocompleteTooltipTheme, 2 tests). Both files untouched by sprint-350. Net new failures from this sprint: 0. |

## Invariant Verification

| Invariant | Status | Evidence |
|-----------|--------|----------|
| RDB Records/Structure sub-tab UI byte-identical pre/post | Pass | `MainArea.tsx` lines 112-193 (the `case "rdb": case "search": case "kv":` branch) untouched by the sprint-350 diff. RDB sub-tab test count (8 pre-existing assertions) unchanged. |
| `DocumentDataGrid.tsx` body unchanged | Mixed | `git diff HEAD -- src/components/document/DocumentDataGrid.tsx` shows only the removal of the `CollectionReadOnlyBanner` import + JSX call — these came from the **separately tracked Task #154 "Banner 제거 (옵션 B)"** which the user marked completed before sprint-350 began. Confirmed against `git log --oneline -- src/components/document/DocumentDataGrid.tsx`: last commit is `c62a4f7 feat(sprint-344)`. The working-tree banner-removal diff is NOT a sprint-350 edit. The Generator does not declare this file in its "Changed Files" list. |
| `list_mongo_indexes` Tauri command signature unchanged | Pass | `git status --porcelain src-tauri/` returns empty. Zero Rust diff. |
| `ValidatorPanel.tsx` not edited | Pass | `git diff HEAD -- src/components/document/ValidatorPanel.tsx` returns empty. |
| No new Tauri command registered | Pass | Zero Rust diff confirmed. |
| `pnpm tsc --noEmit`, `pnpm lint`, full `pnpm vitest run` green at sprint end | Mixed | tsc + lint green. Full vitest has 4 pre-existing failures unrelated to this sprint. The Verification Plan's own "Required Evidence" wording allows this ("Baseline-vs-after vitest fail-count delta must be ≤ 0 net new failures from this sprint's scope; the pre-existing autocompleteTheme failures stay flat"). Acceptable per the brief; non-blocking. |

## Test Documentation Rule

`feedback_test_documentation.md` requires every new test to carry a top-of-file or top-of-`describe` date + reason comment.

- `MongoStructurePanel.test.tsx` lines 1-9: **Pass** — top-of-file Sprint 350 (2026-05-15) header with explicit AC mapping.
- `MongoIndexesPanel.test.tsx` lines 1-8: **Pass** — top-of-file Sprint 350 (2026-05-15) header with explicit AC mapping.
- `MainArea.test.tsx` lines 832-840: **Pass** — top-of-describe Sprint 350 (2026-05-15) header on the new sub-describe block.

## Sprint-Prefix Comment Audit (production code)

`feedback_sprint_comment_cleanup.md` bans sprint-prefix narrative in production comments; only load-bearing WHY may survive.

- `MongoStructurePanel.tsx` line 26: **VIOLATION** — `* restarts is intentionally out of scope per the Sprint 350 contract).` mentions the sprint by name. The "WHY" (intentional non-persistence) is load-bearing; the sprint name is not. See Detailed Findings §B.
- `MongoIndexesPanel.tsx`: clean (no sprint prefix in production comments).
- `MainArea.tsx`: clean (no new sprint-prefix comments in the new document branch).

## Detailed Findings

### §A — AC-350-02 outer-toggle survival is unmet

**Contract wording**: "Activating Structure mounts a nested tab bar... switching via mouse or `ArrowLeft`/`ArrowRight` toggles content and **the inner selection survives Structure-tab re-activation**."

**Spec wording (sprint-350/spec.md AC-350 #2)**: "Switching between Indexes and Validator preserves each tab's state (scroll, editor contents) when the user toggles back via mouse or `ArrowLeft`/`ArrowRight`."

The two phrasings disagree. The contract is the binding artefact for evaluation; the contract's "Structure-tab re-activation" wording is unambiguous: it covers the user going Records → Structure → Records → Structure, and the inner choice must survive that cycle.

**Implementation behavior**: `MainArea.tsx` lines 96-108 — when `tab.subView === "records"`, `MongoStructurePanel` is not rendered. When `tab.subView === "structure"`, a new `MongoStructurePanel` instance is created with `useState<SubSubTab>("indexes")` (line 39 of `MongoStructurePanel.tsx`). Toggling outer Records ↔ Structure remounts the panel and resets the inner state.

**Generator's defense** (handoff line 40-41 + Assumptions §1): "the spec explicitly defers 'persisting Indexes/Validator selection across app restarts' out of scope and the parent-remount reset is the simplest UI semantic that respects the sprint's 'frontend-only, no persistence' boundary."

**Evaluator's response**: The contract distinguishes two persistence levels: (i) across app restarts (out of scope, explicit), and (ii) within a single session across outer-tab cycles (in scope per AC-350-02 literal wording). Conflating the two collapses the literal AC. There is no test asserting outer-toggle survival because the implementation cannot satisfy it — that absence itself is an evidence gap that should be visible in the test suite.

**Suggested fix** (Generator's own recommendation, handoff line 80-81): lift the `active` state into a parent that does not unmount, either:
  - the parent `TableTabView` component in `MainArea.tsx` (component-local `useState` for the inner choice, passed down to `MongoStructurePanel` as a prop) — easiest, no store change; OR
  - a new `mongoStructureSubTab?: "indexes" | "validator"` field on `TableTab` in `workspaceStore` types, persisted via `setSubView`-style action. Adds a store touch but covers both within-session and (free) across-app-restart even though the latter is OOS.

The cheaper of the two (lift to `TableTabView`) is the recommended path. It keeps `MongoStructurePanel` shape unchanged for the caller's consumers and adds zero store surface.

**Counter-evidence**: It is *possible* to read the contract's sentence as "(switching via mouse or ArrowLeft/ArrowRight toggles content) and (the inner selection survives Structure-tab re-activation)" being two separate clauses describing the same inner-only behavior, but that reading erases the "Structure-tab re-activation" phrase entirely — the most natural English reading is "the inner selection is preserved when the user re-activates the Structure tab from elsewhere". On a strict reading, the AC fails.

### §B — Sprint-prefix narrative in `MongoStructurePanel.tsx`

`MongoStructurePanel.tsx` lines 23-33:

```tsx
/**
 * Mongo collection Structure pane. Owns the Indexes / Validator
 * sub-sub-tab selection (component-local — persistence across app
 * restarts is intentionally out of scope per the Sprint 350 contract).
 *
 * The two children are mounted conditionally rather than always-rendered-
 * with-hidden-style so the existing `ValidatorPanel` keeps its current
 * read-on-mount semantics (the IPC fires only when the user activates
 * the Validator sub-sub-tab — same byte-equivalence as the placement
 * this sprint moves it from).
 */
```

The phrase **"per the Sprint 350 contract"** is the offending fragment per `feedback_sprint_comment_cleanup.md`. The surrounding "WHY" (intentional non-persistence, conditional mount to preserve read-on-mount IPC semantics) is load-bearing and should stay. The fix is mechanical: drop the "per the Sprint 350 contract" clause. Suggested rewrite:

```tsx
/**
 * Mongo collection Structure pane. Owns the Indexes / Validator
 * sub-sub-tab selection (component-local — persistence across app
 * restarts is intentionally out of scope).
 *
 * Children are mounted conditionally rather than always-rendered-with-
 * hidden-style so `ValidatorPanel` keeps its read-on-mount IPC semantic:
 * the validator IPC fires only when the user activates the Validator
 * sub-sub-tab — byte-equivalent to its prior placement at the
 * collection-tab root.
 */
```

### §C — Roving tabindex without focus movement

Both the new `mongo-structure-subsubtab-bar` and the existing `mongo-table-subtab-bar` (and the older RDB `Table view` bar) update `tabindex` to track the selected tab, but **none of them call `.focus()` on the new tab when the user arrow-keys**. The WAI-ARIA APG tablist pattern expects focus to move with the active tab so the next Tab keystroke leaves the tablist cleanly. Today, after `ArrowRight`, focus stays on the now-`tabindex=-1` Indexes button — Tab from there leaves the tablist as expected (because that button is no longer in the tab order), but the immediate visual focus indicator lingers on the wrong tab until the user moves focus elsewhere.

This is **consistent with the existing RDB pattern** so it does not regress; it is a pre-existing a11y gap. Not a sprint-350 blocker, but worth registering for a future a11y pass. The sprint contract did not call for closing it.

### §D — Verification gap: no manual browser smoke

The Generator skipped manual smoke (handoff line 61-62). The contract's Verification Plan §6 marks manual smoke as optional ("옵션"), so this is contract-compliant. However, given this is the *tracer* slice that unblocks Sprints 351 and 352, the next live-Mongo developer should still run the manual smoke before declaring the slice done. Recorded as residual risk only.

### §E — Working-tree changes outside the sprint-350 scope

The working tree contains 14 modified/deleted files beyond the Generator's declared "Changed Files" list (e.g., `CollectionReadOnlyBanner.tsx` deletion, `InsertSnippetMenu.tsx` deletion, `mongoshSnippets.ts` deletion, `QueryTab.tsx` slimming). Per `git log` and the task tracker (#153 + #154 already marked completed), these are from prior tasks the user closed before starting sprint-350. They are *not* sprint-350 work. The Generator's evidence packet correctly omits them but the Evaluator notes them here for transparency: if the user commits sprint-350 with `-A`, these orphan changes will ride along. **Recommendation**: stage sprint-350 work file-by-file (`git add` the four new sources + two modified files + `docs/sprints/sprint-350/`), or split the orphan deletions into a separate cleanup commit before sprint-350.

## Feedback for Generator

1. **AC-350-02 outer-toggle survival** (P1)
   - Current: `MongoStructurePanel` unmounts whenever the user toggles Records ↔ Structure on the outer bar, resetting the inner Indexes/Validator state to `Indexes`.
   - Expected per contract literal wording: the inner selection survives Structure-tab re-activation, i.e. cycling Records → Structure → Records → Structure preserves whichever inner tab was last active.
   - Suggestion: Lift `active` to `TableTabView` in `MainArea.tsx` (cheapest path — component-local `useState<SubSubTab>("indexes")` in `TableTabView`, passed down as `activeSubSubTab` + `onActiveSubSubTabChange` props to `MongoStructurePanel`). This survives the outer toggle because `TableTabView` is keyed by `activeTab.id` (line 319 of `MainArea.tsx`) — it stays mounted across outer Records/Structure toggles within the same tab. Add an RTL test in `MainArea.test.tsx` titled `"AC-350-02 — inner selection survives outer Records → Structure → Records → Structure cycle"` that clicks Structure, clicks Validator, clicks Records, clicks Structure, and asserts the Validator sub-sub-tab is still selected.

2. **Sprint-prefix narrative in `MongoStructurePanel.tsx`** (P2)
   - Current: line 26 contains "per the Sprint 350 contract".
   - Expected per `feedback_sprint_comment_cleanup.md`: production comments carry load-bearing WHY without naming the sprint.
   - Suggestion: edit the comment to drop the "per the Sprint 350 contract" clause; keep the rest (non-persistence rationale + conditional-mount rationale).

3. **Table polish** (P3, design)
   - Current: index table has no row hover state and the section→table padding feels tight.
   - Expected: visual cohesion with the RDB structure index grid (`StructurePanel.tsx`'s indexes pane), which paints `hover:bg-secondary/40` on rows.
   - Suggestion: add `hover:bg-secondary/40` to the `<tr>` className, and add `mt-2` or wrap the `<table>` in a `px-3` div for the same horizontal rhythm as the header.

4. **a11y nit — `aria-controls` linkage** (P3, a11y)
   - Current: tabs do not point to their panels via `aria-controls` / panel `id`.
   - Expected per WAI-ARIA APG tablist pattern: each `role="tab"` carries `aria-controls="<panel-id>"`, and each panel carries `role="tabpanel"` + `id="<panel-id>"` + `aria-labelledby="<tab-id>"`.
   - Suggestion: only worth landing if/when the project's RDB tablist also adopts the linkage (consistency > spot-fix). Park as a global a11y sprint candidate.

5. **`MainArea.test.tsx` mocking coverage** (P3, test quality)
   - Current: the mock for `MongoStructurePanel` accepts the three props but discards them; tests only verify presence + props plumbing.
   - Expected: a follow-up integration test (not blocking this sprint) that renders the real `MongoStructurePanel` inside `MainArea` (no mock) and exercises the outer→inner→outer cycle end-to-end. The current isolation strategy is fine for AC-level routing assertions; the gap is acknowledged.
   - Suggestion: when re-attempting after the fix for §A, add one outer-cycle integration test that does NOT mock `MongoStructurePanel`, so the full mount survival path is exercised.

## Re-Attempt Required

Yes. The Completeness dimension scores below the 7/10 threshold due to AC-350-02. The Generator should:

1. Pick up Feedback #1 (P1) and re-implement the inner state to survive outer remount.
2. Pick up Feedback #2 (P2) — one-line comment edit.
3. Optionally Feedback #3/#4/#5 (P3 polish — not blocking).
4. Re-run the focused vitest suite plus full `pnpm vitest run` and confirm the 4 pre-existing failures stay flat.
5. Update the handoff with the new evidence packet (especially the new outer-cycle RTL test name).

---

## Attempt 2 Findings

Date: 2026-05-15
Evaluator: harness Evaluator (rigorous mode, re-run)

## Sprint 350 Attempt 2 — Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Design Quality | 7/10 | Unchanged from attempt 1. The Generator did not pick up the P3 polish items (no row hover on the index grid, no `aria-controls` linkage, no padding wrapper around the `<table>`). These were explicitly marked non-blocking, so attempt 2 is contract-compliant. The sub-tab bar visual treatment continues to match the RDB pattern verbatim (`border-b border-border bg-secondary`, `text-xs font-medium`, `border-primary` underline on the selected tab, `transition-colors`). Indexes panel chrome unchanged. |
| Completeness | 8/10 | **AC-350-02 outer-toggle survival is now genuinely fixed.** The state owner (`TableTabView` at `MainArea.tsx:35-46`) lives above the conditional `MongoStructurePanel` render branch, and `TableTabView` is keyed by `activeTab.id` (`MainArea.tsx:332`) — so it stays mounted across outer Records ↔ Structure toggles within the same tab. The new RTL test (`MainArea.test.tsx:936-973`) actually exercises the outer-toggle path: it clicks the Structure tab → clicks the mock validator-select button → clicks Records → asserts the panel unmounts and `DocumentDataGrid` mounts → clicks Structure → asserts the re-mounted panel carries `data-active="validator"`. That assertion fails if the state lives inside `MongoStructurePanel` itself, so the test is load-bearing. The sprint-prefix narrative ("per the Sprint 350 contract") is gone from `MongoStructurePanel.tsx:33-41`; grep on `MongoStructurePanel.tsx`, `MongoIndexesPanel.tsx`, `MainArea.tsx` for "Sprint 350" / "sprint-350" returns zero hits in production source. All five AC have intact tests with citations. |
| Functionality | 8/10 | Focused vitest: 47/47 (+1 vs attempt 1's 46 — the new outer-cycle test). RDB regression: 39/39 unchanged. Full vitest: 3921 pass / 4 fail / 11 skipped — the 4 failures are the same pre-existing failures in `src/themes.test.ts` (2) + `src/lib/editor/autocompleteTheme.test.ts` (2). Net new failures from this sprint: 0. The controlled-prop wiring is robust: `MongoStructurePanel`'s `active = activeProp ?? activeLocal` falls back to local state when the caller omits the prop (preserves the panel's isolated unit tests), and `setActive` routes through `onActiveChange` when provided or `setActiveLocal` otherwise. Keyboard ArrowLeft/Right toggle still works because `toggle()` calls `setActive` which is itself routed through the controlled-prop pipeline. |
| Accessibility & Responsiveness | 7/10 | Unchanged from attempt 1. `role="tablist"` + `aria-label` on both bars, `role="tab"` + `aria-selected` + roving `tabindex` on every button, `role="alert"` on IPC error region, `role="status"` on empty state, `aria-busy` gated by `useDelayedFlag`. Same pre-existing a11y gaps (no `aria-controls`, no Home/End key handling, no explicit `.focus()` movement) — consistent with the RDB tab bar, so consistency is preserved. Not regressed; not a blocker per the contract. |
| **Overall** | **7.5/10** | Threshold is ≥ 7 on every dimension. Attempt 2 clears every dimension. |

## Verdict: PASS

The P1 finding (AC-350-02 outer-toggle survival) is genuinely fixed: the state owner lives in `TableTabView` (a sibling that survives the outer toggle because it is keyed only by `activeTab.id`), and the new RTL test in `MainArea.test.tsx` actually forces `MongoStructurePanel` to unmount and remount during the assertion path. The P2 finding (sprint-prefix narrative) is gone — grep on `MongoStructurePanel.tsx`, `MongoIndexesPanel.tsx`, and the new portion of `MainArea.tsx` returns zero matches for "Sprint 350" / "sprint 350" / "Sprint-350". The Completeness score clears 7/10. Required checks all pass:

- `pnpm tsc --noEmit` → exit 0 (Evaluator-rerun confirmed).
- `pnpm lint` → exit 0 (Evaluator-rerun confirmed).
- Focused vitest (`MongoStructurePanel.test.tsx` + `MongoIndexesPanel.test.tsx` + `MainArea.test.tsx`) → 47/47 pass (4 + 5 + 38 = 47; +1 vs attempt 1).
- RDB regression (`StructurePanel.columns.test.tsx` + `StructurePanel.constraints.test.tsx`) → 39/39 unchanged.
- Full `pnpm vitest run` → 3921 pass / 4 fail / 11 skipped. Net new failures from this sprint: **0** (the 4 failures are the pre-existing `src/themes.test.ts` x2 + `src/lib/editor/autocompleteTheme.test.ts` x2 that the contract explicitly excludes).

Zero Rust diff confirmed (`git status --porcelain src-tauri/` returns empty). `ValidatorPanel.tsx` body unchanged (`git diff HEAD -- src/components/document/ValidatorPanel.tsx` empty). `DocumentDataGrid.tsx` body shows only the pre-sprint-350 banner-removal diff (Task #154, marked completed before the sprint started — same orphan diff registered in attempt 1's Detailed Findings §E and not a sprint-350 edit).

## Sprint Contract Status (Done Criteria) — Attempt 2

- [x] `AC-350-01` Records/Structure tablist with Records default — `MainArea.test.tsx:869-886` `"AC-350-01 — renders Records/Structure sub-tab bar with Records selected by default for document paradigm"` (unchanged from attempt 1).
- [x] `AC-350-02` Structure mounts nested tablist with Indexes default, mouse + arrow keys toggle, **inner selection survives outer Records → Structure → Records → Structure cycle** — proven by the new test `MainArea.test.tsx:936-973` `"AC-350-02 — inner selection survives outer Records → Structure → Records → Structure cycle"`. The test:
  - mounts a Mongo tab with `subView: "structure"`;
  - asserts initial `data-active="indexes"` on the `mock-mongo-structure` node;
  - clicks `mock-mongo-structure-select-validator` → asserts `data-active="validator"`;
  - clicks the Records outer tab → asserts `mock-mongo-structure` is unmounted AND `mock-document-datagrid` mounts;
  - clicks the Structure outer tab → asserts the re-mounted `mock-mongo-structure` still has `data-active="validator"` (not the default `"indexes"`).
  - This is a genuine outer-toggle survival test: the assertion would fail if the state lived inside `MongoStructurePanel` itself, because the panel is conditionally rendered in `MainArea.tsx:113-121`.
  - Plus the four existing `MongoStructurePanel.test.tsx` tests still pass and cover default selection, mouse-click toggle + Validator mount, keyboard ArrowLeft/Right toggle, and roving tabindex.
- [x] `AC-350-03` IPC exactly once + row mapping + empty + error + delayed loading — unchanged; `MongoIndexesPanel.test.tsx` 5/5 still pass (`toHaveBeenCalledTimes(1)`, empty-state `mongo-indexes-empty`, `role="alert"` on failure, no-fetch when `database === ""`, `useDelayedFlag(loading, 1000)` gate verified with `vi.useFakeTimers()`).
- [x] `AC-350-04` Validator mounts existing `ValidatorPanel` — unchanged; `MongoStructurePanel.test.tsx:63` `"switches to the Validator sub-sub-tab on click and mounts ValidatorPanel verbatim"`. `ValidatorPanel.tsx` body confirmed unmodified.
- [x] `AC-350-05` RDB regression — unchanged; `MainArea.test.tsx:975-991` `"AC-350-05 — RDB regression guard..."` still green.

## Verification Plan Execution — Attempt 2

| Check | Status | Notes |
|-------|--------|-------|
| `pnpm tsc --noEmit` | Pass (exit 0) | Evaluator-rerun confirmed. |
| `pnpm lint` | Pass (exit 0) | Evaluator-rerun confirmed. |
| Focused: `MongoStructurePanel.test.tsx + MongoIndexesPanel.test.tsx + MainArea.test.tsx` | Pass | 47 tests / 3 files / 0 failures (= 4 + 5 + 38). +1 vs attempt 1 (the new outer-cycle test). |
| RDB regression: `StructurePanel.columns.test.tsx + StructurePanel.constraints.test.tsx` | Pass | 39 tests / 2 files / 0 failures (unchanged baseline). |
| Full `pnpm vitest run` | 3921 pass / 4 fail / 11 skipped | Same 4 pre-existing failures in `src/themes.test.ts` + `src/lib/editor/autocompleteTheme.test.ts`. Net new failures from this sprint: **0**. |

## Invariant Verification — Attempt 2

| Invariant | Status | Evidence |
|-----------|--------|----------|
| RDB Records/Structure sub-tab UI byte-identical pre/post | Pass | `MainArea.tsx:125-204` (the `case "rdb": case "search": case "kv":` branch) byte-identical to attempt 1. The new `useState<MongoStructureSubTab>` hoist lives above the switch (line 45-46) so it has zero impact on the RDB branch. |
| `DocumentDataGrid.tsx` body unchanged | Mixed | Same as attempt 1 — the banner-removal diff is from Task #154 (completed before sprint-350 began) and is not declared as a sprint-350 change. Confirmed via `git log -- src/components/document/DocumentDataGrid.tsx`. |
| `list_mongo_indexes` Tauri command signature unchanged | Pass | Zero Rust diff (`git status --porcelain src-tauri/` empty). |
| `ValidatorPanel.tsx` not edited | Pass | `git diff HEAD -- src/components/document/ValidatorPanel.tsx` empty. |
| No new Tauri command registered | Pass | Zero Rust diff. |
| `pnpm tsc --noEmit`, `pnpm lint`, full `pnpm vitest run` green at sprint end | Mixed | tsc + lint green. Full vitest has the 4 pre-existing failures unrelated to this sprint (themes + autocompleteTheme); contract's "≤ 0 net new failures" wording satisfied. |

## Sprint-Prefix Comment Audit (production code) — Attempt 2

`feedback_sprint_comment_cleanup.md` bans sprint-prefix narrative in production comments.

- `MongoStructurePanel.tsx`: **Clean.** `grep -i "sprint.*350"` returns zero hits. The JSDoc at lines 32-42 retains the load-bearing WHY (component-local persistence policy + conditional-mount rationale to preserve `ValidatorPanel`'s read-on-mount IPC semantic) without naming the sprint.
- `MongoIndexesPanel.tsx`: Clean (no sprint prefix in production comments — unchanged from attempt 1).
- `MainArea.tsx`: Clean. The new comment at lines 40-44 explaining the state hoist is load-bearing WHY ("Owned here (not in `MongoStructurePanel`) so the user's inner Indexes/Validator pick survives an outer Records ↔ Structure remount...") and does NOT name the sprint.

## Test Documentation Rule — Attempt 2

`feedback_test_documentation.md` requires every new test to carry a top-of-file or top-of-`describe` date + reason comment.

- `MongoStructurePanel.test.tsx` lines 1-9: Pass — unchanged top-of-file Sprint 350 (2026-05-15) header.
- `MongoIndexesPanel.test.tsx` lines 1-8: Pass — unchanged top-of-file Sprint 350 (2026-05-15) header.
- `MainArea.test.tsx`:
  - Lines 96-99 (mock comment): Pass — Sprint 350 (2026-05-15) attribution + reason.
  - Lines 119-124 (new mock comment block): Pass — Sprint 350 (2026-05-15) attribution + reason explaining why the mock surfaces `data-active` + selection buttons.
  - Lines 179-182 (`makeDocumentTab` helper): Pass — Sprint 350 (2026-05-15) attribution + reason.
  - Lines 860-867 (`describe` block): Pass — Sprint 350 (2026-05-15) top-of-describe header.
  - Lines 931-935 (new test): Pass — top-of-test comment explaining the AC-350-02 literal wording and the state-owner choice.

## Delta vs Attempt 1

| Area | Attempt 1 | Attempt 2 |
|------|-----------|-----------|
| AC-350-02 outer-toggle survival | Unmet (state inside `MongoStructurePanel`, reset on outer remount) | **Met** (state hoisted to `TableTabView`, survives the outer toggle; new RTL test gate) |
| Sprint-prefix narrative in `MongoStructurePanel.tsx` JSDoc | Violation ("per the Sprint 350 contract") | **Gone**; load-bearing WHY preserved |
| `MongoStructurePanel` public surface | `connectionId / database / collection` | Same + optional `active` + `onActiveChange` (controlled-prop opt-in); new `MongoStructureSubTab` export |
| Focused vitest count | 46 (4 + 5 + 37) | 47 (4 + 5 + 38; +1 for the new outer-cycle test) |
| Full vitest pass count | 3920 | 3921 (+1) |
| Full vitest fail count | 4 (themes + autocompleteTheme) | 4 (same files; net new = 0) |
| RDB regression count | 39 | 39 (unchanged) |
| Rust diff | None | None |
| Completeness score | 6/10 | 8/10 |
| Overall score | 6.75/10 | 7.5/10 |
| Verdict | FAIL | **PASS** |

## Detailed Findings — Attempt 2

### §A — AC-350-02 outer-toggle survival: verified

The state owner is `TableTabView` at `MainArea.tsx:35`, which holds `useState<MongoStructureSubTab>("indexes")` at line 45-46. `TableTabView` itself is mounted from `MainArea.tsx:331-343` with `key={activeTab.id}`. Because the outer Records ↔ Structure toggle does not change `activeTab.id`, `TableTabView` does not remount across that toggle and its `useState` survives. The conditional rendering at `MainArea.tsx:107-121` (Records → `DocumentDataGrid`; Structure → `MongoStructurePanel`) only affects `MongoStructurePanel`'s mount; the hoisted state outlives the panel's lifecycle within the same tab. The new RTL test at `MainArea.test.tsx:936-973` validates this by:
1. Driving `MongoStructurePanel` to `validator` via the controlled-prop hook;
2. Asserting the panel actually unmounts on the outer Records click (`screen.queryByTestId("mock-mongo-structure")).toBeNull()`);
3. Asserting that on re-mount the panel comes back with `data-active="validator"`, not the local-state default `"indexes"`.

If the state lived inside `MongoStructurePanel`, step 3 would fail because the panel's local `useState` re-initializes to `"indexes"` on remount.

### §B — Sprint-prefix narrative: verified absent

`MongoStructurePanel.tsx` JSDoc at lines 32-42 reads:

> "Mongo collection Structure pane. Owns (or accepts via controlled props) the Indexes / Validator sub-sub-tab selection. Persistence across app restarts is intentionally out of scope.
>
> The two children are mounted conditionally rather than always-rendered-with-hidden-style so the existing `ValidatorPanel` keeps its current read-on-mount semantics — the validator IPC fires only when the user activates the Validator sub-sub-tab, byte-equivalent to its prior placement at the collection-tab root."

No sprint name remains. The load-bearing WHY (non-persistence policy + conditional-mount rationale) is preserved.

### §C — Controlled-prop API: clean and idiomatic

The `active?: MongoStructureSubTab` + `onActiveChange?: (next: MongoStructureSubTab) => void` shape follows the standard React controlled-input pattern. The fallback chain `active = activeProp ?? activeLocal` lets the panel be either fully controlled (parent owns state) or fully uncontrolled (panel owns state). `setActive` routes through `onActiveChange` when provided; this keeps the parent the single source of truth and avoids the dual-write hazard. The `MongoStructureSubTab` type is exported so the parent can declare its `useState` with the same union. No `any` usage; types are strict.

### §D — Test mock is sufficient for the outer-toggle gate

The `MongoStructurePanel` mock at `MainArea.test.tsx:132-163` renders the controlled `active` prop on `data-active` and exposes two buttons (`mock-mongo-structure-select-validator` / `-select-indexes`) that call `onActiveChange?.(...)`. This is sufficient to gate the outer-toggle path because:
1. The test does not need to mount the real Indexes/Validator children — it only needs to observe the controlled-prop pipeline.
2. The buttons let the test drive `onActiveChange` from the parent's perspective, which is what AC-350-02 cares about (parent ownership).
3. The `data-active` attribute exposes the value the parent passes down, so the test can assert the survival semantics directly.

An integration test that does NOT mock `MongoStructurePanel` would be stronger (Evaluator's P3 #5 from attempt 1), but the contract does not require it and the current mock-driven gate already proves the parent owns the state. Park as P3 follow-up.

### §E — Residual P3 polish items (informational, not blocking)

The Generator deliberately skipped the P3 polish items from attempt 1's findings (row hover, `aria-controls`, table padding, etc.) and called them out as "marked informational and deliberately skipped per the contract's minimal-change guidance" in the handoff. This is acceptable — the contract's "Design Bar / Quality Bar" section does not enumerate these as hard requirements, and the contract's invariant about minimal diff supports the choice. They remain valid follow-ups for a global a11y / polish pass.

### §F — Working-tree changes outside the sprint-350 scope (carried from attempt 1)

The working tree still contains the orphan deletions/edits from Tasks #153 + #154 (banner removal, `InsertSnippetMenu` removal, `mongoshSnippets` removal, `QueryTab` slimming). Same recommendation as attempt 1: when committing, stage sprint-350 work explicitly (`git add` on the 6 sprint-350 files) instead of `git add -A`, or split the orphan deletions into a separate cleanup commit. Not a sprint-350 quality issue; transparency note only.

## Exit Criteria — Attempt 2

- Open `P1` / `P2` findings: **0**
- Required checks passing: **yes**
- Acceptance criteria evidence linked in `handoff.md`: **yes** (attempt 2 section in handoff cites the new test name + line range)

## Re-Attempt Required: No

All P1 and P2 findings from attempt 1 are resolved. All five AC have intact test citations. Required checks all green. Net new vitest failures = 0. The sprint is complete and ready to merge once the orphan working-tree edits are split out (a git-hygiene step the user must do at commit time, not a sprint-350 implementation issue).
