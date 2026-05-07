# Sprint 229 — Handoff

Sprint: `sprint-229` (feature — Foreign Keys + CHECK + UNIQUE
constraints tab functional in CREATE TABLE UI).
Date: 2026-05-07.
Status: Generator complete.
Type: feature (Phase 27 sprint 4).

## Generator Handoff

### Changed Files

#### Backend (Rust)

| 파일 | LOC delta | Purpose |
|------|-----------|---------|
| **MOD** `src-tauri/src/models/schema.rs` | +25 | Extend `ConstraintDefinition::ForeignKey` enum arm with two new optional fields — `#[serde(default)] pub on_delete: Option<String>` and `#[serde(default)] pub on_update: Option<String>`. `#[serde(default)]` keeps Sprint 226+227+228 callers byte-equivalent on the wire (omitting the keys deserializes to `None`). Two existing serde-roundtrip tests (`constraint_definition_foreign_key_serde`, `add_constraint_request_serde_roundtrip`) extended with `on_delete: None, on_update: None` Rust struct-literal completeness — emitted JSON shape unchanged when fields are `None` (serde drops `None` values when `Option` is the field type and the surrounding `Serialize` impl is the default). |
| **MOD** `src-tauri/src/db/postgres/mutations.rs` | +147 | (a) Module-level helper `format_referential_action_clause(action, keyword)` + `REFERENTIAL_ACTIONS` const slice — closed PG-canonical whitelist `{NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT}`. (b) `add_constraint`'s FK match arm extended (~+22 LOC) — appends ` ON DELETE <action>` / ` ON UPDATE <action>` to the emitted SQL only when `Some(action)` AND action is whitelisted. Validation failures surface as `AppError::Validation("Invalid ON DELETE action: <value>")` / `… ON UPDATE …`. Non-FK match arms (PrimaryKey / Unique / Check) byte-equivalent. (c) Existing `add_constraint_preview_foreign_key` fixture's struct literal (lines 1314-1318) gains 2 mechanical lines (`on_delete: None, on_update: None`) — Rust syntax requires complete field listings. **Emitted SQL assertion at line 1325 stays byte-equivalent** (`#[serde(default)]` doesn't help with Rust struct construction; only with serde deserialization). (d) 3 new fixtures: `add_constraint_preview_foreign_key_on_delete_cascade`, `add_constraint_preview_foreign_key_on_update_set_null_with_on_delete_restrict`, `add_constraint_preview_foreign_key_invalid_on_delete_fails`. |

#### Frontend (TS / React)

| 파일 | LOC delta | Purpose |
|------|-----------|---------|
| **MOD** `src/types/schema.ts` | +15 | Additive `on_delete?: string \| null` + `on_update?: string \| null` on the `foreign_key` arm of the `ConstraintDefinition` discriminated union (snake_case to match Rust serde). Sprint 226+227+228 callers that omit the fields remain valid. |
| **MOD** `src/components/schema/CreateTableDialog.tsx` | +432 / −15 (=1199 final) | Replace Sprint 228 Foreign Keys-tab placeholder body with `<ForeignKeysTabBody>` invocation. Add modal-local `fks: ForeignKeyDraft[]` / `checks: CheckDraft[]` / `uniques: UniqueDraft[]` draft state arrays + 13 mutator handlers (3 add / 3 remove / 3 update / 4 toggle). Reactive subscriptions to `useSchemaStore.tables` + `tableColumnsCache` — translated to `refTablesByKey` (`<refSchema>` → table-name list) + `refColumnsByKey` (`<refSchema>:<refTable>` → column-name list) for the FK editor body. New `declaredConstraintsForChain` `useMemo` filters out invalid rows + applies auto-suggest names (`fk_<table>_<cols>` / `chk_<table>_<n>` / `uq_<table>_<cols>`). Extend `handleShowDdl` to fan out preview-only `addConstraint` calls and join with `;\n`. Extend the commit closure with a third loop after the Sprint 228 indexes loop — `for (const c of chainConstraints) { try { await tauri.addConstraint(buildConstraintRequest(c, false)); } catch (e) { throw new Error(`Constraint "${c.name}" failed: ${String(e)}`); } }`. New helper `useFkReferencePicker(connectionId)` consumed for lazy `loadTables` / `getTableColumns`. |
| **NEW** `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx` | +608 | Pure presentational mapper for the 3-sub-section editor (Foreign Keys / CHECK / UNIQUE). Owns no state. Props: 3 draft arrays + `availableColumns` + `availableSchemas` + `refTablesByKey` + `refColumnsByKey` + `fkRefColumnsLoadingByTrackingId` + 13 mutator callbacks. FK row renders 7 inputs (name + local cols multi-checkbox + ref schema `<Select>` + ref table `<Select>`-or-`<input>` (graceful fallback) + ref cols multi-checkbox-or-comma-text-input + ON DELETE `<Select>` + ON UPDATE `<Select>`). CHECK row = name + single-line expression `<input>`. UNIQUE row = name + columns multi-checkbox. Each sub-section's empty state mirrors the Sprint 228 IndexesTabBody dashed-border pattern. **Larger than contract's ~280 LOC estimate (608 LOC) because three sub-sections + 7-input FK rows expanded the JSX surface; structure is still a single shallow-tree pure mapper, no anticipatory abstraction.** |
| **NEW** `src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx` | +226 | Pure presentation tests — render shape + aria labels + add/remove callbacks + ON DELETE/ON UPDATE 5-option list + column toggle wiring. 10 cases (≥ 5 contract minimum). |
| **NEW** `src/hooks/useFkReferencePicker.ts` | +61 | Tiny lifecycle hook wrapping the `useSchemaStore.getState().loadTables` / `getTableColumns` imperative calls. Necessary because `eslint.config.js`'s `no-restricted-syntax` rule (2026-05-05) forbids `store.getState()` inside `src/**/*.tsx` files; selector hooks are reactive and the chain needed an imperative one-shot trigger. Exports `ensureTablesLoaded(refSchema)` + `loadColumnsIfMissing(refSchema, refTable)`. The schema store body itself (`schemaStore.ts`) is byte-equivalent — only the existing API surface is invoked. |
| **MOD** `src/components/schema/CreateTableDialog.test.tsx` | +806 (mock surface +9, AC-227-01 placeholder-presence test rewritten −4 / +21, Sprint 229 describe block +789) | Extend `vi.mock("@lib/tauri")` to expose `addConstraint` + `dropConstraint` mocks. Add `describe("Sprint 229 — Foreign Keys + CHECK + UNIQUE tab functional", …)` block with 13 vitest cases covering AC-229-01..AC-229-12 + canonical Safe Mode warn-cancel survival. Mechanically rewrite the Sprint 227 carry-over `Foreign Keys tab renders 'Available in Sprint 229' placeholder…` test to its inverse (placeholder absent + 3 add buttons present) since AC-229-01 supersedes that snapshot. All other Sprint 226+227+228 carry-overs pass byte-for-byte unchanged. |

#### Docs

| 파일 | Purpose |
|------|---------|
| **MOD** `docs/PLAN.md` (+1, =) | Add row 4 (Sprint 229 ✓) to the post-225 feature cycle table. Row 5 reseeded as the next-candidate placeholder (TBD — Sprint 230 polish). |
| **NEW** `docs/sprints/sprint-229/handoff.md` | This file. |
| **NEW** `docs/sprints/sprint-229/findings.md` | Decisions + tradeoffs + residual risks. |
| **NEW** `docs/sprints/sprint-229/tdd-evidence/red-state.log` | TDD red-state evidence — 14 new CreateTableDialog vitest cases + 10 ForeignKeysTabBody cases captured failing before implementation. |

총: 2 backend MOD + 1 type MOD + 1 frontend MOD + 2 frontend NEW + 1 hook NEW + 1 test MOD + 4 docs.

### Checks Run

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` | **PASS** — 52/52 (Sprint 228 baseline 38 + 14 new) |
| 2 | `pnpm vitest run src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx` | **PASS** — 10/10 (≥ 5 required) |
| 3 | `pnpm vitest run` | **PASS** — 218 files / 2819 tests (Sprint 228 baseline 217 / 2795; Sprint 229 +1 file + ≥ 24 cases) |
| 4 | `pnpm tsc --noEmit` | **PASS** — exit 0 |
| 5 | `pnpm lint` | **PASS** — exit 0 |
| 6 | `cargo build --manifest-path src-tauri/Cargo.toml` | **PASS** — exit 0 |
| 7 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **PASS** — exit 0 |
| 8 | `cargo test --manifest-path src-tauri/Cargo.toml create_table` | **PASS** — 16/16 (Sprint 226+227 fixtures intact, no source diff) |
| 9 | `cargo test --manifest-path src-tauri/Cargo.toml create_index` | **PASS** — 11/11 (Sprint 228 fixtures intact, no source diff) |
| 10 | `cargo test --manifest-path src-tauri/Cargo.toml add_constraint` | **PASS** — 12/12 (9 baseline + 3 new ON DELETE/UPDATE; existing `add_constraint_preview_foreign_key` 2-line struct-literal addition only — emitted SQL assertion at line 1325 byte-equivalent) |
| 11 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | **= 0** ✓ |
| 12 | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | **= 0** ✓ |
| 13 | `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | **= 0** ✓ |
| 14 | `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` | **= 0** ✓ |
| 15 | `git diff --stat src/lib/tauri/ddl.ts` | **= 0** ✓ |
| 16 | `git diff --stat src/components/ui/` | **= 0** ✓ |
| 17 | `git diff --stat src/components/schema/CreateTableTypeCombobox.tsx` | **= 0** ✓ |
| 18 | `git diff --stat src/components/schema/CreateTableDialog/Header.tsx` | **= 0** ✓ |
| 19 | `git diff --stat src/components/schema/CreateTableDialog/IndexesTabBody.tsx` | **= 0** ✓ |
| 20 | `grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` | **= 0 hits** ✓ |
| 21 | `grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` | **= 0 hits** ✓ (Sprint 228 removal not regressed) |
| 22 | `grep -n 'addConstraint' src/components/schema/CreateTableDialog.tsx` | **≥ 2 hits** (lines 776 + 807) ✓ |
| 23 | `grep -nE 'addConstraint\|add_constraint' src-tauri/src/lib.rs` | **= 1 hit** (line 154) ✓ |
| 24 | `grep -nE 'FOREIGN KEY\|REFERENCES' src-tauri/src/db/postgres/mutations.rs` | **= 5 hits** ✓ |
| 25 | `grep -nE 'ON DELETE\|ON UPDATE' src-tauri/src/db/postgres/mutations.rs` | **= 12 hits** (Path A new emitter + 3 new fixture byte-strings) ✓ |
| 26 | `grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` | **= 1 hit** (jsdoc only — sibling editors note, no import) — same as Sprint 227+228 baseline; "= 0 hits" in contract was inaccurate against existing carry-over. Documented in §findings as lock-in. |
| 27 | `grep -nE 'it\.only\|it\.skip\|describe\.skip\|xit\|it\.todo' …` | **= 0** ✓ |
| 28 | `git diff src/ src-tauri/ \| grep "^+.*eslint-disable"` | **= 0** ✓ (no new eslint-disable; resolved a typed-mock helper to remove the one I had inadvertently added during red-phase) |
| 29 | `git diff src/ \| grep -E "^\+.*\bany\b"` | **= 0** ✓ |
| 30 | `grep -rnE 'createCollection\|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` | **= 0** ✓ |
| 31 | Vitest case asserts 0-constraint IPC sequence byte-equivalent | **PASS** — `0-constraint IPC sequence is byte-equivalent to Sprint 228 (AC-229-10)` |
| 32 | Vitest case asserts 1-FK + 1-CHECK + 1-UNIQUE happy-path IPC sequence | **PASS** — `Show DDL bundles CREATE TABLE + 3× ADD CONSTRAINT … (AC-229-06)` + `Execute chains createTable + addConstraint × 3 sequentially with one history entry (AC-229-07)` |
| 33 | Vitest case asserts composite FK preview substring | **PASS** — `composite FK emits FOREIGN KEY ('order_id','user_id') REFERENCES 'orders' ('id','line_no') in preview (AC-229-03)` |
| 34 | Vitest case asserts CHECK preview substring | **PASS** — `CHECK row preview shows ADD CONSTRAINT "<name>" CHECK (<expression>) (AC-229-04)` |
| 35 | Vitest case asserts table-level UNIQUE preview substring | **PASS** — `table-level UNIQUE row preview shows ADD CONSTRAINT "<name>" UNIQUE ("col") (AC-229-05)` |
| 36 | Vitest case asserts constraint-failure-mid-chain abort | **PASS** — `2nd addConstraint(commit) rejection halts chain, modal stays open, error names failing constraint (AC-229-08)` |
| 37 | Vitest case asserts reference table picker populates from cache + triggers loadTables on cache miss | **PASS** — `reference table picker populates from useSchemaStore.tables cache (AC-229-09)` + `reference schema selection triggers loadTables on cache miss (AC-229-09)` |
| 38 | Vitest case asserts canonical Safe Mode warn-cancel verbatim | **PASS** — `Safe Mode warn-cancel surfaces the canonical message even with constraints declared …` |
| 39 | Manual UI smoke (`pnpm tauri dev`) | **NOT PERFORMED** — optional; e2e dead per ADR 0019 / lefthook 5_e2e skip:true since 2026-05-01. |

### Done Criteria Coverage (AC-229-01..12)

| AC | Evidence |
|----|----------|
| **AC-229-01** FK tab placeholder removed; 3 add buttons | `grep '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` = 0 hits. Vitest cases `Foreign Keys tab no longer renders the 'Available in Sprint 229' placeholder (AC-229-01)` (CreateTableDialog.test.tsx Sprint 229 block) + the rewritten Sprint 227 carry-over assertion (`Foreign Keys tab no longer renders the Sprint 228 placeholder (AC-227-01 superseded by AC-229-01)`) both assert placeholder is gone + Add foreign key / Add check / Add unique buttons surface. |
| **AC-229-02** FK row inputs + ON DELETE/UPDATE 5 options | Vitest cases `FK row renders all 7 inputs (name + local cols + ref schema + ref table + ref cols + ON DELETE + ON UPDATE) (AC-229-02)` + `ON DELETE / ON UPDATE dropdowns each list exactly 5 options (AC-229-02)` + ForeignKeysTabBody.test.tsx `FK ON DELETE / ON UPDATE dropdowns expose 5 PG-canonical options`. |
| **AC-229-03** Composite FK preview substring | Vitest case `composite FK emits FOREIGN KEY ('order_id','user_id') REFERENCES 'orders' ('id','line_no') in preview (AC-229-03)` — asserts `previewPane.textContent.toContain('FOREIGN KEY ("order_id", "user_id") REFERENCES "orders" ("id", "line_no")')` + payload columns/reference_columns arrays. |
| **AC-229-04** CHECK preview substring + whitespace filter | Vitest cases `CHECK row preview shows ADD CONSTRAINT "<name>" CHECK (<expression>) (AC-229-04)` + `whitespace-only CHECK expression is filtered out of the chain (AC-229-04)`. |
| **AC-229-05** Table-level UNIQUE preview substring | Vitest case `table-level UNIQUE row preview shows ADD CONSTRAINT "<name>" UNIQUE ("col") (AC-229-05)`. |
| **AC-229-06** Multi-statement preview shows full bundle | Vitest case `Show DDL bundles CREATE TABLE + 3× ADD CONSTRAINT (1 FK + 1 CHECK + 1 UNIQUE) (AC-229-06)`. |
| **AC-229-07** Chained Execute happy path — sequential + 1 history entry | Vitest case `Execute chains createTable + addConstraint × 3 sequentially with one history entry (AC-229-07)` — `maxConcurrent <= 1` + 1 history entry + onRefresh once + onClose once. |
| **AC-229-08** Constraint failure mid-chain → table+earlier stay applied | Vitest case `2nd addConstraint(commit) rejection halts chain, modal stays open, error names failing constraint (AC-229-08)` — 2nd commit-time `addConstraint` rejects → 3rd not called → preview pane contains failing constraint name verbatim → modal stays open → no `dropConstraint` rollback. |
| **AC-229-09** Reference table picker schemaStore-cached + lazy load | Vitest cases `reference table picker populates from useSchemaStore.tables cache (AC-229-09)` + `reference schema selection triggers loadTables on cache miss (AC-229-09)`. |
| **AC-229-10** 0-constraint byte-equivalent regression | Vitest case `0-constraint IPC sequence is byte-equivalent to Sprint 228 (AC-229-10)` — `mockAddConstraint.not.toHaveBeenCalled()` + `mockCreateIndex.not.toHaveBeenCalled()` after preview + commit when no constraints declared. `cargo test create_table create_index add_constraint` all green; existing `composite_pk_byte_equivalent` + comment fixtures + `create_index_preview_*` fixtures bytes untouched; `add_constraint_preview_foreign_key` SQL assertion unchanged. |
| **AC-229-11** No new shadcn primitives | `git diff --stat src/components/ui/` = 0. `ForeignKeysTabBody.tsx` imports only existing `@components/ui/{button,select}` modules already imported by Sprint 228 sibling `IndexesTabBody.tsx`. |
| **AC-229-12** Test coverage targets | 14 new vitest cases under Sprint 229 describe (≥ 9 required). 10 cases in new `ForeignKeysTabBody.test.tsx` (≥ 5 required). Canonical Safe Mode message verbatim case present (`Safe Mode warn-cancel surfaces the canonical message even with constraints declared`). Rust `add_constraint` baseline 9 → 12 unit (3 new ON DELETE/UPDATE fixtures). |

### Decisions

- **Tab layout**: single Foreign Keys tab with 3 sub-sections (FK / CHECK / UNIQUE) — locked by contract. Compliant.
- **Reference table picker source**: `useSchemaStore.tables[<conn>:<refSchema>]` reactive subscription via `useSchemaStore((s) => s.tables)`. Lazy `loadTables(connectionId, refSchema)` on ref-schema change when cache empty (via `useFkReferencePicker.ensureTablesLoaded`). Reference columns via `useSchemaStore((s) => s.tableColumnsCache)` reactive + lazy `getTableColumns(connectionId, refTable, refSchema)` on ref-table change (via `useFkReferencePicker.loadColumnsIfMissing`). The schema store body itself is byte-equivalent.
- **Auto-suggest constraint names**: format `fk_<table>_<cols_joined>` / `chk_<table>_<n>` / `uq_<table>_<cols_joined>` — applied in `declaredConstraintsForChain` `useMemo` when the user leaves the name field blank. Implemented in TS (parent), not the body — the body just renders the input. (NB: the contract suggested putting the auto-suggest as `placeholder` text; I implemented as a fallback fill at chain-assembly time so both UI and chain agree on the same name.)
- **Failure surface text**: inline preview pane error slot only (no toast). Verbatim format: `Constraint "<name>" failed: <PG error>`. Tested via `previewPane.textContent.toContain("chk_age")` substring assertion (AC-229-08).
- **Chain order across families**: `[...validatedFks, ...validatedChecks, ...validatedUniques]` — declared family order, byte-stable across preview and execute. Generator did not reorder.
- **Path A backend extension**: landed. `ConstraintDefinition::ForeignKey` extended with `on_delete: Option<String>` + `on_update: Option<String>` (`#[serde(default)]`). 3 new fixtures + 2-line struct-literal addition on existing FK fixture (Rust syntax requirement; emitted SQL byte-equivalent because `#[serde(default)]` doesn't affect Rust struct construction, only serde deserialization).
- **ON DELETE / ON UPDATE default**: UI default = `"NO ACTION"` (matches PG default). Always serialized as `Some("NO ACTION")` rather than omitted; the backend emits the explicit clause. This is one of the two acceptable choices per pre-flight note 11; chose verbose form for explicitness — the SQL byte-string includes the clause, making the user's intent explicit in tooling like `psql \d`.
- **`useFkReferencePicker` hook**: added to satisfy `eslint.config.js` `no-restricted-syntax` rule that forbids `store.getState()` in `src/**/*.tsx`. The hook lives in `src/hooks/` (rule allows `getState()` there for one-shot imperative ops). Schema store body untouched.
- **`ForeignKeysTabBody.tsx` extracted, sized 608 LOC** (vs contract estimate 280): three sub-sections, each with their own row-render JSX, expanded the file. Still a single shallow-tree presentational mapper, no anticipatory abstraction. Parent CreateTableDialog.tsx grew to 1199 LOC (up from Sprint 228's 793 + 432 — 286 of which is in the `declaredConstraintsForChain` memo + 13 handlers + reactive store wiring; the FK editor JSX itself is in the extracted body). Sprint 230 polish may further extract `ColumnsTabBody.tsx` / `KeysTabBody.tsx` to drop parent below 700.

### Assumptions

1. **Hook reuse, not bypass**: `useDdlPreviewExecution.ts` body unchanged. The chain runs inside the `prepareCommit` factory closure passed to `loadPreview`. Hook diff = 0 verified.
2. **`SqlPreviewDialog` body unchanged**: Sprint 227 already removed the import; only a comment-mention persists in the modal (legacy reference). Component diff = 0 verified.
3. **`tauri.addConstraint` wrapper unchanged**: existing `src/lib/tauri/ddl.ts` lines 55-58 already wired. `git diff --stat` = 0 verified.
4. **`AddConstraintRequest` Rust struct shell unchanged**: only the `ConstraintDefinition::ForeignKey` enum arm gained 2 fields; surrounding `AddConstraintRequest` definition byte-equivalent. `git diff src-tauri/src/models/schema.rs | grep -E "^[+-].*pub struct AddConstraintRequest"` outputs 0 lines.
5. **Backend `add_constraint` impl body extension is FK-arm-only**: PrimaryKey / Unique / Check arms byte-equivalent; surrounding `pub async fn add_constraint` signature + first 6 lines + final preview/execute/info!/Ok blocks byte-equivalent.
6. **Sprint 226+227+228 carry-over assertion text frozen for all but ONE case** — the Foreign Keys placeholder presence test (`Foreign Keys tab renders 'Available in Sprint 229' placeholder…`) was rewritten to its inverse since AC-229-01 supersedes that snapshot. Comment updated to `(AC-227-01 superseded by AC-229-01)`. Mirrors the Sprint 228 carry-over flip pattern.
7. **Chain failure rolls back NEITHER the table NOR earlier indexes/constraints** — partial-atomic policy C. The chain closure simply re-throws on first constraint failure; subsequent `addConstraint` calls do not fire. The hook records the partial run as `status: "error"` in `useQueryHistoryStore`. The CREATE TABLE + earlier indexes/constraints remain applied at PG.
8. **Reactive store subscriptions** (`useSchemaStore((s) => s.tables)` / `tableColumnsCache`) auto-rerender the FK editor body when a lazy `loadTables` / `getTableColumns` populates the cache — so dropdowns auto-fill without the user having to re-open the row.
9. **Validation timing**: backend whitelist check fires at preview-only AND commit-only branches (the SQL builder runs the same code path). Frontend default = `"NO ACTION"` keeps the UI happy without inline errors.

### Residual Risk

- **Manual UI smoke not performed.** `pnpm tauri dev` smoke deferred (e2e dead since 2026-05-01). Same risk as Sprint 226/227/228.
- **CHECK expression body is single-line `<input>`, not `<textarea>`.** Multi-line + SQL syntax highlighting is a Sprint 230 polish question (contract Out of Scope).
- **No FK self-reference fast-path.** A user declaring an FK from the table-being-created back to itself goes through atomic policy C — CREATE TABLE creates the table first, then the chain's ALTER TABLE ADD CONSTRAINT runs against the now-existing table. PG accepts this. Documented for future sprints.
- **Reference column free-text fallback uses comma-split parsing.** When the column cache is empty (fetch failed / connection offline), the user types `id, name` and the parent splits on `,` + trims. No special-character handling beyond trim. Backend `validate_identifier` rejects malformed names. A future polish could surface inline errors per non-conforming column name.
- **Constraint name auto-suggest fires only at chain-assembly time, not as placeholder text.** The user sees an empty input; if they leave it blank the chain uses the auto-suggested name. A future polish could surface the auto-suggested name as `placeholder` text so the user sees it in advance.
- **`ForeignKeysTabBody.tsx` LOC = 608** — bigger than contract's ~280 LOC estimate. Justified by 3 sub-sections × 2-3 sub-elements each; the parent only grew by 432 LOC because 280 LOC of FK-tab JSX moved to the new sub-component. Sprint 230 polish may further extract per-sub-section bodies if reordering is added.

## Required checks (재현)

```sh
pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
pnpm vitest run src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
cargo build --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml create_table
cargo test --manifest-path src-tauri/Cargo.toml create_index
cargo test --manifest-path src-tauri/Cargo.toml add_constraint
```

기대값: 모두 zero error. 자세한 결과는 위 표 참조.

## 다음 sprint 가 알아야 할 것

### Sprint 230 (polish)

- Reorder ↑↓ buttons (column rows + index rows + FK rows + CHECK rows + UNIQUE rows).
- Table-level `COMMENT ON TABLE`.
- Type coloring on combobox display.
- Schema picker position move (header → form section).
- (Optional) further parent-file extraction (`ColumnsTabBody.tsx` / `KeysTabBody.tsx`) to drop `CreateTableDialog.tsx` below 700 LOC. Currently 1199.
- (Optional) CHECK expression body multi-line + syntax highlighting.
- (Optional) Constraint name auto-suggest as `placeholder` text rather than chain-time fallback.

## Refs

- `docs/sprints/sprint-229/contract.md` — sprint contract (38 verification checks, 12 ACs).
- `docs/sprints/sprint-229/findings.md` — decisions / tradeoffs / residual risks.
- `docs/sprints/sprint-229/tdd-evidence/red-state.log` — TDD red-state.
- `docs/sprints/sprint-228/handoff.md` — Sprint 228 baseline (Indexes tab pattern).
- `docs/sprints/sprint-228/findings.md` — chain shape rationale; sub-component extraction precedent.
- `docs/sprints/sprint-227/findings.md` — partial-atomic policy C decision (lines 118-119).
- `docs/sprints/sprint-214/handoff.md` — `useDdlPreviewExecution` source pattern.
