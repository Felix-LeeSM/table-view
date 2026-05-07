# Sprint 229 — Findings

Sprint: `sprint-229` (feature — Foreign Keys + CHECK + UNIQUE
constraints tab functional in CREATE TABLE UI).
Date: 2026-05-07.
Status: Generator complete.
Type: feature (Phase 27 sprint 4).

## §0 — TDD red→green sequence

`tdd-evidence/red-state.log` captures the canonical failure
trajectory. Tests authored first, against the Sprint 228 modal
source (Foreign Keys tab still says `"Available in Sprint 229"`):

- **`ForeignKeysTabBody.test.tsx`** (10 cases) → all 10 fail because
  the component file didn't exist; vite import resolution errored.
- **`CreateTableDialog.test.tsx`** Sprint 229 describe block (13
  cases) + 1 mechanical assertion flip on the Sprint 227 placeholder
  test → 14 fail because the FK tab body still renders the placeholder
  + the modal doesn't yet call `tauri.addConstraint` from any chain
  closure + `Add foreign key` / `Add check` / `Add unique` buttons
  don't exist + ON DELETE / ON UPDATE selectors don't render.

Initial run before implementation:
```
ForeignKeysTabBody.test.tsx → 1 file failed (vite import error)
CreateTableDialog.test.tsx → 14 failed | 38 passed (52)
```

After implementing the editor body + chained execute closure +
`ForeignKeysTabBody.tsx` extraction + Path A backend extension + 1
mechanical assertion flip on the Sprint 227 placeholder-presence
test, all 62 cases (52 + 10) pass.

## §1 — Key decisions

### Hook reuse — `useDdlPreviewExecution` body unchanged

The Sprint 214 hook is render-agnostic. The chain runs **inside** the
`prepareCommit` factory closure passed to `loadPreview`. Sprint 228's
chain (CREATE TABLE → CREATE INDEX × M) gets a third loop appended:

```ts
() => async () => {
  await tauri.createTable(buildRequest(false));
  for (const idx of chainIndexes) {
    try { await tauri.createIndex(buildIndexRequest(idx, false)); }
    catch (e) { throw new Error(`Index "${idx.name.trim()}" failed: ${String(e)}`); }
  }
  for (const c of chainConstraints) {
    try { await tauri.addConstraint(buildConstraintRequest(c, false)); }
    catch (e) { throw new Error(`Constraint "${c.name}" failed: ${String(e)}`); }
  }
}
```

The hook's catch slot already surfaces `previewError` from the thrown
`Error.message` — which contains the failing constraint's name verbatim.
No hook modification needed. `git diff --stat
src/components/structure/useDdlPreviewExecution.ts` = 0.

### Show DDL multi-statement preview — sequential preview-only fan-out

The preview-fetch closure passed to `loadPreview` runs the table's
`tauri.createTable({preview_only:true})` then iterates one
`tauri.createIndex({preview_only:true})` per declared (non-PK-dedup)
row, then one `tauri.addConstraint({preview_only:true})` per
declared (validated) FK / CHECK / UNIQUE row. All `result.sql`
strings joined with `;\n`. Sequential rather than `Promise.all`
because:
- Row count is small (≤ 5 typical per family).
- Sequential is simpler + deterministic ordering.
- Tests assert in-order IPC sequence.
- The ON DELETE / ON UPDATE clauses depend on backend validation
  ordering; sequential lets us stop at the first invalid row.

The `useDdlPreviewExecution` hook splits `previewSql` on `";"` for
Safe Mode analysis — every statement (CREATE TABLE / COMMENT ON /
CREATE INDEX / ALTER TABLE ADD CONSTRAINT) classifies as `safe`, so
the canonical Safe Mode warn flow is preserved (vitest case `Safe
Mode warn-cancel surfaces the canonical message even with constraints
declared`).

### Atomic policy C — partial-atomic, NO rollback

CREATE TABLE + COMMENT ON live in a single backend transaction
(Sprint 227 invariant). CREATE INDEX statements (Sprint 228) and
ALTER TABLE ADD CONSTRAINT statements (Sprint 229) are separate
transactions, **executed sequentially** after `createTable({preview
_only:false})` returns success. Index/constraint failures do NOT
roll back the CREATE TABLE. Already-applied indexes/constraints
earlier in the chain stay applied. This matches DataGrip's reference
behaviour.

User-facing failure surface:
- `Constraint "<name>" failed: <pg error>` re-thrown from the chain
  closure → caught by the hook's `runCommit` catch → set as
  `previewError`. The inline preview pane's `<pre role="alert">` slot
  renders this string. The failing row's name appears verbatim.
- Modal stays open — `onClose()` is never reached because the hook's
  `onRefresh` only fires on successful commit.
- `useQueryHistoryStore` records the partial run as `status: "error"`
  (Sprint 214 baseline behaviour). User sees one history entry.

No `tauri.dropConstraint` calls anywhere — Generator did not add a
frontend rollback. Vitest case `2nd addConstraint(commit) rejection
halts chain, modal stays open, error names failing constraint
(AC-229-08)` asserts `mockDropConstraint.not.toHaveBeenCalled()`.

### Path A backend extension — ON DELETE / ON UPDATE landed

`ConstraintDefinition::ForeignKey` enum arm gains 2 fields:
```rust
#[serde(default)]
on_delete: Option<String>,
#[serde(default)]
on_update: Option<String>,
```

PG SQL emitter extended in the FK match arm:
```rust
let on_delete_clause = format_referential_action_clause(
    on_delete.as_deref(),
    "ON DELETE",
)?;
let on_update_clause = format_referential_action_clause(
    on_update.as_deref(),
    "ON UPDATE",
)?;
format!(
    "FOREIGN KEY ({}) REFERENCES {} ({}){}{}",
    cols.join(", "),
    quote_identifier(reference_table),
    ref_cols.join(", "),
    on_delete_clause,
    on_update_clause,
)
```

`format_referential_action_clause` validates against the closed
whitelist `{NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT}`
(case-sensitive uppercase, PG canonical form). Anything else →
`AppError::Validation("Invalid ON DELETE action: <value>")`.

Existing `add_constraint_preview_foreign_key` fixture's emitted SQL
assertion at line 1325 stays byte-equivalent because the new fields
default to `None`, the helper returns `String::new()`, and the
emitter appends nothing. The struct literal at lines 1314-1318
gained 2 mechanical lines (`on_delete: None, on_update: None`) —
Rust syntax requires complete field listings in struct construction
even when `#[serde(default)]` is set (that attribute only affects
serde deserialization, not Rust source code).

### Constraint name auto-suggest at chain-assembly time

Format strings:
- FK default: `fk_<table>_<localCols_joined_underscore>`.
- CHECK default: `chk_<table>_<n>` where `n` is the row index (1-based).
- UNIQUE default: `uq_<table>_<columns_joined_underscore>`.

Implemented in `declaredConstraintsForChain` `useMemo` rather than as
`placeholder` text on the input. Reasoning:
- The chain needs the *resolved* name so the SQL emitter can quote
  it; computing it once at chain-assembly time + using `f.name.trim()
  || autoName` is a single source of truth.
- Placeholder text would also work but would require duplicate
  logic between the body (placeholder generator) and the parent
  (chain assembly). The two would need to stay in sync.
- The user-visible behaviour: blank input → chain uses auto-name;
  typed input → chain uses typed value.

### Reference table picker — reactive subscriptions + lazy ops via hook

`useSchemaStore((s) => s.tables)` + `useSchemaStore((s) => s
.tableColumnsCache)` are reactive selector subscriptions; the FK
editor body re-renders when a lazy `loadTables` / `getTableColumns`
populates a previously-empty key. So the dropdowns auto-fill
without the user having to re-open the row.

For the imperative one-shot triggers, I added `src/hooks/useFkRefer
encePicker.ts` (61 LOC). It exports `ensureTablesLoaded(refSchema)`
and `loadColumnsIfMissing(refSchema, refTable)`. Both wrap
`useSchemaStore.getState()` calls; the hook lives in `src/hooks/`
because `eslint.config.js`'s `no-restricted-syntax` rule (2026-05-05)
forbids `store.getState()` inside `src/**/*.tsx`. The schema store
body itself stays unchanged.

### Columns multi-select — multi-checkbox group

Per Sprint 228 `IndexesTabBody.tsx` precedent. FK local cols + FK
ref cols + UNIQUE columns all use multi-`<input type="checkbox">`
groups. No new shadcn primitive.

### ON DELETE / ON UPDATE Select — `<Select>` with 5 hard-coded options

Backend whitelists exactly 5; UI exposes exactly 5. Inlined in
`ForeignKeysTabBody.tsx` as `REFERENTIAL_ACTIONS: readonly
ReferentialAction[]`. No separate `lib/sql/postgresReferentialActions
.ts` constant — single consumer, no anticipatory abstraction.

### Default ON DELETE / ON UPDATE = `"NO ACTION"` (verbose form)

`newFkDraft()` initializes both to `"NO ACTION"`. The chain
serializes them as `Some("NO ACTION")` — backend emits the explicit
`ON DELETE NO ACTION` / `ON UPDATE NO ACTION` clause. This is one
of the two acceptable defaults per pre-flight note 11; chose the
verbose form for explicitness — `psql \d <table>` shows the user's
intent.

The other choice (omit clause when `"NO ACTION"`, behave as PG
default) would be ~5 LOC less in the emitter but obscures the
serialized intent in psql output.

### `ForeignKeysTabBody.tsx` extraction (608 LOC)

Larger than the contract's ~280 LOC estimate because three
sub-sections × per-row JSX (FK row alone has 7 inputs across 4
rows of layout) added up. Still a single shallow-tree presentational
mapper, no anticipatory abstraction — sub-section content lives
inline rather than being further sub-sub-extracted into
`ForeignKeyRow.tsx` / `CheckRow.tsx` / `UniqueRow.tsx` because:
- All three rows are < 100 LOC each.
- Per-row JSX uses props that flow trivially from the parent — no
  shared computation worth de-duplicating.
- Sprint 230 reorder polish would re-edit each row anyway.

Parent CreateTableDialog.tsx grew to 1199 LOC (up from 793). 286
LOC of the parent growth is in `declaredConstraintsForChain` memo
+ 13 handlers + reactive store wiring + `useFkReferencePicker`
consumption — all pre-extraction-resistant glue. Sprint 230 polish
could extract `ColumnsTabBody.tsx` / `KeysTabBody.tsx` to drop the
parent below 700 if the file becomes a maintenance burden.

## §2 — Tradeoffs

### `useFkReferencePicker` hook addition

Adding a new file under `src/hooks/` was not in the contract's
explicit "In Scope" list. I added it because:
- The contract pre-flight note 5 specifies `useSchemaStore.getState()`
  reads.
- `eslint.config.js` `no-restricted-syntax` (2026-05-05) forbids
  `getState()` in `src/**/*.tsx`.
- The two rules conflict; resolution = imperative ops live in
  `src/hooks/*` (rule allows there).
- The schema store body stays untouched (Sprint 224 freeze).
- Sprint 219+223+224 hook-extraction precedents (`useConnection
  Mutations`, `useSchemaTableMutations`, `useConnectionSession
  Hydration`) make this a recognized pattern.

The hook is 61 LOC, exports two pure-imperative ops, and has no
state of its own. If the contract author considers this a scope
violation, the alternative is a single `// eslint-disable-next-line
no-restricted-syntax` directive at each `getState()` call in
`CreateTableDialog.tsx` (4 sites) — but that's exactly what the
2026-05-05 rule was added to prevent.

### Sprint 227 carry-over assertion flip — single-test rewrite

The Sprint 227 carry-over test `Foreign Keys tab renders 'Available
in Sprint 229' placeholder and zero textboxes (AC-227-01)` directly
contradicts AC-229-01 (placeholder removed). The test was rewritten
to assert the **inverse**: the placeholder is gone, the editor's
3 sub-section add buttons surface. Comment updated to `(AC-227-01
superseded by AC-229-01)`.

This is a state-snapshot test for Sprint 227 acceptance — by Sprint
229 design the snapshot is obsolete. Per contract pre-flight note 8
("Sprint 226+227+228 carry-over tests should pass with NO
assertion-text changes EXCEPT the one Sprint 229-superseded flip"),
this is the single allowed flip. The remaining 38 Sprint 226+227+228
carry-overs pass byte-for-byte unchanged.

### `_unused` `getTableColumns` mock attempt

During the Sprint 229 cases I considered mocking
`getTableColumns` per-test to control the lazy-load resolution
exactly. I dropped that approach in favour of:
- Pre-seeding `tableColumnsCache` in `useSchemaStore.setState({...})`
  before each test that exercises the populated path.
- Asserting `loadTables` triggers via `vi.fn` injection on
  `useSchemaStore.setState({tables: {}, loadTables})`.

The simpler test setup avoids spy-target cross-talk between the hook
and the store body.

## §3 — Out of scope confirmed

Contract Out of Scope items all 0:

- Reorder ↑/↓ buttons (sprint-230) — 0.
- Table-level `COMMENT ON TABLE` (sprint-230) — 0.
- Type coloring (sprint-230) — 0.
- Schema picker position move (sprint-230) — 0.
- DEFERRABLE / INITIALLY DEFERRED — 0 (not exposed in UI).
- MATCH FULL / MATCH PARTIAL — 0 (not exposed in UI).
- SQL syntax highlighting / textarea for CHECK expression body — 0
  (single-line `<input>`).
- MongoDB createCollection — 0 (`grep -rnE 'createCollection|
  create_collection' src/lib/tauri/ src-tauri/src/commands/document/`
  = 0 hits).
- New shadcn primitive — 0 (`git diff --stat src/components/ui/`
  = 0).
- `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` /
  `connectionStore.ts` / `schemaStore.ts` / `tauri.addConstraint`
  wrapper / `IndexesTabBody.tsx` / `Header.tsx` /
  `CreateTableTypeCombobox.tsx` / `commands/rdb/ddl.rs::add_constraint`
  Tauri command — all freeze (`git diff --stat` = 0 for each).
- `it.skip` / `eslint-disable` / `any` / silent `catch{}` — 0.

## §4 — Residual risks

- **Manual UI smoke not performed.** `pnpm tauri dev` flow not
  exercised. e2e dead since 2026-05-01 (lefthook 5_e2e skip:true).
  Risk: a runtime surface bug (e.g. Radix `<Select>` z-index inside
  the Tabs/Dialog stack with multiple FK rows) could ship without a
  test catching it. Same risk applied to Sprint 226/227/228 and was
  tolerated.
- **CHECK expression body single-line.** Multi-line + SQL syntax
  highlighting deferred to Sprint 230+. Power users typing `(age
  >= 0 AND age <= 150) AND email LIKE '%@%'` may want word-wrap.
- **Reference column free-text fallback uses comma-split parsing.**
  When the column cache is empty (fetch failed / connection
  offline), the user types `id, name` and the parent splits on `,`
  + trims. No special-character handling beyond trim. Backend
  `validate_identifier` rejects malformed names. A future polish
  could surface inline errors per non-conforming column name.
- **Constraint name auto-suggest at chain-assembly time, not as
  placeholder text.** The user sees an empty input; if they leave
  it blank the chain uses the auto-suggested name. A future polish
  could surface the auto-suggested name as `placeholder` text so
  the user sees it in advance. Tradeoff documented in §1.
- **`ForeignKeysTabBody.tsx` LOC = 608** — bigger than contract
  estimate. Sprint 230 polish may extract per-sub-section bodies if
  reordering UI is added. Not a regression risk per se; documenting
  for future sprints.
- **Constraint name collision detection deferred.** Two FK rows with
  the same `name` would let the chain submit a duplicate to PG; the
  surface message names the failing constraint but the user must
  remove the duplicate manually. A pre-flight inline warning could
  be added in Sprint 230+.
- **ON DELETE / ON UPDATE = `"NO ACTION"` is always serialized.**
  PG output always includes the explicit clause. If the user prefers
  `psql \d <table>` to show the bare `FOREIGN KEY (...)` form
  (omitting the clause), they would need a Sprint 230 polish toggle.
  Documented as design choice in §1.
- **`useFkReferencePicker.ts` is a scope addition** (1 new file,
  61 LOC) not explicitly in the contract's "In Scope" list. Justified
  by the lint rule conflict; documented in §2. If the evaluator
  considers this a contract violation, the alternative is 4
  `eslint-disable-next-line no-restricted-syntax` directives in the
  modal — which the 2026-05-05 rule was added to prevent. The hook
  pattern follows Sprint 219+223+224 precedent.

## §5 — Persistent standards

- **Sprint 229 = Phase 27 sprint 4.** Sprint 230 (polish) plugs into
  the same `CreateTableDialog` shell without further structural
  change.
- **Atomic policy C** (CREATE TABLE + COMMENT ON in 1 tx; CREATE
  INDEX × M in separate sequential tx; ALTER TABLE ADD CONSTRAINT ×
  K in separate sequential tx after the indexes) is now fully
  exercised end-to-end. Future schema-write surfaces (e.g. ALTER
  TABLE add column + indexes + constraints) follow the same chained
  pattern.
- **Hook reuse via render-agnostic `prepareCommit` closure** — Sprint
  229 confirmed the `useDdlPreviewExecution` design extends to
  three-step chains without modification. Future multi-step DDL
  surfaces will reuse identically.
- **Sub-component extraction at the 700 LOC threshold** —
  `IndexesTabBody.tsx` (Sprint 228) + `ForeignKeysTabBody.tsx`
  (Sprint 229) precedents. Sprint 230 polish may re-extract
  `ColumnsTabBody.tsx` / `KeysTabBody.tsx` to drop the parent below
  700 (currently 1199).
- **Backend additive enum extension via `#[serde(default)]`** — Path
  A pattern (Sprint 229's `on_delete` / `on_update` on
  `ConstraintDefinition::ForeignKey`) keeps wire-level back-compat
  while requiring a 2-line struct-literal diff in existing Rust
  test fixtures. Future enum extensions (e.g. DEFERRABLE / MATCH on
  FK, partial-index WHERE on indexes) can follow the same pattern.
- **`useFkReferencePicker` hook pattern** — `eslint.config.js`
  `no-restricted-syntax` rule + selector-vs-imperative split. Future
  modals that need `getState()` calls should extract a small hook in
  `src/hooks/*` rather than disable the lint rule.
