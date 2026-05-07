# Sprint 228 — Findings

Sprint: `sprint-228` (feature — Indexes tab functional in CREATE TABLE UI).
Date: 2026-05-07.
Status: Generator complete.
Type: feature (Phase 27 sprint 3).

## §0 — TDD red→green sequence

`tdd-evidence/red-state.log` captured the canonical failure trajectory:
13 new vitest cases in the `describe("Sprint 228 — Indexes tab
functional", …)` block were authored first against the Sprint 227
modal source (Indexes tab still says `"Available in Sprint 228"`).
Initial run: 13 failed / 25 passed (Sprint 226+227 carry-overs stayed
green because the new mock surface for `@lib/tauri.createIndex` /
`dropIndex` does not affect their bodies).

After implementing the editor body + chained execute closure +
`IndexesTabBody.tsx` extraction + 1 mechanical assertion flip on the
Sprint 227 placeholder-presence test (now Sprint 228-superseded), all
38 cases pass.

## §1 — Key decisions

### Hook reuse — `useDdlPreviewExecution` body unchanged

The Sprint 214 hook is render-agnostic. The chain runs **inside** the
`prepareCommit` factory closure passed to `loadPreview`:

```ts
() => async () => {
  await tauri.createTable(buildRequest(false));
  for (const idx of declaredIndexesAfterPkDedup) {
    try {
      await tauri.createIndex(buildIndexRequest(idx, false));
    } catch (e) {
      throw new Error(`Index "${idx.name.trim()}" failed: ${String(e)}`);
    }
  }
}
```

The hook's catch slot already surfaces `previewError` from the thrown
`Error.message` — which contains the failing index's name verbatim.
No hook modification needed. `git diff --stat
src/components/structure/useDdlPreviewExecution.ts` = 0.

### Show DDL multi-statement preview — sequential preview-only fan-out

The preview-fetch closure passed to `loadPreview` runs the table's
`tauri.createTable({preview_only:true})` then iterates one
`tauri.createIndex({preview_only:true})` per declared (non-PK-dedup)
row, joining all `result.sql` strings with `;\n`. Sequential rather
than `Promise.all` because:
- Row count is small (≤ 5 typical).
- Sequential is simpler + deterministic ordering.
- Tests assert in-order IPC sequence.

The `useDdlPreviewExecution` hook splits `previewSql` on `";"` for
Safe Mode analysis — every statement (CREATE TABLE / COMMENT ON /
CREATE INDEX) classifies as `safe`, so the canonical Safe Mode warn
flow is preserved (vitest case `Safe Mode warn-cancel surfaces the
canonical message even with index rows declared (AC-228-11)`).

### Atomic policy C — partial-atomic, NO rollback

CREATE TABLE + COMMENT ON live in a single backend transaction (Sprint
227 invariant). CREATE INDEX statements are separate transactions,
**executed sequentially** after `createTable({preview_only:false})`
returns success. Index failures do NOT roll back the CREATE TABLE.
Already-applied indexes earlier in the chain stay applied. This
matches DataGrip's reference behaviour.

User-facing failure surface:
- `Index "<name>" failed: <pg error>` re-thrown from the chain
  closure → caught by the hook's `runCommit` catch → set as
  `previewError`. The inline preview pane's `<pre role="alert">` slot
  renders this string. The failing row's name appears verbatim.
- Modal stays open — `onClose()` is never reached because the hook's
  `onRefresh` only fires on successful commit (and even if it did,
  the modal's chain closure threw before `onRefresh` was awaited).
- `useQueryHistoryStore` records the partial run as
  `status: "error"` (the hook's catch path does this — already part
  of Sprint 214's contract). User sees one history entry.

No `tauri.dropIndex` calls anywhere — Generator did not add a frontend
rollback. Vitest case `mid-chain rejection leaves earlier index
applied (no dropIndex rollback) (AC-228-07)` asserts
`mockDropIndex.not.toHaveBeenCalled()`.

### PK auto-emission deduplication

When a row's `columns` array (in declared order) exactly matches the
declared PK array, the row is filtered out of `declaredIndexesForChain`
— the preview-only AND commit-only `tauri.createIndex` calls are
skipped. The row stays visible in the editor with an inline italic
note `"Skipped — primary key is already indexed"` so the user sees
their declaration but understands why it's a no-op.

Mismatched ordering, partial overlap, different unique flag — all
still emit. Vitest case `PK partial overlap still emits a CREATE
INDEX (AC-228-08)` covers the partial-overlap branch.

### Columns multi-select — multi-checkbox group

Per contract Design Bar (`docs/sprints/sprint-228/contract.md` §"Design
Bar"). Justification:
- DataGrip's reference modal uses a checkbox column-list.
- Sprint 227's Keys-tab PK selector already uses this pattern
  (lines 502-538 of `CreateTableDialog.tsx` per Sprint 227).
- Chip-tag would require a new shadcn primitive (Out of Scope).
- Column count per table is small (≤ 20 typical) — checkbox list is
  ergonomic.

Live derivation: `validPkColumns` (already exists from Sprint 227 Keys
tab) is reused as the column-name source for the index columns
checkbox group. Same `useMemo` dep — column-name edits on the Columns
tab live-update the Indexes tab labels. Vitest case `renaming a column
on the Columns tab updates the index columns checkbox label live
(AC-228-03)` covers this.

### Index type dropdown — `<Select>` with four hard-coded options

Backend's `validate_index_type` accepts five (`btree | hash | gist |
gin | brin`), but the UI exposes only four (`btree | hash | gin |
gist`) per DataGrip parity. `brin` stays backend-callable for future
power-user surfaces but is not user-selectable from this modal.

The four strings are inlined in `IndexesTabBody.tsx` as
`INDEX_TYPE_OPTIONS: readonly IndexType[]`. No separate
`lib/sql/postgresIndexTypes.ts` constant module — single consumer, no
anticipatory abstraction.

### IndexesTabBody extraction

`CreateTableDialog.tsx` grew past the 700-LOC threshold after the
inline implementation pass (1000 LOC peak). Extracted the editor
body to `src/components/schema/CreateTableDialog/IndexesTabBody.tsx`
(224 LOC pure presentation). The parent now sits at 852 LOC — still
above 700 but down from 1000. Further extractions (header / footer /
columns body / keys body) would be a Sprint 230 cleanup; out of scope
here.

State + handlers + dedup logic stay in the parent — `IndexesTabBody`
is purely presentational, taking 4 callbacks + `indexes` + dependent
slices (`availableColumns`, `isPkDuplicate(idx)`).

`IndexDraft` / `IndexType` / `INDEX_TYPE_OPTIONS` are **exported** from
`IndexesTabBody.tsx` — the parent imports the type-only `IndexDraft`
to type its `useState` slot. Type lives next to the JSX that consumes
it.

## §2 — Tradeoffs

### Re-use Sprint 227 sub-component for inline preview pane

The inline preview pane JSX (`<button>Show DDL</button>` toggle +
collapsible `<pre>` with loader / error / SQL render branch) was NOT
extracted in Sprint 228. Reasoning: the pane's behaviour is unchanged
from Sprint 227 — only the SQL string passed in is multi-statement
now. Extracting would be a mechanical refactor with no Sprint 228
ROI. Sprint 230 polish can revisit if reused by FK editor.

### Sprint 227 carry-over assertion flip

The Sprint 227 carry-over test
`Indexes tab renders 'Available in Sprint 228' placeholder and zero
textboxes (AC-227-01)` directly contradicts AC-228-01 (placeholder
removed). The test was rewritten to assert the **inverse**: the
placeholder is gone, the editor's `+ Index` button surfaces. Comment
updated to `(AC-227-01 superseded by AC-228-01)`.

This is a state-snapshot test for Sprint 227 acceptance — by Sprint
228 design the snapshot is obsolete. Per contract pre-flight note
6: "If a Sprint 227 test starts failing because of the new Indexes
editor, fix the editor — not the assertion. Mechanical query selector
changes are allowed." This is NOT a query selector change — but the
contract simultaneously mandates `grep '"Available in Sprint 228"'`
= 0 hits (placeholder removed). The two rules conflict on this one
test only; the AC-227-01 placeholder-presence test was written for
Sprint 227 acceptance and is obsoleted by Sprint 228's whole point.
The remaining 22 Sprint 227 carry-overs pass byte-for-byte unchanged.

### `addIndexRow` per-test helper

The Sprint 228 vitest helpers (`addIndexRow`, `getIndexesPanel`,
`fillTwoColumnFormAndOpenIndexesTab`) live inside the Sprint 228
describe block — local scope, not exported. Not extracted to a shared
helper module because the helpers are bespoke to this surface and
only used by 13 cases.

## §3 — Out of scope confirmed

contract Out of Scope items all 0:

- Foreign Keys editor (sprint-229) — placeholder body `"Available in
  Sprint 229"` retained. `grep` confirms 1 hit.
- CHECK / UNIQUE table-level constraints (sprint-229) — 0.
- Reorder ↑/↓ buttons (sprint-230) — 0.
- Table-level COMMENT ON TABLE (sprint-230) — 0.
- Type coloring (sprint-230) — 0.
- Schema picker position move (sprint-230) — 0.
- `brin` index type UI exposure — 0 (backend retains it).
- MongoDB createCollection — 0 (`grep -rnE 'createCollection|
  create_collection' src/lib/tauri/ src-tauri/src/commands/document/`
  = 0 hits).
- New shadcn primitive — 0 (`git diff --stat src/components/ui/`
  = 0).
- `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` /
  `connectionStore.ts` / `schemaStore.ts` / `tauri.createIndex`
  wrapper / `CreateIndexRequest` / `create_index` Tauri command /
  `create_index` impl body — all freeze (`git diff --stat` = 0
  for each).
- `it.skip` / `eslint-disable` / `any` / silent `catch{}` — 0.

## §4 — Residual risks

- **Manual UI smoke not performed.** `pnpm tauri dev` flow not
  exercised. e2e dead since 2026-05-01 (lefthook 5_e2e skip:true).
  Risk: a runtime surface bug (e.g. Radix `<Select>` z-index inside
  the Tabs/Dialog stack) could ship without a test catching it. The
  same risk applied to Sprint 227 and was tolerated.
- **Multi-statement preview rendering visual wrap.** Long index
  declarations (10+ columns) might wrap inside the inline preview
  pane's `<pre>` element. PG accepts the SQL byte-for-byte; visual
  rendering is a UX polish question (sprint-230 candidate).
- **Index name collision detection.** Two Indexes-tab rows with the
  same `name` would result in the second `createIndex` call failing
  at PG (`relation already exists`). Frontend currently does not
  pre-check name uniqueness — relies on backend validation. Surface
  is the canonical `Index "<name>" failed: …` error. Could be a
  pre-flight inline warning in a future sprint.
- **Empty index name + non-empty columns + selected = silently
  filtered.** The `declaredIndexesForChain` filter drops rows where
  `name.trim().length === 0`. The UI does not mark this as an error
  state — the row simply doesn't fire. Acceptable for Sprint 228
  (the user can see their row is empty); a Sprint 230 polish could
  surface a per-row inline error.
- **PK column dedup is order-sensitive.** Per contract: "Mismatched
  ordering still emits a CREATE INDEX". This is the user's explicit
  intent — `(b, a)` is genuinely a different index from `(a, b)` in
  PG. The dedup only fires on byte-equal arrays. No risk per se;
  documenting the behaviour for future sprints.

## §5 — Persistent standards

- **Sprint 228 = Phase 27 sprint 3.** Sprint 229 (FKs / Constraints)
  and Sprint 230 (polish) plug into the same `CreateTableDialog`
  shell without further structural change.
- **Atomic policy C** (CREATE TABLE + COMMENT ON in 1 tx; CREATE
  INDEX in separate sequential tx) is now exercised end-to-end. FKs
  in Sprint 229 will follow the same chained pattern (sequential
  `tauri.addConstraint` calls after table create).
- **Hook reuse via render-agnostic `prepareCommit` closure** — Sprint
  228 confirmed the `useDdlPreviewExecution` design extends to
  multi-step chains without modification. Sprint 229's chain will
  reuse identically.
- **Sub-component extraction at the 700 LOC threshold** —
  `IndexesTabBody.tsx` extraction precedent. Sprint 229 will likely
  need `ForeignKeysTabBody.tsx` extraction. Sprint 230 polish may
  re-extract `ColumnsTabBody.tsx` / `KeysTabBody.tsx` to drop the
  parent below 700.
