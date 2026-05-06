# Sprint Execution Brief: sprint-227

## Objective

Phase 27 sprint 2 — DataGrip-parity foundation for the CREATE TABLE GUI. Restructure `CreateTableDialog` (Sprint 226 output) into a tabbed surface (Columns / Keys / Indexes / Foreign Keys) with a Target schema dropdown header, an autocomplete type combobox over the canonical PG type list (≥ 25 entries with free-text fallback), per-column comment input emitted as `COMMENT ON COLUMN` statements alongside `CREATE TABLE` in **one transaction** (atomic policy = C, partial-atomic), and an inline collapsible DDL Preview pane that replaces the modal-on-modal `SqlPreviewDialog`. Indexes / Foreign Keys tabs are present-but-disabled placeholders that Sprint 228 / 229 will plug into. Single sprint covers AC-227-01..AC-227-08; verification profile `command` (vitest + tsc + lint + cargo test + cargo clippy); e2e dead, **not** a closure dependency.

## Task Why

- **DataGrip parity foundation** — Sprint 226 shipped a flat form. Manual feedback (2026-05-06) — "form이 너무 구리다 — type 자동완성, constraint/index 같이" + DataGrip "Import 'actor' Table" reference — drives a tabbed redesign as the structural foundation for the rest of Phase 27.
- **228 / 229 / 230 plug into this shell** — by landing the tabbed Tabs container + inline DDL Preview + Target schema dropdown in this sprint, Sprint 228 (Indexes tab functional) and Sprint 229 (FK tab functional) become *additive* — they only fill in tab bodies. Sprint 230 polish (reorder + table comment + type coloring) likewise additive. Without sprint-227 the next three sprints would each require structural surgery.
- **`useDdlPreviewExecution` reuse contract** — Sprint 214's hook is render-agnostic. Sprint 227 validates the hook supports an *inline* preview render (in addition to Sprint 226's modal-on-modal use) without modifying its body. If the contract holds (`git diff --stat = 0`), it's the second proof point that the hook is the canonical DDL-orchestration shape across the codebase.
- **No cross-window risk → e2e dead OK** — schema cache stays window-local; no `SYNCED_KEYS` extension, no IPC bridge change, no broadcast subscriber. Sprint 227's only cross-cutting change is additive backend payload (`comment: Option<String>` with `#[serde(default)]`) which Sprint 226 callers tolerate. e2e dead is acceptable per lesson `e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant`.
- **Atomic policy = C (partial-atomic)** — user decision (2026-05-06): `create_table` only handles CREATE TABLE + PK + NOT NULL + DEFAULT + COMMENT ON inside one transaction. Indexes / FKs are *separate* Tauri commands chained sequentially in 228 / 229. This sprint lands the column-comment leg of policy C; the next two sprints land the Index / FK legs.
- **Modal-on-modal removal isolates the seam** — `SqlPreviewDialog` is dropped from `CreateTableDialog`'s import path only. Sibling editors (`ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor`) keep using it. This keeps the seam narrow and the freeze surface small (`SqlPreviewDialog` body byte-equivalent unchanged).

## Scope Boundary

**In scope:**
- Backend: `ColumnDefinition.comment: Option<String>` (`#[serde(default)]`); `create_table` PG impl emits `COMMENT ON COLUMN` per commented column inside the existing transaction (single-quote escape `O'Brien` → `'O''Brien'`); ≥ 2 new Rust unit fixtures (single-quote escape + 0-comment regression byte-equivalent to Sprint 226).
- Frontend: `src/types/schema.ts` `comment?` mirror; `CreateTableDialog.tsx` redesign (Target schema dropdown header + Tabs wrapper + Type combobox + Comment input + inline DDL Preview pane + footer Cancel/Execute, dropping `SqlPreviewDialog` import); extended `CreateTableDialog.test.tsx` with AC-227-01..08 cases (≥ 15 total, including Sprint 226 carry-over migrated to tab-aware queries); optional new `CreateTableTypeCombobox.{tsx,test.tsx}` if Generator extracts; optional new `src/lib/sql/postgresTypes.ts` canonical PG type list if Generator extracts; `SchemaTree/dialogs.tsx` `availableSchemas` prop wiring; `docs/PLAN.md` cycle table row.

**Out of scope (frozen):**
- Indexes editor functional rows (Sprint 228 — placeholder body only in 227).
- Foreign Keys editor functional rows (Sprint 229 — placeholder body only).
- ↑/↓ row reorder buttons (Sprint 230).
- Table-level `COMMENT ON TABLE` (Sprint 230).
- Type coloring on combobox display (Sprint 230 polish).
- MongoDB / DocumentAdapter `createCollection` (Phase 27 = PG-first).
- `SYNCED_KEYS` extension / `attachZustandIpcBridge` modification / new IPC channel.
- Cross-window invariant test suite (`src/__tests__/cross-window-*.test.tsx` diff = 0).
- `SqlPreviewDialog` body changes (sibling editors keep using it).
- `useDdlPreviewExecution` hook signature / body changes (Sprint 214 reuse only).
- `useSafeModeGate` / `analyzeStatement` body changes.
- `schemaStore` / `connectionStore` body changes.
- Existing DDL surface text-string changes (`ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor`).
- Sibling `SchemaTree.*` test files beyond `SchemaTree.actions.test.tsx`.
- Shared "DDL modal" base extraction.
- Generalised "DDL combobox" abstraction (combobox stays in `src/components/schema/`).
- e2e restoration / Playwright spec authoring.
- Sprint 226 `composite_pk_byte_equivalent` test source diff.

## Invariants

- **Sprint 226 byte-equivalence** — `create_table_preview_three_column_composite_pk_byte_equivalent` Rust fixture passes **unmodified**; 0-comment SQL byte-equivalent to Sprint 226 (additive regression proof in a new fixture).
- **`useDdlPreviewExecution` (Sprint 214) hook body unchanged** — `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0. Hook is render-agnostic; modal owns inline preview JSX, hook owns state slots.
- **`SqlPreviewDialog` component body unchanged** — `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0. Only the *import path* in `CreateTableDialog.tsx` is removed.
- **Cross-window invariant suite frozen** — `git diff --stat src/__tests__/cross-window-*.test.tsx` = 0.
- **Existing DDL surface test suites pass without text-string changes** — `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` / `useDdlPreviewExecution` / `SqlPreviewDialog` / `useSafeModeGate` / `SchemaTree` rename/drop suites all exit 0 with zero text-string diff.
- **Schema cache stays window-local** — no `SYNCED_KEYS` extension, no `attachZustandIpcBridge` modification, no new IPC channel.
- **Safe Mode warn-cancel canonical message** — `"Safe Mode (warn): confirmation cancelled — no changes committed"` byte-equivalent surfaces in inline DDL Preview pane error slot.
- **`useQueryHistoryStore.addHistoryEntry` source = `"ddl-structure"`** on commit-success (Sprint 226 carry-over).
- **Identifier validation rule** mirrors `rename_table` / Sprint 226 byte-for-byte. Comment string is *not* an identifier — only single-quote-doubled inside the SQL literal.
- **Preview→commit IPC sequence** is exactly `[{preview_only:true},{preview_only:false}]` for both 0-comment and comment-bearing forms.
- **Backend additive payload** — `ColumnDefinition.comment` carries `#[serde(default)]`; Sprint 226 callers omitting the field deserialize to `None`.
- **Atomic policy = C (partial-atomic)** — `CREATE TABLE … ; COMMENT ON COLUMN …;` emitted as one transactional batch. Indexes / FKs are separate Tauri commands chained sequentially in Sprint 228 / 229.
- **No new `useEffect` / `setInterval` / `setTimeout` / `addEventListener` / `subscribe`** in `CreateTableDialog` beyond what the redesign genuinely needs (preview cache invalidation effect on form-edit is OK; broadcast subscribers are NOT).
- **Zero new `it.skip` / `describe.skip` / `it.todo` / `xit` / `this.skip()` / `it.only`** in any touched test file.
- **Zero new `eslint-disable*`** lines.
- **Zero new silent `catch {}`** blocks.
- **Zero new `any` in TS, zero new `unwrap()` in production Rust paths**.
- **No store mutation** — `git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts` = 0.
- **Mongo / non-RDB path untouched** — `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0.

## Done Criteria

1. **AC-227-01 (Tabs layout)** — `CreateTableDialog` renders 4 tabs (`Columns` / `Keys` / `Indexes` / `Foreign Keys`); Indexes / FK tabs render verbatim placeholder strings (`"Available in Sprint 228"` / `"Available in Sprint 229"`) with no inputs; vitest cases assert tab roles + labels + placeholder content + `queryAllByRole("textbox")` length = 0 in placeholder bodies.
2. **AC-227-02 (Schema picker)** — Modal header surfaces a `Target schema` dropdown populated from `useSchemaStore.schemas[connectionId]` (with `availableSchemas` prop wired in `dialogs.tsx`); default = pre-filled schema; change updates `tauri.createTable` payload's `schema` field on next preview; change invalidates cached preview; vitest covers default + change + invalidation paths.
3. **AC-227-03 (Type combobox)** — Per-column type input is a filterable combobox seeded with ≥ 25 canonical PG types; typing filters case-insensitively (`"int"` → `integer`/`bigint`/`smallint`/`interval`); ↑/↓ moves selection; Enter commits highlighted suggestion; Esc closes popover; free-text `numeric(10,4)` blur commits verbatim; vitest covers filter + Enter + free-text fallback.
4. **AC-227-04 (Column comment + COMMENT ON SQL emission)** — Each column row has a `Column comment` input (placeholder `"comment (optional)"`); backend emits `COMMENT ON COLUMN "<schema>"."<table>"."<col>" IS '<escaped>';` per commented column inside the existing transaction; single-quote escape `O'Brien` → `'O''Brien'`; empty / whitespace-only comments emit nothing; ≥ 2 new Rust fixtures (single-quote escape + 0-comment regression byte-equivalent to Sprint 226).
5. **AC-227-05 (Inline DDL Preview pane)** — `SqlPreviewDialog` import removed from `CreateTableDialog.tsx` (`grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` matches 0); inline collapsible region toggles `"Show DDL"` / `"Hide DDL"`; "Show DDL" → 1× `tauri.createTable({preview_only: true})`; preview text contains `CREATE TABLE` + `COMMENT ON` substrings (comment-bearing form); editing a field invalidates cached preview (next click triggers 2nd preview call); Execute calls `tauri.createTable({preview_only: false})`.
6. **AC-227-06 (Keys tab PK)** — PK multi-select renders inside Keys tab; reflects column-row name list live; switching tabs preserves form state; renaming column on Columns tab updates label live on Keys tab (Sprint 226 PK behaviour parity); `primary_key` payload field unchanged.
7. **AC-227-07 (Footer + Safe Mode)** — Footer renders `Cancel` + `Execute` only (no `"Preview SQL"` button); preview→commit IPC sequence exactly `[{preview_only:true},{preview_only:false}]`; one `useQueryHistoryStore` entry with `source:"ddl-structure"`; Safe Mode warn-cancel canonical message verbatim in inline preview pane error slot.
8. **AC-227-08 (No regression on Sprint 226)** — `cargo test create_table_preview_three_column_composite_pk_byte_equivalent` exit 0 with no source diff to that test; Sprint 226 vitest IPC-sequence + history-source cases survive in migrated test file with at most mechanical tab-aware query adaptation.

Verification 4-set + clippy (per `docs/PLAN.md:186`): `pnpm vitest run` + `pnpm tsc --noEmit` + `pnpm lint` + `cargo build --manifest-path src-tauri/Cargo.toml` + `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` all exit 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 32 checks (vitest 신규 + 회귀 + cargo test + cargo clippy + tsc + lint + grep freeze + diff freeze).
- Required evidence:
  - 변경 파일 목록 + 각 LOC delta.
  - check 1-32 실행 결과 (exit code + 핵심 출력).
  - AC-227-01..AC-227-08 별 concrete evidence (test file:case:line, fixture string verbatim for both new comment fixtures, IPC sequence trace, canonical Safe Mode message verbatim, grep output).
  - Both new Rust fixture strings (verbatim) included in handoff — single-quote escape (`O'Brien`) + 0-comment regression byte-equivalent to Sprint 226.
  - `git diff --stat` output for `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` / `schemaStore.ts` / `connectionStore.ts` / `src/__tests__/` (all expected zero or no `cross-window-*` paths).
  - Decision note: combobox extracted vs inlined; PG type list extracted vs inlined (justify in handoff).
  - Confirmation that `ColumnDefinition.comment` carries `#[serde(default)]`.
  - Mongo path untouched proof.
  - TDD red-state evidence (`red-state.log` 또는 red-state commit message).
  - Optional manual UI smoke recorded in `docs/sprints/sprint-227/findings.md`.

## Evidence To Return

- Changed files and purpose: backend (`models/schema.rs` `comment` field + `db/postgres/mutations.rs` COMMENT ON emission + new fixtures) + frontend types (`src/types/schema.ts` `comment` field) + redesigned modal (`CreateTableDialog.tsx` + `.test.tsx`) + optional new combobox (`CreateTableTypeCombobox.{tsx,test.tsx}` if extracted) + optional canonical PG type list (`src/lib/sql/postgresTypes.ts` if extracted) + `SchemaTree/dialogs.tsx` `availableSchemas` prop wiring + `docs/PLAN.md` row.
- Checks run and outcomes: 32 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage: AC-227-01..08 별 concrete evidence with test file path + case name + assertion line; both new Rust fixture SQL strings verbatim; IPC sequence trace from vitest mock-call args.
- Composite-PK / 0-comment fixture strings (verbatim) — proof of byte-equivalence to Sprint 226.
- Single-quote-escape fixture string (verbatim) — proof of `O'Brien` → `'O''Brien'`.
- Preview→commit IPC sequence trace for comment-bearing form (vitest mock-call argument log).
- Safe Mode warn-cancel canonical message match.
- `git diff --stat` outputs for frozen files (expected zero).
- Assumptions made:
  - Combobox extracted vs inlined — Generator picks (justify in handoff). Recommendation: extract if file LOC > 150, inline otherwise.
  - PG type list extracted vs inlined — Generator picks (justify in handoff). Recommendation: extract to `src/lib/sql/postgresTypes.ts` for testability.
  - Tab activation key — `Tabs` shadcn primitive default (←/→ + Tab); Generator confirms primitive supports keyboard nav out-of-the-box.
  - Inline preview pane visual treatment — collapsed = button-like row; expanded = scrollable `<pre>` block separated by thin border above footer (matches DataGrip aesthetic per spec Visual Direction).
  - Preview cache invalidation mechanism — Generator picks: `useEffect` keyed on form fields vs explicit `setPreviewStale(true)` calls in field onChange handlers. Either is acceptable provided no broadcast subscribers leak in.
  - `dialogs.tsx` `availableSchemas` source — `useSchemaStore.schemas[connectionId]`; Generator confirms the existing store key shape matches.
- Residual risk / verification gaps:
  - **Manual UI smoke is optional** — without `pnpm tauri dev` confirmation, the modal's *visual* fidelity to DataGrip "Import 'actor' Table" reference is unverified by automation. Recommend at least one manual smoke run before close-out (Tab navigation, dropdown styling, inline preview readability, Comment input placement).
  - **No e2e** — Phase 27 closure does not include e2e coverage. Captured as `[DEFERRED-PHASE-27-E2E]` per lesson.
  - **PG-only** — Mongo `createCollection` is deferred; users on Mongo paradigm see no Create Table menu item (Sprint 226 carry-over).
  - **Comment string with `;` inside literal** — backend SQL emission must NOT split on `;` (the `;` inside a single-quoted literal is *not* a statement boundary). If the SQL builder uses naive `;`-split, this breaks. Generator must verify the emission codepath emits the literal intact and that the multi-statement transaction submits the full batch as a single PG `simple_query` call (or each `;`-separated statement individually, with comments emitted as their own statements outside the literal).
  - **`useDdlPreviewExecution` `;`-split semantics** — the hook splits multi-statement preview SQL on `;` for per-statement Safe Mode analysis. Comment strings containing `;` must not be analyzed as a separate statement. Generator must confirm the existing `;`-split helper is quote-aware (or document the gap as a `[DEFERRED]` item — but this is unlikely given Sprint 189's `analyzeStatement` design).
  - **Combobox keyboard nav** — Generator picks the combobox primitive (`Command` from cmdk + `Popover` from shadcn). Confirm ↑/↓ + Enter + Esc work out-of-the-box; if not, extend with a thin keyboard handler (still no cross-window broadcast).
  - **Tab state preservation across tab switch** — modal-local `useState` retains form fields including comment + PK + selected schema. Generator must verify no inadvertent unmount of the Columns tab body on switch (Tabs primitive may render hidden vs unmount; the former preserves DOM state, the latter requires lifting state to modal root which is already the design).
  - **Sprint 226 vitest test migration** — assertion text changes are forbidden (per AC-227-08). Only query selectors may be migrated to tab-aware (e.g. `getByLabelText("Column name")` scoped via `within(columnsTabPanel)`). If a Sprint 226 case requires *assertion* text change to pass, that's a regression — flag as `P1`.
  - **TDD red-state evidence** — must be captured before green commits; per `docs/PLAN.md:182-186`.

## References

- Contract: `docs/sprints/sprint-227/contract.md`
- Spec: `docs/sprints/sprint-227/spec.md`
- Findings: `docs/sprints/sprint-227/findings.md` (작성 예정)
- TDD evidence: `docs/sprints/sprint-227/tdd-evidence/red-state.log` (작성 예정)
- Sprint 226 (carry-over baseline + entry-point + Sprint 226 fixture freeze): `docs/sprints/sprint-226/{spec,contract,execution-brief,findings,handoff}.md`; Rust fixture in `src-tauri/src/db/postgres/mutations.rs::create_table_preview_three_column_composite_pk_byte_equivalent`.
- Sprint 214 (`useDdlPreviewExecution` source): `docs/sprints/sprint-214/{spec,contract,findings,handoff}.md`; hook file `src/components/structure/useDdlPreviewExecution.ts` (reuse, diff 0).
- Sprint 213 (`ConnectionDialog` modal Tabs pattern source): `docs/sprints/sprint-213/{spec,contract,findings,handoff}.md`.
- Sprint 189 (`useSafeModeGate` + `analyzeStatement`): hook file `src/lib/safe-mode/*` (reuse, diff 0).
- Sprint 219 (`useConnectionMutations` `vi.hoisted` + factory mock pattern source): `docs/sprints/sprint-219/{spec,contract}.md`.
- Sprint 223 (`useSchemaTableMutations` N-case migration mock pattern): `docs/sprints/sprint-223/{spec,contract}.md`.
- Sprint 224 (`useConnectionSessionHydration` two-export hook pattern): `docs/sprints/sprint-224/{contract,execution-brief}.md`.
- Relevant files:
  - `src-tauri/src/models/schema.rs` (target — `ColumnDefinition.comment: Option<String>` + `#[serde(default)]`, +~5 LOC)
  - `src-tauri/src/db/postgres/mutations.rs` (target — emit `COMMENT ON COLUMN` per commented column + new fixtures; ~+50 LOC; Sprint 226 `composite_pk_byte_equivalent` test source untouched)
  - `src/types/schema.ts` (target — `comment?: string` mirror, +~3 LOC)
  - `src/components/schema/CreateTableDialog.tsx` (target — full redesign: Target schema dropdown header + Tabs wrapper + Type combobox + Comment input + inline DDL Preview pane; drop `SqlPreviewDialog` import; ~+250/-120 LOC net)
  - `src/components/schema/CreateTableDialog.test.tsx` (target — extend with AC-227-01..08 cases; ≥ 15 cases total; ~+200 LOC)
  - `src/components/schema/CreateTableTypeCombobox.tsx` (new, optional — filterable combobox; ~80-150 LOC if extracted)
  - `src/components/schema/CreateTableTypeCombobox.test.tsx` (new, optional — vitest cases for combobox if extracted)
  - `src/lib/sql/postgresTypes.ts` (new, optional — canonical PG type list ≥ 25 entries; ~30 LOC if extracted)
  - `src/components/schema/SchemaTree/dialogs.tsx` (target — pass `availableSchemas` prop to `CreateTableDialog`; +~5 LOC)
  - `docs/PLAN.md` (target — add row for sprint-227; +~3 LOC)
  - `src/components/structure/useDdlPreviewExecution.ts` (reuse, diff 0)
  - `src/components/structure/SqlPreviewDialog.tsx` (reuse, diff 0; sibling editors keep using it — only `CreateTableDialog.tsx` drops the import)
  - `src/components/structure/ColumnsEditor.tsx` (reference for column-row repeater idiom; diff 0)
  - `src/components/structure/ConstraintsEditor.tsx` (reference for PK checkbox-list pattern; diff 0)
  - `src/components/ui/tabs.tsx` (reuse Tabs primitive; diff 0)
  - `src/components/ui/select.tsx` (reuse Select primitive for Target schema dropdown; diff 0)
  - `src/components/ui/popover.tsx` (reuse Popover primitive for combobox; diff 0)
- Phase context: `docs/PLAN.md` (Phase 27 parity scope + Verification 4-set + TDD evidence policy lines 182-186).
- Lesson: `e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant` (justifies e2e dead state for this sprint).
- 후속 sprints: Sprint 228 (Indexes tab functional — chains `tauri.createTable` → `tauri.createIndex` per declared index; outside CREATE TABLE transaction per partial-atomic policy C) / Sprint 229 (FK + Constraints tab — chains `tauri.addConstraint` after CREATE TABLE) / Sprint 230 (reorder + table comment + type coloring polish) / Phase 27 closure sprint (parity smoke matrix + lessons retro).
