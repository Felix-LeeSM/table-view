# Sprint 136 — Handoff

## Summary

Sprint 136 unifies sidebar click semantics across paradigms — single-click
opens a preview tab and double-click promotes it to persistent — and caps
the function/procedure category list with `max-h-[50vh] + overflow-y-auto`
so a deeply populated function category cannot push the rest of the
sidebar out of the viewport.

Per the contract's "이미 비슷한 게 있다면 통합" rule, the existing
`isPreview: boolean` field on `TableTab` and the existing
`promoteTab(tabId)` action are reused as the canonical preview API rather
than introduced as a parallel `preview` field. The contract uses
`tab.preview === true` in prose; the production field name is `isPreview`
and the new tests assert against it.

All 7 verification gates pass:

| # | Command | Status |
|---|---|---|
| 1 | `pnpm vitest run` | 2063 passed (128 files) |
| 2 | `pnpm tsc --noEmit` | 0 errors |
| 3 | `pnpm lint` | 0 errors |
| 4 | `pnpm contrast:check` | 0 new violations |
| 5 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 268 passed, 2 ignored |
| 6 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | clean |
| 7 | `pnpm exec eslint e2e/**/*.ts` | 0 errors |

## Changed Files

| Path | Purpose |
|------|---------|
| `src/components/schema/SchemaTree.tsx` | Add `handleTableDoubleClick` (open via `addTab` then `promoteTab`); wire `onDoubleClick` on table rows in all three render paths (virtualized, eager nested, SQLite flat); wrap function/procedure category content with `max-h-[50vh] overflow-y-auto` (AC-S136-05) and a `data-category-overflow="capped"` test hook. |
| `src/stores/tabStore.test.ts` | Add 4 AC-mapped tests (AC-S136-01 single-click create + swap, AC-S136-02 promote, AC-S136-04 idempotent same-row click) under the existing `preview tab system` describe block. |
| `src/components/schema/SchemaTree.preview.test.tsx` | **CREATED** — RTL preview/promote tests for the relational tree (AC-S136-01, AC-S136-02, AC-S136-04) plus the function category overflow cap test (AC-S136-05). |
| `src/components/schema/DocumentDatabaseTree.tsx` | Single-click on a collection now also opens the preview tab via `handleCollectionOpen` (previously selected only); add `handleCollectionDoubleClick` that opens then promotes. Wires the new handler to the collection button's `onDoubleClick`. |
| `src/components/schema/DocumentDatabaseTree.test.tsx` | Add 3 AC-mapped tests (AC-S136-03 single-click preview, AC-S136-03 double-click promote, AC-S136-04 idempotent same-collection click). |
| `src/components/layout/TabBar.test.tsx` | Add 2 AC-S136-06 tests pinning the preview cue (italic + opacity-70) and asserting it coexists with the dirty marker on the same tab without overlap. |

No production-side changes to `TabBar.tsx` were needed — the preview cue
(italic + opacity-70 on the title span) and the dirty marker
(`data-dirty="true"` dot to the right of the title) already render
independently. The new tests pin both cues so any future refactor that
re-couples them would fail loudly.

## Verification Commands (last 20 lines each)

### 1. `pnpm vitest run`

```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  128 passed (128)
      Tests  2063 passed (2063)
   Start at  01:57:15
   Duration  21.26s (transform 5.29s, setup 7.78s, import 33.39s, tests 50.14s, environment 80.26s)
```

### 2. `pnpm tsc --noEmit`

```
(no output — exit 0)
```

### 3. `pnpm lint`

```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .

(exit 0)
```

### 4. `pnpm contrast:check`

```
> table-view@0.1.0 contrast:check /Users/felix/Desktop/study/view-table
> tsx scripts/check-theme-contrast.ts

WCAG AA contrast: 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)
```

### 5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`

```
test storage::tests::test_save_connection_empty_password_not_encrypted ... ok
test storage::tests::test_save_connection_rejects_duplicate_name ... ok
test storage::tests::test_save_connection_same_name_same_id_succeeds ... ok
test storage::tests::test_save_connection_updates_existing_by_id ... ok
test storage::tests::test_save_connection_with_none_preserves_existing ... ok
test storage::tests::test_save_group_adds_and_updates ... ok
test storage::tests::test_save_multiple_connections ... ok

test result: ok. 268 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

### 6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.32s
```

### 7. `pnpm exec eslint e2e/**/*.ts`

```
(no output — exit 0)
```

## AC Coverage

### AC-S136-01 — PG single-click → preview tab; row swap

- Production: `handleTableClick` in `SchemaTree.tsx` calls `addTab` which
  creates a tab with `isPreview: true` (default). Subsequent clicks on
  different rows hit the `previewIdx` swap branch in `tabStore.addTab`
  so the slot is mutated rather than appended.
- Tests:
  - `tabStore > preview tab system > AC-S136-01: single-click creates a preview tab (isPreview === true)` (passes)
  - `tabStore > preview tab system > AC-S136-01: clicking a different row swaps the preview slot (no tab accumulation)` (passes)
  - `SchemaTree — Sprint 136 preview / persist click semantics > AC-S136-01: single-click on a table row opens a preview tab (isPreview=true)` (passes)
  - `SchemaTree — Sprint 136 preview / persist click semantics > AC-S136-01: clicking a different row swaps the preview slot (no tab accumulation)` (passes)

### AC-S136-02 — same row double-click → promote

- Production: each table row in all three render paths now carries
  `onDoubleClick` → `handleTableDoubleClick` → `addTab` then
  `promoteTab(activeTabId)`. After promote the next single-click on a
  different row spawns a fresh preview tab beside the promoted tab
  (confirms the promote stuck).
- Tests:
  - `tabStore > preview tab system > AC-S136-02: promoteTab flips isPreview to false; further row clicks open a separate preview tab` (passes)
  - `SchemaTree — Sprint 136 preview / persist click semantics > AC-S136-02: double-click on a table row promotes the preview tab (isPreview=false)` (passes)

### AC-S136-03 — Mongo collection click follows the same model

- Production: `DocumentDatabaseTree.tsx` collection button:
  - `onClick` now calls `handleCollectionOpen` (open preview tab) +
    `setSelectedNodeId` (was: select only).
  - `onDoubleClick` calls the new `handleCollectionDoubleClick` which
    opens then promotes.
- Tests:
  - `DocumentDatabaseTree > AC-S136-03: single-click on a collection opens a preview tab (isPreview=true)` (passes)
  - `DocumentDatabaseTree > AC-S136-03: double-click on a collection promotes the tab (isPreview=false)` (passes)

### AC-S136-04 — same row single-click twice is idempotent

- Production: `addTab` early-returns on exact (connectionId, table) match,
  only updating `activeTabId`. The preview flag is untouched. No new
  tab is appended and no promote is triggered.
- Tests:
  - `tabStore > preview tab system > AC-S136-04: clicking the same row twice is idempotent (no second tab, no promote)` (passes)
  - `SchemaTree — Sprint 136 preview / persist click semantics > AC-S136-04: same-row single-click twice is idempotent (no extra tab, no promote)` (passes)
  - `DocumentDatabaseTree > AC-S136-04: same-collection single-click twice is idempotent (no extra tab, no promote)` (passes)

### AC-S136-05 — Function category overflow cap

- Production: in `SchemaTree.tsx`, the inner content `<div>` of each
  category gains `max-h-[50vh] overflow-y-auto` only for the
  `functions` and `procedures` categories. A `data-category-overflow="capped"`
  attribute on the same element gives tests a stable hook independent of
  className ordering.
- Tests:
  - `SchemaTree — Sprint 136 function category overflow (AC-S136-05) > caps the function category container with max-h-[50vh] + overflow-y-auto when 60+ functions are present` (passes — 60-fixture asserts the capped container exists, carries `max-h-[50vh] overflow-y-auto`, and contains the rendered function items).
  - JSDOM does not lay out real heights, so the test asserts on the
    capped container's classes / data attribute / item presence rather
    than on `getBoundingClientRect()` — the contract permits either
    approach ("If `getBoundingClientRect` is unreliable in JSDOM, assert
    presence of the `overflow-y-auto` class and `max-height` style/class
    instead — pragmatic.").

### AC-S136-06 — Preview cue + dirty marker coexist on TabBar

- Production: `TabBar.tsx` already renders the preview cue (`italic
  opacity-70` on the title span when `tab.type === "table" && tab.isPreview`)
  and the dirty marker (`data-dirty="true"` dot, rendered when
  `dirtyTabIds.has(tab.id)`) as siblings inside the same tab cell. Their
  selectors are independent so they trivially coexist; no production
  change required.
- Tests (new, in `TabBar.test.tsx`):
  - `TabBar > preview tab carries the preview visual cue (italic + opacity-70) without a dirty marker (AC-S136-06)` (passes)
  - `TabBar > preview cue and dirty marker coexist on the same tab (AC-S136-06)` (passes — both `italic` + `opacity-70` AND `[data-dirty="true"]` dot present in the same tab cell).
- Pre-existing baseline tests confirm the cues are independent:
  - `preview tab has italic title` (S29 baseline) — italic on preview
  - `permanent tab does not have italic title` (S29 baseline) — no italic on persistent
  - `renders a dirty mark for tabs in dirtyTabIds (AC-01)` (S97 baseline) — dot on dirty
  - `renders the dirty mark on a tab that is NOT the active tab (AC-S134-06)` (S134 baseline) — dot independent of activeTabId

### AC-S136-07 — Regression guard

- All previously-green tests stay green. Notable guards:
  - **Dirty marker independent of active tab (S134)**:
    `renders the dirty mark on a tab that is NOT the active tab (AC-S134-06)` — green.
    `does NOT render a dirty mark on the active tab when only an inactive sibling is dirty (AC-S134-06)` — green.
  - **DBMS shape (S135)**: `SchemaTree.dbms-shape.test.tsx` (6 tests) and
    `DocumentDatabaseTree > renders database → collection (2-level tree, no schema layer) — AC-S135-05` — all green.
  - **Favorites / context menu / keyboard nav**: `SchemaTree.test.tsx`
    suite (135+ tests including F2 rename, ContextMenu Drop/Rename/Data,
    Enter/Space expand) — all green.
  - **Cmd+W / Cmd+T / Cmd+S / Cmd+1..9**: covered by
    `Sidebar.test.tsx`, `App.test.tsx`, etc. — all green.
- Test count: 2049 (before) → 2063 (after); +14 net new tests, 0 lost.

### AC-S136-08 — 7 gates green

See the table at the top of this handoff. Gates 1–7 all pass.

## Assumptions

1. **Field name unification**. Per the contract's "이미 비슷한 게 있다면
   통합" rule and the user prompt's "If the existing tabStore already
   has a similar concept (some projects call it 'preview' or 'transient'),
   unify rather than add a parallel field," I kept the production-side
   field name `isPreview` (already in `TableTab`) instead of adding a
   parallel `preview` field. The contract's prose
   (`tab.preview === true`) is treated as conceptual, and tests assert
   `isPreview === true / false` against the actual production field.
   Renaming would have been a multi-file refactor without behavioral
   benefit and would have risked S134/S135 regressions.

2. **Function category cap, not the whole tree**. The contract / brief
   call out the function category specifically (and "임의 카테고리"
   parenthetically). I applied the cap only to the `functions` and
   `procedures` categories — Tables/Views already paginate via the
   search input + bounded table count, so capping them would shrink
   their existing affordance without an observed bug. Procedures share
   the same unbounded-list shape as Functions in PG, so the cap covers
   both.

3. **`max-h-[50vh]` cap value**. The user prompt and contract both
   suggest `50vh` as a sensible cap. JSDOM does not compute layout, so
   the test asserts class presence + the `data-category-overflow`
   attribute rather than measuring real height. In a real Webkit window
   this caps the function list at half the sidebar height; the user
   gets a native scroll inside the sidebar without affecting outer
   layout.

4. **Mongo single-click semantics shifted**. Previously the document
   tree's single-click on a collection only set `selectedNodeId` (no
   tab). After S136 it also opens the preview tab. The pre-existing
   "double-clicking a collection opens a document-paradigm TableTab"
   test continues to pass because double-click still ends with a tab
   open (now also promoted, but the test only asserts the tab fields,
   not `isPreview`).

5. **Promote-on-edit not implemented**. The user prompt called this out
   as optional ("Editing a preview SQL tab (typing in editor)
   auto-promotes to `preview=false`. Implement IF a clean place exists;
   OK to defer if intrusive — just note it as a non-blocker in handoff
   Risks."). The clean place would be inside `updateQuerySql` in the
   tabStore, but flipping `isPreview` there would also affect
   table-tab edits (which thread through different actions) and
   would couple the preview model to the editor stream — both
   non-trivial cross-surface concerns. Deferring per the prompt's
   explicit allowance. See **Risks / Gaps** below.

6. **Table-tab path only**. `handleTableDoubleClick` only triggers on
   table rows, not view/function rows. Views spawn dedicated table tabs
   (which would be a sensible promote-on-double-click target — but the
   AC text only mentions tables, and views don't currently exhibit the
   single-click preview problem because each view click adds a
   separately-keyed tab). Functions go via `addQueryTab` which doesn't
   participate in the preview slot. Capturing only the table-row paths
   keeps the change minimal and contract-faithful.

7. **No virtualization regression**. AC-S136-05 was the test scenario
   that risked colliding with the S115 virtualizer (`shouldVirtualize`
   triggers above 200 visible rows). With 60 functions + 1 schema, the
   total visible-rows count stays well below the threshold, so the
   eager render path runs and the cap classes are real DOM. Tests above
   200 rows would route through the virtualizer's flat-list render, which
   does NOT apply the cap — but in that branch the virtualizer itself
   windows the list to ~viewport height, so the underlying problem
   (function list pushing layout) cannot occur there either.

## Risks / Gaps

- **Promote-on-edit is deferred** (assumption #5). Today, typing in a
  preview SQL tab does not auto-promote it; the user must explicitly
  double-click the sidebar row or use a future TabBar-side double-click.
  The pre-existing TabBar `onDoubleClick` already promotes a preview
  tab when the user double-clicks the tab itself — so the user has
  three promote paths today (sidebar row dblclick, tab dblclick,
  explicit `promoteTab` from store). Adding edit-time promote is a
  small follow-up if it becomes a usability complaint; there is no
  open ticket asking for it as of S136.

- **None blocking**. All 7 verification gates green. No pending P1/P2
  findings.

## References

- Contract: `docs/sprints/sprint-136/contract.md`
- Execution brief: `docs/sprints/sprint-136/execution-brief.md`
- Master spec: `docs/sprints/sprint-134/spec.md` (Phase 10 합본 — Sprint 136 section)
- Origin lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- S134 baseline: `docs/sprints/sprint-134/handoff.md`
- S135 baseline: `docs/sprints/sprint-135/handoff.md`
