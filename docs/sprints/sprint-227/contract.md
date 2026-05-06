# Sprint Contract: sprint-227

## Summary

- Goal: Phase 27 sprint 2 — DataGrip-parity foundation for the CREATE TABLE GUI. Restructure `CreateTableDialog` into a tabbed surface (Columns / Keys / Indexes / Foreign Keys) with a Target schema dropdown header, autocomplete type combobox over the canonical PG type list (≥ 25 entries with free-text fallback), per-column comment input emitted as `COMMENT ON COLUMN` statements alongside `CREATE TABLE` in **one transaction** (atomic policy = C, partial-atomic), and an inline collapsible DDL Preview pane that replaces the modal-on-modal `SqlPreviewDialog`. Indexes / Foreign Keys tabs are present-but-disabled placeholders (`"Available in Sprint 228"` / `"Available in Sprint 229"`) — Sprint 228 / 229 plug into this shell. Single sprint covers AC-227-01..AC-227-08; verification profile is `command` (vitest + tsc + lint + cargo test + cargo clippy); e2e is dead per `lefthook.yml:61-86` and is **not** a closure dependency.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle, Phase 27 sprint 2 — DataGrip-parity foundation).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

Backend (Rust):
- `src-tauri/src/models/schema.rs`: extend `ColumnDefinition` with `comment: Option<String>` (`#[serde(default)]` for backward compatibility with Sprint 226 callers). +~5 LOC.
- `src-tauri/src/db/postgres/mutations.rs`: extend `create_table` to emit `COMMENT ON COLUMN "<schema>"."<table>"."<col>" IS '<escaped>';` per commented column inside the same transaction. PG-specific multi-statement DDL emission with single-quote escaping (`O'Brien` → `'O''Brien'`). Add ≥ 2 new Rust unit fixtures (single-quote escape; 0-comment byte-equivalent regression). +~50 LOC.
- (No new Tauri command; reuse `create_table` from Sprint 226 with additive payload.)

Frontend (TS/TSX):
- `src/types/schema.ts`: extend `ColumnDefinition` with optional `comment?: string`. +~3 LOC.
- `src/components/schema/CreateTableDialog.tsx`: redesign — Target schema dropdown header + Tabs wrapper (`Columns` / `Keys` / `Indexes` / `Foreign Keys`) + Type combobox per column row + Comment input per column + inline collapsible DDL Preview pane between body and footer. **Drop `SqlPreviewDialog` import** (modal-on-modal removed from this surface). Reuse `useDdlPreviewExecution` (Sprint 214) verbatim — hook owns preview state slots, modal owns inline preview JSX. Footer: `Cancel` + `Execute` (no separate "Preview SQL" button). ~+250 / ~-120 LOC net.
- `src/components/schema/CreateTableDialog.test.tsx`: extend with AC-227-01..08 cases. Sprint 226 cases mechanically migrated to tab-aware queries (e.g. `getByLabelText("Column name")` scoped to Columns tab panel). ≥ 15 cases total. ~+200 LOC.
- `src/components/schema/CreateTableTypeCombobox.tsx` (new, optional — Generator's call to extract or inline): the filterable type combobox. Reuses `Popover` + `Command` shadcn primitives. ~80-150 LOC if extracted.
- `src/components/schema/CreateTableTypeCombobox.test.tsx` (new, only if extracted): vitest cases for filter / Enter commit / free-text fallback / ↑↓ navigation. ~80-120 LOC.
- `src/lib/sql/postgresTypes.ts` (new, optional): canonical PG type list (≥ 25 entries). ~30 LOC if extracted.
- `src/components/schema/SchemaTree/dialogs.tsx`: pass `availableSchemas` prop to `CreateTableDialog` (from `useSchemaStore.schemas[connectionId]`). +~5 LOC.

Docs:
- `docs/PLAN.md`: add row 2 to post-225 feature cycle table for sprint-227. +~3 LOC.
- `docs/sprints/sprint-227/tdd-evidence/red-state.log` (new): TDD red-state captured before green commits. (per `docs/PLAN.md:182-186`)

## Out of Scope

The following are explicitly frozen for sprint-227. Cite the spec's "Future sprints" + Global AC.

- **Indexes editor functional rows** — Sprint 228; sprint-227 only renders the placeholder `"Available in Sprint 228"` body. No `+`/`-` row inputs, no index-name field, no unique toggle.
- **Foreign Keys editor functional rows** — Sprint 229; sprint-227 only renders the placeholder `"Available in Sprint 229"` body. No reference-table picker, no `ON DELETE` / `ON UPDATE` selectors.
- **↑/↓ row reorder buttons** — Sprint 230 polish.
- **Table-level `COMMENT ON TABLE`** — Sprint 230 polish; sprint-227 emits column-level comments only.
- **Type coloring on combobox display** — Sprint 230 polish; sprint-227 combobox renders plain text for suggestions.
- **MongoDB / DocumentAdapter `createCollection`** — Phase 27 = PG-first. No `createCollection` IPC, no menu item on Mongo schema rows.
- **`SYNCED_KEYS` extension** of any store — schema cache stays window-local; no cross-window broadcast.
- **`attachZustandIpcBridge` modification** — no new IPC channel, no bridge wiring change.
- **Cross-window invariant suite** — `git diff --stat src/__tests__/cross-window-*.test.tsx` must be 0.
- **`SqlPreviewDialog` body changes** — sibling editors (`ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor`) keep using it; `git diff --stat src/components/structure/SqlPreviewDialog.tsx` must be 0. Only the *import path* in `CreateTableDialog.tsx` is removed.
- **`useDdlPreviewExecution` hook signature / body changes** — Sprint 214 reuse only; `git diff --stat src/components/structure/useDdlPreviewExecution.ts` must be 0. The hook is render-agnostic; modal owns inline preview JSX, hook owns state slots.
- **`useSafeModeGate` body / `analyzeStatement` body changes** — reuse only.
- **`schemaStore` / `connectionStore` body changes** — no store mutation; `git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts` must be 0.
- **Existing DDL surface text-string changes** — `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` rendered strings, button labels, aria-labels frozen.
- **Sibling `SchemaTree.*` test files** beyond `SchemaTree.actions.test.tsx` — no diff to lifecycle / expand / refresh / search / highlight / preview / virtualization / rowcount / dbms-shape.
- **Shared "DDL modal" base extraction** — Sprint 226 deferred this until 3+ Create-* modals exist; same constraint here.
- **Generalised "DDL combobox" abstraction** — combobox stays in `src/components/schema/`; do NOT lift to `src/components/ui/` or `src/components/structure/` until a second consumer surfaces.
- **e2e restoration / Playwright spec authoring** — `lefthook.yml:5_e2e` stays disabled; sprint-227 captured as `[DEFERRED-PHASE-27-E2E]` per lesson `e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant`.

## Invariants

- **Sprint 226 byte-equivalence (regression proof)** — Rust fixture `create_table_preview_three_column_composite_pk_byte_equivalent` (Sprint 226's composite-PK case) passes **unmodified** — generated SQL is byte-equivalent to the Sprint 226 fixture string when no comment is set on any column. A new fixture proves 0-comment SQL byte-equivalent to Sprint 226 (additive proof).
- **`useDdlPreviewExecution` (Sprint 214) hook body unchanged** — `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0. Hook is render-agnostic; the modal owns the inline preview JSX while the hook still owns preview SQL / loading / error / pendingConfirm state slots.
- **`SqlPreviewDialog` component body unchanged** — `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0. Sibling editors (`ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor`) keep importing it; only `CreateTableDialog.tsx` drops the import.
- **Cross-window suite frozen** — `git diff --stat src/__tests__/cross-window-*.test.tsx` = 0 (verify via `git diff --stat src/__tests__/` and confirm no `cross-window-*` paths appear).
- **Existing DDL surface test suites pass without text-string changes** — `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` / `useDdlPreviewExecution` / `SqlPreviewDialog` / `useSafeModeGate` / `SchemaTree` rename/drop suites all exit 0 with zero text-string diff.
- **Schema cache stays window-local** — no `SYNCED_KEYS` extension, no `attachZustandIpcBridge` modification, no new IPC channel.
- **Safe Mode warn-cancel canonical message** — `"Safe Mode (warn): confirmation cancelled — no changes committed"` byte-equivalent surfaces in the inline DDL Preview pane error slot (matches sibling `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` paths).
- **`useQueryHistoryStore.addHistoryEntry` source = `"ddl-structure"`** on commit-success — matches the existing DDL surface convention (Sprint 226 carry-over).
- **Identifier validation rule** mirrors `rename_table` / Sprint 226 byte-for-byte. `AppError::Validation` text surfaces verbatim in the inline preview error slot.
- **Preview→commit IPC sequence** is exactly `[tauri.createTable({preview_only: true}), tauri.createTable({preview_only: false})]` — no third call, no skipped preview, no double-commit. Holds for both 0-comment and comment-bearing forms.
- **Backend additive payload** — `ColumnDefinition.comment: Option<String>` carries `#[serde(default)]`; Sprint 226 callers omitting `comment` deserialize to `None` without error.
- **Atomic policy = C (partial-atomic)** — `create_table` emits `CREATE TABLE … ; COMMENT ON COLUMN …;` as one transactional batch. Indexes / FKs are *separate* Tauri commands chained sequentially in Sprint 228 / 229 (NOT in this sprint).
- **No new `useEffect` / `setInterval` / `setTimeout` / `addEventListener` / `subscribe`** in `CreateTableDialog` beyond what the modal redesign genuinely needs (preview cache invalidation effect on form-edit is OK; broadcast subscribers / cross-window listeners are NOT).
- **Zero new `it.skip` / `describe.skip` / `it.todo` / `xit` / `this.skip()` / `it.only`** in any touched test file.
- **Zero new `eslint-disable*`** lines.
- **Zero new silent `catch {}`** blocks (rejection paths must surface error in the inline preview pane error slot or modal-close path).
- **Zero new `any` in TS, zero new `unwrap()` in production Rust paths** (test fixtures may use `unwrap` per existing convention).
- **No store mutation** — `git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts` = 0.
- **Modal-local `useState` only** for form state (table name, column drafts incl. `comment`, selected schema, active tab, "Show DDL" expanded flag, cached preview SQL, "preview is stale" flag); no new Zustand store.
- **Mongo / non-RDB path untouched** — `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0.

## Acceptance Criteria

Verbatim from `docs/sprints/sprint-227/spec.md` (with testable assertions appended):

- `AC-227-01` **Tabbed modal layout.** `CreateTableDialog` renders four tabs labelled `"Columns"`, `"Keys"`, `"Indexes"`, `"Foreign Keys"`. Columns + Keys tabs are interactive. Indexes + Foreign Keys tabs are clickable but render an empty-state body with verbatim `"Available in Sprint 228"` (Indexes) / `"Available in Sprint 229"` (Foreign Keys) — body is read-only (no inputs). Tab keyboard navigation (←/→) works via the existing `Tabs` primitive (`src/components/ui/tabs.tsx`). **Testable:** vitest cases in `CreateTableDialog.test.tsx` assert each tab's role + label + placeholder content; `getAllByRole("tab")` returns exactly 4; activating Indexes / FK tabs renders the canonical placeholder string with `queryAllByRole("textbox")` length = 0 inside the tab panel.

- `AC-227-02` **Target schema picker.** Modal header surfaces a `Select` dropdown labelled `"Target schema"` populated from `useSchemaStore.schemas[connectionId]`. Default = the schema name passed into the modal (the right-clicked schema from SchemaTree entry-point). User can change the schema; selection drives the `schema` field in the `CreateTableRequest` payload AND the `<schema>` token in generated SQL. Selection change invalidates the cached DDL preview (per AC-227-05). If the connection has only one schema, the dropdown still renders (no auto-collapse). aria-label `"Target schema"`. **Testable:** vitest mocks `availableSchemas = ["public", "analytics"]`, asserts dropdown lists ≥ 2 entries, default selection equals the pre-filled schema, changing selection updates `tauri.createTable` payload's `schema` field on next preview, and invalidates a previously-cached preview.

- `AC-227-03` **Type input becomes an autocomplete combobox.** Per-column data-type input renders as a filterable combobox seeded with the canonical PG common-type list (≥ 25 entries: `serial`, `bigserial`, `smallserial`, `integer`, `bigint`, `smallint`, `varchar`, `varchar(255)`, `text`, `boolean`, `timestamp`, `timestamptz`, `date`, `time`, `numeric`, `numeric(10,2)`, `real`, `double precision`, `uuid`, `jsonb`, `json`, `bytea`, `inet`, `cidr`, `interval`, `char`, `money`, `tsvector`, `xml`). Behavioural: typing filters case-insensitively; ↑/↓ moves selection; Enter commits highlighted suggestion; Esc closes popover; **free-text fallback** — custom strings (`numeric(10,4)`) commit on blur and forward to backend's `data_type.trim()` path. **Testable:** vitest asserts typing `"int"` filters to expected suggestions (`integer`, `bigint`, `smallint`, `interval`); Enter commits the highlighted entry; typing `"numeric(10,4)"` + blur commits the custom string verbatim into the column row's data_type field.

- `AC-227-04` **Column comment input + COMMENT ON SQL emission.** Each column row gains a comment text input (placeholder `"comment (optional)"`, aria-label `"Column comment"`). Backend `ColumnDefinition` accepts optional `comment: Option<String>` (`#[serde(default)]`). When any column has a non-empty (post-trim) comment, generated SQL contains `CREATE TABLE …;` followed by one `COMMENT ON COLUMN "<schema>"."<table>"."<col>" IS '<escaped>';` per commented column, in column-declaration order. Comment SQL-escaping doubles single quotes (`O'Brien` → `'O''Brien'`). Empty / whitespace-only comments emit no `COMMENT ON`. Backend executes the full batch inside one transaction. **Testable:** Rust unit fixtures — (a) 2-col with one comment byte-equivalent; (b) 3-col with `O'Brien`-style single-quote escape byte-equivalent; (c) 0-comment case byte-equivalent to Sprint 226 fixture (additive regression). vitest asserts the comment input renders per row + aria-label match.

- `AC-227-05` **Inline DDL Preview pane.** Modal footer no longer opens `SqlPreviewDialog` as a separate modal. Instead, an inline collapsible region between form body and Cancel/Execute buttons toggles between `"Show DDL"` (collapsed) and `"Hide DDL"` (expanded). When opened with a valid form, fetches preview via `tauri.createTable({ preview_only: true })` and displays. Edits to form (any of: table name, column rows, schema picker) invalidate the cached preview — next "Show DDL" refetches. Multi-statement SQL renders intact (visible newlines or semicolons). Execute button lives in modal footer (not in child preview dialog) and is enabled only when a fetched preview is current and Safe Mode does not strict-block. **Testable:** vitest asserts clicking "Show DDL" calls `tauri.createTable` exactly once with `preview_only: true`; preview text contains `CREATE TABLE` + `COMMENT ON` substrings (when comments present); editing a field invalidates cached preview (re-collapse + next click triggers a 2nd preview call); clicking Execute calls `tauri.createTable` with `preview_only: false`. `grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` matches 0.

- `AC-227-06` **Keys tab houses Primary Key selection.** PK multi-select that lived in the flat Sprint 226 form now renders inside the **Keys** tab. Behavioural: PK options derive live from column-row name list. Switching tabs does not lose form state. The `primary_key` field of the Tauri payload is unchanged. **Testable:** vitest types column name on Columns tab, switches to Keys, asserts checkbox appears with that label; checks it; switches back to Columns and renames the column — Keys tab's checkbox label updates live (Sprint 226 PK behaviour parity); `primary_key` value forwarded in the Tauri payload matches the checked column.

- `AC-227-07` **Footer + Safe Mode parity.** Footer renders `Cancel` + `Execute` (no separate "Preview SQL" button). Execute closure runs through `useDdlPreviewExecution` (Sprint 214) + `useSafeModeGate` (Sprint 189). Multi-statement preview is `;`-split and analyzed per statement (CREATE / COMMENT ON both `safe`). Safe Mode warn-cancel surfaces canonical message `"Safe Mode (warn): confirmation cancelled — no changes committed"` verbatim. `useQueryHistoryStore` records single `source: "ddl-structure"` entry on commit success. **Testable:** vitest asserts IPC sequence `[{preview_only:true},{preview_only:false}]`; one history entry recorded with `source:"ddl-structure"`; canonical warn-cancel message verbatim; only one `Execute` button in footer (`getAllByRole("button", { name: /Execute/ })` length = 1) and no `"Preview SQL"` button (`queryByRole("button", { name: /Preview SQL/ })` is null).

- `AC-227-08` **No regression on Sprint 226 contract.** Backend `create_table` CREATE-TABLE SQL is byte-equivalent to Sprint 226 fixture **when no comment is set**. Sprint 226 `create_table_preview_three_column_composite_pk_byte_equivalent` Rust unit test passes **unmodified**. Sprint 226 vitest cases for "preview→commit IPC sequence" and "history source" continue to pass with at most mechanical adaptation to tab structure (e.g. `getByLabelText("Column name")` scoped to Columns tab panel). **Testable:** `cargo test create_table_preview_three_column_composite_pk_byte_equivalent` exit 0 with no source change to the test; Sprint 226-style vitest cases survive in the migrated test file with assertion text unchanged.

## Design Bar / Quality Bar

- **Narrow extraction** — reuse `useDdlPreviewExecution` (Sprint 214) **without modification**. The hook is render-agnostic; the modal owns inline preview JSX, the hook still owns preview SQL / loading / error / pendingConfirm state slots. Reuse `useSafeModeGate` (Sprint 189) as-is.
- **No anticipatory abstraction** — combobox stays in `src/components/schema/`. Do **not** lift it to `src/components/ui/` or `src/components/structure/` as a generalised "DDL combobox" until a second consumer surface (e.g. ALTER TABLE column-add) demands the same shape.
- **No shared "DDL modal" base extraction** — same Sprint 226 constraint; wait until 3+ Create-* modals exist.
- **Pattern source** — Sprint 213 `ConnectionDialog` modal Tabs pattern (form-state-via-`useState` + tab navigation idiom); Sprint 219 / 223 / 224 hook test mock pattern (`vi.hoisted` + factory mock for `useDdlPreviewExecution`); Sprint 226 modal as the structural starting point (mechanical migration of column-row repeater into Columns tab panel).
- **Visual consistency** — type combobox reuses existing `Popover` + `Command` shadcn primitives (no new shadcn components); Tabs uses existing `src/components/ui/tabs.tsx`; Target schema dropdown uses existing `Select` primitive. Disabled-tab placeholder body: muted-foreground italic style.
- **TDD evidence** — capture `red-state.log` (or red-state commit message) in `docs/sprints/sprint-227/tdd-evidence/red-state.log` per `docs/PLAN.md:182-186`.
- **Identifier validation share** — backend continues to use the Sprint 226 / `rename_table` shared validator. Comment string is *not* an identifier — only single-quote-doubled inside the SQL literal; do not pass it through the identifier validator.
- **SQL emission determinism** — new comment-bearing fixtures must be byte-equivalent to a string literal in the test (RFC-style). No `.contains()` partial matches on the canonical multi-statement fixtures.
- **Modal-local state only** — no Zustand store; no module-load side effects; no broadcast subscribers.
- **Preview cache invalidation effect** — a `useEffect` keyed on form fields that clears the cached preview is acceptable. Broadcast subscribers / cross-window listeners are NOT.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` exit 0 + ≥ 15 cases pass (Sprint 226 carry-over + AC-227-01..08).
2. `pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx` exit 0 (Sprint 226 entry-point regression — no diff expected).
3. `cargo test --manifest-path src-tauri/Cargo.toml create_table` exit 0 + ≥ 13 fixtures pass (Sprint 226's 11 + ≥ 2 new comment fixtures: single-quote escape + 0-comment regression).
4. `pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx` exit 0 (sibling DDL surface freeze).
5. `pnpm vitest run` exit 0 (full suite — Sprint 226's 215 files + 1-2 new ≈ 216-217).
6. `pnpm tsc --noEmit` exit 0.
7. `pnpm lint` exit 0.
8. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
9. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` exit 0.
10. `git diff --stat src/components/structure/useDdlPreviewExecution.ts` outputs zero changed lines (Sprint 214 hook unchanged — reuse only).
11. `git diff --stat src/components/structure/SqlPreviewDialog.tsx` outputs zero changed lines (sibling editors keep using it).
12. `git diff --stat src/__tests__/` shows no `cross-window-*.test.tsx` paths (cross-window invariant suite frozen).
13. `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` outputs zero changed lines (no store mutation).
14. `grep -nE 'SYNCED_KEYS|attachZustandIpcBridge' src/stores/connectionStore.ts | wc -l` unchanged from Sprint 226 baseline.
15. `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0 (Mongo path untouched).
16. `git diff src/ src-tauri/ | grep "^+.*eslint-disable"` matches 0.
17. `git diff src/ | grep -E "^\+.*\bany\b"` matches 0 (no new `any` types).
18. `grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo|this\.skip\(\)' src/components/schema/CreateTableDialog.test.tsx` matches 0.
19. `grep -n '"ddl-structure"' src/components/schema/CreateTableDialog.tsx` ≥ 1 (history source canonical) — alternative: appears in test assertion if dialog forwards via hook callback.
20. `grep -nE 'COMMENT ON COLUMN' src-tauri/src/db/postgres/mutations.rs` ≥ 1 (SQL emission for column comments).
21. `grep -nE '#\[serde\(default\)\]' src-tauri/src/models/schema.rs | head -1` ≥ 1 (`comment` field carries `#[serde(default)]` for back-compat with Sprint 226 callers).
22. Rust fixture `create_table_preview_three_column_composite_pk_byte_equivalent` (Sprint 226 carry-over) passes **unchanged** — `git diff src-tauri/src/db/postgres/mutations.rs | grep -E "^[+-].*composite_pk_byte_equivalent"` outputs 0 lines (no source diff to that test).
23. New Rust fixture exists for byte-equivalent multi-statement SQL with `O'Brien`-style single-quote escape (assert literal SQL string equality).
24. New Rust fixture exists for 0-comment byte-equivalent to Sprint 226 SQL (additive regression proof — same column-set, no comment field, identical byte output).
25. Vitest case asserts type combobox filter behaviour: typing `"int"` → suggestions list contains `integer`, `bigint`, `smallint`, `interval`.
26. Vitest case asserts free-text combobox fallback: typing `"numeric(10,4)"` + blur commits the custom string verbatim into the column's `data_type` field.
27. Vitest case asserts schema dropdown lists ≥ 2 mocked schemas, default selection equals the pre-filled schema, change updates the Tauri payload's `schema` field on next preview.
28. Vitest case asserts Indexes / Foreign Keys tabs render canonical placeholder verbatim (`"Available in Sprint 228"` / `"Available in Sprint 229"`) + tab panel `queryAllByRole("textbox")` length = 0.
29. Vitest case asserts inline preview "Show DDL" → 1× `tauri.createTable({preview_only: true})`; editing a field invalidates the cached preview (next click triggers a 2nd preview call).
30. Vitest case asserts canonical Safe Mode warn-cancel message verbatim: `"Safe Mode (warn): confirmation cancelled — no changes committed"`.
31. Vitest case asserts Sprint 226 IPC sequence `[{preview_only:true},{preview_only:false}]` for a comment-bearing form (regression-locked carry-over).
32. `grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` matches 0 (modal-on-modal removed from `CreateTableDialog` only — sibling editors keep their import).

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 + 각 LOC delta.
  - check 1-32 실행 결과 (exit code + 핵심 출력).
  - AC-227-01..AC-227-08 별 concrete evidence (test file path + case name + assertion line; fixture string verbatim for both new comment fixtures; IPC sequence trace from vitest mock-call args).
  - Both new Rust fixture strings (verbatim) included in the handoff — single-quote escape + 0-comment regression.
  - Confirmation that `useDdlPreviewExecution` / `useSafeModeGate` / `analyzeStatement` / `SqlPreviewDialog` were reused without diff (`git diff --stat` output for each).
  - Confirmation that `ColumnDefinition.comment` carries `#[serde(default)]` (grep output line).
  - Decision note: combobox extracted vs inlined; PG type list extracted vs inlined (justify in handoff).
  - Mongo path untouched proof (check 15).
  - TDD red-state evidence (`red-state.log` or red-state commit message).
  - Manual UI smoke (`pnpm tauri dev` → Create Table → switch schema → fill 2 columns with comments + PK on Keys tab → Show DDL → Execute → confirm comments visible in `\d+ <table>`) optional but recommended; document in `docs/sprints/sprint-227/findings.md` if performed.
- Evaluator must cite:
  - 각 AC-227-01..08 별 pass/fail 근거 with concrete evidence (test file:line, fixture string match, grep output, IPC mock-call sequence).
  - missing 또는 weak evidence findings as `P1` / `P2`.
  - regression freeze verification — Sprint 226 `composite_pk_byte_equivalent` fixture passing with no source diff; Sprint 226 vitest IPC-sequence assertion still passing under tab-aware queries.
  - cross-window invariant verification (no `cross-window-*` diff, no `SYNCED_KEYS` change, no IPC bridge change).
  - sibling DDL surface freeze verification (`SqlPreviewDialog` / `useDdlPreviewExecution` / `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` zero diff).

## Test Requirements

### Unit Tests (필수)

- **AC-227-01 (Tabs layout)**: vitest cases — `getAllByRole("tab")` length = 4; tab labels match exact strings; activating Indexes / FK tabs renders the canonical placeholder string; tab panel `queryAllByRole("textbox")` length = 0 in placeholder bodies. ≥ 3 cases.
- **AC-227-02 (Schema picker)**: vitest cases — dropdown lists ≥ 2 schemas; default = pre-filled; change updates payload `schema` field; change invalidates cached preview; aria-label `"Target schema"` exists; single-schema connection still renders dropdown. ≥ 3 cases.
- **AC-227-03 (Type combobox)**: vitest cases — typing `"int"` filters suggestions; ↑/↓ moves selection; Enter commits highlighted suggestion; Esc closes popover; free-text `"numeric(10,4)"` blur commits verbatim. ≥ 3 cases.
- **AC-227-04 (Column comment input + SQL emission)**: vitest case asserts comment input + aria-label `"Column comment"`; Rust fixtures — 2-col with one comment byte-equivalent + 3-col `O'Brien` escape byte-equivalent + 0-comment regression byte-equivalent to Sprint 226. ≥ 1 vitest case + ≥ 3 Rust fixtures.
- **AC-227-05 (Inline DDL Preview pane)**: vitest cases — "Show DDL" → 1× preview call with `preview_only: true`; preview text contains `CREATE TABLE` + `COMMENT ON` substrings (comment-bearing form); editing a field invalidates cached preview (re-collapse + next click triggers 2nd call); Execute calls `tauri.createTable` with `preview_only: false`; `SqlPreviewDialog` not imported in `CreateTableDialog.tsx`. ≥ 3 cases.
- **AC-227-06 (Keys tab PK)**: vitest cases — typing column name on Columns tab → switching to Keys tab shows checkbox with that label; checking it forwards `primary_key` in payload; renaming column on Columns tab updates label live on Keys tab (Sprint 226 parity). ≥ 2 cases.
- **AC-227-07 (Footer + Safe Mode)**: vitest cases — only one `Execute` button in footer + no `"Preview SQL"` button; preview→commit IPC sequence `[{preview_only:true},{preview_only:false}]`; one `useQueryHistoryStore` entry with `source:"ddl-structure"`; Safe Mode warn-cancel canonical message verbatim. ≥ 3 cases.
- **AC-227-08 (Sprint 226 regression)**: Rust `cargo test create_table_preview_three_column_composite_pk_byte_equivalent` exit 0 with no source diff; vitest Sprint 226 IPC-sequence + history-source cases survive in migrated test file. ≥ 2 cases.

### Coverage Target

- 신규 / 수정 `src/components/schema/CreateTableDialog.tsx`: 라인 ≥ 70%.
- 신규 (if extracted) `src/components/schema/CreateTableTypeCombobox.tsx`: 라인 ≥ 70%.
- 수정 `src-tauri/src/db/postgres/mutations.rs::create_table` 함수: 브랜치 ≥ 70% (preview / execute / 0-comment / comment-bearing / single-quote-escape / validation-fail).
- CI baseline: 라인 40% / 함수 40% / 브랜치 35%.

### Scenario Tests (필수)

- [x] **Happy path** — preview→commit with comment-bearing form → multi-statement SQL emitted in one transaction → success → `refreshSchema` + history entry + modal close.
- [x] **Empty / 누락 입력** — empty comment string emits no `COMMENT ON`; whitespace-only comment emits no `COMMENT ON`; Sprint 226 callers omitting `comment` field deserialize via `#[serde(default)]` to `None`; empty column-name still rejected by backend identifier validator.
- [x] **에러 복구** — Safe Mode warn-cancel surfaces canonical message in inline preview pane error slot + form stays editable; backend mid-batch failure (e.g. table already exists) rolls back transaction + PG error surfaces verbatim in inline preview pane; modal stays open.
- [x] **경계 조건 / 동시성** — comment with single quotes `O'Brien` → SQL `'O''Brien'`; comment with newlines / tabs / `;` emitted verbatim inside literal (PG-accepted, NOT split as statement boundary); schema dropdown change after preview invalidates cached preview; user clicks "Show DDL" twice rapidly → second preview overwrites first (Sprint 214 stale-overwrite contract).
- [x] **상태 전이** — collapsed (no preview) → "Show DDL" clicked → preview-loading → preview-shown → safe-mode-decide → (safe → commit-loading → success) | (warn → confirm-mounted → committed) | (block → previewError set); edit any field → preview-stale → collapsed back to "Show DDL".
- [x] **에지 케이스** — type combobox empty filter shows full list / does NOT commit a default; type combobox custom free-text `numeric(10,4)` blur commits verbatim; tab switch with unsaved column draft preserves state; single-schema connection still renders dropdown; comment with `;` does not split statements; Indexes / FK tabs disabled-but-clickable (no hidden advanced path); 0-comment form byte-equivalent to Sprint 226 SQL.
- [x] **기존 기능 회귀 없음** — Sprint 226 `composite_pk_byte_equivalent` Rust fixture passes unchanged; Sprint 226 vitest IPC-sequence + history-source cases survive in migrated test file; `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` / `SqlPreviewDialog` / `useDdlPreviewExecution` test suites exit 0 with zero text-string diff; cross-window suite untouched.

## Test Script / Repro Script

1. baseline (before any change):
   ```sh
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx
   pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx src/components/schema/CreateTableDialog.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml create_table --no-run
   ```
2. Generator 작업 후 — primary command profile:
   ```sh
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
   pnpm vitest run src/components/schema/CreateTableTypeCombobox.test.tsx   # only if extracted
   pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml create_table
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx
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
   git diff --stat src/__tests__/
   grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx
   grep -nE 'COMMENT ON COLUMN' src-tauri/src/db/postgres/mutations.rs
   grep -nE '#\[serde\(default\)\]' src-tauri/src/models/schema.rs | head
   grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/
   grep -nE 'SYNCED_KEYS|attachZustandIpcBridge' src/stores/connectionStore.ts | wc -l
   git diff src/ src-tauri/ | grep "^+.*eslint-disable"
   git diff src/ | grep -E "^\+.*\bany\b"
   grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo' src/components/schema/CreateTableDialog.test.tsx
   ```
5. Optional manual UI smoke (record in `docs/sprints/sprint-227/findings.md` if performed):
   ```sh
   pnpm tauri dev
   # → connect to PG → expand schema → right-click → Create Table…
   # → switch Target schema in dropdown → fill 2 columns (id integer NOT NULL with comment "primary key", name text with comment "O'Brien-safe")
   # → switch to Keys tab → check id PK → switch back to Columns to confirm state preserved
   # → click Show DDL → confirm multi-statement SQL renders intact (CREATE TABLE + 2× COMMENT ON COLUMN)
   # → click Execute → confirm new table appears in tree; in psql `\d+ <table>` shows column comments verbatim
   ```

## Ownership

- Generator: general-purpose agent (Phase 3, harness skill).
- Write scope: backend (`models/schema.rs` `comment` field + `db/postgres/mutations.rs` COMMENT ON emission + new fixtures) + frontend types (`src/types/schema.ts` `comment` field) + redesigned modal (`CreateTableDialog.tsx` + `.test.tsx`) + optional new combobox (`CreateTableTypeCombobox.{tsx,test.tsx}` if extracted) + optional canonical PG type list (`src/lib/sql/postgresTypes.ts` if extracted) + `SchemaTree/dialogs.tsx` `availableSchemas` prop wiring + `docs/PLAN.md` row.
- 변경 금지: `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` / `useSafeModeGate*` / `analyzeStatement*` / `ColumnsEditor*` / `IndexesEditor*` / `ConstraintsEditor*` / `schemaStore*` / `connectionStore*` / `src/lib/zustand-ipc-bridge.ts` / `src/lib/window-label.ts` / Mongo paths (`src/components/schema/DocumentDatabaseTree*` / `src-tauri/src/commands/document/`) / sibling `SchemaTree.*` test files (lifecycle / expand / refresh / search / highlight / preview / virtualization / rowcount / dbms-shape) / cross-window regression test (`src/__tests__/cross-window-*.test.tsx`) / `main.tsx` / Sprint 226 `composite_pk_byte_equivalent` test source.

## Exit Criteria

- Open `P1` / `P2` findings: `0`.
- Required checks passing: `yes` (1-32 모두).
- Acceptance criteria evidence linked in `handoff.md` — AC-227-01..AC-227-08 each cited with concrete test/fixture/grep evidence.
- **본 sprint 후 Phase 27 sprint 2 종료** — DataGrip-parity foundation lands; Sprint 228 (Indexes tab functional) plugs into the tabbed shell without further structural change; Sprint 229 (Foreign Keys) and Sprint 230 (reorder + table comment polish) unblocked.
- TDD evidence (`red-state.log` 또는 red-state commit) recorded in `docs/sprints/sprint-227/tdd-evidence/`.
- e2e closure dependency: **none**. `lefthook.yml:5_e2e` stays disabled. Phase 27 e2e smoke deferred under `[DEFERRED-PHASE-27-E2E]` marker.
