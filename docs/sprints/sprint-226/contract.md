# Sprint Contract: sprint-226

## Summary

- Goal: Phase 27 sprint 1 — close the CREATE TABLE GUI parity gap. Add backend `create_table` Tauri command (PG SQL builder + identifier validation + preview/execute branches inside a transaction) and a frontend `CreateTableDialog` modal that reuses Sprint 214's `useDdlPreviewExecution` hook + Sprint 189's `useSafeModeGate`. Wire the entry point through `SchemaTree`'s schema-row context menu (`Create Table…`) and refresh the schema's table list on commit-success. Single sprint covers AC-226-01 through AC-226-05; verification profile is `command` (vitest + tsc + lint + cargo test); e2e is dead per `lefthook.yml:61-86` and is **not** a closure dependency.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle, Phase 27 sprint 1 of 5).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

Backend (Rust):
- `src-tauri/src/models/schema.rs`: add `CreateTableRequest { connection_id, schema, name, columns: Vec<ColumnDefinition>, primary_key: Option<Vec<String>>, preview_only: bool }` + `ColumnDefinition` (or reuse `ColumnChange::Add` shape — Generator's call). +~30 LOC.
- `src-tauri/src/db/traits.rs`: add `create_table(req) -> Result<SchemaChangeResult, AppError>` to `RdbAdapter` trait. +~5 LOC.
- `src-tauri/src/db/postgres/mutations.rs`: implement `create_table` on PG adapter — identifier validation (whitespace-trim, non-empty, no embedded `"`, mirrors `rename_table`), ANSI-quoted SQL build, preview branch (return `{ sql }` without execute), execute branch (transactional). +~80 LOC.
- `src-tauri/src/commands/rdb/ddl.rs`: add `#[tauri::command] pub async fn create_table(...)` matching the existing `alter_table` shape. +~20 LOC.
- `src-tauri/src/lib.rs`: register the new handler in `invoke_handler!` (line ~148 area where `drop_table` / `rename_table` / `alter_table` already register). +1 LOC.

Frontend (TS/TSX):
- `src/types/schema.ts`: add `CreateTableRequest` (and `ColumnDefinition` if not subsumed). +~20 LOC.
- `src/lib/tauri/ddl.ts`: add `createTable(request): Promise<SchemaChangeResult>` IPC wrapper paralleling `alterTable`. +~10 LOC.
- `src/components/schema/CreateTableDialog.tsx` (new): modal that owns form state and delegates preview/execute to `useDdlPreviewExecution`. ~180-260 LOC.
- `src/components/schema/CreateTableDialog.test.tsx` (new): vitest suite covering form behaviour + preview→commit pipeline + Safe Mode branches. ~250-350 LOC, ≥ 8 cases.
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts`: add `handleCreateTable(schemaName)` opener + `createTableDialog` state field on the returned `SchemaTreeActions` interface + commit-success → `refreshSchema(schemaName)` wiring. +~30 LOC.
- `src/components/schema/SchemaTree/dialogs.tsx`: mount `CreateTableDialog` alongside the existing `DropTableConfirmDialog` and rename modal. +~10 LOC.
- `src/components/schema/SchemaTree/rows.tsx` (or wherever the schema-row context menu lives — Generator confirms): add the `"Create Table…"` menu item. +~5 LOC.
- `src/components/schema/SchemaTree.actions.test.tsx`: extend with the entry-point assertion (menu item exists + click → opens modal + commit-success → `refreshSchema` called once). +~40 LOC, +1-2 cases.

## Out of Scope

The following are explicitly frozen for sprint-226. Cite the spec's "Future sprints" + "DO NOT" sections.

- **MongoDB / DocumentAdapter `createCollection`** — Mongo collection creation is a separate paradigm (Phase 27 = PG-first per `docs/PLAN.md`). No `createCollection` IPC, no `create_collection` Rust command, no menu item on Mongo schema rows.
- **Drop Table CASCADE preview** — Sprint 227 candidate; requires a new `pg_depend` query path and is a separable user story.
- **Typing-confirm UX** — only Drop benefits from it; Create is non-destructive.
- **Sprint 180 cancel-token integration** — `CREATE TABLE` is near-instant in PG; deferred unless a follow-up sprint shows operator pain.
- **`SYNCED_KEYS` extension** of any store — schema cache is window-local; cross-window broadcast is unnecessary for the Create flow.
- **`attachZustandIpcBridge` modification** — no new IPC channel, no bridge wiring change, no module-load attach reorder.
- **e2e restoration / Playwright spec authoring** — `lefthook.yml:5_e2e` stays disabled; Phase 27 e2e smoke is captured as `[DEFERRED-PHASE-27-E2E]` per lesson `e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant`.
- **Shared "DDL modal" base extraction** — wait until 3+ Create-* modals exist before extracting; premature extraction risks Sprint 214-style cross-component shape mismatch.
- **`useDdlPreviewExecution` hook signature / body changes** — reuse only; `git diff --stat src/components/structure/useDdlPreviewExecution.ts` must be 0.
- **`useSafeModeGate` body / `analyzeStatement` body changes** — reuse only.
- **`schemaStore` / `connectionStore` body changes** — `git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts` must be 0.
- **Existing DDL surface text-string changes** — `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` / `SqlPreviewDialog` rendered strings, button labels, aria labels frozen.
- **Sibling `SchemaTree.*` test files** beyond `SchemaTree.actions.test.tsx` — no diff to `SchemaTree.lifecycle.test.tsx` / `SchemaTree.expand.test.tsx` / `SchemaTree.refresh.test.tsx` / `SchemaTree.search.test.tsx` / `SchemaTree.highlight.test.tsx` / `SchemaTree.preview*.test.tsx` / `SchemaTree.virtualization.test.tsx`.

## Invariants

- Existing DDL surface test suites (`ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` / `useDdlPreviewExecution` / `SqlPreviewDialog` / `SchemaTree` rename/drop / `useSafeModeGate`) pass without text-string changes.
- Schema cache stays window-local — no `SYNCED_KEYS` extension, no `attachZustandIpcBridge` modification, no new IPC channel.
- Safe Mode warn-cancel canonical message — `"Safe Mode (warn): confirmation cancelled — no changes committed"` byte-equivalent surfaces in `previewError` (matches sibling `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` paths).
- `useQueryHistoryStore.addHistoryEntry` source must be `"ddl-structure"` on commit-success — matches the existing DDL surface convention.
- Identifier validation rule mirrors `rename_table` byte-for-byte (whitespace-trimmed, non-empty, no embedded `"`); `AppError::Validation` text surfaces verbatim in `previewError`.
- Preview→commit IPC sequence is exactly `[tauri.createTable({preview_only: true}), tauri.createTable({preview_only: false})]` — no third call, no skipped preview, no double-commit.
- `useDdlPreviewExecution` (Sprint 214) hook reused as-is — `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0.
- `useSafeModeGate` (Sprint 189) reused as-is — `git diff --stat` = 0.
- No new `useEffect` / `setInterval` / `setTimeout` / `addEventListener` / `subscribe` in `CreateTableDialog` beyond what the existing modal pattern (`Dialog` shadcn primitive open/close) already uses.
- Zero new `it.skip` / `describe.skip` / `it.todo` / `xit` / `this.skip()` / `it.only` in any touched test file.
- Zero new `eslint-disable*` lines.
- Zero new silent `catch {}` blocks (rejection paths must surface error to the user via `previewError` or modal-close path).
- Zero new `any` in TS, zero new `unwrap()` in production Rust paths (test fixtures may use `unwrap` per existing convention).
- No store mutation — `git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts` = 0.
- Modal-local `useState` only for form state (table name, column rows, PK selection); no new Zustand store.
- Mongo / non-RDB path untouched — `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0.

## Acceptance Criteria

Verbatim from `docs/sprints/sprint-226/spec.md`:

- `AC-226-01` Backend `create_table` Tauri command accepts `CreateTableRequest { connection_id, schema, name, columns: Vec<ColumnDefinition>, primary_key: Option<Vec<String>>, preview_only: bool }`. When `preview_only=true` it returns `SchemaChangeResult { sql: String }` without executing; when `preview_only=false` it executes inside a transaction and returns the SQL it ran. Identifier inputs are validated by the same rule already enforced in `rename_table` (whitespace-trimmed, non-empty, no embedded `"`); failures return `AppError::Validation` and are surfaced verbatim by the modal. **Testable:** Rust unit tests in `src-tauri/src/db/postgres/mutations.rs` + `src-tauri/src/commands/rdb/ddl.rs`; assert preview branch returns SQL without DB write, execute branch wraps in `BEGIN/COMMIT`, identifier `"foo bar"` rejected.

- `AC-226-02` Generated SQL follows PG ANSI quoting: `CREATE TABLE "<schema>"."<name>" ("<col1>" <type1> [NOT NULL] [DEFAULT …], …, PRIMARY KEY ("<pkcol>", …))`. Empty column list is rejected with `AppError::Validation("Table must have at least one column")`. PK columns must reference declared columns; mismatch rejected with a specific error. **Testable:** Rust unit-test fixtures covering 1-col no-PK / 3-col composite-PK / NOT NULL + DEFAULT / identifier with embedded space (rejected) / empty columns (rejected) / PK referencing undeclared column (rejected). Composite-PK fixture asserts byte-equivalent SQL string.

- `AC-226-03` Frontend exposes `tauri.createTable(request)` in `src/lib/tauri/ddl.ts`. A new `CreateTableDialog` component (modal) renders: a "Table name" text input + a column-row repeater (name / data_type / nullable toggle / default_value) + a "Primary key" multi-select bound to declared columns + Preview SQL button + Cancel button. **Testable:** vitest covers — opens with one empty column row; "+ Column" adds a row; "−" removes a row but blocks the last one; PK multi-select reflects current column names live; Preview SQL disabled until name + ≥ 1 valid column.

- `AC-226-04` "Preview SQL" routes through the existing `useDdlPreviewExecution` hook (Sprint 214). Preview fetch calls `tauri.createTable({ ..., preview_only: true })`; Execute closure calls the same with `preview_only: false`. The Safe Mode gate (`useSafeModeGate`, Sprint 189) decides strict-block vs warn-confirm vs safe-pass identically to the existing `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` paths. **Testable:** vitest mocks `tauri.createTable` and asserts — preview→commit calls are exactly `[{ preview_only: true }, { preview_only: false }]`; on commit success a `useQueryHistoryStore` entry with `source: "ddl-structure"` is recorded; on Safe Mode warn-cancel the canonical message `"Safe Mode (warn): confirmation cancelled — no changes committed"` surfaces in `previewError`.

- `AC-226-05` Entry-point: `SchemaTree`'s schema-row right-click context menu surfaces a `"Create Table…"` item. Clicking it opens `CreateTableDialog` pre-filled with the right-clicked schema name (read-only field). On commit-success the modal closes and the SchemaTree refreshes the schema's table list (`refreshSchema(schemaName)`) so the new table appears without manual reload. **Testable:** `SchemaTree.actions.test.tsx` opens the menu, asserts the item exists, clicks it, and confirms `refreshSchema` is called exactly once after a mocked successful commit.

## Design Bar / Quality Bar

- **Narrow extraction** — reuse `useDdlPreviewExecution` (Sprint 214) and `useSafeModeGate` (Sprint 189) as-is. No anticipatory abstraction. Do **not** extract a shared "DDL modal" base — wait until 3+ Create-* modals exist (per `DO NOT` section in spec).
- **Pattern source** — `useDdlPreviewExecution` (Sprint 214) reuse + `ConnectionDialog` modal pattern (Sprint 213) for form-state shape + `vi.hoisted` + factory mock pattern (Sprint 219/223/224) for hook test mocks.
- **Visual consistency** — column-row repeater reuses the visual idiom of `ColumnsEditor.tsx` add-column flow; PK multi-select uses the same checkbox-list pattern as the constraint Primary Key form. No new visual primitives, no new shadcn components.
- **TDD evidence** — capture `red-state.log` (or commit ordering with red-state commit message) in `docs/sprints/sprint-226/tdd-evidence/red-state.log` per `docs/PLAN.md:182-186`.
- **Identifier validation** — share the regex / helper that `rename_table` already uses. Do not duplicate the validator inline in `create_table`.
- **SQL emission determinism** — composite-PK fixture must be byte-equivalent to a string literal in the test (RFC-style). No `.contains()` partial matches for the canonical fixture.
- **Modal-local state only** — no Zustand store added; `useState` for form fields, `useDdlPreviewExecution` owns preview SQL / loading / error / pendingConfirm.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` exit 0 + ≥ 8 cases pass.
2. `pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx` exit 0 + entry-point case included.
3. `cargo test --manifest-path src-tauri/Cargo.toml create_table` exit 0 + ≥ 5 fixtures (1-col no-PK / 3-col composite-PK byte-equivalent / NOT NULL+DEFAULT / embedded-space rejected / empty-columns rejected / PK-undeclared rejected).
4. `pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx` exit 0 (regression freeze on existing DDL surfaces).
5. `pnpm vitest run` exit 0. file count 사전 +2 (CreateTableDialog.tsx + CreateTableDialog.test.tsx).
6. `pnpm tsc --noEmit` exit 0.
7. `pnpm lint` exit 0.
8. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
9. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` exit 0.
10. `grep -nE 'create_table\b' src-tauri/src/lib.rs` ≥ 1 (handler registered in `invoke_handler!`).
11. `grep -nE 'createTable\b' src/lib/tauri/ddl.ts` ≥ 1 (IPC wrapper exported).
12. `grep -rn 'CreateTableDialog\b' src/components/schema/SchemaTree/dialogs.tsx` ≥ 1 (modal mounted in dialog slot).
13. `grep -rnE '"Create Table…"|Create Table\.\.\.' src/components/schema/SchemaTree/` ≥ 1 (menu item literal exists).
14. `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0 (Sprint 214 hook unchanged — reuse only).
15. `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0 (preview dialog unchanged).
16. `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` = 0 (no store mutation).
17. `grep -nE 'SYNCED_KEYS|attachZustandIpcBridge' src/stores/connectionStore.ts | wc -l` unchanged from baseline.
18. `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0 (Mongo path not touched).
19. `git diff src/ src-tauri/ | grep "^+.*eslint-disable"` matches 0.
20. `git diff src/ | grep -E "^\+.*\bany\b"` matches 0 (no new `any` types).
21. `grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo|this\.skip\(\)' src/components/schema/CreateTableDialog.test.tsx src/components/schema/SchemaTree.actions.test.tsx` matches 0.
22. `grep -nE '"ddl-structure"' src/components/schema/CreateTableDialog.tsx` ≥ 1 (history source canonical) — alternative: appears in test assertion if dialog forwards via hook callback.
23. `grep -nE 'preview_only' src-tauri/src/db/postgres/mutations.rs` ≥ 2 (preview branch + execute branch both reference the flag).
24. Rust unit test asserts SQL byte-equivalent to fixture for the composite-PK case (spec verification hint #2).
25. Vitest test asserts call sequence is exactly `[{ preview_only: true }, { preview_only: false }]` (spec verification hint #1).
26. Vitest test asserts Safe Mode warn-cancel canonical message verbatim (spec verification hint #4).
27. `pnpm vitest run src/components/schema/SchemaTree.lifecycle.test.tsx src/components/schema/SchemaTree.expand.test.tsx src/components/schema/SchemaTree.refresh.test.tsx src/components/schema/SchemaTree.search.test.tsx src/components/schema/SchemaTree.highlight.test.tsx src/components/schema/SchemaTree.preview.test.tsx src/components/schema/SchemaTree.preview.entrypoints.test.tsx src/components/schema/SchemaTree.virtualization.test.tsx src/components/schema/SchemaTree.rowcount.test.tsx src/components/schema/SchemaTree.dbms-shape.test.tsx` exit 0 (sibling axis regression).
28. `git diff --stat src/components/schema/SchemaTree.lifecycle.test.tsx src/components/schema/SchemaTree.expand.test.tsx src/components/schema/SchemaTree.refresh.test.tsx src/components/schema/SchemaTree.search.test.tsx src/components/schema/SchemaTree.highlight.test.tsx` = 0 each (sibling test files frozen).

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 + 각 LOC delta.
  - check 1-28 실행 결과 (exit code + 핵심 출력).
  - AC-226-01..AC-226-05 별 concrete evidence (test file name + case name + assertion line, fixture string for composite-PK, IPC sequence trace).
  - composite-PK fixture string (verbatim) included in the handoff.
  - confirmation that `useDdlPreviewExecution` / `useSafeModeGate` / `analyzeStatement` were reused without diff.
  - identifier-validator share decision (Generator's call: shared helper vs duplicated; if duplicated, justify in handoff).
  - Mongo-path untouched proof (check 18).
  - Manual UI smoke (`pnpm tauri dev` → right-click schema → Create Table → 2 columns → Preview → Execute → confirm new table appears) optional but recommended; document in `docs/sprints/sprint-226/findings.md` if performed.
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거 with concrete evidence (test file:line, fixture string match, grep output).
  - missing 또는 weak evidence findings as P1/P2.
  - regression freeze verification (existing DDL surfaces test exit 0 + zero text-string diff).
  - cross-window invariant verification (no `SYNCED_KEYS` / IPC bridge change).

## Test Requirements

### Unit Tests (필수)

- **AC-226-01**: Rust unit tests in `src-tauri/src/db/postgres/mutations.rs` (or a sibling `mutations_create_table_tests.rs` module) — preview branch returns SQL without DB write; execute branch wraps in transaction; identifier validator rejects whitespace-only / embedded-`"` / empty-string. ≥ 4 cases.
- **AC-226-02**: Rust SQL-emission fixtures — 1-col no-PK / 3-col composite-PK byte-equivalent / NOT NULL + DEFAULT / empty-columns rejected / PK-undeclared rejected / embedded-space rejected. ≥ 6 cases.
- **AC-226-03**: vitest on `CreateTableDialog.test.tsx` — opens with one empty column row; "+ Column" adds row; "−" removes row but blocks the last one; PK multi-select reflects column names live; Preview SQL disabled until name + ≥ 1 valid column. ≥ 5 cases.
- **AC-226-04**: vitest on `CreateTableDialog.test.tsx` — preview→commit IPC sequence is `[{preview_only:true},{preview_only:false}]`; commit-success records `useQueryHistoryStore` entry with `source:"ddl-structure"`; Safe Mode warn-cancel surfaces canonical message verbatim; Safe Mode strict-block prevents commit closure invocation. ≥ 4 cases.
- **AC-226-05**: vitest on `SchemaTree.actions.test.tsx` — context-menu surfaces `"Create Table…"` on schema row; click opens `CreateTableDialog` pre-filled; commit-success → `refreshSchema(schemaName)` called exactly once. ≥ 1-2 cases.

### Coverage Target

- 신규 `src/components/schema/CreateTableDialog.tsx`: 라인 ≥ 70%.
- 신규 `src-tauri/src/db/postgres/mutations.rs::create_table` 함수: 브랜치 ≥ 70% (preview/execute/validation-fail).
- CI baseline: 라인 40% / 함수 40% / 브랜치 35%.

### Scenario Tests (필수)

- [x] **Happy path** — preview→commit with safe SQL → success → `refreshSchema` + history entry + modal close.
- [x] **Empty / 누락 입력** — empty column list rejected (frontend disables Preview button + backend defends with `AppError::Validation`); empty table name rejected; whitespace-only name rejected by backend.
- [x] **에러 복구** — Safe Mode warn-cancel surfaces canonical message + form stays editable; backend `AppError::Database` (table already exists) surfaces in preview dialog error slot + modal stays open.
- [x] **경계 조건 / 동시성** — schema dropped between Preview and Execute → PG error verbatim; user clicks Preview twice → second preview overwrites first (Sprint 214 contract); user closes modal mid-flight → `cancelPreview` discards commit closure.
- [x] **상태 전이** — idle → preview-loading → preview-shown → safe-mode-decide → (safe → commit-loading → success) | (warn → confirm-mounted → committed) | (block → previewError set).
- [x] **에지 케이스** — 1-col no-PK / 3-col composite-PK / NOT NULL + DEFAULT / identifier with embedded space (rejected) / PK references column not in declared list (rejected) / removing a column row dereferences stale PK entries.
- [x] **기존 기능 회귀 없음** — `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` / `SqlPreviewDialog` / `useDdlPreviewExecution` / sibling `SchemaTree.*` test files all exit 0 with zero text-string diff.

## Test Script / Repro Script

1. baseline (before any change):
   ```sh
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx
   pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml --no-run
   ```
2. Generator 작업 후 — primary command profile:
   ```sh
   pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
   pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx
   cargo test --manifest-path src-tauri/Cargo.toml create_table
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx
   pnpm vitest run src/components/schema/SchemaTree.lifecycle.test.tsx src/components/schema/SchemaTree.expand.test.tsx src/components/schema/SchemaTree.refresh.test.tsx src/components/schema/SchemaTree.search.test.tsx src/components/schema/SchemaTree.highlight.test.tsx
   ```
3. Verification 4-set (per `docs/PLAN.md:186`):
   ```sh
   pnpm vitest run
   pnpm tsc --noEmit
   pnpm lint
   cargo build --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
   ```
4. Surface + freeze 검증:
   ```sh
   git diff --stat src/components/structure/useDdlPreviewExecution.ts src/components/structure/SqlPreviewDialog.tsx src/stores/schemaStore.ts src/stores/connectionStore.ts
   grep -nE 'create_table\b' src-tauri/src/lib.rs
   grep -nE 'createTable\b' src/lib/tauri/ddl.ts
   grep -rnE '"Create Table…"|Create Table\.\.\.' src/components/schema/SchemaTree/
   grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/
   grep -nE 'preview_only' src-tauri/src/db/postgres/mutations.rs
   git diff src/ src-tauri/ | grep "^+.*eslint-disable"
   grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo' src/components/schema/CreateTableDialog.test.tsx src/components/schema/SchemaTree.actions.test.tsx
   ```
5. Optional manual UI smoke (record in `docs/sprints/sprint-226/findings.md` if performed):
   ```sh
   pnpm tauri dev
   # → connect to PG → expand schema in SchemaTree → right-click "public" → "Create Table…"
   # → fill 2 columns (id int NOT NULL, name text) → mark id as PK → Preview SQL → Execute
   # → confirm new table appears in tree without manual refresh
   ```

## Ownership

- Generator: general-purpose agent (Phase 3, harness skill).
- Write scope: backend (`models/schema.rs` / `db/traits.rs` / `db/postgres/mutations.rs` / `commands/rdb/ddl.rs` / `lib.rs`) + frontend types (`src/types/schema.ts`) + IPC wrapper (`src/lib/tauri/ddl.ts`) + new modal (`CreateTableDialog.{tsx,test.tsx}`) + SchemaTree wiring (`useSchemaTreeActions.ts` + `dialogs.tsx` + `rows.tsx`) + entry-point test extension (`SchemaTree.actions.test.tsx`).
- 변경 금지: `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` / `useSafeModeGate*` / `ColumnsEditor*` / `IndexesEditor*` / `ConstraintsEditor*` / `schemaStore*` / `connectionStore*` / `src/lib/zustand-ipc-bridge.ts` / `src/lib/window-label.ts` / Mongo paths (`src/components/schema/DocumentDatabaseTree*` / `src-tauri/src/commands/document/`) / sibling `SchemaTree.*` test files (lifecycle / expand / refresh / search / highlight / preview / virtualization / rowcount / dbms-shape) / cross-window regression test / `main.tsx`.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (1-28 모두).
- Acceptance criteria evidence linked in `handoff.md` — AC-226-01..AC-226-05 each cited with concrete test/fixture evidence.
- **본 sprint 후 Phase 27 sprint 1 종료** — Sprint 227 (Drop Table CASCADE preview) / Sprint 228 (Phase 26 Trigger Read) / Sprint 229+ unblocked.
- TDD evidence (`red-state.log` 또는 red-state commit) recorded in `docs/sprints/sprint-226/tdd-evidence/`.
- e2e closure dependency: **none**. `lefthook.yml:5_e2e` stays disabled. Phase 27 e2e smoke deferred under `[DEFERRED-PHASE-27-E2E]` marker.
