# Sprint Contract: sprint-234

## Summary

- Goal: Phase 27 polish — UX consolidation across the `CreateTableDialog`. Six
  user-feedback items (originally batched as Sprint 230 polish, deferred since
  Sprint 230 closed as the dynamic PG type list cycle): (1) cross-tab visual
  feedback so column edits in the Columns tab show up in the Keys / Indexes /
  Foreign Keys tabs without switching, (2) explicit empty-state for the sub-tab
  column multi-checks when no column row has a name yet, (3) ↑/↓ reorder
  buttons on every row repeater (columns + indexes + FK + UNIQUE), (4)
  table-level `COMMENT ON TABLE` emit in the same `create_table` transaction,
  (5) move the schema picker out of the modal header into the body so it sits
  beside / above the Table name input, (6) `type_kind`-driven color dots in the
  type combobox using Sprint 230's `PostgresTypeInfo.type_kind` field. All six
  ride on the Sprint 226-233 frozen invariant set — diff = 0 outside the
  explicitly named modify list.

  **User feedback (2026-05-07)** — verbatim:
  > "Columns 탭에서 컬럼을 추가했을 때 다른 탭에서도 그게 반영됐다는 피드백
  > 이 있으면 좋겠고, name 비어 있는 row 가 PK / Index / FK column 체크박스
  > 에 어떻게 보일지 명시. 컬럼 reorder ↑↓, table COMMENT, schema picker
  > 위치는 header 말고 body 안 (table name 위), type combobox 는 type_kind
  > 별 색 표시."

- Audience: Generator + Evaluator (multi-agent harness, post-233 cycle, Phase
  27 sprint 9 — UX polish bundle).
- Owner: harness skill orchestrator.
- Verification Profile: `mixed` (command + static).

## In Scope

### Frontend (TS/TSX)

- **MOD** `src/hooks/usePostgresTypes.ts` (~+15 LOC): the existing hook returns
  `{ types: string[]; loading; error; reload }` (Sprint 230). Extend the
  surface so the cache entry exposes a derived `typesByName: Map<string,
  TypeKind>` alongside `types`. Map keys are the same display labels the hook
  already produces (`pg_catalog.X` → `X`, `<schema>.X` → `<schema>.X`). Values
  are the live `PostgresTypeInfo.type_kind`. Canonical entries (from
  `POSTGRES_COMMON_TYPES`) that have no live counterpart get the literal
  `"base"`. Empty `Map` while the first fetch is in flight (so consumers can
  call `.get(label)` safely without null-checking the map itself). Loading-UX
  invariant: like `types`, `typesByName` is always non-null even mid-fetch;
  the value just lacks the live extras until resolution. The existing
  Sprint 230 surface (`types`, `loading`, `error`, `reload`) stays
  byte-equivalent; this is purely additive.
- **MOD** `src/components/schema/CreateTableTypeCombobox.tsx` (~+25 LOC):
  add optional prop `typeKindMap?: Map<string, string>` (or `ReadonlyMap`).
  When supplied, render each option's `<button role="option">` with a small
  color dot prefix:
  - `"base"` → no dot (default — the dot wrapper is omitted entirely).
  - `"enum"` → `<span class="text-blue-500" aria-hidden>•</span>`
  - `"domain"` → `<span class="text-green-500" aria-hidden>•</span>`
  - `"range"` → `<span class="text-purple-500" aria-hidden>•</span>`
  - `"composite"` → `<span class="text-orange-500" aria-hidden>•</span>`
  - Any other / unknown kind → no dot (graceful degrade — never throw).
  The accessible name (`aria-label` / button text content) remains the type
  name verbatim — color dots do NOT inject characters into the option label
  (screen readers see only the type name). When `typeKindMap` is omitted, the
  combobox renders identically to Sprint 230 (back-compat for tests that don't
  thread the map). Lookup is case-sensitive on the display label string.
- **MOD** `src/components/schema/CreateTableDialog/Header.tsx` (~-25 LOC):
  REMOVE the schema picker block (the `{showSchemaPicker && <div ...>}`
  branch including the `<label>` and `<Select>`). The header collapses back to
  title + `<DialogDescription sr-only>` + close `<X>` button only. Drop the
  `selectedSchema` / `schemaOptions` / `onSchemaChange` props from the
  `CreateTableDialogHeaderProps` interface. The header becomes a thin title
  bar — all schema-picker concerns move to the parent body.
- **MOD** `src/components/schema/CreateTableDialog.tsx` (~+200 LOC, ~-15 LOC):
  multi-faceted polish — the largest surface of this sprint. All edits are
  surgical and preserve `trackingId`-keyed identity across reorders.
  - **Schema picker move (AC-234-07)**: render the schema picker INSIDE the
    body, **above** the Table name input (NOT to the left of it — see
    Decisions §Schema picker layout). The label "Target schema" + the
    `<Select value={selectedSchema} onValueChange={handleSchemaChange}>` block
    sits as the first body row. Table name is the second body row. Hide when
    `schemaOptions.length === 0` (mirrors the previous header guard).
  - **Table-level COMMENT (AC-234-05)**: render a single-line `<input>` for
    "Table comment" between the Table name input and the `<Tabs>` block.
    Optional, controlled, default empty. New state slot:
    `const [tableComment, setTableComment] = useState("");`. Invalidates the
    preview on change (calls `invalidatePreview()` in the same handler). Reset
    in `resetForm()`. Plumbed into `buildRequest(previewOnly)` as
    `table_comment: tableComment.trim() || null` (when empty post-trim, send
    `null` so backend `#[serde(default)]` keeps the Sprint 226-233 fixtures
    byte-equivalent).
  - **Column reorder (AC-234-03 + AC-234-04)**: insert `↑` / `↓` buttons
    immediately to the LEFT of the row's existing `−` button (not right —
    see Decisions §Reorder placement). Use `lucide-react`'s `ArrowUp` /
    `ArrowDown` icons (already in scope; if not, fall back to `ChevronUp` /
    `ChevronDown`). New parent handler:
    ```ts
    const handleMoveColumn = (trackingId: string, direction: -1 | 1) => {
      setColumns((prev) => {
        const idx = prev.findIndex((c) => c.trackingId === trackingId);
        if (idx < 0) return prev;
        const swap = idx + direction;
        if (swap < 0 || swap >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[swap]] = [next[swap]!, next[idx]!];
        return next;
      });
      invalidatePreview();
    };
    ```
    `↑` is disabled when `idx === 0`; `↓` is disabled when
    `idx === columns.length - 1`. The same pattern is applied to the indexes
    list (parent-owned `handleMoveIndex`) — see "Mirror reorder" below. FK /
    CHECK / UNIQUE rows also get the buttons — same handler shape, threaded
    through `ForeignKeysTabBody`'s props.
  - **Mirror reorder in IndexesTabBody**: parent owns `handleMoveIndex`,
    `IndexesTabBody` receives `onMove: (trackingId, direction) => void` +
    boundary booleans (or just thread the index position into the row map and
    derive disabled inline).
  - **Mirror reorder in ForeignKeysTabBody**: parent owns `handleMoveFk` /
    `handleMoveCheck` / `handleMoveUnique` — same shape. The body wires three
    new props (one per family).
  - **Cross-tab visual feedback (AC-234-01)**: render a small `(N)` count
    badge after each tab label when the relevant family has rows OR when
    `availableColumns.length > 0` matters. Decision (locked, see Decisions
    §Cue style): use `(N)` count badge — NOT a flash animation. Counts:
    - "Columns": none (the tab IS the source).
    - "Keys": `(${declaredPk.length})` when `declaredPk.length > 0`.
    - "Indexes": `(${declaredIndexesForChain.length})` when > 0.
    - "Foreign Keys": `(${declaredConstraintsForChain.length})` when > 0.
    Render as a sibling `<span class="ml-1 text-[10px] text-muted-foreground">`
    inside the `<TabsTrigger>` — does NOT affect the tab's accessible name
    because the digits flow as plain text after the label.
  - **Empty-state messages (AC-234-02)**: `IndexesTabBody`,
    `ForeignKeysTabBody` (FK + UNIQUE sub-sections) — when
    `availableColumns.length === 0`, replace the existing fragment "Add a
    column with a name to choose ..." with the locked message
    "Add named columns in the Columns tab to use this picker." (period-
    terminated). Keys tab: replace "Add a column with a name to choose
    primary key columns" with the same locked message. The string is
    mechanical (no per-tab variant) — picks up cross-tab consistency.

### Backend (Rust)

- **MOD** `src-tauri/src/models/schema.rs` (~+5 LOC): extend
  `CreateTableRequest` with a new optional field:
  ```rust
  /// Sprint 234 — table-level COMMENT ON TABLE statement, emitted
  /// inside the same `create_table` transaction as the per-column
  /// `COMMENT ON COLUMN` statements (atomic policy = C). When `None`
  /// or `Some(empty-after-trim)`, no statement is emitted (Sprint
  /// 226-233 callers stay byte-equivalent).
  #[serde(default)]
  pub table_comment: Option<String>,
  ```
  `#[serde(default)]` is **mandatory** for back-compat — Sprint 226-233 JSON
  payloads omit this field, deserialize to `None`, and the SQL emitter
  produces byte-identical output to the existing fixtures.
- **MOD** `src-tauri/src/db/postgres/mutations.rs` (~+25 LOC): inside
  `create_table`, append a `COMMENT ON TABLE ... IS '...'` statement to the
  comment-statements list when `req.table_comment` is `Some(s)` and `s.trim()`
  is non-empty. Place it FIRST in the comment chain (before per-column
  comments) for consistent ordering. The escape-doubling rule from the
  per-column comment (`replace('\'', "''")`) applies verbatim. The same
  transaction-rollback policy (Sprint 227 atomic policy C) covers the new
  statement — a failure rolls back CREATE TABLE + table comment + any
  per-column comments together. Emit:
  ```sql
  COMMENT ON TABLE "<schema>"."<table>" IS '<escaped>'
  ```
- **MOD** `src-tauri/src/db/postgres/mutations.rs#[cfg(test)] mod tests`
  (~+50 LOC): add ≥ 2 byte-string fixtures:
  - `create_table_preview_table_comment_byte_equivalent` — single column +
    `table_comment: Some("user accounts")`. Asserts emitted SQL is
    `CREATE TABLE "public"."users" ("id" integer); COMMENT ON TABLE
    "public"."users" IS 'user accounts';`.
  - `create_table_preview_table_and_column_comments_byte_equivalent` — 2
    columns, one with `comment`, plus `table_comment`. Asserts ordering:
    table comment FIRST, then per-column comments. Combined SQL terminated
    with trailing `;`.
  - (Optional, recommended) `create_table_preview_table_comment_single_quote`
    — `table_comment: Some("O'Brien's table")`. Locks single-quote escape.
  - (Optional, recommended)
    `create_table_preview_zero_table_comment_byte_equivalent_to_sprint_226`
    — proves zero `table_comment` keeps the Sprint 226 composite-PK fixture
    intact.
- **MOD** `src-tauri/src/models/schema.rs#[cfg(test)] mod tests` (~+15 LOC):
  add one serde-roundtrip test for the new `CreateTableRequest.table_comment`
  field (mirrors the existing `column_change_*` roundtrip tests).

### `docs/PLAN.md` row entry

- **MOD** `docs/PLAN.md`: row 9 (Sprint 234) flips from placeholder to ✓ with a
  one-line description matching the established voice.

## Frozen / Out of Scope

- **DEFERRABLE / INITIALLY DEFERRED for FK** — Sprint 235+.
- **ON DELETE / ON UPDATE for indexes** — backend doesn't accept; Sprint 230+.
- **CHECK expression multi-line / textarea** — Sprint 235+.
- **SQL editor for CHECK expression syntax highlighting** — Sprint 235+.
- **MongoDB createCollection** — out of scope.
- **Drag-and-drop reorder** — Sprint 234 ships ↑/↓ buttons only. DnD requires
  a bigger primitive (e.g. `@dnd-kit/sortable`) and is deferred.
- **Type-coloring legend** — the dots are self-evident in context. A separate
  legend / tooltip "domain / enum / range / composite" key is deferred.

## Invariants (Frozen Files — diff = 0)

- `src/components/structure/useDdlPreviewExecution.ts` — Sprint 214 invariant.
- `src/components/structure/SqlPreviewDialog.tsx` — Sprint 214 invariant.
- `src/__tests__/cross-window-connection-sync.test.tsx` — diff = 0.
- `src/__tests__/cross-window-store-sync.test.tsx` — diff = 0.
- `src/__tests__/window-lifecycle.ac141.test.tsx` — diff = 0.
- `src/stores/connectionStore.ts` — diff = 0.
- `src/stores/schemaStore.ts` — diff = 0.
- `src/stores/safeModeStore.ts` — diff = 0.
- `src/lib/safeMode.ts` — diff = 0.
- `src/lib/sql/sqlSafety.ts` — diff = 0.
- `src/hooks/useFkReferencePicker.ts` — Sprint 229 invariant.
- `src/lib/sql/postgresTypes.ts` — Sprint 230 canonical list authoritative.
- `src/components/shared/SqlSyntax.tsx` — Sprint 233 invariant.
- `src/lib/sql/sqlTokenize.ts` — Sprint 233 invariant.

Files explicitly modified by AC-234-* (NOT frozen):

- `src/components/schema/CreateTableDialog.tsx` (schema picker move + table
  comment input + reorder buttons + tab count badges).
- `src/components/schema/CreateTableDialog/Header.tsx` (schema picker REMOVED).
- `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` (empty-state
  message + reorder).
- `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx`
  (empty-state messages + reorder for FK + CHECK + UNIQUE).
- `src/components/schema/CreateTableTypeCombobox.tsx` (`typeKindMap` prop +
  color dot render).
- `src/hooks/usePostgresTypes.ts` (`typesByName` returned).
- `src-tauri/src/models/schema.rs` (`table_comment` field + serde test).
- `src-tauri/src/db/postgres/mutations.rs` (COMMENT ON TABLE emit + ≥ 2
  fixtures).

Test invariants:

- All Sprint 226-233 vitest cases pass with at most mechanical query selector
  adaptation. The Sprint 227 schema-picker-in-header test is allowed ONE
  mechanical move (the `getByRole("combobox", { name: /target schema/i })`
  query now resolves the body-located picker, not the header-located one).
- All Sprint 226-233 cargo `create_table` byte-string fixtures pass UNCHANGED
  — `composite_pk_byte_equivalent`, `zero_comment_byte_equivalent_to_sprint_
  226`, `two_columns_one_comment_byte_equivalent`, `single_quote_escape_byte_
  equivalent`, `whitespace_comment_emits_no_statement`,
  `comment_with_semicolon_does_not_split` — all six should produce identical
  output because the Sprint 234 codepath only emits the new `COMMENT ON
  TABLE` statement when `table_comment.is_some_and(|s| !s.trim().is_empty())`.
- No `it.skip`, `eslint-disable`, `any`, silent `catch{}`.

## Done Criteria

### Cross-tab visual feedback (Bug-class polish)

1. **AC-234-01** — Cross-tab cue. After a column is added, renamed, or
   reordered in the Columns tab, the Keys / Indexes / Foreign Keys tab labels
   show `(N)` count badges next to the label text — N = `declaredPk.length`,
   `declaredIndexesForChain.length`, `declaredConstraintsForChain.length`
   respectively. Badge appears immediately on state change, no debounce, no
   flash animation. When the corresponding count is 0, the badge is hidden
   (no `(0)`). Visible without switching tabs.

2. **AC-234-02** — Empty column-name handling. Columns with empty trimmed
   `name` are NOT included in `availableColumns` (already true via the
   existing `validPkColumns` derivation). Each sub-tab's column-multi-check
   block, when `availableColumns.length === 0`, renders the locked message
   "Add named columns in the Columns tab to use this picker." (verbatim,
   period-terminated). Applies to: Keys tab PK list, Indexes tab columns
   group, FK tab local-columns group, UNIQUE sub-section columns group.

### Column reorder

3. **AC-234-03** — Reorder buttons. Each column / index / FK / CHECK /
   UNIQUE row gets ↑ / ↓ buttons positioned to the LEFT of the row's `−`
   remove button (per Decisions §Reorder placement). Click ↑ moves the row
   up by one position; click ↓ moves it down by one. ↑ is `disabled` at the
   topmost row; ↓ is `disabled` at the bottommost row. Reorder preserves the
   `trackingId`-keyed React identity (in-place swap; no rebuild). Buttons
   carry `aria-label="Move column up"` / `"Move column down"` (or
   `"Move index up"` etc. per family) for screen reader support.

4. **AC-234-04** — Reorder invalidates preview. Every reorder call invokes
   `invalidatePreview()` so `previewStale` flips to true; the next "Show DDL"
   click re-fetches the SQL with the new declaration order. The cached
   preview SQL is discarded, the inline preview pane collapses (mirrors the
   Sprint 228 / 229 invalidate-on-edit pattern).

### Table-level COMMENT ON TABLE

5. **AC-234-05** — Table comment input. A single-line `<input>` labeled
   "Table comment" appears in the body, between the Table name input and the
   `<Tabs>` block. Optional, default empty, controlled, mirrors the Sprint
   227 column-comment input shape. When non-empty, plumbed into
   `buildRequest(...)` as `table_comment: <trimmed string>`; when empty
   post-trim, threaded as `null`. The new state slot (`tableComment`) is
   reset by `resetForm()` and bound to `invalidatePreview()` on every change.

6. **AC-234-06** — Backend extension. `CreateTableRequest.table_comment:
   Option<String>` with `#[serde(default)]`. The PG `create_table` impl
   appends a `COMMENT ON TABLE "<schema>"."<table>" IS '<escaped>'` statement
   FIRST in the comment chain (before any `COMMENT ON COLUMN` statements)
   when `Some(s)` && `!s.trim().is_empty()`. Single-quote escape applies
   identically (`'` → `''`). The full chain still runs in one transaction
   (atomic policy C). ≥ 2 new Rust byte-string fixtures lock the SQL output
   ("byte-equivalent" pattern). Sprint 226-233 fixtures pass UNCHANGED — when
   `table_comment = None`, the SQL is byte-identical.

### Schema picker position

7. **AC-234-07** — Schema picker in body. The schema picker is REMOVED from
   `CreateTableDialog/Header.tsx` (header collapses to title + X only). The
   picker is rendered as the FIRST body row, ABOVE the Table name input
   (Decisions §Schema picker layout: above, not left). Label "Target schema"
   + `<Select>`. Hidden when `schemaOptions.length === 0` (matches the
   previous header guard). Selection persists across tab switches; resets
   to `schemaName` prop on modal re-open (existing behavior preserved).

### Type combobox color coding

8. **AC-234-08** — Color dots. When `typeKindMap` is supplied AND
   `typesSource` is supplied, each option in the combobox renders a small
   color dot prefix per `type_kind`:
   - `"base"` → no dot
   - `"enum"` → `text-blue-500`
   - `"domain"` → `text-green-500`
   - `"range"` → `text-purple-500`
   - `"composite"` → `text-orange-500`
   - unknown kind → no dot (graceful)
   Dots are `<span aria-hidden>•</span>` — the option's accessible name
   stays the verbatim type string. When `typeKindMap` is omitted, the
   combobox renders identically to Sprint 230 (no dots, no diff).

9. **AC-234-09** — `typesByName` from hook. `usePostgresTypes` returns a
   new `typesByName: Map<string, string>` field alongside the existing
   `types`. Map keys = display labels (same `pg_catalog`-stripped form).
   Values = `type_kind` strings. Empty `Map` while loading; populated map
   after fetch resolves. Canonical entries (no live counterpart) get
   `"base"`. The hook's existing surface (`types`, `loading`, `error`,
   `reload`) stays byte-equivalent — `typesByName` is purely additive.

### Both, plus regression

10. **AC-234-10** — Sprint 226-233 byte-equivalent fixtures pass UNMODIFIED.
    Frozen file diff = 0 (per the Invariants list). 4-set verification
    (`pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`,
    `cargo test --manifest-path src-tauri/Cargo.toml --lib`) PASS.

11. **AC-234-11** — `docs/PLAN.md` row 9 = Sprint 234 ✓ entry with a
    1-line description.

## Test Requirements

vitest cases — ≥ 14 new cases distributed across:

- `src/hooks/usePostgresTypes.test.ts` — ≥ 2 new cases:
  1. `surfaces a typesByName map matching the live PostgresTypeInfo entries`
  2. `falls back to a typesByName containing canonical entries with kind=base`

- `src/components/schema/CreateTableTypeCombobox.test.tsx` — ≥ 4 new cases:
  3. `renders a blue dot prefix for enum-typed options when typeKindMap supplies enum`
  4. `renders a green dot for domain, purple for range, orange for composite`
  5. `omits the dot for base-kind options`
  6. `omits the dot when typeKindMap is undefined (back-compat)`

- `src/components/schema/CreateTableDialog.test.tsx` — ≥ 6 new cases:
  7. `renders the target schema dropdown in the body, not in the header (AC-234-07)`
  8. `renders a Table comment input above the tabs (AC-234-05)`
  9. `shows (N) count badge next to Keys / Indexes / Foreign Keys tab labels (AC-234-01)`
  10. `surfaces empty-state message when no named column exists (AC-234-02)`
  11. `Move column up/down buttons reorder rows in place and disable at boundaries (AC-234-03)`
  12. `reorder invalidates the cached DDL preview (AC-234-04)`

- `src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx` (or new
  component test if absent) — ≥ 2 new cases:
  13. `renders Move up/down buttons disabled at first and last index row`
  14. `renders the locked empty-state message when availableColumns is empty`

cargo cases — ≥ 2 new fixtures (per AC-234-06) + the optional escape /
zero-comment fixtures bring the total to 4 recommended:

- `create_table_preview_table_comment_byte_equivalent`
- `create_table_preview_table_and_column_comments_byte_equivalent`
- `create_table_preview_table_comment_single_quote` (recommended)
- `create_table_preview_zero_table_comment_byte_equivalent_to_sprint_226`
  (recommended)
- One serde-roundtrip case in `models/schema.rs#mod tests`.

### Edge cases the Generator must cover

- **Single-quote in `table_comment`** (`O'Brien's table`) — escape doubles
  internally to `O''Brien''s table`. Locked by fixture.
- **Whitespace-only `table_comment`** (`"   "`) — emits NO statement; SQL is
  byte-equivalent to the no-comment form.
- **Schema picker disabled when only one schema in `schemaOptions`** — the
  picker still renders (one-item dropdown is benign), but the body still
  passes `schemaOptions.length === 0` for the empty-list MySQL/MariaDB
  fallback. Don't accidentally hide the picker when length === 1.
- **`type_kind` missing in cache during loading** — the combobox is open
  before the fetch resolves: `typeKindMap.get(label)` returns `undefined`,
  the dot is omitted. No throw. Verified by AC-234-08 (graceful path).
- **Reorder boundary clicks** — clicking ↑ on row 0 or ↓ on the last row
  is a no-op AND the button is `disabled` (defense in depth).
- **Reorder a row whose name is empty** — reorder still works; empty-name
  rows don't surface in `availableColumns` but still occupy a position in
  the columns array (preserves user's typing slot).
- **Cross-tab cue with PK = subset of declared columns** — `declaredPk`
  reflects only `is_pk: true` columns; the Keys badge counts those, not
  every column.

## Decisions

### Cross-tab cue style — `(N)` count badge (locked)

Two candidates were considered:

- **Flash animation** — briefly highlight the tab label (e.g. yellow
  background pulse) when the column count changes. Cons: requires a CSS
  keyframes definition, test brittleness (animation timing in jsdom is
  fragile), accessibility (motion-reduce queries). Pros: visually
  attention-grabbing.
- **Count badge `(N)`** (chosen). Pros: zero animation, deterministic test
  query (`getByText("Indexes (3)")`), accessible by default (digits flow
  into the tab's accessible name). Cons: less visually punchy. Mitigated
  by: this is a desktop power-user tool — count badges are familiar from
  TablePlus / DataGrip / DBeaver.

### Schema picker layout — above table name (locked)

- **Above the Table name input** (chosen). Pros: matches the user-cited
  "table name 위" feedback verbatim; vertical stacking aligns with the
  existing one-input-per-row body layout; no flex/wrap concerns on narrow
  modals. Cons: adds one row of vertical space.
- **Left of the Table name `<input>`** (rejected). Pros: compact. Cons:
  flexbox + tab-key flow becomes brittle on narrow modals (label wraps);
  the schema picker typically shows shorter strings ("public") than the
  table name input, so the visual weight asymmetry feels off.

### Reorder button placement — left of `−` button (locked)

- **Left of `−`** (chosen). Pattern matches DataGrip / pgAdmin column
  editors. Cons: pushes `−` further from the row body. Pros: natural
  reading order — the user scans from row content → reorder → delete.
- **Right of `−`** (rejected). Pros: keeps `−` close to row content. Cons:
  inconsistent with industry-standard table-row-reorder controls.

### `typesByName` value type — plain string vs union (locked plain string)

The hook returns `Map<string, string>` (NOT `Map<string, TypeKind>`) so the
runtime gracefully handles a future `type_kind` value not yet enumerated in
the union (e.g. PG 17 multirange `'m'` → `"multirange"`). The combobox's
switch is exhaustive over the four colored kinds + a default no-op branch,
so unknown kinds degrade to no dot (AC-234-08). Type narrowing happens at
the consumer site, not the hook boundary.

## Verification Plan (28 checks, mixed profile)

| # | Check | Command | Expected |
| --- | --- | --- | --- |
| 1 | vitest full | `pnpm vitest run` | 0 failed |
| 2 | tsc | `pnpm tsc --noEmit` | exit 0, silent |
| 3 | lint | `pnpm lint` | exit 0, silent |
| 4 | cargo build | `cargo build --manifest-path src-tauri/Cargo.toml` | Finished |
| 5 | cargo clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | 0 warnings |
| 6 | cargo test create_table | `cargo test --manifest-path src-tauri/Cargo.toml --lib create_table` | PASS — Sprint 226-233 fixtures byte-equivalent |
| 7 | cargo test create_index | `cargo test --manifest-path src-tauri/Cargo.toml --lib create_index` | PASS unchanged |
| 8 | cargo test add_constraint | `cargo test --manifest-path src-tauri/Cargo.toml --lib add_constraint` | PASS unchanged |
| 9 | cargo test list_types | `cargo test --manifest-path src-tauri/Cargo.toml --lib list_types` | PASS unchanged |
| 10 | cargo test table_comment | `cargo test --manifest-path src-tauri/Cargo.toml --lib table_comment` | PASS — ≥ 2 new fixtures |
| 11 | frozen — useDdlPreviewExecution | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | 0 |
| 12 | frozen — SqlPreviewDialog | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | 0 |
| 13 | frozen — cross-window tests | `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/cross-window-store-sync.test.tsx` | 0 |
| 14 | frozen — window lifecycle | `git diff --stat src/__tests__/window-lifecycle.ac141.test.tsx` | 0 |
| 15 | frozen — connectionStore | `git diff --stat src/stores/connectionStore.ts` | 0 |
| 16 | frozen — schemaStore | `git diff --stat src/stores/schemaStore.ts` | 0 |
| 17 | frozen — safeModeStore | `git diff --stat src/stores/safeModeStore.ts` | 0 |
| 18 | frozen — safeMode + sqlSafety | `git diff --stat src/lib/safeMode.ts src/lib/sql/sqlSafety.ts` | 0 |
| 19 | frozen — useFkReferencePicker | `git diff --stat src/hooks/useFkReferencePicker.ts` | 0 |
| 20 | frozen — postgresTypes.ts | `git diff --stat src/lib/sql/postgresTypes.ts` | 0 |
| 21 | frozen — SqlSyntax + sqlTokenize | `git diff --stat src/components/shared/SqlSyntax.tsx src/lib/sql/sqlTokenize.ts` | 0 |
| 22 | grep — COMMENT ON TABLE | `grep -nE 'COMMENT ON TABLE' src-tauri/src/db/postgres/mutations.rs` | ≥ 1 hit |
| 23 | grep — table_comment field | `grep -nE 'table_comment' src-tauri/src/models/schema.rs` | ≥ 1 hit |
| 24 | grep — typeKindMap / typesByName | `grep -nE 'typeKindMap\|typesByName' src/components/schema/CreateTableTypeCombobox.tsx src/hooks/usePostgresTypes.ts` | ≥ 2 hits combined |
| 25 | grep — schema picker NOT in Header | `grep -nE 'Target schema\|onSchemaChange' src/components/schema/CreateTableDialog/Header.tsx` | 0 hits |
| 26 | grep — schema picker IN body | `grep -nE 'Target schema' src/components/schema/CreateTableDialog.tsx` | ≥ 1 hit |
| 27 | AC-234 named cases | vitest filter `AC-234` | all PASS |
| 28 | docs/PLAN.md row 9 | `grep -nE 'Sprint 234' docs/PLAN.md` | row 9 ✓ entry |

## Required evidence Generator must return

- Changed files table (path / lines / purpose).
- Test counts: vitest before/after; cargo before/after.
- AC-234 coverage table (AC → test name → file:line → result).
- Verification check results (28 / 28 expected).
- Decisions taken (cross-tab cue style — already locked to badge; schema
  picker layout — already locked to above; reorder placement — already
  locked to left). Generator confirms or notes deviation.
- Edge cases tested (with file:line references).
- Assumptions & residual risks.
