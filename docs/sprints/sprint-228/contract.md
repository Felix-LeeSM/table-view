# Sprint Contract: sprint-228

## Summary

- Goal: Phase 27 sprint 3 — make the **Indexes tab functional** in `CreateTableDialog`. Replace the Sprint 227 placeholder body (`"Available in Sprint 228"`) with an interactive editor (per-row index name + columns multi-select + index type dropdown + unique checkbox + `+`/`-` add/remove buttons). After a successful CREATE TABLE the frontend chains `tauri.createIndex` calls **sequentially**, one per declared index, **each in its own transaction** (atomic policy = C, partial-atomic — DataGrip pattern). Index failures do **NOT** roll back the CREATE TABLE; already-applied indexes from earlier in the chain stay applied; the failing index name is surfaced in a toast / inline error. The inline DDL Preview pane shows the multi-statement bundle (`CREATE TABLE` + `COMMENT ON COLUMN ×N` + `CREATE INDEX ×M`) joined by `;\n` so `useDdlPreviewExecution`'s `;`-split + per-statement Safe Mode analysis treats each as its own statement.

  **Important** — the backend `create_index` Tauri command + Rust `PostgresAdapter::create_index` impl + `CreateIndexRequest` model + frontend `tauri.createIndex` wrapper + 8 Rust unit fixtures (`create_index_preview_btree`, `create_index_preview_hash_non_unique`, `create_index_preview_multi_column`, `create_index_all_types_accepted` covering btree/hash/gist/gin/brin, `create_index_invalid_type_fails`, `create_index_empty_columns_fails`, `create_index_invalid_name_fails`, `create_index_without_connection_fails_non_preview`) **already exist** from a prior sprint. Sprint 228 is therefore predominantly a **frontend** sprint. Backend changes are limited to (a) confirming the existing `create_index` SQL emission is byte-stable for the four UI-exposed types (btree / hash / gin / gist), and (b) adding **at most** one additional Rust fixture if the Generator wants byte-equivalence proof for the multi-statement preview chain that the frontend will assemble (optional — the chain lives entirely on the frontend; the existing fixtures already cover each `CREATE INDEX` statement byte-for-byte).
- Audience: Generator + Evaluator (multi-agent harness, post-227 cycle, Phase 27 sprint 3 — Indexes tab functional).
- Owner: harness skill orchestrator.
- Verification Profile: `mixed` (command + static).

## In Scope

Backend (Rust) — minimal:
- `src-tauri/src/db/postgres/mutations.rs` — **NO logic change**. Existing `create_index` impl emits `CREATE [UNIQUE ]INDEX "<name>" ON "<schema>"."<table>" USING <type> ("<col1>"[, "<col2>"…])` (verified at lines 401-461) with the lowercased type-validator accepting `btree | hash | gist | gin | brin`. Sprint 228 may add **at most** ≤ 2 new Rust unit fixtures for the four UI-exposed types if any are missing strict byte-equality coverage today (current coverage: btree unique single-col, hash non-unique single-col, btree multi-col, all-types-acceptance loop without byte-string). Generator's call. ≤ +40 LOC.
- `src-tauri/src/models/schema.rs` — **NO change**. `CreateIndexRequest` (lines 108-120) already carries `connection_id`, `schema`, `table`, `index_name`, `columns`, `index_type`, `is_unique` (`#[serde(default)]`), `preview_only` (`#[serde(default)]`). Diff = 0.
- `src-tauri/src/commands/rdb/ddl.rs` — **NO change**. `create_index` Tauri command (lines 75-85) already wired and registered in `src-tauri/src/lib.rs:152`. Diff = 0.

Frontend (TS/TSX) — primary scope:
- `src/components/schema/CreateTableDialog.tsx` (~+220 / ~-15 LOC): replace the Sprint 227 Indexes-tab placeholder body with an interactive editor. Add modal-local `IndexDraft` state (`trackingId`, `name`, `columns: string[]`, `index_type: "btree" | "hash" | "gin" | "gist"`, `unique: boolean`). Add `+ Index` / `−` row buttons. Wire the inline DDL Preview pane to render multi-statement preview: `CREATE TABLE` + `COMMENT ON ×N` + `CREATE INDEX ×M`, joined by `;\n` between statements (single trailing `;` per statement so the existing `;`-split + Safe Mode flow analyses each as its own). Wire the Execute closure to chain (a) `tauri.createTable({preview_only:false})` first, (b) on success, sequentially `await tauri.createIndex({preview_only:false, …})` for each declared index, **each in its own transaction**, (c) on the first index failure halt the chain, leave the table + earlier indexes applied, and surface a toast / inline error naming the failing index. Reuse `useDdlPreviewExecution` (Sprint 214) **without modification** — the hook already accepts an arbitrary `prepareCommit` factory; the chain runs inside that closure.
- `src/components/schema/CreateTableDialog.test.tsx` (~+180 LOC): add ≥ 8 new vitest cases under a `describe("Sprint 228 — Indexes tab functional", …)` block — tab-no-longer-placeholder; add row; remove row (and last-row guard); index-type dropdown options; multi-column selection; unique checkbox forwards `is_unique`; happy-path chained execution sequence (`createTable` → `createIndex × N`); index-failure-after-table chain abort + table stays; PK auto-emission deduplication (no `createIndex` call when the row's columns exactly match the declared PK). Sprint 226+227 carry-over cases stay byte-for-byte unchanged (no assertion-text edits; mechanical query selectors only when forced by tab structure — at this point the Sprint 227 carry-overs are already tab-aware).
- `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` (new, optional — Generator's call to extract or inline; if file > 700 LOC after inline edits, extract). ~150 LOC if extracted.
- `src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx` (new, only if extracted). ~120 LOC.

Docs:
- `docs/PLAN.md` (≤ +3 LOC): row 3 added to post-225 feature cycle table for sprint-228.
- `docs/sprints/sprint-228/handoff.md` (new): Generator handoff.
- `docs/sprints/sprint-228/findings.md` (new): decisions + tradeoffs + residual risk.
- `docs/sprints/sprint-228/tdd-evidence/red-state.log` (new) — TDD red-state captured before green commits.

## Out of Scope

Cite Sprint 227 spec "Future sprints" (`docs/sprints/sprint-227/spec.md:50-55`) + the 2026-05-06 user decision (atomic policy C):

- **Foreign Keys editor** — Sprint 229. Sprint 228 keeps the Foreign Keys tab body as the verbatim placeholder `"Available in Sprint 229"`. No FK row inputs, no reference-table picker, no `ON DELETE` / `ON UPDATE` selectors.
- **CHECK / UNIQUE table-level constraints** — Sprint 229 may fold these in alongside FKs.
- **Reorder ↑/↓ buttons** for column rows or index rows — Sprint 230 polish.
- **Table-level `COMMENT ON TABLE`** — Sprint 230 polish.
- **Type coloring on combobox display** — Sprint 230 polish.
- **Schema picker position move** — Sprint 230 polish; sprint-228 keeps the Sprint 227 header position.
- **MongoDB `createCollection`** / DocumentAdapter — Phase 27 = PG-first.
- **`brin` index type exposure in the UI** — backend accepts it but the four UI dropdown options stay `btree | hash | gin | gist` (DataGrip parity). `brin` remains backend-callable but not user-selectable from this modal.
- **Index expression / function-based indexes** (`CREATE INDEX … ON t USING btree (lower(col))`) — only direct column-name selection.
- **Partial indexes** (`WHERE` clause) — out of scope; deferred to a future polish sprint.
- **Atomic-with-CREATE-TABLE indexes** — atomic policy C is locked: `CREATE INDEX` runs in a separate transaction *after* CREATE TABLE returns success. Per `docs/sprints/sprint-227/findings.md:118-119` and the 2026-05-06 user decision.
- **`useDdlPreviewExecution.ts` body changes** — Sprint 214 freeze (`git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0).
- **`SqlPreviewDialog.tsx` body changes** — Sprint 227 freeze (`git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0). Sibling editors keep using it.
- **`schemaStore` / `connectionStore` body changes** — Sprint 224 baseline (`git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` = 0).
- **Cross-window invariant suite** — `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
- **`SYNCED_KEYS` extension** of any store — schema cache stays window-local; no cross-window broadcast.
- **`attachZustandIpcBridge` modification** — no new IPC channel, no bridge wiring change.
- **Sprint 226 + Sprint 227 backend fixtures** — must remain byte-equivalent; assertions unchanged.
- **New shadcn primitives** — reuse existing `Select`, the existing checkbox styling pattern from `CreateTableDialog.tsx:434-446` (or `Checkbox` if a primitive exists), and `Input`. The columns multi-select uses a multi-`<input type="checkbox">` group (DataGrip pattern) — no new primitive. See "Design Bar" below for the explicit choice rationale.

## Invariants

- **Sprint 226 + Sprint 227 byte-equivalence preserved** — Rust fixtures `create_table_preview_three_column_composite_pk_byte_equivalent` (Sprint 226) and the Sprint 227 comment fixtures (`COMMENT ON COLUMN` single-quote-escape + 0-comment regression) all pass **unmodified** with no source diff to those test bodies. Generated CREATE TABLE SQL with **zero indexes declared from the frontend** is byte-equivalent to the Sprint 227 output.
- **`useDdlPreviewExecution.ts` body unchanged** — `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0. The hook is render-agnostic and accepts the chain closure verbatim. Sprint 214 freeze.
- **`SqlPreviewDialog.tsx` body unchanged** — `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0. Sprint 227 freeze. (Sibling editors keep importing it. `CreateTableDialog.tsx` continues to NOT import it.)
- **Cross-window invariant suite unchanged** — `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
- **`schemaStore` / `connectionStore` body unchanged** — `git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts` = 0.
- **Foreign Keys tab placeholder text retained** — `grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` ≥ 1 hit (FK tab body verbatim).
- **Indexes tab placeholder text removed** — `grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` = 0 hits (placeholder body replaced by the editor; the canonical sprint-tooltip allowlist may keep an entry if `no-stale-sprint-tooltip.test.ts` requires it but the dialog source must NOT contain that string in any rendered branch).
- **Backend `create_index` impl unchanged** — `git diff src-tauri/src/db/postgres/mutations.rs | grep -E "^[+-].*fn create_index"` matches 0 lines (only fixture additions allowed; impl body byte-equivalent).
- **Backend `CreateIndexRequest` model unchanged** — `git diff src-tauri/src/models/schema.rs | grep -E "^[+-].*CreateIndexRequest"` matches 0 lines (struct definition byte-equivalent).
- **`tauri.createIndex` frontend wrapper unchanged** — `git diff --stat src/lib/tauri/ddl.ts` = 0.
- **Atomic policy C** — CREATE TABLE + COMMENT ON live in **one** transaction (Sprint 227 invariant). CREATE INDEX statements are **separate** transactions, executed sequentially **after** the CREATE TABLE returns success. Index failures do **NOT** roll back the CREATE TABLE. Already-applied indexes earlier in the chain stay applied.
- **Preview→commit IPC sequence for 0-index form** is exactly `[tauri.createTable({preview_only:true}), tauri.createTable({preview_only:false})]` — byte-equivalent to Sprint 227 (no `createIndex` calls when no indexes declared).
- **PK auto-emission deduplication** — when an index row's `columns` array exactly matches the declared `primary_key` array (same names, same order), the frontend **skips** the `tauri.createIndex` call for that row (PG already implicitly indexes the PK). The DDL preview pane reflects this skip — the `CREATE INDEX` for that row does NOT appear in the preview SQL. Mismatched orderings or partial overlaps DO emit a `CREATE INDEX` (user explicitly asked for a different shape).
- **Multi-statement preview Safe Mode parity** — every statement in the bundle (CREATE TABLE / COMMENT ON / CREATE INDEX) analyzes as `safe` per `analyzeStatement` (DDL-create + metadata; no DROP / TRUNCATE / DELETE / UPDATE). The canonical Safe Mode warn-cancel message `"Safe Mode (warn): confirmation cancelled — no changes committed"` byte-equivalent surfaces if any statement triggers warn (currently none should).
- **`useQueryHistoryStore` source `"ddl-structure"`** — single history entry per Execute closure success, regardless of how many CREATE INDEX legs ran. Hook records once; the chain is invisible to the history surface.
- **Identifier validation** — backend `validate_identifier` rejects index names with spaces / leading digits / non-alphanumeric chars (lines 22-48 of `mutations.rs`). Frontend mirrors this rule before assembling the chain so the user sees a per-row inline error early. `AppError::Validation` text surfaces verbatim if the frontend pre-check is bypassed.
- **No new `it.skip` / `describe.skip` / `it.todo` / `xit` / `this.skip()` / `it.only`** in any touched test file.
- **No new `eslint-disable*` lines.**
- **No new silent `catch {}` blocks** — the chain's catch must surface the failing index name verbatim in the inline preview error slot or via toast (per `.claude/rules/test-scenarios.md` "에러 처리 / catch 블록" rule).
- **No new `any` in TS, no new `unwrap()` in production Rust paths.**
- **Mongo / non-RDB path untouched** — `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0.
- **Modal-local `useState` only** for the new index drafts — no new Zustand store, no module-load side effects, no broadcast subscribers.

## Acceptance Criteria

- `AC-228-01` **Indexes tab no longer placeholder.** The Indexes tab body becomes interactive. The verbatim string `"Available in Sprint 228"` is removed from `src/components/schema/CreateTableDialog.tsx` (and from any extracted Indexes-tab component). `getByRole("tab", { name: "Indexes" })` activates a panel containing the editor. **Testable:** vitest case asserts `queryByText("Available in Sprint 228")` is null inside the Indexes tab panel + `queryAllByRole("textbox")` length ≥ 1 (index-name input present); `grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` = 0 hits.

- `AC-228-02` **Add / remove index rows.** The Indexes tab renders a `+ Index` button that appends an empty `IndexDraft` row to the list, and each row renders a `−` button that removes it. The first/last row's `−` button is disabled when only zero or one row remains (zero-row state is allowed — unlike Columns tab, indexes are optional). aria-labels: `"Add index"` (button), `"Remove index"` (per row), `"Index name"` (input), `"Index columns"` (group), `"Index type"` (select), `"Index unique"` (checkbox). **Testable:** vitest cases — clicking `+ Index` increases row count by 1; clicking `−` decreases by 1; starting with 0 rows is the default empty state; at the 0-row state no `−` button is rendered.

- `AC-228-03` **Per-row inputs: index name + columns multi-select + type dropdown + unique checkbox.** Each index row renders (a) an `<input>` for the index name (aria-label `"Index name"`), (b) a multi-select for the columns drawn live from the **declared column rows on the Columns tab** (DataGrip pattern: a list of checkboxes, one per declared column with a non-empty trimmed name), (c) a `<Select>` dropdown for the index type with exactly four options `btree | hash | gin | gist` (aria-label `"Index type"`), default `btree`, (d) a `<input type="checkbox">` for unique (aria-label `"Index unique"`), default false. Renaming a column on the Columns tab live-updates the index column checkbox label (Sprint 226 PK-style live derivation). **Testable:** vitest — type a column name on Columns tab, switch to Indexes tab, the column appears as a selectable checkbox in the columns multi-select; rename the column on Columns tab, the checkbox label updates; `getByRole("combobox", { name: "Index type" })` (or equivalent for the chosen `Select` primitive) lists exactly four options.

- `AC-228-04` **Inline DDL Preview shows multi-statement bundle.** With ≥ 1 declared index row that has a non-empty name + ≥ 1 selected column + valid type, clicking `Show DDL` fires exactly one `tauri.createTable({preview_only:true})` call (which returns `CREATE TABLE …;` + optional `COMMENT ON COLUMN ×N`) followed by exactly one `tauri.createIndex({preview_only:true})` call **per declared index** (which each return one `CREATE INDEX …` statement). The frontend joins these with `;\n` between statements (no leading whitespace on each line; trailing `;` after each except possibly the last — Generator's call to keep parity with Sprint 227's emission style) and renders the joined SQL inside the inline preview pane. Editing any field (table name / column rows / schema picker / index rows) invalidates the cached preview as in Sprint 227. **Testable:** vitest — declare 1 index, click Show DDL, assert IPC call sequence is `[tauri.createTable({preview_only:true}), tauri.createIndex({preview_only:true})]` with the `tauri.createIndex` payload carrying the row's index_name + columns + index_type + is_unique; the rendered preview text contains both `CREATE TABLE` and `CREATE INDEX` substrings; editing the index name invalidates and the next Show DDL re-fetches.

- `AC-228-05` **Chained Execute sequence — happy path.** On Execute with ≥ 1 declared index, the IPC sequence is exactly `[tauri.createTable({preview_only:true}), tauri.createIndex({preview_only:true}) × M, tauri.createTable({preview_only:false}), tauri.createIndex({preview_only:false}) × M]` where M is the count of declared indexes minus the count of indexes that match the PK (per AC-228-08). Each `tauri.createIndex({preview_only:false})` call awaits the previous one (sequential, not parallel). On success of all calls, `onRefresh()` runs once + `onClose()` runs once + `useQueryHistoryStore.addHistoryEntry` records exactly one entry with `source: "ddl-structure"` (regardless of M). **Testable:** vitest — declare 2 distinct (non-PK) indexes, Execute, assert IPC sequence with `vi.fn()` mock; assert `onRefresh` called exactly once; assert one history entry; assert no parallelism (each `createIndex` mock called only after the previous resolved — verified via `mockImplementation` order tracking).

- `AC-228-06` **Index failure handling — table stays applied.** When the chain's first `tauri.createIndex({preview_only:false})` rejects (mocked PG error), (a) the CREATE TABLE call is **NOT** retried or rolled back from the frontend (atomic policy C), (b) any subsequent index calls in the chain are **aborted**, (c) the modal stays open, (d) a clear error surfaces in the inline preview pane error slot **and/or** as a toast naming the failing index — verbatim text shape: `Index "<index_name>" failed: <PG error verbatim>` (or equivalent — the index name MUST appear in the user-facing surface). The `useQueryHistoryStore` entry MAY record the partial success as `status: "error"` — Generator's call; either is acceptable as long as the user is informed which index failed. **Testable:** vitest — declare 2 indexes, mock `tauri.createIndex` to reject on the **first** call, Execute, assert the error surface contains the failing index name; assert the second `tauri.createIndex({preview_only:false})` is **not** called; assert the modal stays open (no `onClose` call).

- `AC-228-07` **Index failure handling — earlier indexes stay applied.** When the chain's **second** `tauri.createIndex({preview_only:false})` rejects after the first succeeded, the first index's success is **NOT** rolled back from the frontend (no DROP INDEX call). The user-facing error names the failing index. The CREATE TABLE remains applied. **Testable:** vitest — declare 3 indexes, mock the 2nd `tauri.createIndex({preview_only:false})` to reject, Execute, assert the 1st `tauri.createIndex` was called and resolved + the 3rd was NOT called + no `tauri.dropIndex` call was made + the error surface contains the 2nd index's name.

- `AC-228-08` **PK auto-emission deduplication.** When the user declares a primary key on the Keys tab AND an Indexes-tab row whose `columns` array (in the same order) exactly matches the PK column array, the frontend (a) does NOT include a `CREATE INDEX` for that row in either the preview pane or the executed chain, (b) the row remains visible on the Indexes tab (the user sees their declaration but a small inline note explains why it's skipped: `"Skipped — primary key is already indexed"` or equivalent verbatim text). Mismatched ordering, partial overlap, or different unique flag still emits the `CREATE INDEX` statement. **Testable:** vitest — declare PK on column `id` on Keys tab + Indexes-tab row with `columns: ["id"]`, assert preview SQL does NOT contain `CREATE INDEX` for that row; assert `tauri.createIndex` is NOT called for that row on Execute; declare a second Indexes-tab row with `columns: ["id", "email"]` and assert it IS emitted (partial overlap).

- `AC-228-09` **Sprint 226 + Sprint 227 byte-equivalent regression preserved.** With **zero** indexes declared from the frontend, the IPC sequence is exactly `[tauri.createTable({preview_only:true}), tauri.createTable({preview_only:false})]` — byte-equivalent to Sprint 227. `cargo test create_table_preview_three_column_composite_pk_byte_equivalent` exit 0 with no source diff. The Sprint 227 hot-fix combobox tests (filter / Enter commit / free-text fallback) pass unchanged. **Testable:** `cargo test --manifest-path src-tauri/Cargo.toml create_table` all green; `git diff src-tauri/src/db/postgres/mutations.rs | grep -E "^[+-].*composite_pk_byte_equivalent"` outputs 0 lines; vitest assertion of 0-index IPC sequence holds.

- `AC-228-10` **No new shadcn primitives — Select / Checkbox / Input only.** The Indexes-tab editor reuses (a) the existing `<Select>` primitive (`@components/ui/select`) for the index type dropdown, (b) raw `<input type="checkbox">` for both the unique flag and the columns multi-select group (matches the Sprint 227 Keys-tab pattern at lines 502-538 of `CreateTableDialog.tsx`), (c) raw `<input>` for the index name. No new files under `src/components/ui/`. **Testable:** `git diff --stat src/components/ui/` = 0; the Indexes-tab JSX imports only existing `@components/ui/*` modules already imported by Sprint 227 `CreateTableDialog.tsx`.

- `AC-228-11` **Test coverage targets.** Vitest coverage on the modified `CreateTableDialog.tsx` ≥ 70% line. ≥ 8 new vitest cases under the Sprint 228 describe block covering AC-228-01..AC-228-09. ≥ 1 vitest case asserts the canonical Safe Mode warn-cancel message verbatim survives the multi-statement bundle (per Sprint 227 invariant carry-over). Rust unit test count for `create_index` stays ≥ 8 (current baseline, no regression).

## Design Bar / Quality Bar

- **Pattern source** — Sprint 227 `CreateTableDialog.tsx` is the structural template. The Indexes-tab editor follows the same shape as the Keys-tab body (`CreateTableDialog.tsx:498-540`) for the columns multi-select (live-derived from valid column names + `<input type="checkbox">` per column).
- **Columns multi-select choice = multi-`<input type="checkbox">` group, NOT a chip-tag list.** Justification: (a) DataGrip's reference modal uses a checkbox column-list for index column membership, (b) the existing Keys-tab PK selector already uses this pattern (`CreateTableDialog.tsx:511-538`), (c) a chip-tag would require a new shadcn primitive (Out of Scope), (d) the canonical column count per table is small (≤ 20 typical) so a checkbox list is ergonomic without the chip add/remove dance. Generator MUST follow this choice.
- **Index type dropdown = `<Select>` with four hard-coded options** (`btree | hash | gin | gist`). Backend's `create_index` validator accepts `brin` too, but the UI does not surface it (DataGrip parity). The four strings are inlined in the modal — no need for a separate `lib/sql/postgresIndexTypes.ts` constant module unless a second consumer surfaces (anticipatory abstraction risk).
- **Chained Execute closure** — runs **inside** the `prepareCommit` factory passed to `useDdlPreviewExecution.loadPreview`. The hook's `attemptExecute` calls the closure; the closure calls `await tauri.createTable({preview_only:false})` then iterates `for (const idx of declaredIndexes) { await tauri.createIndex({preview_only:false, …}); }`. On any iteration's rejection, the closure re-throws so the hook's catch surfaces `previewError` per Sprint 214 contract — **plus** the modal owns its own try/catch around the chain to capture which index failed (the hook only sees a single `Error`; the modal augments the message with the failing index's name before re-throwing, OR sets a modal-local `chainError` state).
- **Failure-handling UX choice** — surface the failing index name in the **inline preview pane error slot** (canonical per Sprint 227 — same slot that surfaces Safe Mode messages and validation errors). A toast is OPTIONAL; if Generator chooses to add one, reuse the existing toast surface from `connectionStore.ts` / wherever `ColumnsEditor` already toasts on commit-success — do NOT add a new toast primitive. Inline-pane is the canonical surface.
- **No anticipatory abstraction** — keep the index editor inside `src/components/schema/CreateTableDialog.tsx` (or extract to `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` if the file grows above 700 LOC). Do NOT lift to `src/components/structure/` or `src/components/ui/`. Sprint 229's FK editor is a separate consumer; sharing comes after a third consumer surfaces.
- **TDD evidence** — capture `red-state.log` in `docs/sprints/sprint-228/tdd-evidence/red-state.log` per `docs/PLAN.md:182-186` (sprint convention).
- **No `it.skip` / `eslint-disable` / `any` / silent `catch {}`** — see Invariants.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` exit 0 with ≥ 31 cases pass (Sprint 227 baseline = 23 + ≥ 8 new Sprint 228 cases). File count must increase ≥ Sprint 227 baseline if any extracted Indexes tab body has its own test file.
2. `pnpm vitest run` exit 0 — full suite. File count ≥ Sprint 227 baseline (217 files / 2768 tests). Expected new ≈ 217-218 files / 2776+ tests.
3. `pnpm tsc --noEmit` exit 0.
4. `pnpm lint` exit 0.
5. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` exit 0.
7. `cargo test --manifest-path src-tauri/Cargo.toml create_table` exit 0 with no source diff to existing fixtures (Sprint 226 + 227 fixtures intact).
8. `cargo test --manifest-path src-tauri/Cargo.toml create_index` exit 0 with ≥ 8 fixtures pass (current baseline: btree single-col unique, hash non-unique single-col, btree multi-col, all-types-acceptance for btree/hash/gist/gin/brin, invalid-type-fails, empty-columns-fails, invalid-name-fails, no-connection-non-preview-fails). Generator MAY add ≤ 2 new byte-string fixtures for `gin` / `gist` if missing strict byte equality coverage today; existing fixtures stay green unchanged.
9. `git diff --stat src/components/structure/useDdlPreviewExecution.ts` outputs 0 changed lines (Sprint 214 freeze).
10. `git diff --stat src/components/structure/SqlPreviewDialog.tsx` outputs 0 changed lines (Sprint 227 freeze).
11. `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` outputs 0 changed lines (cross-window invariant).
12. `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` outputs 0 changed lines (Sprint 224 baseline).
13. `git diff --stat src/lib/tauri/ddl.ts` outputs 0 changed lines (`tauri.createIndex` wrapper unchanged).
14. `git diff --stat src/components/ui/` outputs 0 changed lines (no new shadcn primitive).
15. `grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` = 0 hits (placeholder removed).
16. `grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` ≥ 1 hit (FK placeholder kept).
17. `grep -nE 'CREATE INDEX' src-tauri/src/db/postgres/mutations.rs` ≥ 4 hits (existing impl + ≥ 3 fixture byte-strings — current count from Sprint 227 baseline).
18. `grep -n 'createIndex\|create_index' src-tauri/src/lib.rs` ≥ 1 hit (Tauri command registration intact at line 152).
19. `grep -n 'createIndex' src/components/schema/CreateTableDialog.tsx` ≥ 1 hit (modal calls `tauri.createIndex` from chain closure).
20. `grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` matches 0 (Sprint 227 invariant: modal-on-modal removed).
21. `grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo|this\.skip\(\)' src/components/schema/CreateTableDialog.test.tsx` matches 0.
22. `git diff src/ src-tauri/ | grep "^+.*eslint-disable"` matches 0.
23. `git diff src/ | grep -E "^\+.*\bany\b"` matches 0 (no new `any` types).
24. `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0 (Mongo path untouched).
25. Vitest case asserts the **0-index IPC sequence** is byte-equivalent to Sprint 227: `[tauri.createTable({preview_only:true}), tauri.createTable({preview_only:false})]` — no `tauri.createIndex` calls when no indexes declared.
26. Vitest case asserts the **1-index happy-path IPC sequence** is `[tauri.createTable({preview_only:true}), tauri.createIndex({preview_only:true}), tauri.createTable({preview_only:false}), tauri.createIndex({preview_only:false})]` — sequential.
27. Vitest case asserts **index-failure-after-table** chain abort: 2 indexes declared, 1st `createIndex({preview_only:false})` rejects → 2nd is NOT called → modal stays open → error surface contains failing index name → CREATE TABLE NOT rolled back from frontend.
28. Vitest case asserts **PK dedup**: PK on `id` + Indexes row `columns:["id"]` → no `tauri.createIndex` call for that row + preview SQL does not contain `CREATE INDEX` for that row.
29. Vitest case asserts the **multi-column index** payload: row with `columns:["a","b"]` btree → `tauri.createIndex` called with `columns:["a","b"]` and `index_type:"btree"`.
30. Vitest case asserts the **unique flag** forwards: row with unique=true → `tauri.createIndex` called with `is_unique:true`.
31. Vitest case asserts each of the **four index types** (`btree | hash | gin | gist`) renders as a selectable option in the type dropdown.
32. Vitest case asserts the **canonical Safe Mode warn-cancel message** verbatim (`"Safe Mode (warn): confirmation cancelled — no changes committed"`) survives the multi-statement bundle (Sprint 227 invariant carry-over).
33. Manual UI smoke (OPTIONAL — `pnpm tauri dev` → CREATE TABLE with 1 unique btree index + 1 gin index → both indexes visible in `pgAdmin` / `psql \di`). Document in `docs/sprints/sprint-228/findings.md` if performed; capture log in handoff. e2e is dead; this is a manual gate only.

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 (file → purpose → LOC delta).
  - check 1-32 실행 결과 (exit code + 핵심 출력). Check 33 optional + log.
  - AC-228-01..AC-228-11 별 concrete evidence (test file path + case name + assertion line; IPC mock-call sequence trace from `vi.fn().mock.calls`).
  - Decision: columns multi-select implementation = multi-checkbox group (not chip) — confirmed.
  - Decision: failure-handling UX surface = inline preview pane (toast OPTIONAL) — Generator must record which surface was actually used + verbatim error-message format string.
  - Decision: Indexes-tab body extracted vs inlined — justify in handoff (file LOC delta is the threshold gate at 700 LOC).
  - Confirmation of Sprint 226 + 227 fixture preservation: `cargo test create_table` PASS + `git diff src-tauri/src/db/postgres/mutations.rs | grep -E "composite_pk_byte_equivalent|comment.*byte_equivalent"` outputs 0 lines.
  - Confirmation that `useDdlPreviewExecution` / `SqlPreviewDialog` / `tauri.createIndex` / `CreateIndexRequest` are reused without diff (`git diff --stat` for each).
  - Mongo-path-untouched proof (check 24).
  - TDD red-state evidence (`red-state.log` or red-state commit message in `docs/sprints/sprint-228/tdd-evidence/`).
  - Manual UI smoke note if performed (`pnpm tauri dev` flow → `psql \di` capture).
- Evaluator must cite:
  - 각 AC-228-01..AC-228-11 별 pass/fail 근거 with concrete evidence (test file:line, IPC mock-call sequence, grep output).
  - missing 또는 weak evidence findings as `P1` / `P2`.
  - regression freeze verification — Sprint 226 + 227 fixtures pass with no source diff; 0-index IPC sequence byte-equivalent.
  - cross-window invariant verification (no diff).
  - sibling DDL surface freeze verification (`SqlPreviewDialog` / `useDdlPreviewExecution` / `connectionStore` / `schemaStore` / `tauri.createIndex` / `CreateIndexRequest` zero diff).
  - PK-dedup invariant verification (AC-228-08 evidence).
  - Failure-handling UX evidence (AC-228-06, AC-228-07 — failing index name surfaces verbatim).

## Test Requirements

### Unit Tests (필수)

- **AC-228-01 (Indexes tab no longer placeholder)**: 1 vitest case asserts placeholder text gone + ≥ 1 input present.
- **AC-228-02 (Add / remove rows)**: 2 vitest cases — `+ Index` adds row, `−` removes row, 0-row state default.
- **AC-228-03 (Per-row inputs + live column derivation)**: 2 vitest cases — type dropdown 4 options; column name rename on Columns tab updates Indexes-tab checkbox label.
- **AC-228-04 (Multi-statement preview)**: 1 vitest case — Show DDL with 1 index → `tauri.createTable({preview_only:true})` + `tauri.createIndex({preview_only:true})` called; preview text contains both `CREATE TABLE` and `CREATE INDEX`.
- **AC-228-05 (Chained Execute happy path)**: 1 vitest case — 2 distinct (non-PK) indexes, Execute, assert sequential IPC sequence + 1 history entry + `onRefresh` + `onClose`.
- **AC-228-06 (Index failure — table stays)**: 1 vitest case — 2 indexes, 1st `createIndex({preview_only:false})` rejects, assert 2nd NOT called + modal stays open + error surface contains failing index name.
- **AC-228-07 (Index failure — earlier indexes stay applied)**: 1 vitest case — 3 indexes, 2nd rejects, assert 1st was called + 3rd NOT called + no `dropIndex` call + error surface contains 2nd's name.
- **AC-228-08 (PK dedup)**: 2 vitest cases — exact PK match → no `createIndex`; partial overlap → still emitted.
- **AC-228-09 (0-index byte-equivalent regression)**: 1 vitest case — IPC sequence byte-equivalent to Sprint 227 when no indexes declared.
- **AC-228-10 (No new shadcn primitives)**: covered by check 14.
- **AC-228-11 (Coverage)**: covered by checks 1-2.

Total minimum new vitest cases: **≥ 8** under the Sprint 228 describe block. Sprint 226 + 227 carry-over cases pass unchanged.

### Coverage Target

- 수정 `src/components/schema/CreateTableDialog.tsx`: 라인 ≥ 70%.
- 신규 (if extracted) `src/components/schema/CreateTableDialog/IndexesTabBody.tsx`: 라인 ≥ 70%.
- 수정 `src-tauri/src/db/postgres/mutations.rs::create_index` 함수: 브랜치 ≥ 70% (already met from Sprint 227 baseline; no new branch — impl unchanged).
- CI baseline: 라인 40% / 함수 40% / 브랜치 35%.

### Scenario Tests (필수)

- [x] **Happy path** — preview→commit with 2 declared indexes → multi-statement preview → CREATE TABLE + 2× CREATE INDEX → success → `refreshSchema` + 1 history entry + modal close.
- [x] **Empty / 누락 입력** — 0 declared indexes is the canonical empty state (IPC sequence byte-equivalent to Sprint 227); declaring an index row with empty `name` or `columns` is a validation error surfaced inline before preview fetch (preview button disabled OR error in inline pane); whitespace-only index name rejected by frontend pre-check + backend `validate_identifier`.
- [x] **에러 복구** — index-failure-mid-chain: 1st succeeds + 2nd rejects → 1st stays applied (no `dropIndex` rollback) + 2nd's failure surfaces verbatim with index name + modal stays open + form editable; CREATE TABLE failure (table already exists) → no `createIndex` calls fired + PG error in preview pane (Sprint 226+227 carry-over).
- [x] **경계 조건 / 동시성** — 2 declared indexes execute **sequentially** (not parallel) — 2nd `createIndex` only called after 1st resolves; user clicks Execute twice rapidly while chain is mid-flight — second click is ignored (button disabled while `previewLoading` true, per Sprint 227 invariant); large index column list (10 columns selected on a single index) emits a `CREATE INDEX` with all 10 columns in declared order.
- [x] **상태 전이** — 0-index → declare 1 index → preview-stale → Show DDL refetches with chained call → Execute → success → modal closes (form reset on close per Sprint 226 behaviour); declare 1 index → switch to Indexes tab → switch back to Columns → state preserved (Sprint 227 carry-over).
- [x] **에지 케이스** — PK dedup (AC-228-08); invalid index name (`"bad name!"`) surfaces validation error before chain start; 0-column index (user added row but checked nothing) → preview button or Execute disabled until ≥ 1 column selected; index name collision (two rows with same name) → frontend warns inline before chain start (DataGrip behaviour); MongoDB connection (RDB-only path) — modal entry-point already disabled per Sprint 226 (no Mongo regression).
- [x] **기존 기능 회귀 없음** — Sprint 226 `composite_pk_byte_equivalent` Rust fixture passes unchanged; Sprint 227 comment-fixture suite passes unchanged; Sprint 227 vitest cases pass with at most mechanical query selector changes (none expected — Sprint 227 already used tab-aware queries); `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` / `SqlPreviewDialog` / `useDdlPreviewExecution` test suites pass with zero text-string diff; cross-window suite untouched.

## Test Script / Repro Script

1. baseline (before any change):
   ```sh
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx src/components/schema/CreateTableTypeCombobox.test.tsx src/lib/sql/postgresTypes.test.ts
   pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml create_table create_index --no-run
   ```
2. Generator 작업 후 — primary command profile:
   ```sh
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
   pnpm vitest run src/components/schema/CreateTableDialog/IndexesTabBody.test.tsx   # only if extracted
   cargo test --manifest-path src-tauri/Cargo.toml create_table
   cargo test --manifest-path src-tauri/Cargo.toml create_index
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx
   pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx
   ```
3. Verification 4-set + clippy (per `docs/PLAN.md:186`):
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
   git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx
   grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx
   grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx
   grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx
   grep -n 'createIndex' src/components/schema/CreateTableDialog.tsx
   grep -nE 'CREATE INDEX' src-tauri/src/db/postgres/mutations.rs
   grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/
   git diff src/ src-tauri/ | grep "^+.*eslint-disable"
   git diff src/ | grep -E "^\+.*\bany\b"
   grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo' src/components/schema/CreateTableDialog.test.tsx
   ```
5. Optional manual UI smoke (record in `docs/sprints/sprint-228/findings.md` if performed):
   ```sh
   pnpm tauri dev
   # → connect to PG → expand schema → right-click → Create Table…
   # → fill 2 columns (id integer NOT NULL, email text)
   # → switch to Indexes tab → + Index → name "idx_users_email" / columns [email] / type btree / unique=true
   # → + Index → name "idx_users_email_lower" / columns [email] / type gin / unique=false  (uses gin for demo only)
   # → click Show DDL → confirm preview shows CREATE TABLE + 2× CREATE INDEX joined by ;\n
   # → click Execute → confirm table appears in tree
   # → in psql `\di public.idx_users_*` shows both indexes
   ```

## Ownership

- Generator: general-purpose agent (Phase 3, harness skill).
- Write scope: frontend modal (`src/components/schema/CreateTableDialog.tsx` + `.test.tsx`) + optional `IndexesTabBody.{tsx,test.tsx}` extraction + sprint docs (`handoff.md`, `findings.md`, `tdd-evidence/red-state.log`) + `docs/PLAN.md` row 3. **Optional** ≤ 2 new Rust unit fixtures for `gin` / `gist` byte-strings if Generator wants tightening.
- 변경 금지: `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` / `useSafeModeGate*` / `analyzeStatement*` / `ColumnsEditor*` / `IndexesEditor*` / `ConstraintsEditor*` / `schemaStore*` / `connectionStore*` / `src/lib/tauri/ddl.ts` / `src/lib/zustand-ipc-bridge.ts` / `src/lib/window-label.ts` / Mongo paths (`src/components/schema/DocumentDatabaseTree*` / `src-tauri/src/commands/document/`) / sibling `SchemaTree.*` test files / cross-window regression test (`src/__tests__/cross-window-*.test.tsx`) / `src/__tests__/window-lifecycle.ac141.test.tsx` / `main.tsx` / Sprint 226 + 227 backend fixtures / `src-tauri/src/models/schema.rs` `CreateIndexRequest` struct / `src-tauri/src/commands/rdb/ddl.rs` `create_index` command / `src-tauri/src/db/postgres/mutations.rs::create_index` impl body (only `#[cfg(test)] mod tests` may grow).

## Exit Criteria

- Open `P1` / `P2` findings: `0`.
- Required checks passing: `yes` (1-32 모두; 33 optional).
- Acceptance criteria evidence linked in `handoff.md` — AC-228-01..AC-228-11 each cited with concrete test/grep evidence.
- **본 sprint 후 Phase 27 sprint 3 종료** — Indexes tab functional lands; Sprint 229 (Foreign Keys + Constraints) plugs into the same `CreateTableDialog` shell without further structural change; Sprint 230 (reorder + table comment polish) unblocked.
- TDD evidence (`red-state.log` 또는 red-state commit) recorded in `docs/sprints/sprint-228/tdd-evidence/`.
- e2e closure dependency: **none**. `lefthook.yml:5_e2e` stays disabled per ADR 0019. Phase 27 e2e smoke deferred under `[DEFERRED-PHASE-27-E2E]` marker.
