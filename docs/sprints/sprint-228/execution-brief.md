# Sprint Execution Brief: sprint-228

## Objective

Make the **Indexes tab** in `CreateTableDialog` functional. Replace the Sprint 227 placeholder body (`"Available in Sprint 228"`) with an interactive editor (`+ Index` / `−` row buttons + per-row index-name input + columns multi-select + type dropdown [`btree | hash | gin | gist`] + unique checkbox). After a successful CREATE TABLE the frontend chains `tauri.createIndex` calls **sequentially**, **one per declared index**, **each in its own transaction** (atomic policy C — DataGrip pattern). Index failures do **NOT** roll back the CREATE TABLE; already-applied indexes from earlier in the chain stay applied; the failing index name is surfaced in the inline preview pane error slot.

## Task Why

Sprint 227 (`docs/sprints/sprint-227/handoff.md:114-118`) ships the DataGrip-parity foundation: tabbed modal + schema picker + type combobox + per-column comment + inline DDL preview. The Indexes tab body is intentionally a placeholder so this sprint can plug in without further structural change. Sprint 228 closes the Indexes loop so users can declare table + comments + indexes from a single modal — matching DataGrip's "Import Table" reference workflow that motivated the redesign (user feedback 2026-05-06: "form이 너무 구리다 — type 자동완성, constraint/index 같이").

The chained approach (CREATE TABLE first, then CREATE INDEX × N) is the user-decided atomic policy C (`docs/sprints/sprint-227/findings.md:118-119`, 2026-05-06 decision). It mirrors DataGrip's behaviour: index failures do NOT abort the table.

## Scope Boundary

**In:**
- `src/components/schema/CreateTableDialog.tsx` — replace Indexes-tab placeholder body with editor; wire chained Execute closure.
- `src/components/schema/CreateTableDialog.test.tsx` — ≥ 8 new vitest cases under `describe("Sprint 228 — Indexes tab functional", …)`.
- (Optional) extract Indexes-tab body to `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` if `CreateTableDialog.tsx` grows above 700 LOC.
- `docs/PLAN.md` row 3 + `docs/sprints/sprint-228/{handoff,findings}.md` + `tdd-evidence/red-state.log`.
- (Optional) ≤ 2 new Rust unit fixtures in `src-tauri/src/db/postgres/mutations.rs#[cfg(test)] mod tests` for `gin` / `gist` byte-strings if missing strict byte-equality coverage today.

**Out (frozen — see contract Out of Scope + Invariants):**
- Foreign Keys editor (Sprint 229) — keep `"Available in Sprint 229"` placeholder.
- CHECK / UNIQUE table-level constraints (Sprint 229).
- Reorder ↑/↓ buttons (Sprint 230).
- Table-level `COMMENT ON TABLE` (Sprint 230).
- Type coloring on combobox (Sprint 230 polish).
- Schema picker position move (Sprint 230 polish).
- `brin` index type exposure in the UI (backend accepts but UI hides).
- MongoDB createCollection.
- New shadcn primitives — reuse `Select`, raw `<input type="checkbox">` (Keys-tab pattern), raw `<input>`.
- `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` / `connectionStore.ts` / `schemaStore.ts` / `tauri.createIndex` wrapper / `CreateIndexRequest` struct / `create_index` Tauri command / `create_index` Rust impl body — ALL freeze (existing impls already cover everything backend needs).

## Invariants

- `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0 (Sprint 214 freeze).
- `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0 (Sprint 227 freeze).
- `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
- `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` = 0 (Sprint 224 baseline).
- `git diff --stat src/lib/tauri/ddl.ts` = 0 (`tauri.createIndex` wrapper already exists at lines 43-47).
- `git diff --stat src/components/ui/` = 0 (no new shadcn primitive).
- `git diff src-tauri/src/models/schema.rs | grep -E "^[+-].*CreateIndexRequest"` = 0 lines (struct unchanged at lines 108-120).
- `git diff src-tauri/src/db/postgres/mutations.rs | grep -E "^[+-].*fn create_index"` = 0 lines (impl body unchanged at lines 401-461).
- `git diff src-tauri/src/commands/rdb/ddl.rs | grep -E "^[+-].*fn create_index"` = 0 lines (Tauri command unchanged at lines 75-85).
- Sprint 226 + 227 backend fixtures byte-equivalent — `composite_pk_byte_equivalent`, comment fixtures pass unmodified.
- 0-index IPC sequence byte-equivalent to Sprint 227: `[tauri.createTable({preview_only:true}), tauri.createTable({preview_only:false})]`.
- `grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` = 0 hits (placeholder removed).
- `grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` ≥ 1 hit (FK placeholder kept).
- No new `it.skip` / `eslint-disable` / `any` / silent `catch {}`.
- Modal-local `useState` only — no new Zustand store, no broadcast subscribers.
- Atomic policy C — CREATE TABLE + COMMENT ON in one transaction; CREATE INDEX in separate transactions; index failures do NOT roll back the table.

## Done Criteria

1. **AC-228-01** Indexes tab no longer placeholder; `"Available in Sprint 228"` removed from `CreateTableDialog.tsx`; tab panel contains editor inputs.
2. **AC-228-02** `+ Index` adds a row; `−` removes a row; 0-row state is the default empty.
3. **AC-228-03** Per-row inputs: index name (`<input>`, aria `"Index name"`); columns multi-select (multi-`<input type="checkbox">` group, derived live from declared column names; aria `"Index columns"`); type `<Select>` with exactly four options `btree | hash | gin | gist` (default `btree`, aria `"Index type"`); unique `<input type="checkbox">` (default false, aria `"Index unique"`). Renaming a column on Columns tab live-updates the index column checkbox label.
4. **AC-228-04** Show DDL fires 1× `tauri.createTable({preview_only:true})` + 1× `tauri.createIndex({preview_only:true})` per declared (non-PK-dedup) index; preview text contains both `CREATE TABLE` and `CREATE INDEX`; statements joined by `;\n`. Edit-invalidates-cache from Sprint 227 still works.
5. **AC-228-05** Execute IPC sequence: `[createTable(preview_only:true), createIndex(preview_only:true) × M, createTable(preview_only:false), createIndex(preview_only:false) × M]` — sequential (each `await`s the previous). On full success: 1 history entry (`source: "ddl-structure"`); `onRefresh()` once; `onClose()` once.
6. **AC-228-06** First `createIndex(preview_only:false)` rejects → 2nd not called; modal stays open; error in inline preview pane error slot contains failing index name (verbatim format: `Index "<index_name>" failed: <PG error>` or equivalent — index name MUST appear). CREATE TABLE NOT rolled back from frontend.
7. **AC-228-07** Second `createIndex(preview_only:false)` rejects after 1st succeeded → 1st stays applied (no `dropIndex` rollback); 3rd not called; error names 2nd's index.
8. **AC-228-08** PK dedup: when an Indexes-tab row's `columns` array exactly matches the PK array (same names, same order), no `tauri.createIndex` call AND the row's `CREATE INDEX` statement does not appear in the preview SQL. Inline note explains skip (`"Skipped — primary key is already indexed"` or equivalent verbatim). Mismatched ordering / partial overlap / different unique flag still emits.
9. **AC-228-09** 0-index regression: IPC sequence byte-equivalent to Sprint 227; `cargo test create_table_preview_three_column_composite_pk_byte_equivalent` exit 0 with no source diff.
10. **AC-228-10** No new shadcn primitive — `git diff --stat src/components/ui/` = 0.
11. **AC-228-11** ≥ 8 new vitest cases under Sprint 228 describe; coverage ≥ 70% line on the modified modal; Rust `create_index` test count ≥ 8 (current baseline).

## Verification Plan

- **Profile**: `mixed` (command + static).
- **Required checks** (numbered for harness check-runner; all exit 0 except where noted):
  1. `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` PASS, ≥ 31 cases (Sprint 227 baseline 23 + ≥ 8 new).
  2. `pnpm vitest run` PASS, file count ≥ Sprint 227 baseline (217 files).
  3. `pnpm tsc --noEmit` exit 0.
  4. `pnpm lint` exit 0.
  5. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` exit 0.
  7. `cargo test --manifest-path src-tauri/Cargo.toml create_table` PASS — Sprint 226 + 227 fixtures intact, no source diff.
  8. `cargo test --manifest-path src-tauri/Cargo.toml create_index` PASS — ≥ 8 fixtures (current baseline).
  9. `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0.
  10. `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0.
  11. `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
  12. `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` = 0.
  13. `git diff --stat src/lib/tauri/ddl.ts` = 0.
  14. `git diff --stat src/components/ui/` = 0.
  15. `grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` = 0 hits.
  16. `grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` ≥ 1 hit.
  17. `grep -nE 'CREATE INDEX' src-tauri/src/db/postgres/mutations.rs` ≥ 4 hits.
  18. `grep -n 'createIndex\|create_index' src-tauri/src/lib.rs` ≥ 1 hit (line 152).
  19. `grep -n 'createIndex' src/components/schema/CreateTableDialog.tsx` ≥ 1 hit.
  20. `grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` = 0 hits.
  21. `grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo' src/components/schema/CreateTableDialog.test.tsx` = 0.
  22. `git diff src/ src-tauri/ | grep "^+.*eslint-disable"` = 0.
  23. `git diff src/ | grep -E "^\+.*\bany\b"` = 0.
  24. `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` = 0 hits.
  25. Vitest case asserts 0-index IPC sequence byte-equivalent to Sprint 227.
  26. Vitest case asserts 1-index happy-path IPC sequence.
  27. Vitest case asserts index-failure-after-table chain abort + table stays.
  28. Vitest case asserts PK dedup (no `createIndex` + no `CREATE INDEX` in preview).
  29. Vitest case asserts multi-column index payload.
  30. Vitest case asserts unique flag forwards.
  31. Vitest case asserts four index types in dropdown.
  32. Vitest case asserts canonical Safe Mode warn-cancel message verbatim survives multi-statement bundle.
  33. (Optional) Manual UI smoke: `pnpm tauri dev` → CREATE TABLE with 1 unique btree + 1 gin index → both visible in `psql \di`. Document in `findings.md` if performed.

- **Required evidence**:
  - Changed files table (file → purpose → LOC delta).
  - Test counts (vitest before/after, cargo test before/after).
  - AC-228 coverage table (AC → vitest case name + line).
  - Verification check results (PASS/FAIL per numbered check).
  - Decision: columns multi-select implementation — multi-checkbox group (per contract Design Bar; chip is OUT).
  - Decision: failure-handling UX choice — verbatim error-message format string + which surface (inline preview pane is canonical; toast OPTIONAL).
  - Decision: Indexes-tab body extracted vs inlined — justify in handoff (700 LOC threshold).
  - Confirmation that `useDdlPreviewExecution` / `SqlPreviewDialog` / `tauri.createIndex` / `CreateIndexRequest` / `create_index` impl body diffs = 0.
  - Confirmation Sprint 226 + 227 fixture preservation (`cargo test create_table` + `composite_pk_byte_equivalent` no source diff).
  - Mongo path untouched proof (check 24).
  - TDD red-state evidence (`docs/sprints/sprint-228/tdd-evidence/red-state.log` or red-state commit message).
  - Manual UI smoke note if performed.
  - Assumptions made + residual risks.

## Evidence To Return

- Changed files table (file → purpose → LOC delta).
- Vitest before/after file + case counts; `cargo test create_table` and `create_index` before/after counts.
- AC-228-01..AC-228-11 coverage table (AC → vitest case name + assertion line).
- Verification 1-32 results (exit code + key output) + check 33 optional log.
- Decisions: columns multi-select (multi-checkbox confirmed), failure-handling UX text + surface, Indexes-tab body extraction or inline.
- Freeze diffs (use `git diff --stat`).
- Mongo path untouched proof.
- TDD red-state evidence path.
- Assumptions + residual risks.

## References

- **Contract**: `docs/sprints/sprint-228/contract.md`.
- **Sprint 227 spec** (Phase 27 master spec — covers Sprints 226-230 scope at lines 50-55): `docs/sprints/sprint-227/spec.md`.
- **Sprint 227 contract** (32 verification checks shape, freeze list pattern): `docs/sprints/sprint-227/contract.md`.
- **Sprint 227 handoff** (Sprint 228 instructions in §"다음 sprint 가 알아야 할 것" lines 114-118): `docs/sprints/sprint-227/handoff.md`.
- **Sprint 227 findings** (atomic policy C rationale at lines 118-119): `docs/sprints/sprint-227/findings.md`.
- **Sprint 226 handoff** (CREATE TABLE first cut, baseline byte-equivalent fixture): `docs/sprints/sprint-226/handoff.md`.
- **Sprint 214 hook reuse pattern**: `src/components/structure/useDdlPreviewExecution.ts` + `docs/sprints/sprint-214/handoff.md`.
- **Relevant files** (read before implementing):
  - `src/components/schema/CreateTableDialog.tsx` (Sprint 227 modal, lines 542-568 for current Indexes/FK placeholder).
  - `src/components/schema/CreateTableDialog.test.tsx` (existing 23 cases — Sprint 226 + 227 carry-overs at lines 154-665).
  - `src-tauri/src/db/postgres/mutations.rs:401-461` (existing `create_index` impl — DO NOT modify body; lines 1000-1162 contain the 8 existing `create_index` fixtures).
  - `src-tauri/src/models/schema.rs:108-120` (`CreateIndexRequest` struct — DO NOT modify).
  - `src-tauri/src/commands/rdb/ddl.rs:75-85` (`create_index` Tauri command — DO NOT modify).
  - `src-tauri/src/lib.rs:152` (Tauri command registration — DO NOT modify).
  - `src/lib/tauri/ddl.ts:43-47` (`tauri.createIndex` wrapper — DO NOT modify).
  - `src/components/structure/useDdlPreviewExecution.ts` (hook — DO NOT modify; the chain runs inside the `prepareCommit` factory closure).
  - `src/types/schema.ts` (`CreateIndexRequest` TS type — verify shape; DO NOT modify).
  - `.claude/rules/test-scenarios.md` (catch-block + reject-case test rule — apply to chain failure tests).
  - `.claude/rules/git-policy.md` (no `--no-verify`, no `LEFTHOOK=0`).

## Pre-flight notes for the Generator

1. **Backend already exists.** Do not re-implement `create_index`. Verify with `grep -n create_index src-tauri/src/db/postgres/mutations.rs` (≥ 1 impl + 8 fixtures expected).
2. **The chain runs inside `useDdlPreviewExecution.loadPreview`'s `prepareCommit` factory.** The factory returns a closure. That closure is what the hook calls on Execute. Its body is roughly:
   ```ts
   () => async () => {
     await tauri.createTable(buildCreateRequest(false));
     for (const idx of declaredIndexesAfterPkDedup) {
       try {
         await tauri.createIndex(buildIndexRequest(idx, false));
       } catch (e) {
         throw new Error(`Index "${idx.name}" failed: ${String(e)}`);
       }
     }
   }
   ```
   The hook's catch sets `previewError` from the thrown message — which already contains the failing index's name.
3. **Show DDL fans out N+1 calls in parallel? No — sequential.** The preview phase MAY parallelize the N `tauri.createIndex({preview_only:true})` calls since they are read-only SQL builders, but the order in which their resulting strings are joined into the preview SQL must match the row order. The Execute phase MUST be sequential (one `createIndex` resolves before the next starts) — the user-facing "first-failure-aborts-rest" semantics depend on it.
4. **PK dedup is a frontend-only concern.** The backend has no awareness of which CREATE INDEX corresponds to which PK; the frontend simply skips the index-builder call and the index-execute call when the row matches.
5. **Failure surface text** — pick a verbatim format and stick with it across the inline pane error slot AND any optional toast. The test asserts the failing index name appears verbatim somewhere in the user-facing surface — not the exact wrapper string. Generator's call on the wrapper, but document it in `findings.md`.
6. **Sprint 226 + 227 carry-over tests should pass with NO assertion-text changes.** If a Sprint 227 test starts failing because of the new Indexes editor, fix the editor — not the assertion. Mechanical query selector changes are allowed (e.g. scoping to `within(columnsTabPanel)`) but assertion text strings are frozen.
7. **No `it.skip`, no `--no-verify`** — see `.claude/rules/git-policy.md`. Hook failures must be fixed at the root (`cargo fmt`, `pnpm lint --fix`, etc.).
