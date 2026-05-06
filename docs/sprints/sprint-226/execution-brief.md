# Sprint Execution Brief: sprint-226

## Objective

Phase 27 sprint 1 — close the CREATE TABLE GUI parity gap. Add a `create_table` Tauri command (PG SQL builder + identifier validation + preview/execute branches in a transaction) and a `CreateTableDialog` modal that reuses Sprint 214's `useDdlPreviewExecution` hook + Sprint 189's `useSafeModeGate`. Wire the entry point through `SchemaTree`'s schema-row context menu (`Create Table…`) and refresh the schema's table list on commit-success via `refreshSchema(schemaName)` from `useSchemaTreeActions`. Single sprint covers AC-226-01..AC-226-05; verification profile `command` (vitest + tsc + lint + cargo test); e2e dead, **not** a closure dependency.

## Task Why

- **Phase 27 closure** — Today users can drop / rename / alter columns of existing tables, but cannot create a table from the GUI. This is a fundamental TablePlus-parity gap; sprint 226 is the first of 5 sprints that close Phase 27.
- **`useDdlPreviewExecution` reuse pattern** — Sprint 214 extracted the DDL preview/execute orchestration as the shared hook that `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` already consume. Sprint 226 validates the hook's reuse contract for a *new* surface (Create vs Alter) without modifying the hook body. If the contract holds, Sprint 229 (Trigger Write) and other future Create-* surfaces inherit the same shape.
- **Cross-window risk = none** — Schema cache is window-local; no `SYNCED_KEYS` extension, no IPC bridge change, no broadcast. This is why the e2e dead state is acceptable: there is no cross-window invariant for sprint-226 to violate (per lesson `e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant`).
- **Backend identifier-validator share** — `rename_table` already enforces the whitespace-trim / non-empty / no-embedded-`"` rule. Sprint 226 reuses this validator (no inline duplication) so the Phase 27 family stays consistent and a future regression in one site fixes all sites.
- **Modal pattern stability** — `ConnectionDialog` (Sprint 213) + `IndexesEditor` / `ConstraintsEditor` create dialogs already establish the shadcn `Dialog` + form-state-via-`useState` idiom. Sprint 226 follows that idiom verbatim — no anticipatory abstraction, no new visual primitives, no shared "DDL modal" base extraction (wait until 3+ Create-* modals exist).

## Scope Boundary

**In scope:**
- Backend: `CreateTableRequest` + `ColumnDefinition` payload, `RdbAdapter::create_table` trait method, PG impl (validation + ANSI quoting + preview/execute branches in tx), Tauri command + handler registration.
- Frontend: TS types, `tauri.createTable(req)` IPC wrapper, `CreateTableDialog.{tsx,test.tsx}` new modal + test, `useSchemaTreeActions` extension (`handleCreateTable` + `createTableDialog` state), `dialogs.tsx` modal mount, schema-row context-menu `"Create Table…"` item, `SchemaTree.actions.test.tsx` entry-point assertion.
- Mongo / DocumentAdapter `createCollection` (Phase 27 = PG-first).
- Sprint 227 candidate Drop CASCADE preview / typing-confirm UX.
- `SYNCED_KEYS` extension / IPC bridge / `attachZustandIpcBridge` modification.
- e2e restoration / Playwright spec authoring.
- Shared "DDL modal" base extraction.
- `useDdlPreviewExecution` / `useSafeModeGate` / `analyzeStatement` body changes (reuse only).
- `schemaStore` / `connectionStore` body changes.
- Sibling `SchemaTree.*` test files beyond `SchemaTree.actions.test.tsx`.
- Existing DDL surface (`ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` / `SqlPreviewDialog`) text-string changes.

## Invariants

- Existing DDL surface test suites pass without text-string changes — `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` / `useDdlPreviewExecution` / `SqlPreviewDialog` / `useSafeModeGate` / `SchemaTree` rename/drop.
- Schema cache stays window-local (no `SYNCED_KEYS` change, no broadcast).
- Safe Mode warn-cancel canonical message — `"Safe Mode (warn): confirmation cancelled — no changes committed"` byte-equivalent.
- `useQueryHistoryStore.addHistoryEntry` source = `"ddl-structure"` on commit-success.
- Identifier validation rule mirrors `rename_table` byte-for-byte; `AppError::Validation` text surfaces verbatim in `previewError`.
- Preview→commit IPC sequence is exactly `[{preview_only:true},{preview_only:false}]`.
- `git diff --stat src/components/structure/useDdlPreviewExecution.ts src/components/structure/SqlPreviewDialog.tsx` = 0 (Sprint 214 surfaces frozen).
- `git diff --stat src/stores/schemaStore.ts src/stores/connectionStore.ts` = 0 (no store mutation).
- No new `useEffect` / `setInterval` / `setTimeout` / `addEventListener` / `subscribe` in `CreateTableDialog` beyond the modal `Dialog` open/close pattern.
- Zero new `it.skip` / `describe.skip` / `it.todo` / `xit` / `this.skip()` / `it.only` in any touched test file.
- Zero new `eslint-disable*` lines.
- Zero new silent `catch {}` blocks (rejection paths surface error to user).
- Zero new `any` in TS, zero new `unwrap()` in production Rust paths.
- Mongo path untouched — `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` matches 0.

## Done Criteria

1. **AC-226-01 (backend command)** — `create_table` Tauri command accepts `CreateTableRequest`; `preview_only=true` returns `{ sql }` without execute; `preview_only=false` executes in transaction; identifier validation rejects whitespace-only / embedded-`"` / empty; Rust unit tests cover all 4 cases + handler registration verified by `grep -nE 'create_table\b' src-tauri/src/lib.rs ≥ 1`.
2. **AC-226-02 (SQL builder)** — Composite-PK fixture byte-equivalent to literal string; 1-col no-PK / NOT NULL+DEFAULT / empty-columns rejected / PK-undeclared rejected / embedded-space rejected — all covered by `cargo test --manifest-path src-tauri/Cargo.toml create_table`.
3. **AC-226-03 (modal form)** — `CreateTableDialog.test.tsx` covers: opens with one empty column row; `+ Column` adds row; `−` removes row but blocks the last one; PK multi-select reflects column names live; Preview SQL disabled until name + ≥ 1 valid column.
4. **AC-226-04 (preview/execute pipeline + Safe Mode)** — vitest asserts preview→commit sequence `[{preview_only:true},{preview_only:false}]`; commit-success records `useQueryHistoryStore` entry with `source:"ddl-structure"`; Safe Mode warn-cancel surfaces canonical message verbatim; `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0.
5. **AC-226-05 (entry-point + refresh)** — `SchemaTree.actions.test.tsx` asserts `"Create Table…"` menu item on schema row, click opens modal pre-filled with schema name, commit-success → `refreshSchema(schemaName)` called exactly once.

Verification 4-set (per `docs/PLAN.md:186`): `pnpm vitest run` + `pnpm tsc --noEmit` + `pnpm lint` + `cargo build --manifest-path src-tauri/Cargo.toml` all exit 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 28 checks (vitest 신규 + 회귀 + cargo test + cargo clippy + tsc + lint + grep freeze + sibling diff freeze).
- Required evidence:
  - 변경 파일 목록 + 각 LOC delta.
  - check 1-28 실행 결과 (exit code + 핵심 출력).
  - AC-226-01..AC-226-05 별 concrete evidence (test file:case:line, fixture string for composite-PK, IPC sequence trace, canonical Safe Mode message verbatim).
  - composite-PK fixture string included verbatim in handoff.
  - identifier-validator share decision (shared helper vs duplicated; if duplicated, justify).
  - Mongo path untouched proof.
  - TDD red-state evidence (`red-state.log` 또는 red-state commit message).
  - Optional manual UI smoke recorded in `docs/sprints/sprint-226/findings.md`.

## Evidence To Return

- Changed files and purpose: backend (`models/schema.rs` / `db/traits.rs` / `db/postgres/mutations.rs` / `commands/rdb/ddl.rs` / `lib.rs`) + frontend types + IPC wrapper + new modal + new modal test + SchemaTree wiring (`useSchemaTreeActions.ts` / `dialogs.tsx` / `rows.tsx`) + entry-point test extension.
- Checks run and outcomes: 28 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage: AC-226-01..05 별 concrete evidence with test file path + case name + assertion line.
- Composite-PK fixture string (verbatim).
- Preview→commit IPC sequence trace (vitest mock-call argument log).
- Safe Mode warn-cancel canonical message match.
- Assumptions made:
  - `ColumnDefinition` shape — Generator picks reuse-`ColumnChange::Add` vs new struct (justify).
  - identifier-validator share — shared helper preferred (Generator confirms or justifies duplication).
  - `useSchemaTreeActions` `createTableDialog` state shape — Generator picks discriminated union vs `{ open: bool, schemaName: string | null }`.
  - `dialogs.tsx` mount point — Generator confirms placement next to `DropTableConfirmDialog`.
  - PK multi-select primitive — Generator confirms reuse of constraint Primary Key checkbox-list pattern.
  - Schema-row menu item placement — Generator picks above/below existing rename/drop entries (justify in handoff).
- Residual risk / verification gaps:
  - **Manual UI smoke is optional** — without `pnpm tauri dev` confirmation, the modal's *visual* fidelity to existing `IndexesEditor`/`ConstraintsEditor` create dialogs is unverified by automation. Recommend at least one manual smoke run before close-out.
  - **No e2e** — Phase 27 closure does not include e2e coverage of the Create flow. Captured as `[DEFERRED-PHASE-27-E2E]` per lesson.
  - **PG-only** — Mongo `createCollection` is deferred; users on Mongo paradigm see no menu item. Acceptable per Phase scope.
  - **`ColumnDefinition` reuse vs new struct** — if Generator picks reuse of `ColumnChange::Add` and the shape later diverges (e.g., for ALTER TABLE column-add semantics), a future split may be needed. Document the choice + a "split if X" note in handoff.
  - **Identifier-validator share** — if the helper is not yet extracted (i.e., `rename_table` has it inline), Generator must extract it as part of sprint-226 *or* duplicate-with-tests; choose the share path unless the extraction blast radius exceeds 30 LOC outside the scoped files.
  - **Schema dropped concurrently between Preview and Execute** — backend surfaces PG error verbatim; modal stays open. No client-side guard added; acceptable per spec edge-case section.
  - **TDD red-state evidence** — must be captured before green commits; per `docs/PLAN.md:182-186`.

## References

- Contract: `docs/sprints/sprint-226/contract.md`
- Spec: `docs/sprints/sprint-226/spec.md`
- Findings: `docs/sprints/sprint-226/findings.md` (작성 예정)
- TDD evidence: `docs/sprints/sprint-226/tdd-evidence/red-state.log` (작성 예정)
- Sprint 214 (`useDdlPreviewExecution` source): `docs/sprints/sprint-214/{spec,contract,findings,handoff}.md`; hook file `src/components/structure/useDdlPreviewExecution.ts`.
- Sprint 213 (`ConnectionDialog` modal pattern source): `docs/sprints/sprint-213/{spec,contract,findings,handoff}.md`.
- Sprint 189 (`useSafeModeGate` + `analyzeStatement`): hook file `src/lib/safe-mode/*` (Generator confirms exact path).
- Sprint 219 (`useConnectionMutations` mock pattern source): `docs/sprints/sprint-219/{spec,contract}.md`.
- Sprint 223 (`useSchemaTableMutations` N-case migration mock pattern): `docs/sprints/sprint-223/{spec,contract}.md`.
- Sprint 224 (`useConnectionSessionHydration` two-export hook pattern): `docs/sprints/sprint-224/{contract,execution-brief}.md`.
- Relevant files:
  - `src-tauri/src/db/postgres/mutations.rs` (target — add `create_table` impl, ~+80 LOC)
  - `src-tauri/src/commands/rdb/ddl.rs` (target — add Tauri command, ~+20 LOC)
  - `src-tauri/src/lib.rs` (target — register handler, +1 LOC near `drop_table`/`rename_table`/`alter_table`)
  - `src-tauri/src/db/traits.rs` (target — add trait method, +~5 LOC)
  - `src-tauri/src/models/schema.rs` (target — add request payload, +~30 LOC)
  - `src/types/schema.ts` (target — TS mirror, +~20 LOC)
  - `src/lib/tauri/ddl.ts` (target — IPC wrapper, +~10 LOC)
  - `src/components/schema/CreateTableDialog.tsx` (new — modal, ~180-260 LOC)
  - `src/components/schema/CreateTableDialog.test.tsx` (new — vitest, ≥ 8 cases)
  - `src/components/schema/SchemaTree/useSchemaTreeActions.ts` (target — `handleCreateTable` + state)
  - `src/components/schema/SchemaTree/dialogs.tsx` (target — mount modal)
  - `src/components/schema/SchemaTree/rows.tsx` (target — context-menu item)
  - `src/components/schema/SchemaTree.actions.test.tsx` (target — entry-point assertion)
  - `src/components/structure/useDdlPreviewExecution.ts` (reuse, diff 0)
  - `src/components/structure/SqlPreviewDialog.tsx` (reuse, diff 0)
  - `src/components/structure/ColumnsEditor.tsx` (reference for column-row repeater idiom; diff 0)
  - `src/components/structure/ConstraintsEditor.tsx` (reference for PK checkbox-list pattern; diff 0)
- Phase context: `docs/PLAN.md` (Phase 27 parity scope + Verification 4-set + TDD evidence policy lines 182-186).
- Lesson: `e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant` (justifies e2e dead state for this sprint).
- 후속 sprints: Sprint 227 (Drop CASCADE preview) / Sprint 228 (Trigger Read) / Sprint 229 (Trigger Write) / Sprint 230 (Function CREATE/EDIT) / Phase 27 closure sprint.
