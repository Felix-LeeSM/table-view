# Sprint Contract: sprint-229

## Summary

- Goal: Phase 27 sprint 4 — make the **Foreign Keys tab functional** in `CreateTableDialog`. Replace the Sprint 228 placeholder body (`"Available in Sprint 229"`) with an interactive editor that lets the user declare three constraint families in a single tab: **Foreign Keys** (per-row: name + local columns multi-checkbox + reference schema dropdown + reference table dropdown + reference columns multi-checkbox + ON DELETE select + ON UPDATE select), **CHECK constraints** (per-row: name + free-text expression `<input>`), and **table-level UNIQUE constraints** (per-row: name + columns multi-checkbox). After a successful CREATE TABLE the frontend chains `tauri.addConstraint` calls **sequentially**, **one per declared constraint**, **each in its own transaction**, **after** the Sprint 228 `tauri.createIndex` chain. Same partial-atomic policy C as Sprint 228 — constraint failures do **NOT** roll back the CREATE TABLE or earlier-applied indexes/constraints; the failing constraint name surfaces verbatim in the inline preview pane error slot.

  **Important (backend pre-existence audit)** — the backend `add_constraint` Tauri command + Rust `PostgresAdapter::add_constraint` impl + `AddConstraintRequest` model + `ConstraintDefinition` enum (`PrimaryKey | ForeignKey | Unique | Check`) + frontend `tauri.addConstraint` wrapper + 9 Rust unit fixtures (`add_constraint_preview_primary_key`, `add_constraint_preview_foreign_key`, `add_constraint_preview_unique`, `add_constraint_preview_check`, `add_constraint_empty_pk_columns_fails`, `add_constraint_empty_check_expression_fails`, `add_constraint_invalid_name_fails`, `add_constraint_without_connection_fails_non_preview`, `drop_constraint_preview`) **already exist** (`src-tauri/src/db/postgres/mutations.rs:495-595` impl, `:1283-1444` fixtures; `src-tauri/src/models/schema.rs:135-164` types; `src-tauri/src/commands/rdb/ddl.rs:99-110` Tauri command; `src/lib/tauri/ddl.ts:55-58` wrapper; `src/types/schema.ts` `ConstraintDefinition | AddConstraintRequest`). Sprint 229 is therefore predominantly a **frontend** sprint.

  **Critical backend gap — ON DELETE / ON UPDATE NOT supported by Rust.** `ConstraintDefinition::ForeignKey { columns, reference_table, reference_columns }` has no `on_delete` / `on_update` fields. The PG SQL emitter at `mutations.rs:541-546` is `FOREIGN KEY (...) REFERENCES T (...)` — no referential-action suffix. **Decision (locked at contract time, NOT Generator's call): Sprint 229 surfaces the ON DELETE / ON UPDATE selectors in the UI but renders them as a UI-only field that REQUIRES a backend extension to take effect.** The contract picks ONE of two implementation paths:

  - **Path A — backend extends `ConstraintDefinition::ForeignKey`.** Add optional `on_delete: Option<String>` + `on_update: Option<String>` fields with `#[serde(default)]` (back-compat: existing serialized payloads deserialize to `None`). PG emitter appends `ON DELETE <action>` / `ON UPDATE <action>` only when `Some(...)` and value matches the validated whitelist `{NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT}`. Add 2-3 new Rust byte-equivalence fixtures: `add_constraint_preview_foreign_key_on_delete_cascade`, `add_constraint_preview_foreign_key_on_update_set_null`, `add_constraint_preview_foreign_key_no_action_omitted` (proves `None` keeps Sprint 228 byte-equivalent SQL). Existing `add_constraint_preview_foreign_key` byte-string fixture stays unchanged (the new fields default to `None` so the old SQL is byte-equivalent).
  - **Path B — defer ON DELETE / ON UPDATE to Sprint 230 polish.** The UI shows the two selectors with a tooltip `"Coming in Sprint 230"` and the chain ignores their values (passes `None` to backend, emitting the bare `FOREIGN KEY ... REFERENCES ...` SQL).

  **Path A is selected.** Justification: (a) ON DELETE / ON UPDATE is the most-asked feature for FKs in DataGrip parity surveys; deferring blocks the primary user benefit of this tab. (b) Backend extension is **≤ +30 LOC of Rust** (2 enum fields with `#[serde(default)]` + emitter conditional + 3 fixtures); it isolates cleanly inside `add_constraint` without touching `create_table` / `create_index`. (c) Sprint 230 is already overloaded with reorder / table COMMENT / type coloring polish — adding ON DELETE/UPDATE there crowds the polish surface. (d) `#[serde(default)]` keeps Sprint 228 byte-equivalent: zero existing FK callers serialize the new fields. (e) Drop-FK / inspect-FK paths read constraint metadata from `pg_catalog` (Sprint 161+), not from this enum, so they are unaffected.

- Audience: Generator + Evaluator (multi-agent harness, post-228 cycle, Phase 27 sprint 4 — Foreign Keys + Constraints tab functional).
- Owner: harness skill orchestrator.
- Verification Profile: `mixed` (command + static).

## In Scope

Backend (Rust) — minimal, Path A:
- `src-tauri/src/models/schema.rs` (~+4 LOC): extend `ConstraintDefinition::ForeignKey` with `#[serde(default)] pub on_delete: Option<String>` and `#[serde(default)] pub on_update: Option<String>`. No other variants change. `AddConstraintRequest` body unchanged. `ColumnDefinition` / `CreateTableRequest` / `CreateIndexRequest` unchanged.
- `src-tauri/src/db/postgres/mutations.rs::add_constraint` (~+22 LOC inside the `ConstraintDefinition::ForeignKey` arm only): validate `on_delete` / `on_update` against the closed whitelist `{"NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"}` (case-sensitive uppercase, match the PG canonical form); when `Some(action)` append ` ON DELETE <action>` / ` ON UPDATE <action>` to the emitted SQL after the `REFERENCES "T" ("c1", ...)` clause. When `None`, omit the clause entirely (Sprint 228 byte-equivalence). Validation failure → `AppError::Validation("Invalid ON DELETE action: <value>")` (or equivalent).
- `src-tauri/src/db/postgres/mutations.rs#[cfg(test)] mod tests` (~+90 LOC): add **3 new** byte-equivalence fixtures:
  - `add_constraint_preview_foreign_key_on_delete_cascade` — emits `... FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE`.
  - `add_constraint_preview_foreign_key_on_update_set_null_with_on_delete_restrict` — both clauses, both ordering: `ON DELETE RESTRICT ON UPDATE SET NULL`.
  - `add_constraint_preview_foreign_key_invalid_on_delete_fails` — `on_delete: Some("INVALID")` → `AppError::Validation`.
  Existing `add_constraint_preview_foreign_key` (Sprint 228 baseline at lines 1306-1327) **stays byte-equivalent** with no source-text diff (the struct extension uses `#[serde(default)]`, so the existing fixture omits the new fields and the emitter omits the clauses).
- `src-tauri/src/commands/rdb/ddl.rs` — **NO change**. `add_constraint` Tauri command (lines 99-110) already wired and registered in `src-tauri/src/lib.rs:154`. Diff = 0.

Frontend (TS/TSX) — primary scope:
- `src/types/schema.ts` (~+4 LOC): extend the `ConstraintDefinition` discriminated-union `foreign_key` arm with optional `on_delete?: string | null` + `on_update?: string | null` fields (snake_case, matches Rust serde). No other type changes; existing call sites that omit them remain valid.
- `src/components/schema/CreateTableDialog.tsx` (~+30 / ~-15 LOC): replace the Sprint 228 Foreign Keys tab placeholder body with `<ForeignKeysTabBody …>`. Add modal-local draft state arrays (`fks: ForeignKeyDraft[]`, `checks: CheckDraft[]`, `uniques: UniqueDraft[]`). Wire the inline DDL Preview pane to fan out one `tauri.addConstraint({preview_only:true})` call per declared (validated) constraint **after** the Sprint 228 indexes preview chain. Wire the Execute closure to chain (a) `tauri.createTable({preview_only:false})`, (b) `tauri.createIndex × M` (Sprint 228), (c) `tauri.addConstraint × K` (Sprint 229) — sequential, each in its own transaction. Reuse `useDdlPreviewExecution` (Sprint 214) **without modification**.
- `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx` (new, **mandatory** — extracted from the parent because Sprint 228 left `CreateTableDialog.tsx` near the 700-LOC threshold and three new draft families would push it over): pure presentational mapper. Owns no state. Receives `fks` + `checks` + `uniques` drafts + `availableColumns` + `availableSchemas` + `tablesByRefSchema` (a `Record<string, TableInfo[]>` snapshot) + `columnsByRefTable` (a `(refSchema, refTable) => string[]` accessor that the parent populates from `useSchemaStore.getTableColumns` lazily) + 9 mutator callbacks (3 add / 3 remove / 3 update; the column-toggle ops fold into update). ~280 LOC including the three sub-sections (Foreign Keys / CHECK / Unique) inside one tab body. **Single tab — three labeled sub-sections**, NOT three sibling tabs (see "Tab Layout Decision" under Design Bar).
- `src/components/schema/CreateTableDialog.test.tsx` (~+220 LOC): add ≥ 9 new vitest cases under a `describe("Sprint 229 — Foreign Keys + CHECK + UNIQUE tab functional", …)` block (one per AC-229 line + happy/failure scenarios; see Test Requirements). Sprint 226+227+228 carry-overs stay byte-for-byte unchanged except **one** mechanical assertion flip: the Sprint 228 case `Foreign Keys tab renders 'Available in Sprint 229' placeholder…` flips inverse (the placeholder is now removed). Document the flip with a Sprint 229-superseded comment, the same way Sprint 228 handled the AC-227-01 flip.
- `src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx` (new): ~150 LOC. Pure presentation tests for the extracted body — render shape, aria labels, prop callback wiring. Coverage ≥ 70% line on the new file.

Docs:
- `docs/PLAN.md` (≤ +3 LOC): row 4 added to post-225 feature cycle table for sprint-229.
- `docs/sprints/sprint-229/handoff.md` (new): Generator handoff.
- `docs/sprints/sprint-229/findings.md` (new): decisions + tradeoffs + residual risk.
- `docs/sprints/sprint-229/tdd-evidence/red-state.log` (new) — TDD red-state captured before green commits.

## Out of Scope

Cite Sprint 228 handoff "다음 sprint" §"Sprint 230 (polish)" + Sprint 227 spec line 53 "Future sprints" + the 2026-05-06 user decision (atomic policy C):

- **Reorder ↑/↓ buttons** for column rows / index rows / FK rows / CHECK rows / UNIQUE rows — Sprint 230 polish.
- **Table-level `COMMENT ON TABLE`** — Sprint 230 polish.
- **Type combobox color coding** — Sprint 230 polish.
- **Schema picker position move** — Sprint 230 polish; sprint-229 keeps the Sprint 227 header position.
- **MongoDB `createCollection`** / DocumentAdapter — Phase 27 = PG-first.
- **DEFERRABLE / INITIALLY DEFERRED** — backend currently has no support and the UI does not expose a control. Future sprint.
- **MATCH FULL / MATCH PARTIAL / MATCH SIMPLE** for FK — defaults to PG's `MATCH SIMPLE`. Not exposed in UI.
- **SQL syntax highlighting / auto-validation for the CHECK expression body** — free-text input; backend trims + non-empty check only. Sprint 230 candidate.
- **Inline FK reference schema/table validation** — Sprint 229 trusts the dropdowns; if the user manually overrides via free-text fallback (when `useSchemaStore.tables[<conn>:<refSchema>]` is missing) we forward the raw string. Backend `validate_identifier` rejects malformed names. No frontend-side existence check.
- **Atomic-with-CREATE-TABLE constraints** — atomic policy C is locked: `ALTER TABLE … ADD CONSTRAINT` runs in a separate transaction *after* CREATE TABLE returns success and *after* the Sprint 228 CREATE INDEX chain completes (or aborts).
- **Cross-window invariant suite** — `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
- **`useDdlPreviewExecution.ts` body changes** — Sprint 214 freeze (`git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0).
- **`SqlPreviewDialog.tsx` body changes** — Sprint 227 freeze (`git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0). Sibling editors keep using it.
- **`schemaStore` / `connectionStore` body changes** — Sprint 224 baseline (`git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` = 0). The reference table picker reads from `useSchemaStore.tables[`${connectionId}:${refSchema}`]` via `getState()` and may *call* `loadTables` on demand when a `refSchema` is selected for the first time, but the **store body itself stays unchanged**.
- **`SYNCED_KEYS` extension** of any store — schema cache stays window-local; no cross-window broadcast.
- **`attachZustandIpcBridge` modification** — no new IPC channel, no bridge wiring change.
- **Sprint 226 + 227 + 228 backend fixtures** — must remain byte-equivalent; assertions unchanged. The existing `add_constraint_preview_foreign_key` byte-string is byte-equivalent under Path A because the new fields are `#[serde(default)] = None` and the emitter omits the clauses.
- **Sprint 228 hot-fix files** — `src/components/schema/CreateTableTypeCombobox.tsx` and `src/components/schema/CreateTableDialog/Header.tsx` stay frozen (`git diff --stat` = 0 for `CreateTableTypeCombobox.tsx`; `Header.tsx` may receive an additive-only change ONLY if the FK tab needs a new schema picker — Generator's call, scoped to NEW props, no behaviour change to existing usage).
- **`src/components/schema/CreateTableDialog/IndexesTabBody.tsx`** — Sprint 228 freeze (`git diff --stat` = 0; the FK tab is a separate sibling, not a fork).
- **Sprint 228 vitest cases** — pass with at most ONE mechanical assertion flip (the Foreign Keys placeholder presence test). All other Sprint 228 + 227 + 226 carry-over assertion text frozen byte-for-byte.
- **New shadcn primitives** — reuse existing `Select` (for ref schema, ref table, ON DELETE, ON UPDATE), raw `<input type="checkbox">` (for column multi-select, mirroring Sprint 228 `IndexesTabBody.tsx`), raw `<input>` (for constraint name + CHECK expression). No new `src/components/ui/*` files. **CHECK expression input is a single-line `<input type="text">`** — multi-line `<textarea>` is OUT (deferred to a polish sprint with SQL syntax highlighting).

## Invariants

- **Sprint 226 + 227 + 228 byte-equivalence preserved** — Rust fixtures `create_table_preview_three_column_composite_pk_byte_equivalent` (Sprint 226) + Sprint 227 comment fixtures + Sprint 228 `create_index` fixtures all pass **unmodified** with no source diff. The existing Sprint 228 `add_constraint_preview_foreign_key` byte-string fixture (`mutations.rs:1306-1327`) **stays byte-equivalent** under Path A's `#[serde(default)]` extension. Generated CREATE TABLE / CREATE INDEX SQL with **zero FKs / CHECKs / UNIQUEs declared from the frontend** is byte-equivalent to Sprint 228 output.
- **`useDdlPreviewExecution.ts` body unchanged** — `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0. Sprint 214 freeze.
- **`SqlPreviewDialog.tsx` body unchanged** — `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0. Sprint 227 freeze.
- **Cross-window invariant suite unchanged** — `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
- **`schemaStore` / `connectionStore` body unchanged** — `git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts` = 0. The FK reference table picker reads `useSchemaStore.getState().tables[<conn>:<refSchema>]` and lazily calls `loadTables` on first ref-schema selection (existing API surface), but the store source stays unmodified.
- **`tauri.addConstraint` frontend wrapper unchanged** — `git diff --stat src/lib/tauri/ddl.ts` = 0 (already exists at lines 55-58).
- **`tauri.createIndex` / `tauri.createTable` wrappers unchanged** — Sprint 228 freeze.
- **`AddConstraintRequest` / `ConstraintDefinition` Rust struct/enum extended additively only** — `ForeignKey` arm gains 2 optional fields with `#[serde(default)]`; other variants and the `AddConstraintRequest` shell stay byte-equivalent. `git diff src-tauri/src/models/schema.rs | grep -E "^[+-].*pub struct AddConstraintRequest"` outputs 0 lines (only the `ForeignKey` enum arm changes; the wrapping struct definition is byte-equivalent).
- **`add_constraint` impl body extension is FK-arm-only** — `git diff src-tauri/src/db/postgres/mutations.rs` shows changes only inside the `ConstraintDefinition::ForeignKey { … } => { … }` match arm and the `#[cfg(test)] mod tests` block. The PrimaryKey / Unique / Check arms stay byte-equivalent; the surrounding `pub async fn add_constraint` signature + first 6 lines (validate_identifier + qualified) + final `if req.preview_only` + `sqlx::query(&sql).execute(...)` + `info!` + `Ok(SchemaChangeResult { sql })` blocks all stay byte-equivalent.
- **Foreign Keys tab placeholder text removed** — `grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` = 0 hits.
- **Indexes tab placeholder text remains absent** — `grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` = 0 hits (Sprint 228 already removed it; Sprint 229 must not regress).
- **Atomic policy C** — CREATE TABLE + COMMENT ON live in **one** transaction. CREATE INDEX × M (Sprint 228) + ALTER TABLE ADD CONSTRAINT × K (Sprint 229) are **separate** transactions, executed sequentially **after** CREATE TABLE returns success. Constraint failures do **NOT** roll back the CREATE TABLE or earlier-applied indexes/constraints. Already-applied constraints earlier in the chain stay applied.
- **Preview→commit IPC sequence for 0-constraint form is byte-equivalent to Sprint 228** — `[tauri.createTable({preview_only:true}), tauri.createIndex({preview_only:true}) × M, tauri.createTable({preview_only:false}), tauri.createIndex({preview_only:false}) × M]` with **zero `tauri.addConstraint` calls** when no FKs/CHECKs/UNIQUEs are declared.
- **Multi-statement preview Safe Mode parity** — every statement in the bundle (CREATE TABLE / COMMENT ON / CREATE INDEX / ALTER TABLE ADD CONSTRAINT) analyzes as `safe` per `analyzeStatement` (DDL-create + ALTER-add-constraint without DROP / TRUNCATE / DELETE / UPDATE). The canonical Safe Mode warn-cancel message survives the multi-statement bundle.
- **`useQueryHistoryStore` source `"ddl-structure"`** — single history entry per Execute closure success, regardless of how many CREATE INDEX or ADD CONSTRAINT legs ran (Sprint 228 invariant carry-over).
- **Identifier validation** — backend `validate_identifier` rejects constraint names / FK column names / FK reference table names / FK reference column names / UNIQUE constraint names with spaces / leading digits / non-alphanumeric chars. Frontend mirrors this rule before assembling the chain so the user sees a per-row inline error early. CHECK expression body is **NOT** identifier-validated (free-text SQL); backend trims + non-empty check only.
- **ON DELETE / ON UPDATE whitelist** — exactly five values: `NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT`. Frontend dropdown options match the backend whitelist exactly. Backend rejects any other string. Frontend default for both = `NO ACTION` (or `null` — which serializes as omitted and behaves identically to `NO ACTION` per PG default; Generator picks one and documents in findings).
- **No FK-self-reference fast-path** — if the user declares a FK from the table being created back to itself, the chain still fires `tauri.addConstraint` after the table exists (atomic policy C). PG will succeed since the table now exists. No special preview-only branch needed.
- **No new `it.skip` / `describe.skip` / `it.todo` / `xit` / `this.skip()` / `it.only`** in any touched test file.
- **No new `eslint-disable*` lines.**
- **No new silent `catch {}` blocks** — the chain's catch must surface the failing constraint name verbatim in the inline preview error slot or via toast.
- **No new `any` in TS, no new `unwrap()` in production Rust paths** (tests may use `unwrap`).
- **Mongo / non-RDB path untouched** — `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0.
- **Modal-local `useState` only** for the new draft families — no new Zustand store, no module-load side effects, no broadcast subscribers. The reference table picker reads `useSchemaStore` via `getState()` and may call `loadTables` on demand, but no store write outside the existing API.

## Acceptance Criteria

- `AC-229-01` **Foreign Keys tab no longer placeholder.** The FK tab body becomes interactive. The verbatim string `"Available in Sprint 229"` is removed from `src/components/schema/CreateTableDialog.tsx` (and from any extracted FK-tab component). `getByRole("tab", { name: "Foreign Keys" })` activates a panel containing the editor with three sub-section labels (`Foreign Keys`, `CHECK constraints`, `Unique constraints`). **Testable:** vitest case asserts `queryByText("Available in Sprint 229")` is null inside the FK tab panel + `queryAllByRole("button", { name: /Add foreign key|Add check|Add unique/i })` length ≥ 3 (one add button per sub-section); `grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` = 0 hits.

- `AC-229-02` **Foreign Keys sub-section per-row inputs.** Each FK row renders (a) a constraint name `<input>` (aria `"Foreign key name"`); (b) a local-columns multi-checkbox group (aria `"Foreign key local columns"`) live-derived from declared columns on the Columns tab — same DataGrip pattern as Sprint 228 indexes; (c) a reference schema `<Select>` (aria `"Foreign key reference schema"`) populated from `availableSchemas` (the same prop used by the Header schema dropdown), default = `selectedSchema`; (d) a reference table `<Select>` (aria `"Foreign key reference table"`) populated from `useSchemaStore.tables[<conn>:<refSchema>]` (graceful fallback: when missing, render an `<input>` with placeholder `"reference_table_name"` so the user can type — see AC-229-08); (e) a reference columns multi-checkbox group (aria `"Foreign key reference columns"`) populated by lazily calling `useSchemaStore.getTableColumns(<conn>, <refTable>, <refSchema>)` on ref-table change (graceful fallback: when missing, render a single `<input>` with placeholder `"id, ..."` for comma-split parsing — Generator's call between fallback and just-disabling); (f) an ON DELETE `<Select>` (aria `"Foreign key on delete"`) with exactly five options `NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT`, default = `NO ACTION`; (g) an ON UPDATE `<Select>` (aria `"Foreign key on update"`) — same five options + default; (h) `+ Foreign Key` button (aria `"Add foreign key"`) and `−` per-row button (aria `"Remove foreign key"`). 0-row state default. **Testable:** vitest cases — type 2 columns on Columns tab, switch to FK tab, click `+ Foreign Key`, assert all 7 inputs render with the right aria-labels; ON DELETE / ON UPDATE dropdowns each list exactly the five options; ref-schema dropdown lists `availableSchemas`.

- `AC-229-03` **Composite FK works.** Multi-column local + reference column selection emits `FOREIGN KEY ("a","b") REFERENCES "T" ("x","y")` (with the surrounding `ALTER TABLE ... ADD CONSTRAINT "<name>"` shell). The order of selected columns in the chain payload matches the user's check-toggle order on each side (declared by row insertion order — same convention as Sprint 228 indexes). **Testable:** vitest case — declare 2 local columns `[order_id, line_no]` + 2 reference columns `[id, line_no]` on `orders`, Show DDL, assert the preview SQL substring `FOREIGN KEY ("order_id", "line_no") REFERENCES "orders" ("id", "line_no")` appears.

- `AC-229-04` **CHECK constraints sub-section per-row inputs.** Each CHECK row renders (a) a constraint name `<input>` (aria `"Check name"`); (b) an expression `<input type="text">` (aria `"Check expression"`, single-line — no `<textarea>`); (c) `+ CHECK` button (aria `"Add check"`) and `−` per-row button (aria `"Remove check"`). 0-row state default. The expression input is forwarded **verbatim and trimmed** to backend's `ConstraintDefinition::Check { expression }` — backend wraps it as `CHECK (<expression>)`. Whitespace-only expressions are filtered out of the chain (same as empty-name filter from Sprint 228 indexes). **Testable:** vitest case — declare 1 CHECK row `name="chk_age" expression="age >= 0"`, Show DDL, assert preview substring `ALTER TABLE "public"."<table>" ADD CONSTRAINT "chk_age" CHECK (age >= 0)` appears; whitespace-only expression row is excluded from the chain.

- `AC-229-05` **Table-level UNIQUE constraints sub-section per-row inputs.** Each Unique row renders (a) a constraint name `<input>` (aria `"Unique name"`); (b) a columns multi-checkbox group (aria `"Unique columns"`) derived from declared column names — same pattern as FK local columns; (c) `+ Unique` button (aria `"Add unique"`) and `−` per-row button (aria `"Remove unique"`). 0-row state default. **Distinct from per-column UNIQUE / Indexes-tab UNIQUE** (which is Sprint 228's concern via `is_unique:true` on a single-column index): table-level UNIQUE is multi-column and lives in `pg_constraint`, not `pg_index` directly. The chain emits `ALTER TABLE … ADD CONSTRAINT "<name>" UNIQUE ("col1","col2",...)`. **Testable:** vitest case — declare 1 Unique row `name="uq_users_email" columns=[email]`, Show DDL, assert preview substring `ADD CONSTRAINT "uq_users_email" UNIQUE ("email")` appears; declare a second Unique row with `columns=[first_name, last_name]` → preview shows the multi-column form.

- `AC-229-06` **Inline DDL Preview shows full multi-statement bundle.** With ≥ 1 declared FK + ≥ 1 declared CHECK + ≥ 1 declared UNIQUE alongside Sprint 228 indexes + Sprint 227 comments, clicking `Show DDL` fires sequentially `tauri.createTable({preview_only:true})` → one `tauri.createIndex({preview_only:true})` per declared (non-PK-dedup) index → one `tauri.addConstraint({preview_only:true})` per declared (validated) FK + CHECK + UNIQUE row, in that order. The frontend joins all returned `result.sql` strings with `;\n` and renders the joined SQL inside the inline preview pane. Constraint order within the ADD-CONSTRAINT batch: row-declared order **across families** is `[FKs..., CHECKs..., UNIQUEs...]` (Generator may pick a different fixed order — `[FKs, UNIQUEs, CHECKs]` is also acceptable — but **document the choice in findings.md** and keep it byte-stable across preview and execute). **Testable:** vitest — declare 1 FK + 1 CHECK + 1 UNIQUE + 0 indexes, click Show DDL, assert IPC call sequence is `[createTable(true), addConstraint(true) × 3]`; the rendered preview text contains substrings `CREATE TABLE`, `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`, `ADD CONSTRAINT … CHECK`, `ADD CONSTRAINT … UNIQUE`; editing any draft field invalidates the cached preview as in Sprint 227+228.

- `AC-229-07` **Chained Execute sequence — happy path.** On Execute with ≥ 1 FK + ≥ 1 CHECK + ≥ 1 UNIQUE, the IPC sequence is exactly `[createTable(true), createIndex(true) × M, addConstraint(true) × K, createTable(false), createIndex(false) × M, addConstraint(false) × K]` where M is the count of non-PK-dedup indexes and K is the count of validated FKs+CHECKs+UNIQUEs. Each `addConstraint({preview_only:false})` awaits the previous constraint AND awaits the entire index chain (sequential, not parallel). On full success: 1 history entry (`source: "ddl-structure"`); `onRefresh()` once; `onClose()` once. **Testable:** vitest — declare 0 indexes + 1 FK + 1 CHECK + 1 UNIQUE, Execute, assert IPC sequence `[createTable(true), addConstraint(true) × 3, createTable(false), addConstraint(false) × 3]` via `vi.fn()` mock; assert `onRefresh` called exactly once; assert one history entry; assert no parallelism (each `addConstraint` mock called only after the previous resolved).

- `AC-229-08` **Constraint failure handling — table + earlier indexes/constraints stay applied.** When the chain's K-th `tauri.addConstraint({preview_only:false})` rejects (mocked PG error), (a) the CREATE TABLE call is **NOT** rolled back from the frontend (atomic policy C), (b) earlier-resolved CREATE INDEX calls stay applied (Sprint 228 invariant), (c) earlier-resolved ADD CONSTRAINT calls in the same chain stay applied (Sprint 229 invariant), (d) any subsequent constraint calls are **aborted**, (e) the modal stays open, (f) a clear error surfaces in the inline preview pane error slot **and/or** as a toast naming the failing constraint — verbatim text shape: `Constraint "<constraint_name>" failed: <PG error verbatim>` (or equivalent — the constraint name MUST appear in the user-facing surface). The `useQueryHistoryStore` entry MAY record the partial success as `status: "error"` — Generator's call. **Testable:** vitest — declare 1 index + 1 FK + 1 CHECK + 1 UNIQUE (chain length M=1, K=3), mock the **2nd** `tauri.addConstraint({preview_only:false})` to reject, Execute, assert (a) the 1st `addConstraint` was called and resolved, (b) the 3rd `addConstraint` was NOT called, (c) no `tauri.dropConstraint` / `tauri.dropIndex` rollback call was made, (d) the error surface contains the 2nd's constraint name, (e) the modal stays open (no `onClose` call), (f) `tauri.createTable({preview_only:false})` was called exactly once and resolved.

- `AC-229-09` **Reference table picker — schemaStore-cached + graceful fallback.** Selecting a reference schema in the FK row populates the reference table `<Select>` from `useSchemaStore.getState().tables[<connectionId>:<refSchema>]` if present; otherwise the row triggers a one-shot `useSchemaStore.loadTables(connectionId, refSchema)` and disables the table dropdown (or replaces it with a free-text `<input>`) until the load resolves. After ref-table selection, the reference columns multi-checkbox group is populated by `useSchemaStore.getTableColumns(connectionId, refTable, refSchema)` lazily. When the connection is offline / the load fails, the row falls back to free-text inputs for both reference table and reference columns (comma-separated, trimmed, validated by backend `validate_identifier`). The store's body (`schemaStore.ts`) is NOT modified — only existing API surface (`loadTables` / `getTableColumns`) is invoked. **Testable:** vitest — seed `useSchemaStore.setState({tables:{"conn1:public":[{name:"users",...}]}})`, declare an FK row, switch ref-schema to `public`, assert the ref-table dropdown options include `"users"`; mock `loadTables` to succeed and assert it was called once when ref-schema is selected and the cache was empty.

- `AC-229-10` **0-constraint byte-equivalent regression preserved.** With **zero** FKs / CHECKs / UNIQUEs declared from the frontend, the IPC sequence is exactly `[createTable(true), createIndex(true) × M, createTable(false), createIndex(false) × M]` — byte-equivalent to Sprint 228. Sprint 226+227+228 backend fixtures pass unmodified. The existing `add_constraint_preview_foreign_key` Rust fixture (Sprint 228 baseline at `mutations.rs:1306-1327`) stays byte-equivalent under Path A's `#[serde(default)]` extension. **Testable:** `cargo test --manifest-path src-tauri/Cargo.toml create_table create_index add_constraint` all green; `git diff src-tauri/src/db/postgres/mutations.rs | grep -E "composite_pk_byte_equivalent|comment.*byte_equivalent|create_index_preview"` outputs 0 lines (existing test bodies untouched); `git diff src-tauri/src/db/postgres/mutations.rs | grep -E "add_constraint_preview_foreign_key[^_]"` outputs 0 source-line additions/removals on that fixture body (only the new `*_on_delete_*` / `*_on_update_*` / `*_invalid_*` fixtures appear); vitest assertion of 0-constraint IPC sequence holds.

- `AC-229-11` **No new shadcn primitives — Select / Input / raw checkbox only.** The FK editor reuses (a) the existing `<Select>` primitive (`@components/ui/select`) for ref-schema, ref-table, ON DELETE, ON UPDATE; (b) raw `<input type="checkbox">` for the local-columns + reference-columns + UNIQUE-columns multi-select groups (matches the Sprint 228 `IndexesTabBody.tsx` pattern); (c) raw `<input type="text">` for constraint name + CHECK expression; (d) the existing `Button` primitive for `+ Foreign Key` / `+ CHECK` / `+ Unique` / `−` rows. No new files under `src/components/ui/`. **Testable:** `git diff --stat src/components/ui/` = 0; the `ForeignKeysTabBody.tsx` JSX imports only existing `@components/ui/*` modules already imported by Sprint 228 sibling `IndexesTabBody.tsx`.

- `AC-229-12` **Test coverage targets.** Vitest coverage on the modified `CreateTableDialog.tsx` ≥ 70% line. New `ForeignKeysTabBody.tsx` ≥ 70% line. ≥ 9 new vitest cases under the Sprint 229 describe block covering AC-229-01..AC-229-10. ≥ 1 vitest case asserts the canonical Safe Mode warn-cancel message verbatim survives the multi-statement bundle (Sprint 227+228 invariant carry-over). Rust unit test count for `add_constraint` stays ≥ 9 (current baseline) + ≥ 3 new for ON DELETE / ON UPDATE = ≥ 12 total.

## Design Bar / Quality Bar

- **Tab Layout Decision (locked) — single Foreign Keys tab with three labeled sub-sections (FK / CHECK / Unique).** Justification: (a) DataGrip's "Modify Table" / "Generate DDL" reference modal stacks all constraints on one tab with sub-section headers — Sprint 229 mirrors that. (b) Splitting into 3 sibling tabs would balloon the `<TabsList>` to 6 entries (Columns / Keys / Indexes / Foreign Keys / Checks / Uniques) — too crowded. (c) The three constraint families share the same chain target (`tauri.addConstraint`) and the same atomic policy C semantics; co-locating them keeps the user's mental model coherent. (d) The combined tab body fits in ~280 LOC with the three sub-sections rendered as collapsible headers + per-row tables. Generator MUST follow this layout.
- **Pattern source** — Sprint 228 `IndexesTabBody.tsx` is the structural template. The FK / CHECK / UNIQUE sub-section bodies follow the same shape: `<Plus />` add button at top + `space-y-2` row stack + `<Minus />` icon-button per row + multi-checkbox column group for the column-selecting rows. **No new visual component family**; this is structurally identical to Sprint 228 with three sub-sections.
- **Columns multi-select choice = multi-`<input type="checkbox">` group**, matching Sprint 228 IndexesTabBody and Sprint 227 Keys-tab body.
- **Reference table picker source = `useSchemaStore.tables[<conn>:<refSchema>]`** (the cached `Record<string, TableInfo[]>` keyed by `${connectionId}:${schema}`). Path verified: `src/stores/schemaStore.ts:18` `tables: Record<string, TableInfo[]>` + `:178-190` `loadTables` accessor. If the cache is empty for the selected ref-schema, the FK tab triggers a one-shot `loadTables(connectionId, refSchema)` from the row's `onChange` handler. The store body itself is not modified.
- **Reference columns picker source = `useSchemaStore.getTableColumns(connectionId, table, schema)`** (returns `Promise<ColumnInfo[]>`, populates internal cache at `tableColumnsCache[<conn>:<schema>:<table>]`). Path verified: `src/stores/schemaStore.ts:216-224`. Lazy fetch on ref-table change.
- **Constraint name auto-suggest format**:
  - FK default: `fk_<table>_<localColumns_joined_underscore>` (e.g. `fk_orders_user_id`, `fk_orders_order_id_line_no`).
  - CHECK default: `chk_<table>_<n>` where `n` is the row index (1-based; e.g. `chk_orders_1`).
  - UNIQUE default: `uq_<table>_<columns_joined_underscore>` (e.g. `uq_users_email`, `uq_users_first_name_last_name`).
  Auto-suggest is reactive — the placeholder text updates when the user toggles columns or types a different table name. The user may override by typing into the `<input>`. Empty trimmed name + auto-suggest fallback used; backend validates whatever string is forwarded.
- **Failure-handling UX surface = inline preview pane error slot** (canonical Sprint 227+228 pattern, `<pre role="alert">`). Verbatim format: `Constraint "<constraint_name>" failed: <PG error>`. Toast is OPTIONAL; if Generator chooses to add one, reuse the existing toast surface — do NOT add a new toast primitive. Inline-pane is canonical.
- **Chained Execute closure** — runs **inside** the `prepareCommit` factory passed to `useDdlPreviewExecution.loadPreview`. Reuses the Sprint 228 chain shape; appends a third loop:
  ```ts
  () => async () => {
    await tauri.createTable(buildRequest(false));
    for (const idx of declaredIndexesForChain) {
      try { await tauri.createIndex(buildIndexRequest(idx, false)); }
      catch (e) { throw new Error(`Index "${idx.name.trim()}" failed: ${String(e)}`); }
    }
    for (const c of declaredConstraintsForChain) {
      try { await tauri.addConstraint(buildConstraintRequest(c, false)); }
      catch (e) { throw new Error(`Constraint "${c.name.trim()}" failed: ${String(e)}`); }
    }
  }
  ```
  `declaredConstraintsForChain` is the order-stable concatenation `[...validatedFks, ...validatedChecks, ...validatedUniques]` (Generator may reorder to `[FKs, UNIQUEs, CHECKs]` — document).
- **`#[serde(default)]` keeps `add_constraint_preview_foreign_key` byte-equivalent.** When the test constructs `ForeignKey { columns, reference_table, reference_columns }` without the new fields (using struct-update syntax `..Default::default()` won't work because there's no Default; the test must use field-init syntax with `on_delete: None, on_update: None`). **Decision: the existing fixture body is left BYTE-EQUIVALENT — no `on_delete: None` line added.** This requires the Rust struct extension to use `#[serde(default)]` + `Default` derive on the new fields **OR** the existing fixture's struct literal must be modified. Generator picks **the former** (additive `#[serde(default)]` only; existing fixture body source stays byte-equivalent only if the Rust pattern allows omitting fields in struct literals — which it does NOT in regular Rust. **Therefore: the existing `add_constraint_preview_foreign_key` fixture's struct literal at `mutations.rs:1314-1318` MUST add `on_delete: None, on_update: None` lines.** This is a **MECHANICAL** test-body diff (additive 2 fields). Document this single allowed mutation in findings.md. The byte-equivalence claim refers to the **emitted SQL string** (assertion at `mutations.rs:1325` — `ALTER TABLE "public"."orders" ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id")` — that string stays byte-equivalent).
- **No anticipatory abstraction** — keep the FK / CHECK / UNIQUE editor inside `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx`. Do NOT lift to `src/components/structure/` or `src/components/ui/`. Sprint 230's reorder/comment polish is a separate concern; sharing comes after a third consumer surfaces.
- **TDD evidence** — capture `red-state.log` in `docs/sprints/sprint-229/tdd-evidence/red-state.log` per `docs/PLAN.md` sprint convention.
- **No `it.skip` / `eslint-disable` / `any` / silent `catch {}`** — see Invariants.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` exit 0 with ≥ 47 cases pass (Sprint 228 baseline = 38 + ≥ 9 new Sprint 229 cases).
2. `pnpm vitest run src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx` exit 0 with ≥ 5 cases pass (presentation tests for the extracted body).
3. `pnpm vitest run` exit 0 — full suite. File count ≥ 218 (Sprint 228 baseline) + 1 new file (`ForeignKeysTabBody.test.tsx`) = ≥ 219. Total tests ≥ Sprint 228 baseline + ≥ 14 new (≥ 9 in `CreateTableDialog.test.tsx` + ≥ 5 in `ForeignKeysTabBody.test.tsx`).
4. `pnpm tsc --noEmit` exit 0.
5. `pnpm lint` exit 0.
6. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
7. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` exit 0.
8. `cargo test --manifest-path src-tauri/Cargo.toml create_table` PASS — Sprint 226+227 fixtures intact, no source diff.
9. `cargo test --manifest-path src-tauri/Cargo.toml create_index` PASS — Sprint 228 fixtures intact, no source diff.
10. `cargo test --manifest-path src-tauri/Cargo.toml add_constraint` PASS with ≥ 12 fixtures: 9 existing (Sprint 228 baseline) — `add_constraint_preview_primary_key`, `_foreign_key`, `_unique`, `_check`, `_empty_pk_columns_fails`, `_empty_check_expression_fails`, `_invalid_name_fails`, `_without_connection_fails_non_preview`, `drop_constraint_preview` — + 3 new — `add_constraint_preview_foreign_key_on_delete_cascade`, `add_constraint_preview_foreign_key_on_update_set_null_with_on_delete_restrict`, `add_constraint_preview_foreign_key_invalid_on_delete_fails`. Existing 9 fixtures pass with at most the **single mechanical 2-line diff** to the `add_constraint_preview_foreign_key` struct literal at lines 1314-1318 (adding `on_delete: None, on_update: None` field initializers — required by Rust syntax for struct-literal completeness; the **emitted SQL assertion at line 1325 stays byte-equivalent**).
11. `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0 (Sprint 214 freeze).
12. `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0 (Sprint 227 freeze).
13. `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
14. `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` = 0.
15. `git diff --stat src/lib/tauri/ddl.ts` = 0 (`tauri.addConstraint` wrapper unchanged at lines 55-58).
16. `git diff --stat src/components/ui/` = 0 (no new shadcn primitive).
17. `git diff --stat src/components/schema/CreateTableTypeCombobox.tsx` = 0 (Sprint 227 hot-fix freeze).
18. `git diff --stat src/components/schema/CreateTableDialog/Header.tsx` = 0 OR additive-only (no behaviour change to existing usage). If additive, document new prop in findings.
19. `git diff --stat src/components/schema/CreateTableDialog/IndexesTabBody.tsx` = 0 (Sprint 228 freeze).
20. `grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` = 0 hits (placeholder removed).
21. `grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` = 0 hits (Sprint 228 placeholder must NOT regress).
22. `grep -n 'addConstraint' src/components/schema/CreateTableDialog.tsx` ≥ 1 hit (modal calls `tauri.addConstraint` from chain closure).
23. `grep -nE 'addConstraint|add_constraint' src-tauri/src/lib.rs` ≥ 1 hit (Tauri command registration intact at line 154).
24. `grep -nE 'FOREIGN KEY|REFERENCES' src-tauri/src/db/postgres/mutations.rs` ≥ 2 hits (already present in impl + fixtures).
25. `grep -nE 'ON DELETE|ON UPDATE' src-tauri/src/db/postgres/mutations.rs` ≥ 2 hits (Path A new emitter clauses + new fixture byte-strings).
26. `grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` matches 0 (Sprint 227 invariant: modal-on-modal removed).
27. `grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo|this\.skip\(\)' src/components/schema/CreateTableDialog.test.tsx src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx` matches 0.
28. `git diff src/ src-tauri/ | grep "^+.*eslint-disable"` matches 0.
29. `git diff src/ | grep -E "^\+.*\bany\b"` matches 0 (no new `any` types).
30. `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0 (Mongo path untouched).
31. Vitest case asserts the **0-constraint IPC sequence** is byte-equivalent to Sprint 228: `[createTable(true), createIndex(true) × M, createTable(false), createIndex(false) × M]` — no `tauri.addConstraint` calls when no FKs/CHECKs/UNIQUEs declared.
32. Vitest case asserts the **happy-path IPC sequence with 1 FK + 1 CHECK + 1 UNIQUE + 0 indexes** is `[createTable(true), addConstraint(true) × 3, createTable(false), addConstraint(false) × 3]` — sequential.
33. Vitest case asserts the **composite FK preview substring** `FOREIGN KEY ("a","b") REFERENCES "T" ("x","y")` is rendered verbatim.
34. Vitest case asserts the **CHECK preview substring** `ADD CONSTRAINT "<name>" CHECK (<expression>)` is rendered verbatim.
35. Vitest case asserts the **table-level UNIQUE preview substring** `ADD CONSTRAINT "<name>" UNIQUE ("col1","col2",...)` is rendered verbatim.
36. Vitest case asserts **constraint-failure-mid-chain abort + table+earlier-constraints stay applied**: 1 FK + 1 CHECK + 1 UNIQUE declared, 2nd `addConstraint({preview_only:false})` rejects → 3rd not called → modal stays open → error contains failing constraint name → `createTable` and 1st `addConstraint` resolved + no `dropConstraint` call.
37. Vitest case asserts the **reference table picker** populates from `useSchemaStore.tables[<conn>:<refSchema>]` cache + triggers `loadTables` on cache miss.
38. Vitest case asserts the **canonical Safe Mode warn-cancel message** verbatim (`"Safe Mode (warn): confirmation cancelled — no changes committed"`) survives the multi-statement bundle when constraints are declared (Sprint 227+228 invariant carry-over).
39. Manual UI smoke (OPTIONAL — `pnpm tauri dev` → CREATE TABLE with 1 FK + 1 CHECK + 1 UNIQUE → all 3 visible in `psql \d <table>`). Document in `docs/sprints/sprint-229/findings.md` if performed; e2e is dead, this is a manual gate only.

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 (file → purpose → LOC delta).
  - check 1-38 실행 결과 (exit code + 핵심 출력). Check 39 optional + log.
  - AC-229-01..AC-229-12 별 concrete evidence (test file path + case name + assertion line; IPC mock-call sequence trace from `vi.fn().mock.calls`).
  - Decision: tab layout = single FK tab with 3 sub-sections (locked by contract; Generator confirms compliance).
  - Decision: reference table picker source = `useSchemaStore.tables[<conn>:<refSchema>]` (locked by contract; Generator confirms wiring).
  - Decision: constraint name auto-suggest format strings — confirm Generator implemented exactly `fk_<table>_<cols_joined>` / `chk_<table>_<n>` / `uq_<table>_<cols_joined>` OR document any deviation in findings.
  - Decision: failure-handling UX surface = inline preview pane (toast OPTIONAL) — Generator records which surface was actually used + verbatim error-message format string.
  - Decision: order of `[FKs, CHECKs, UNIQUEs]` vs `[FKs, UNIQUEs, CHECKs]` in the chain — document and stay byte-stable.
  - Decision: Path A backend extension landed — confirm `ConstraintDefinition::ForeignKey` extended with `on_delete` / `on_update`, 3 new fixtures land, existing `add_constraint_preview_foreign_key` byte-string assertion unchanged (only the struct literal in the fixture body adds 2 field initializers).
  - Confirmation of Sprint 226+227+228 fixture preservation: `cargo test create_table create_index add_constraint` PASS + `git diff src-tauri/src/db/postgres/mutations.rs | grep -E "composite_pk_byte_equivalent|comment.*byte_equivalent|create_index_preview"` outputs 0 lines (existing test bodies untouched).
  - Confirmation that `useDdlPreviewExecution` / `SqlPreviewDialog` / `tauri.addConstraint` / `IndexesTabBody` / `Header` / `CreateTableTypeCombobox` are reused without diff (`git diff --stat` for each).
  - Mongo-path-untouched proof (check 30).
  - TDD red-state evidence (`red-state.log` or red-state commit message in `docs/sprints/sprint-229/tdd-evidence/`).
  - Manual UI smoke note if performed.
- Evaluator must cite:
  - 각 AC-229-01..AC-229-12 별 pass/fail 근거 with concrete evidence (test file:line, IPC mock-call sequence, grep output).
  - missing 또는 weak evidence findings as `P1` / `P2`.
  - regression freeze verification — Sprint 226+227+228 fixtures pass with no source diff (modulo the documented 2-line struct-literal addition on `add_constraint_preview_foreign_key`); 0-constraint IPC sequence byte-equivalent.
  - cross-window invariant verification (no diff).
  - sibling DDL surface freeze verification (`SqlPreviewDialog` / `useDdlPreviewExecution` / `connectionStore` / `schemaStore` / `tauri.addConstraint` / `IndexesTabBody` / `Header` / `CreateTableTypeCombobox` zero diff).
  - reference table picker wiring verification (AC-229-09 evidence + `loadTables` call assertion).
  - failure-handling UX evidence (AC-229-08 — failing constraint name surfaces verbatim; CREATE TABLE + earlier indexes/constraints stay applied).
  - Path A backend extension verification — `on_delete` / `on_update` whitelist, 3 new fixtures, existing FK byte-string assertion intact.

## Test Requirements

### Unit Tests (필수)

- **AC-229-01 (FK tab no longer placeholder)**: 1 vitest case asserts placeholder text gone + 3 sub-section add-buttons present.
- **AC-229-02 (FK row inputs)**: 2 vitest cases — all 7 FK row inputs render with right aria-labels; ON DELETE / ON UPDATE dropdowns each list exactly 5 options.
- **AC-229-03 (Composite FK preview)**: 1 vitest case — 2 local + 2 reference columns → `FOREIGN KEY ("a","b") REFERENCES "T" ("x","y")` substring in preview SQL.
- **AC-229-04 (CHECK row + preview)**: 1 vitest case — single CHECK row → `CHECK (<expression>)` substring; whitespace-only expression filtered.
- **AC-229-05 (UNIQUE row + preview)**: 1 vitest case — single UNIQUE row → `UNIQUE ("col")` substring; multi-column UNIQUE second case.
- **AC-229-06 (Multi-statement preview)**: 1 vitest case — Show DDL with 1 FK + 1 CHECK + 1 UNIQUE + 0 indexes → IPC sequence + preview text contains all 4 substrings.
- **AC-229-07 (Chained Execute happy path)**: 1 vitest case — sequential IPC + 1 history entry + onRefresh + onClose.
- **AC-229-08 (Constraint failure handling)**: 1 vitest case — 1 FK + 1 CHECK + 1 UNIQUE, 2nd `addConstraint` rejects → 3rd not called + modal stays open + error contains failing name + table+1st constraint applied.
- **AC-229-09 (Reference table picker)**: 1 vitest case — seeds `useSchemaStore.tables`, asserts dropdown populates + `loadTables` triggers on cache miss.
- **AC-229-10 (0-constraint byte-equivalent regression)**: 1 vitest case — IPC sequence byte-equivalent to Sprint 228 when no constraints declared.
- **AC-229-11 (No new shadcn primitives)**: covered by check 16.
- **AC-229-12 (Coverage)**: covered by checks 1-3.

Total minimum new vitest cases under Sprint 229 describe block: **≥ 9**. Plus ≥ 5 in new `ForeignKeysTabBody.test.tsx`. Sprint 226+227+228 carry-over cases pass unchanged except the **one** mechanical assertion flip (Foreign Keys placeholder presence test).

### Coverage Target

- 수정 `src/components/schema/CreateTableDialog.tsx`: 라인 ≥ 70%.
- 신규 `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx`: 라인 ≥ 70%.
- 수정 `src-tauri/src/db/postgres/mutations.rs::add_constraint` 함수 (FK arm only): 브랜치 ≥ 70% (already met from Sprint 228 baseline; new ON DELETE / ON UPDATE branches covered by 3 new fixtures).
- CI baseline: 라인 40% / 함수 40% / 브랜치 35%.

### Scenario Tests (필수)

- [x] **Happy path** — preview→commit with 1 FK + 1 CHECK + 1 UNIQUE → multi-statement preview → CREATE TABLE + 3× ADD CONSTRAINT → success → refreshSchema + 1 history entry + modal close.
- [x] **Empty / 누락 입력** — 0 declared FK/CHECK/UNIQUE is the canonical empty state (IPC sequence byte-equivalent to Sprint 228); declaring an FK row with empty `name` / empty `local columns` / empty `reference table` / empty `reference columns` is filtered out of the chain (no `addConstraint` call); declaring a CHECK row with whitespace-only expression filtered out; whitespace-only constraint name uses auto-suggest fallback before chain start.
- [x] **에러 복구** — constraint-failure-mid-chain: 1st succeeds + 2nd rejects → 1st stays applied (no `dropConstraint` rollback) + 2nd's failure surfaces verbatim with constraint name + modal stays open + form editable; CREATE TABLE failure (table already exists) → no `createIndex` / `addConstraint` calls fired + PG error in preview pane (Sprint 226+227+228 carry-over).
- [x] **경계 조건 / 동시성** — declared constraints execute **sequentially** (not parallel); user clicks Execute twice rapidly while chain is mid-flight — second click is ignored (button disabled while `previewLoading` true, per Sprint 227+228 invariant); 5 declared FKs + 5 CHECKs + 5 UNIQUEs (15 ADD CONSTRAINT calls) work without parallelism.
- [x] **상태 전이** — 0-FK → declare 1 FK → preview-stale → Show DDL refetches → Execute → success → modal closes; declare 1 FK → switch to FK tab → switch back to Columns → state preserved.
- [x] **에지 케이스** — invalid constraint name (`"bad name!"`) surfaces validation error before chain start; FK with no local columns checked → row filtered out of chain (no error); FK reference schema = current schema being created in (self-reference at PG-creation time) — chain still works; FK reference table cache miss → `loadTables` called once + dropdown disabled until resolved (or free-text fallback per AC-229-09); ON DELETE = `SET NULL` with non-nullable local column → backend may reject at `ALTER TABLE` time → error surfaces with constraint name; MongoDB connection (RDB-only path) — modal entry-point already disabled per Sprint 226 (no Mongo regression).
- [x] **기존 기능 회귀 없음** — Sprint 226 `composite_pk_byte_equivalent` Rust fixture passes unchanged; Sprint 227 comment-fixture suite passes unchanged; Sprint 228 `create_index` fixture suite passes unchanged; Sprint 228 `add_constraint_preview_foreign_key` byte-string fixture's emitted SQL assertion unchanged (struct-literal body adds 2 lines for `on_delete: None, on_update: None`); Sprint 226+227+228 vitest cases pass with at most ONE mechanical assertion flip (Foreign Keys placeholder presence test); cross-window suite untouched.

## Test Script / Repro Script

1. baseline (before any change):
   ```sh
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx src/components/schema/CreateTableTypeCombobox.test.tsx src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx
   pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml create_table create_index add_constraint --no-run
   ```
2. Generator 작업 후 — primary command profile:
   ```sh
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
   pnpm vitest run src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx
   pnpm vitest run src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml create_table
   cargo test --manifest-path src-tauri/Cargo.toml create_index
   cargo test --manifest-path src-tauri/Cargo.toml add_constraint
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx
   pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx
   ```
3. Verification 4-set + clippy:
   ```sh
   pnpm vitest run
   pnpm tsc --noEmit
   pnpm lint
   cargo build --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
   ```
4. Surface + freeze 검증:
   ```sh
   git diff --stat src/components/structure/useDdlPreviewExecution.ts src/components/structure/SqlPreviewDialog.tsx
   git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts
   git diff --stat src/lib/tauri/ddl.ts
   git diff --stat src/components/ui/
   git diff --stat src/components/schema/CreateTableDialog/IndexesTabBody.tsx
   git diff --stat src/components/schema/CreateTableDialog/Header.tsx
   git diff --stat src/components/schema/CreateTableTypeCombobox.tsx
   git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx
   grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx
   grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx
   grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx
   grep -n 'addConstraint' src/components/schema/CreateTableDialog.tsx
   grep -nE 'FOREIGN KEY|REFERENCES' src-tauri/src/db/postgres/mutations.rs
   grep -nE 'ON DELETE|ON UPDATE' src-tauri/src/db/postgres/mutations.rs
   grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/
   git diff src/ src-tauri/ | grep "^+.*eslint-disable"
   git diff src/ | grep -E "^\+.*\bany\b"
   grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo' src/components/schema/CreateTableDialog.test.tsx src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx
   ```
5. Optional manual UI smoke (record in `docs/sprints/sprint-229/findings.md` if performed):
   ```sh
   pnpm tauri dev
   # → connect to PG → expand schema → right-click → Create Table…
   # → fill 3 columns (id integer NOT NULL, user_id integer NOT NULL, email text)
   # → switch to Foreign Keys tab → + Foreign Key
   #   → name "fk_orders_user" / local columns [user_id] / ref schema "public" / ref table "users" / ref columns [id] / ON DELETE CASCADE / ON UPDATE NO ACTION
   # → + CHECK → name "chk_orders_email_format" / expression "email LIKE '%@%'"
   # → + Unique → name "uq_orders_email" / columns [email]
   # → click Show DDL → confirm preview shows CREATE TABLE + 3× ALTER TABLE ADD CONSTRAINT joined by ;\n
   # → click Execute → confirm table appears in tree
   # → in psql `\d public.<table>` shows all 3 constraints + ON DELETE CASCADE
   ```

## Ownership

- Generator: general-purpose agent (Phase 3, harness skill).
- Write scope: frontend modal (`src/components/schema/CreateTableDialog.tsx` + `.test.tsx`) + new `ForeignKeysTabBody.{tsx,test.tsx}` extraction + `src/types/schema.ts` (additive `on_delete?` / `on_update?` on `foreign_key` arm) + Rust additive extension (`src-tauri/src/models/schema.rs` `ConstraintDefinition::ForeignKey` + `src-tauri/src/db/postgres/mutations.rs::add_constraint` FK arm + 3 new `#[cfg(test)] mod tests` fixtures + 2-line struct-literal addition on existing FK fixture) + sprint docs (`handoff.md`, `findings.md`, `tdd-evidence/red-state.log`) + `docs/PLAN.md` row 4.
- 변경 금지: `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` / `useSafeModeGate*` / `analyzeStatement*` / `ColumnsEditor*` / `IndexesEditor*` / `ConstraintsEditor*` / `schemaStore*` / `connectionStore*` / `src/lib/tauri/ddl.ts` / `src/lib/zustand-ipc-bridge.ts` / `src/lib/window-label.ts` / Mongo paths (`src/components/schema/DocumentDatabaseTree*` / `src-tauri/src/commands/document/`) / sibling `SchemaTree.*` test files / cross-window regression test (`src/__tests__/cross-window-*.test.tsx`) / `src/__tests__/window-lifecycle.ac141.test.tsx` / `main.tsx` / Sprint 226 + 227 + 228 backend fixtures (modulo the 2-line struct-literal addition on `add_constraint_preview_foreign_key`) / `src-tauri/src/models/schema.rs::AddConstraintRequest` body (only the `ForeignKey` enum arm gains 2 fields) / `src-tauri/src/commands/rdb/ddl.rs::add_constraint` Tauri command / `src-tauri/src/db/postgres/mutations.rs::add_constraint` non-FK arms / `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` (Sprint 228 freeze) / `src/components/schema/CreateTableDialog/Header.tsx` (additive-only if scope demands; otherwise diff = 0) / `src/components/schema/CreateTableTypeCombobox.tsx` (Sprint 227 freeze).

## Exit Criteria

- Open `P1` / `P2` findings: `0`.
- Required checks passing: `yes` (1-38 모두; 39 optional).
- Acceptance criteria evidence linked in `handoff.md` — AC-229-01..AC-229-12 each cited with concrete test/grep evidence.
- **본 sprint 후 Phase 27 sprint 4 종료** — Foreign Keys + CHECK + UNIQUE constraints tab functional lands; Sprint 230 (reorder + table COMMENT polish + type coloring) plugs into the same `CreateTableDialog` shell without further structural change.
- TDD evidence (`red-state.log` 또는 red-state commit) recorded in `docs/sprints/sprint-229/tdd-evidence/`.
- e2e closure dependency: **none**. `lefthook.yml:5_e2e` stays disabled per ADR 0019. Phase 27 e2e smoke deferred under `[DEFERRED-PHASE-27-E2E]` marker.
