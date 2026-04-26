# Sprint 136 Evaluation

Verification profile: `mixed`. All 7 required gates re-executed by the
evaluator against the working tree at evaluation time.

## Independent Verification

### 1. `pnpm vitest run` — PASS (last 20 lines)

```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  128 passed (128)
      Tests  2063 passed (2063)
   Start at  02:02:05
   Duration  21.48s (transform 5.95s, setup 8.25s, import 35.20s, tests 51.04s, environment 78.14s)
```

### 2. `pnpm tsc --noEmit` — PASS

```
(no output — exit 0)
```

### 3. `pnpm lint` — PASS

```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .

(exit 0)
```

### 4. `pnpm contrast:check` — PASS

```
> table-view@0.1.0 contrast:check /Users/felix/Desktop/study/view-table
> tsx scripts/check-theme-contrast.ts

WCAG AA contrast: 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)
```

### 5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — PASS

```
test storage::tests::test_save_connection_empty_password_not_encrypted ... ok
test storage::tests::test_save_connection_rejects_duplicate_name ... ok
test storage::tests::test_save_connection_same_name_same_id_succeeds ... ok
test storage::tests::test_save_connection_updates_existing_by_id ... ok
test storage::tests::test_save_connection_with_none_preserves_existing ... ok
test storage::tests::test_save_group_adds_and_updates ... ok
test storage::tests::test_save_multiple_connections ... ok

test result: ok. 268 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.04s
```

### 6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — PASS

```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.32s
```

### 7. `pnpm exec eslint e2e/**/*.ts` — PASS

```
(no output — exit 0)
```

### Targeted re-runs

- `pnpm vitest run TabBar.test.tsx SchemaTree.test.tsx SchemaTree.preview.test.tsx SchemaTree.dbms-shape.test.tsx DocumentDatabaseTree.test.tsx tabStore.test.ts` →
  **6 files, 245 tests passed**.
- `pnpm vitest run -t "AC-S136"` → 14 tests passed.
- `pnpm vitest run -t "AC-S134"` → 5 tests passed (S134 dirty-marker
  regression guard intact).

## AC Verdict

| AC | Verdict | Evidence |
|----|---------|----------|
| **AC-S136-01** PG single-click → preview tab swap (no accumulation) | **PASS** | `tabStore > preview tab system > AC-S136-01: single-click creates a preview tab (isPreview === true)` and `… clicking a different row swaps the preview slot (no tab accumulation)` (`src/stores/tabStore.test.ts:725, 744`). RTL-level: `SchemaTree — Sprint 136 preview / persist click semantics > AC-S136-01: single-click on a table row opens a preview tab (isPreview=true)` and `… clicking a different row swaps the preview slot (no tab accumulation)` (`src/components/schema/SchemaTree.preview.test.tsx:87, 107`). Production: `addTab` already writes `isPreview: true` (default since S29) and the previewIdx swap branch in `tabStore.ts:281-296` swaps the preview slot. **NOTE**: PG single-click was already preview before S136 — see P3-01 below. |
| **AC-S136-02** same-row double-click → promote (`isPreview = false`) | **PASS** | `tabStore > preview tab system > AC-S136-02: promoteTab flips isPreview to false; further row clicks open a separate preview tab` (`src/stores/tabStore.test.ts:766`). RTL-level: `SchemaTree — Sprint 136 preview / persist click semantics > AC-S136-02: double-click on a table row promotes the preview tab (isPreview=false)` (`src/components/schema/SchemaTree.preview.test.tsx:131`). Production: `handleTableDoubleClick` (`SchemaTree.tsx:601-607`) calls `handleTableClick` then `useTabStore.getState().promoteTab(activeTabId)`. `onDoubleClick` is wired into all three render paths (virtualized item row 994, eager nested 1603, SQLite flat 1298). |
| **AC-S136-03** Mongo collection click follows the same model | **PASS** | `DocumentDatabaseTree > AC-S136-03: single-click on a collection opens a preview tab (isPreview=true)` and `… double-click on a collection promotes the tab (isPreview=false)` (`src/components/schema/DocumentDatabaseTree.test.tsx:282, 306`). Production: `DocumentDatabaseTree.tsx:362-368` — `onClick` now calls `setSelectedNodeId` + `handleCollectionOpen` (was: select-only); `onDoubleClick` calls new `handleCollectionDoubleClick` which opens then `promoteTab`. |
| **AC-S136-04** same-row single-click twice → idempotent | **PASS** | `tabStore > preview tab system > AC-S136-04: clicking the same row twice is idempotent (no second tab, no promote)` (`src/stores/tabStore.test.ts:806`). RTL-level: `SchemaTree — Sprint 136 preview / persist click semantics > AC-S136-04: same-row single-click twice is idempotent (no extra tab, no promote)` (`src/components/schema/SchemaTree.preview.test.tsx:169`). Mongo-level: `DocumentDatabaseTree > AC-S136-04: same-collection single-click twice is idempotent (no extra tab, no promote)` (`src/components/schema/DocumentDatabaseTree.test.tsx:332`). Production: `addTab` early-returns on exact `(connectionId, table)` match (`tabStore.ts:269-278`). |
| **AC-S136-05** Function category expand → max-height + overflow-y-auto cap | **PASS** | `SchemaTree — Sprint 136 function category overflow (AC-S136-05) > caps the function category container with max-h-[50vh] + overflow-y-auto when 60+ functions are present` (`src/components/schema/SchemaTree.preview.test.tsx:214`). Production wrapper: `SchemaTree.tsx:1482-1494` — the inner content `<div>` of `functions`/`procedures` categories carries `max-h-[50vh] overflow-y-auto` and `data-category-overflow="capped"`. The cap wraps the category-items container directly so its scroll bounds are local to that category — verified via the test which finds the `aria-label="… function"` row inside the capped container. **Caveat**: cap only applied in eager-render branch; virtualized branch (`renderCategoryRow` at line 872+) relies on viewport windowing instead — see P3-02. |
| **AC-S136-06** Preview cue + dirty marker coexist on TabBar | **PASS** | `TabBar > preview tab carries the preview visual cue (italic + opacity-70) without a dirty marker (AC-S136-06)` and `… preview cue and dirty marker coexist on the same tab (AC-S136-06)` (`src/components/layout/TabBar.test.tsx:760, 780`). Production: `TabBar.tsx:227-228` — `italic opacity-70` on title span when `tab.isPreview`. Dirty marker (`TabBar.tsx:236-243`) is a sibling `<span data-dirty="true" aria-label="Unsaved changes">`. The tests assert both selectors live inside the same `[role='tab']` cell. **NOTE**: production-side TabBar.tsx was unchanged — italic+opacity preview cue dates back to refactor `f9c2baa` and dirty-dot to S97. New tests pin the coexistence contract. |
| **AC-S136-07** Regression guard | **PASS** | All 2063 tests green (was 2049 before S136 per handoff; +14 net). Targeted re-runs confirm: `AC-S134` (5 tests, dirty marker independent of activeTabId) green; `SchemaTree.dbms-shape.test.tsx` green; `DocumentDatabaseTree > renders database → collection (2-level tree) — AC-S135-05` green; `SchemaTree.test.tsx` 100+ tests covering F2 rename / ContextMenu / search filter / Enter-Space expand all green. |
| **AC-S136-08** 6 gates + e2e static lint green | **PASS** | All 7 gates green per the section above. |

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 8/10 | Click semantics behave exactly as specified for both paradigms across all 14 AC-S136 tests. `addTab`'s pre-existing same-table early-return makes idempotency trivial; `handleTableDoubleClick` correctly calls click first then promote so the preview-swap path runs before the promote stamp. One subtle gap: `handleTableDoubleClick` reads `useTabStore.getState().activeTabId` rather than the tab id created by `addTab`, which is robust for normal flows but couples promotion to whichever tab is active at the moment promote is called — a S29 baseline test (`promoteTab on non-existent tab is a no-op`) implicitly guards against the worst case. The function-category cap is correct in the eager branch but does not apply in the virtualized branch — Generator flagged this honestly in handoff assumption #7. |
| **Test quality** | 7/10 | 14 net new tests with clear AC labels and user-perspective queries (`getByLabelText` for table/collection rows). The function overflow test asserts on `data-category-overflow="capped"` + className substring, which is the right approach in JSDOM (the contract explicitly permits class-based assertion). However: (a) the 4 new `tabStore.test.ts` tests partially duplicate pre-existing S29 baseline cases (`new table tab is preview by default`, `clicking another table replaces preview tab`, `promoteTab sets isPreview to false`) — only AC-S136-04 idempotent-click and AC-S136-02 "further row clicks spawn a separate preview" are genuinely new behaviors. The duplicates are still valuable for AC-traceability but inflate the new-test count. (b) Overflow test uses 60 fixtures; contract scenario test says "function 100+개" which would be a stronger boundary. (c) No test for the document-tree dblclick + later single-click on a different collection — the symmetric "promote stuck" assertion that the relational tree has via the second click in the AC-S136-02 test. |
| **Regression safety** | 9/10 | 2063 tests green (previously 2049). All S134 (5 dirty-marker AC tests) and S135 (DBMS-shape 6 tests + Mongo 2-level tree test) pass. F2 rename, ContextMenu, search filter, Enter/Space expand all intact. Cmd+1..9 / Cmd+W / Cmd+T / Cmd+S guards green via Sidebar/App test suites. The Mongo single-click semantics shift (select-only → preview tab) is documented in handoff assumption #4 and confirmed not to break the existing "double-clicking a collection opens a document-paradigm TableTab" test. |
| **Code quality** | 8/10 | All changes follow project conventions. `data-category-overflow="capped"` test hook is a clean choice — robust to className ordering. Comments accurately cite their AC numbers. `handleTableDoubleClick` and `handleCollectionDoubleClick` follow the same pattern (open → read activeTabId → promote) which keeps both trees mentally aligned. Minor critique: the relational tree wires `onDoubleClick` in three render paths (virtualized item row, eager nested item row, SQLite flat) by hand, which is a duplication risk if a fourth render path is added; a shared `handleDoubleClick(isTableView, item, schema)` helper at the component level would have been DRY-er. Also: the inline comment `// Sprint 136 (AC-S136-02)` is repeated verbatim in three places — consider extracting a single source-of-truth function. No `any`, no TODO, no console.log. |
| **Evidence completeness** | 9/10 | Handoff lists changed files, all 7 verification command outputs, AC-by-AC test names with pass status, 7 numbered assumptions, and 1 deferred non-blocker (promote-on-edit). Re-running the gates locally reproduced the handoff numbers exactly (2063/268/0/0). The honest disclosure that `tabStore.ts`/`TabBar.tsx` were already wired (handoff "No production-side changes to TabBar.tsx were needed") is the correct call given the contract's "이미 비슷한 게 있다면 통합" rule. Minor omission: the handoff does not explicitly call out that PG single-click was already preview before S136 (only frames it as field-name unification), which made AC-S136-01's "first time" framing slightly misleading. |

**Average: 8.2/10. PASS gate (all dimensions ≥ 7).**

## Findings

### P1 (블로커)

None.

### P2 (개선 권장)

**P2-01 — Function/procedure overflow cap is missing in the virtualized
render path.**

- Current: `SchemaTree.tsx:1482-1494` wraps the `isFunctionCat || isProcedureCat`
  inner content with `max-h-[50vh] overflow-y-auto + data-category-overflow="capped"`
  in the **eager nested branch only**. The virtualized branch's
  `renderCategoryRow` (lines 872-908) followed by virtualized item rows does
  not apply the cap.
- Why this is OK today: when the virtualizer is active (>200 visible rows
  total — `VIRTUALIZE_THRESHOLD` at line 99), `useVirtualizer` already windows
  the flat list to viewport-bound DOM, so the underlying user-visible bug
  ("function category pushes schema rows out of viewport") cannot manifest
  in that branch. Generator documents this in handoff assumption #7.
- Why it is still a P2: the *contract* says the function category container
  must carry the cap; in the virtualized branch the container does not.
  A future refactor that flattens further or alters the virtualization
  threshold could re-expose the bug. The current `SchemaTree.preview.test.tsx`
  test only exercises the eager branch (60-row fixture stays under the 200
  threshold).
- Suggestion: add a tiny test that pushes total row count over 200 with most
  of those rows being functions, and assert that the visible function
  scroll area is bounded by viewport height (or simply add the same
  `max-h-[50vh] overflow-y-auto` wrapper to whichever DOM container groups
  the virtualized function rows). Not blocking for S136 — file as S137 or
  a "polish" follow-up.

**P2-02 — Document tree's AC-S136-02 ("promote stuck") assertion is weaker
than the relational tree's.**

- Current: `DocumentDatabaseTree.test.tsx > AC-S136-03: double-click on a
  collection promotes the tab` only asserts `isPreview === false` after the
  dblclick. The relational tree's twin test additionally clicks a different
  row afterwards and asserts the persisted tab survives + a new preview tab
  is appended (the "promote stuck" check at `SchemaTree.preview.test.tsx:152-167`).
- Why this matters: the strongest evidence that promote *worked* is that a
  subsequent single-click on a different collection does NOT swap the
  promoted tab. The current Mongo test could pass even if `promoteTab` were
  a no-op that happens to also reset `isPreview`.
- Suggestion: extend the Mongo dblclick test with a second click on a
  different collection (e.g. fixture has both `users` and `orders`
  collections; click `orders` after dblclick'ing `users`; assert tab count
  == 2 and `users.isPreview === false`).

### P3 (info)

**P3-01 — `tabStore.ts`, `TabBar.tsx`, and "PG single-click is preview"
were pre-existing.** Confirmed via `git log -S` against the working tree:
`isPreview` field, `promoteTab` action, and the italic+opacity-70 preview
cue all date back to commit `7a11728` (Sprint 29-32, "preview tabs"). PG's
`SchemaTree.handleTableClick` already called `addTab` (which always wrote
`isPreview: true`) before S136. The contract / execution brief framed
AC-S136-01 as "the first time" preview semantics work for PG, but the
production behavior was already in place — what S136 actually adds for the
relational tree is `onDoubleClick` → promote (sidebar-side). The handoff
treats this honestly via the "통합" rule (assumption #1). Not a finding —
filed as P3 so future readers don't double-count S136's footprint.

**P3-02 — `tabStore.test.ts`'s 4 new AC-S136 tests partially duplicate S29
baseline tests.** Specifically:

- `AC-S136-01: single-click creates a preview tab` ≅ S29 `new table tab is
  preview by default` (line 607).
- `AC-S136-01: clicking a different row swaps the preview slot` ≅ S29
  `clicking another table replaces preview tab` (line 629).
- `AC-S136-02: promoteTab flips isPreview to false; further row clicks
  open a separate preview tab` partially overlaps S29 `permanent tab is
  not replaced by new preview` (line 658), but extends it with the
  "subsequent preview tab is appended" assertion.
- `AC-S136-04: clicking the same row twice is idempotent` is **genuinely
  new** — no S29 baseline asserts the no-op short-circuit when the same
  table is re-added.

The duplicates are still useful for AC-traceability (auditors searching for
`AC-S136-04` find a direct hit) but the framing in the handoff
("4 AC-mapped tests under the existing 'preview tab system' describe block")
slightly oversells the coverage delta. The genuine net new behavior is
~1.5 tests' worth.

**P3-03 — Function-overflow test uses 60 functions; contract scenario
suggests 100+.** The contract's *Scenario Tests* checklist includes
"function 100+개 → 외부 layout 변동 없음". The new test uses 60 functions.
60 is well above any plausible single-screen render and the assertion is
class-based (not layout-based), so the threshold doesn't change the test's
verdict. Filing as P3 — bumping the fixture to 100 (or 200, to also cross
the virtualization threshold and exercise P2-01) would tighten the
scenario coverage at zero cost.

**P3-04 — `handleTableDoubleClick` reads `activeTabId` rather than the
newly-created tab id.** `SchemaTree.tsx:601-607` calls `handleTableClick`
then reads `useTabStore.getState().activeTabId`. This relies on `addTab`
synchronously promoting the new (or swapped) tab to active, which is
indeed the case in `tabStore.addTab` (sets `activeTabId` in every branch).
It is robust today but coupled to that invariant. Generator could have
returned the tab id from `addTab` for clarity; not refactoring it is a
reasonable scope-discipline choice.

## Verdict: PASS

All 8 acceptance criteria met with concrete evidence (14 new + 5 baseline
S134 tests passing; production wiring verified end-to-end; 7 verification
gates green). All 5 scorecard dimensions ≥ 7. Zero P1 findings; two P2
findings are quality-of-life improvements that do not block merge. Generator's
assumption disclosures are accurate and the handoff faithfully reflects the
"통합" decision (reusing the pre-existing `isPreview` / `promoteTab` /
italic-opacity-70 cue rather than introducing parallel concepts).

Recommend merging S136 and folding P2-01 (virtualized branch cap) and
P2-02 (Mongo "promote stuck" assertion) into a S137 or polish backlog
item.
