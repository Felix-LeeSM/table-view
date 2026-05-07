# Sprint 234 — Execution Brief (Generator-targeted)

Date: 2026-05-07. Owner: harness Generator agent.
Cycle: Phase 27 sprint 9 — UX consolidation polish bundle (post-Sprint 233).

This brief is the Generator-facing companion to `contract.md`. It enumerates
the order of operations, the precise edit sites with line numbers, the test
authoring sequence, and the trade-off escape hatches. Read `contract.md`
first — this brief assumes the AC list is in your working set.

## Read first (in this order)

1. `docs/sprints/sprint-234/contract.md` — the AC list + frozen invariant set.
2. `src/components/schema/CreateTableDialog.tsx` (lines 1-1204, full file).
   Key state slots: `tableName` (198), `columns` (199), `indexes` (202), `fks`
   (205), `checks` (206), `uniques` (207), `selectedSchema` (216),
   `previewStale` (221). Key derivations: `validPkColumns` (268-272),
   `declaredPk` (556-562), `declaredIndexesForChain` (574-581),
   `declaredConstraintsForChain` (653-735). Key handlers: `handleAddColumn`
   (279), `handleRemoveColumn` (284), `handleUpdateColumn` (292),
   `invalidatePreview` (507-513), `resetForm` (241-253), `buildRequest`
   (525-552). Header invocation: line 852.
3. `src/components/schema/CreateTableDialog/Header.tsx` (lines 1-91, full).
   Schema picker block: lines 62-88 — DELETE wholesale.
4. `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` (lines 1-223,
   full). Empty-state message: line 174 (`"Add a column with a name to choose
   index columns"`). Row repeater: lines 112-218.
5. `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx` (lines
   1-613, full). Three sub-sections, three repeaters at lines 187-450 (FK),
   479-518 (CHECK), 547-606 (UNIQUE). Empty-state messages at 218, 568.
   Empty-state `Pick a reference table to choose reference columns` (line
   329) is NOT changed by this sprint — that's the post-table-pick path,
   distinct from `availableColumns.length === 0`.
6. `src/components/schema/CreateTableTypeCombobox.tsx` (lines 1-261, full).
   Suggestions list `<ul>` lines 226-256. Each `<li><button>` at 234-254 is
   the dot insertion site.
7. `src/hooks/usePostgresTypes.ts` (lines 1-243, full). Cache entry shape
   line 44-55; the new `typesByName` field rides on `CacheEntry`.
8. `src-tauri/src/db/postgres/mutations.rs` (lines 189-342 = `create_table`
   impl). Comment-statements vec built at lines 267-282; insert table-comment
   FIRST in this vec.
9. `src-tauri/src/models/schema.rs` (lines 215-226 = `CreateTableRequest`).
   New optional field added at the bottom (preserves field declaration
   order).
10. `.claude/skills/harness/templates/handoff.md` — Generator self-report
    skeleton.

## Order of operations

The dependency graph runs **backend → hook → combobox → header → dialog
body → tests**. Don't write tests for the dialog body until the body is
authored — the test queries depend on stable DOM structure.

### Step 1 — Backend extension (Rust, ~80 LOC + ~50 LOC tests)

1.1. **`src-tauri/src/models/schema.rs`** — extend `CreateTableRequest`:
   add `#[serde(default) pub table_comment: Option<String>` after the
   existing `#[serde(default) pub preview_only: bool` field (lines 224-225).
   Doc-comment the field per Sprint 226-227 prose style. Add a serde
   roundtrip test in `mod tests` mirroring
   `column_change_add_serde_roundtrip` (line 417) — confirm a payload that
   omits `table_comment` deserializes to `None` (proves back-compat).

1.2. **`src-tauri/src/db/postgres/mutations.rs`** — patch `create_table`:
   - At line 267 (`let mut comment_stmts: Vec<String> = Vec::new();`),
     immediately AFTER the vec init, prepend the table-comment statement:
     ```rust
     if let Some(raw) = &req.table_comment {
         let trimmed = raw.trim();
         if !trimmed.is_empty() {
             let escaped = trimmed.replace('\'', "''");
             comment_stmts.push(format!(
                 "COMMENT ON TABLE {} IS '{}'",
                 qualified, escaped
             ));
         }
     }
     ```
   - The existing per-column comment loop (lines 268-282) appends after the
     table-comment statement, so the chain ordering is **table-comment FIRST,
     then per-column comments**. Critical for AC-234-06 fixture ordering.
   - The existing trailing `;` and `; ` joining logic (lines 284-301) is
     unchanged — works for any comment count ≥ 1.
   - The existing transaction loop (lines 329-334) iterates `&comment_stmts`
     so the table-comment statement automatically rides the same
     `BEGIN/COMMIT` envelope (atomic policy C honored).

1.3. **Cargo fixtures** in `mod tests` (lines 1888+, after the Sprint 227
   block):
   - `create_table_preview_table_comment_byte_equivalent` —
     ```rust
     let req = CreateTableRequest {
         /* connection_id, schema, name, columns: vec![col("id","integer",true,None)],
            primary_key: None, preview_only: true, */
         table_comment: Some("user accounts".to_string()),
         /* ... */
     };
     // assert: r#"CREATE TABLE "public"."users" ("id" integer); COMMENT ON TABLE "public"."users" IS 'user accounts';"#
     ```
   - `create_table_preview_table_and_column_comments_byte_equivalent` —
     2 columns (1 commented), `table_comment: Some("…")`, locks ordering:
     `CREATE TABLE …; COMMENT ON TABLE … IS '…'; COMMENT ON COLUMN … IS '…';`.
   - `create_table_preview_table_comment_single_quote` —
     `table_comment: Some("O'Brien's table")`, asserts `O''Brien''s table`
     in output.
   - `create_table_preview_zero_table_comment_byte_equivalent_to_sprint_226`
     — same payload as `create_table_preview_three_column_composite_pk_
     byte_equivalent` (line 1685) but with the new struct field default
     (`table_comment: None`). Asserts identical SQL.
   - **Generator must ALSO update existing test struct literals** that
     construct `CreateTableRequest`. Required because Rust struct
     construction needs all fields listed. The Sprint 234 codepath adds
     `table_comment: None` to: lines 1668, 1687, 1713, 1735, 1756, 1775,
     1798, 1812, 1832, 1851, 1869, 1898, 1925, 1953, 1979, 2007 (16 sites
     in `mutations.rs`'s test mod). Use `replace_all` carefully or audit
     with `grep -n 'CreateTableRequest {' src-tauri/src/db/postgres/
     mutations.rs`.

### Step 2 — Hook extension (~+15 LOC)

2.1. **`src/hooks/usePostgresTypes.ts`** — extend `UsePostgresTypesResult`:
   ```ts
   export interface UsePostgresTypesResult {
     types: string[];
     typesByName: Map<string, string>;     // ← Sprint 234 add
     loading: boolean;
     error: string | null;
     reload: () => void;
   }
   ```

2.2. Extend `CacheEntry` (lines 44-55) with a `typesByName: Map<string,
   string> | null` field. Initialize to `null` in the cache entry at line 130;
   compute alongside `mergeTypes` at line 141:
   ```ts
   entry.typesByName = mergeTypesByName(live);   // new helper
   ```

2.3. Add `mergeTypesByName(live: PostgresTypeInfo[]): Map<string, string>`:
   ```ts
   function mergeTypesByName(live: PostgresTypeInfo[]): Map<string, string> {
     const out = new Map<string, string>();
     for (const t of POSTGRES_COMMON_TYPES) out.set(t, "base");
     for (const info of live) {
       const label = toLabel(info);
       if (label === null) continue;
       if (out.has(label)) continue;            // canonical wins (already "base")
       out.set(label, info.type_kind);
     }
     return out;
   }
   ```
   Canonical-first lookup behavior: live entries that overlap canonical
   labels (e.g. `varchar`) keep `"base"` — prevents canonical built-ins
   from being recolored if PG's `typtype` somehow disagrees.

2.4. The error fallback path (line 144) sets
   `entry.typesByName = new Map(POSTGRES_COMMON_TYPES.map((t) => [t, "base"]));`
   so consumers always observe a non-null map.

2.5. The "no entry yet" return path (line 217-224) and the "in-flight"
   path (line 225-236) both return `typesByName: new Map()` to keep the
   surface non-null even before the first fetch resolves. Combobox lookups
   on missing keys return `undefined`, dot is omitted (graceful path).

2.6. Add ≥ 2 vitest cases in `usePostgresTypes.test.ts`:
   - `surfaces a typesByName map matching the live PostgresTypeInfo entries`
   - `falls back to a typesByName containing canonical entries with kind=base`

### Step 3 — Combobox color dots (~+25 LOC)

3.1. **`src/components/schema/CreateTableTypeCombobox.tsx`**:

3.2. Extend props interface (line 32-49) with `typeKindMap?: ReadonlyMap<
   string, string>;` (using `ReadonlyMap` lets the parent pass either a
   `Map` or a `ReadonlyMap` cleanly).

3.3. Inside the suggestion `<li>` button (line 234-254), prepend a dot
   `<span>` based on the kind lookup:
   ```tsx
   {(() => {
     const kind = typeKindMap?.get(t);
     const dotClass = kind === "enum"   ? "text-blue-500"
                    : kind === "domain"   ? "text-green-500"
                    : kind === "range"    ? "text-purple-500"
                    : kind === "composite"? "text-orange-500"
                    : null;
     return dotClass
       ? <span aria-hidden className={`mr-1 ${dotClass}`}>•</span>
       : null;
   })()}
   {t}
   ```
   Decisions §`typesByName` value type is plain string — the switch is
   exhaustive over four kinds + a default no-dot branch.

3.4. Add ≥ 4 vitest cases in `CreateTableTypeCombobox.test.tsx`:
   - `renders a blue dot prefix for enum-typed options when typeKindMap supplies enum`
   - `renders a green dot for domain, purple for range, orange for composite`
   - `omits the dot for base-kind options`
   - `omits the dot when typeKindMap is undefined (back-compat)`

### Step 4 — Header strip (~-25 LOC)

4.1. **`src/components/schema/CreateTableDialog/Header.tsx`**:
   - Strip `selectedSchema` / `schemaOptions` / `onSchemaChange` from
     `CreateTableDialogHeaderProps` (lines 30-35).
   - Strip the schema picker block (lines 62-88).
   - Strip the unused `Select*` imports (lines 8-14).
   - Strip the `showSchemaPicker` derivation (line 43).
   - Update the Sprint 227 doc-comment (lines 16-29) to note the schema
     picker has moved to the body in Sprint 234.

4.2. The `DialogDescription` line (51) must be preserved — it's the
   accessible description for the modal.

### Step 5 — Dialog body (~+200 LOC, ~-15 LOC)

5.1. **`src/components/schema/CreateTableDialog.tsx`**:
   - Update `CreateTableDialogHeader` invocation (line 852) — drop the
     three schema-picker props.
   - Add new state: `const [tableComment, setTableComment] = useState("");`
     after line 217.
   - Add reorder handlers after line 300 (column repeater region):
     ```ts
     const handleMoveColumn = (trackingId, direction: -1 | 1) => { /* ... */ };
     const handleMoveIndex  = (trackingId, direction: -1 | 1) => { /* ... */ };
     const handleMoveFk     = (trackingId, direction: -1 | 1) => { /* ... */ };
     const handleMoveCheck  = (trackingId, direction: -1 | 1) => { /* ... */ };
     const handleMoveUnique = (trackingId, direction: -1 | 1) => { /* ... */ };
     ```
     All five share the swap-in-place algorithm in contract §AC-234-03.
   - Update `resetForm` (line 241-253) — add `setTableComment("")`.
   - Update `buildRequest` (line 525-552) — add `table_comment:
     tableComment.trim().length > 0 ? tableComment.trim() : null` to the
     returned object.
   - Body layout (lines 860-1114):
     - **First body row** — schema picker `<div>` (label + Select), guarded
       by `schemaOptions.length > 0`. Mirrors the previous header block.
     - **Second body row** — the existing Table name `<div>` (lines 862-878,
       unchanged structure).
     - **Third body row** — NEW: Table comment `<div>` containing a label
       and a single-line `<input>`. ~10 LOC.
     - **Fourth body row** — the existing `<Tabs>` (line 881+).
   - Inside `<TabsList>` (line 885-898), append `(N)` count badges:
     - Keys: `<TabsTrigger value="keys">Keys{declaredPk.length > 0 && <span ...>({declaredPk.length})</span>}</TabsTrigger>`
     - Indexes: `({declaredIndexesForChain.length})` when > 0.
     - Foreign Keys: `({declaredConstraintsForChain.length})` when > 0.
   - Inside the columns repeater (line 922-1008), insert ↑/↓ buttons before
     the `−` button (line 992-1005). Compute `idx` from `columns.findIndex
     (c => c.trackingId === col.trackingId)`. Boundary booleans for
     `disabled`. Reuse the existing `Button variant="ghost" size="icon-xs"`
     shape.
   - Update the Keys tab empty-state message (line 1029) — the user's
     selected message is "Add named columns in the Columns tab to use this
     picker.".

5.2. Thread `onMoveIndex` into `IndexesTabBody` via new prop. Implement
   in-tab the same way (boundary booleans + button placement).

5.3. Thread `onMoveFk` / `onMoveCheck` / `onMoveUnique` into
   `ForeignKeysTabBody` via three new props. Same in-tab implementation.

5.4. Update the FK + UNIQUE empty-state messages in `ForeignKeysTabBody`
   (lines 218, 568) to "Add named columns in the Columns tab to use this
   picker.".

### Step 6 — Tests (vitest authoring)

Authoring sequence:

1. Backend cargo fixtures FIRST — fast feedback on the SQL emit shape.
2. Hook test (`usePostgresTypes.test.ts`) — confirms `typesByName` shape.
3. Combobox test — confirms color dots render.
4. `CreateTableDialog.test.tsx` — the longest authoring task. Generator
   should follow the existing test file's `describe` / `it` pattern and the
   Sprint 227-228-229 selector conventions. Use `getByRole("combobox", {
   name: /target schema/i })` to assert the schema picker is in the body.
5. `IndexesTabBody.test.tsx` — small, mechanical.

### Step 7 — Final polish

- Run `pnpm tsc --noEmit` — fix any prop-flow type errors revealed by the
  new prop signatures.
- Run `pnpm lint` — fix any unused imports or `any` regressions.
- Run `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
  --all-features -- -D warnings` — likely zero warnings since the new code
  is mechanical.
- Update `docs/PLAN.md` row 9 to ✓ with description: "Sprint 234 — UX
  polish (cross-tab cue + reorder + table comment + schema picker move +
  type kind coloring)".

## Trade-off escape hatches

- If the cargo test struct-construction churn (Step 1.3 last bullet) takes
  > 15 minutes, the safer fix is to add `..Default::default()` to existing
  literals. **Don't** unless `CreateTableRequest` already derives `Default`
  — it currently does not. Fall back to explicit `table_comment: None,` per
  literal.
- If `lucide-react`'s `ArrowUp` / `ArrowDown` icons aren't already imported
  somewhere in the dialog, use `ChevronUp` / `ChevronDown` (already imported
  at line 2). Visually equivalent at icon-xs size.
- If the cross-tab badge rendering causes the `TabsTrigger` height to shift,
  wrap the digits in a fixed-height `<span class="ml-1 inline-block min-w-4
  text-[10px] text-muted-foreground">` to keep the tab strip stable.
- If `typesByName: Map<...>` causes a vitest snapshot churn (unlikely), the
  Map can be wrapped in a stable `useMemo` derivation at the consumer site
  before being threaded into the combobox prop. Don't put the memoization
  inside the hook — the hook caches the Map in the module-level entry, so
  re-render across cache hit/miss is stable.

## Acceptance — what the Evaluator will check

- AC-234-01 through AC-234-11 mapped to test names and verification
  commands.
- 28 verification checks (per contract §Verification Plan).
- 14+ new vitest cases, ≥ 2 new cargo fixtures, 1 serde roundtrip case.
- Frozen file diff = 0 across the 14 invariant paths.
- `docs/PLAN.md` row 9 = ✓.

The Generator self-report goes in `docs/sprints/sprint-234/handoff.md`
following the harness `templates/handoff.md` skeleton.
