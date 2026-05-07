# Sprint Execution Brief: sprint-229

## Objective

Make the **Foreign Keys tab** in `CreateTableDialog` functional. Replace the Sprint 228 placeholder body (`"Available in Sprint 229"`) with an interactive editor that houses **three constraint families in a single tab**: Foreign Keys (per-row name + local columns + reference schema + reference table + reference columns + ON DELETE + ON UPDATE), CHECK constraints (name + free-text expression), and table-level UNIQUE constraints (name + columns multi-select). After a successful CREATE TABLE the frontend chains `tauri.addConstraint` calls **sequentially**, **one per declared constraint**, **each in its own transaction**, **after** the Sprint 228 `tauri.createIndex` chain. Same partial-atomic policy C as Sprint 228 — constraint failures do **NOT** roll back the CREATE TABLE or earlier-applied indexes/constraints; the failing constraint name surfaces verbatim in the inline preview pane error slot.

Path A backend extension lands: `ConstraintDefinition::ForeignKey` gains `#[serde(default)] on_delete: Option<String>` + `on_update: Option<String>` with whitelist `{NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT}`. Existing `add_constraint_preview_foreign_key` SQL byte-string assertion stays unchanged; only the struct literal in that fixture body adds 2 field initializers (Rust syntax requirement).

## Task Why

Sprint 228 (`docs/sprints/sprint-228/handoff.md` "다음 sprint" §"Sprint 229 (Foreign Keys + Constraints tab)") closed the Indexes loop and explicitly handed off the FK + CHECK + UNIQUE work to Sprint 229. Sprint 227 spec line 53 + the 2026-05-06 user feedback ("form이 너무 구리다 — type 자동완성, constraint/index 같이") motivated the DataGrip-parity redesign; Sprint 229 closes the constraint loop so users can declare table + comments + indexes + FKs + CHECKs + UNIQUEs from a single modal.

The chained approach (CREATE TABLE first, then CREATE INDEX × M, then ADD CONSTRAINT × K) is the user-decided atomic policy C (`docs/sprints/sprint-227/findings.md:118-119`, 2026-05-06 decision; reaffirmed in Sprint 228 findings). It mirrors DataGrip: index/constraint failures do NOT abort the table.

Path A (backend extension for ON DELETE/UPDATE) was selected at contract time over deferring to Sprint 230 because (a) ON DELETE / ON UPDATE is the most-asked FK feature, (b) backend extension is ≤ +30 LOC of additive Rust isolated to the FK match arm, (c) `#[serde(default)]` keeps Sprint 228 byte-equivalent.

## Scope Boundary

**In:**
- `src/components/schema/CreateTableDialog.tsx` — replace FK tab placeholder body with `<ForeignKeysTabBody …>`; add 3 draft state arrays + 9 mutator handlers + chain closure extension.
- `src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx` — **new, mandatory** (parent already near 700 LOC after Sprint 228; 3 sub-section bodies would push over). ~280 LOC. Pure presentational.
- `src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx` — new, ~150 LOC, ≥ 5 cases, ≥ 70% line coverage.
- `src/components/schema/CreateTableDialog.test.tsx` — ≥ 9 new vitest cases under `describe("Sprint 229 — Foreign Keys + CHECK + UNIQUE tab functional", …)`.
- `src/types/schema.ts` — additive `on_delete?: string | null` + `on_update?: string | null` on the `foreign_key` arm of `ConstraintDefinition`.
- `src-tauri/src/models/schema.rs` — additive `#[serde(default)] pub on_delete: Option<String>` + `pub on_update: Option<String>` on the `ConstraintDefinition::ForeignKey` enum arm.
- `src-tauri/src/db/postgres/mutations.rs::add_constraint` — additive validation + emitter inside the FK match arm only; non-FK arms byte-equivalent.
- `src-tauri/src/db/postgres/mutations.rs#[cfg(test)] mod tests` — 3 new fixtures (`add_constraint_preview_foreign_key_on_delete_cascade`, `add_constraint_preview_foreign_key_on_update_set_null_with_on_delete_restrict`, `add_constraint_preview_foreign_key_invalid_on_delete_fails`) + 2-line struct-literal addition on the existing `add_constraint_preview_foreign_key` (Rust syntax requirement; emitted SQL assertion stays byte-equivalent).
- `docs/PLAN.md` row 4 + `docs/sprints/sprint-229/{handoff,findings}.md` + `tdd-evidence/red-state.log`.

**Out (frozen — see contract Out of Scope + Invariants):**
- Reorder ↑/↓ buttons (Sprint 230).
- Table-level `COMMENT ON TABLE` (Sprint 230).
- Type coloring on combobox (Sprint 230 polish).
- Schema picker position move (Sprint 230 polish).
- DEFERRABLE / INITIALLY DEFERRED / MATCH FULL / MATCH PARTIAL — UI does not expose, backend does not support.
- SQL syntax highlighting for CHECK expression body — Sprint 230 candidate.
- MongoDB createCollection.
- New shadcn primitives — reuse `Select`, raw `<input type="checkbox">`, raw `<input type="text">`.
- `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` / `connectionStore.ts` / `schemaStore.ts` / `tauri.addConstraint` wrapper / `IndexesTabBody.tsx` / `Header.tsx` (additive-only if scope demands) / `CreateTableTypeCombobox.tsx` / `AddConstraintRequest` body / `commands/rdb/ddl.rs::add_constraint` — ALL freeze (existing impls already cover).

## Invariants

- `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0 (Sprint 214 freeze).
- `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0 (Sprint 227 freeze).
- `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
- `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` = 0 (Sprint 224 baseline).
- `git diff --stat src/lib/tauri/ddl.ts` = 0 (`tauri.addConstraint` wrapper exists at lines 55-58).
- `git diff --stat src/components/ui/` = 0 (no new shadcn primitive).
- `git diff --stat src/components/schema/CreateTableDialog/IndexesTabBody.tsx` = 0 (Sprint 228 freeze).
- `git diff --stat src/components/schema/CreateTableDialog/Header.tsx` = 0 OR additive-only (no behaviour change to existing usage).
- `git diff --stat src/components/schema/CreateTableTypeCombobox.tsx` = 0 (Sprint 227 freeze).
- Sprint 226+227+228 backend fixtures byte-equivalent (modulo the 2-line struct-literal addition on `add_constraint_preview_foreign_key` for `on_delete: None, on_update: None` Rust syntax — the emitted SQL string assertion stays byte-equivalent).
- 0-constraint IPC sequence byte-equivalent to Sprint 228: `[createTable(true), createIndex(true) × M, createTable(false), createIndex(false) × M]`.
- `grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` = 0 hits (placeholder removed).
- `grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` = 0 hits (Sprint 228 removal must NOT regress).
- No new `it.skip` / `eslint-disable` / `any` / silent `catch {}`.
- Modal-local `useState` only — no new Zustand store. Reference table picker reads `useSchemaStore` via `getState()` and may call `loadTables` on demand (existing API surface).
- Atomic policy C — CREATE TABLE + COMMENT ON in one transaction; CREATE INDEX × M (Sprint 228) + ADD CONSTRAINT × K (Sprint 229) sequential, each in its own transaction, after CREATE TABLE returns; failures do NOT roll back the table or earlier-applied indexes/constraints.

## Done Criteria

1. **AC-229-01** FK tab no longer placeholder; `"Available in Sprint 229"` removed from `CreateTableDialog.tsx`; tab panel contains editor with 3 sub-section labels (Foreign Keys / CHECK constraints / Unique constraints).
2. **AC-229-02** Per FK row inputs render: name, local columns multi-checkbox (live-derived from declared column names), reference schema `<Select>`, reference table `<Select>` (cached + fallback), reference columns multi-checkbox, ON DELETE `<Select>` (5 options), ON UPDATE `<Select>` (5 options), `+ Foreign Key` / `−` row buttons. 0-row default.
3. **AC-229-03** Composite FK works — preview SQL substring `FOREIGN KEY ("a","b") REFERENCES "T" ("x","y")` rendered verbatim.
4. **AC-229-04** CHECK row renders name + expression `<input type="text">` + `+ CHECK` / `−` row buttons; preview substring `ADD CONSTRAINT "<name>" CHECK (<expression>)`.
5. **AC-229-05** Table-level UNIQUE row renders name + columns multi-checkbox + `+ Unique` / `−` row buttons; preview substring `ADD CONSTRAINT "<name>" UNIQUE ("col1","col2",...)`.
6. **AC-229-06** Inline DDL preview shows multi-statement bundle: CREATE TABLE + COMMENT ON × N + CREATE INDEX × M + ALTER TABLE ADD CONSTRAINT × K (FK + CHECK + UNIQUE) joined by `;\n`. Edit-invalidates-cache from Sprint 227+228 still works.
7. **AC-229-07** Execute IPC sequence: `[createTable(true), createIndex(true) × M, addConstraint(true) × K, createTable(false), createIndex(false) × M, addConstraint(false) × K]` — sequential. On full success: 1 history entry (`source: "ddl-structure"`); `onRefresh()` once; `onClose()` once.
8. **AC-229-08** Constraint failure mid-chain → 2nd `addConstraint(preview_only:false)` rejects → 3rd not called; modal stays open; error in inline preview pane error slot contains failing constraint name (verbatim format: `Constraint "<name>" failed: <PG error>` or equivalent — name MUST appear). CREATE TABLE + earlier indexes/constraints NOT rolled back.
9. **AC-229-09** Reference table picker populates from `useSchemaStore.getState().tables[<conn>:<refSchema>]` cache; lazy `loadTables(connectionId, refSchema)` triggers on cache miss (existing store API; store body unchanged); reference columns lazy-fetched via `getTableColumns`. Graceful fallback to free-text inputs when fetch fails.
10. **AC-229-10** 0-constraint regression: IPC sequence byte-equivalent to Sprint 228; `cargo test create_table create_index add_constraint` exit 0 with at most the 2-line struct-literal addition on `add_constraint_preview_foreign_key` (emitted SQL assertion unchanged).
11. **AC-229-11** No new shadcn primitive — `git diff --stat src/components/ui/` = 0.
12. **AC-229-12** ≥ 9 new vitest cases under Sprint 229 describe block in `CreateTableDialog.test.tsx`; ≥ 5 in new `ForeignKeysTabBody.test.tsx`; coverage ≥ 70% line on the modified modal + new sub-component; Rust `add_constraint` test count ≥ 12 (9 baseline + 3 new for ON DELETE/UPDATE).

## Verification Plan

- **Profile**: `mixed` (command + static).
- **Required checks** (numbered for harness check-runner; all exit 0 except where noted):
  1. `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` PASS, ≥ 47 cases (Sprint 228 baseline 38 + ≥ 9 new).
  2. `pnpm vitest run src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx` PASS, ≥ 5 cases.
  3. `pnpm vitest run` PASS, file count ≥ 219 (Sprint 228 baseline 218 + 1 new).
  4. `pnpm tsc --noEmit` exit 0.
  5. `pnpm lint` exit 0.
  6. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
  7. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` exit 0.
  8. `cargo test --manifest-path src-tauri/Cargo.toml create_table` PASS — Sprint 226+227 fixtures intact, no source diff.
  9. `cargo test --manifest-path src-tauri/Cargo.toml create_index` PASS — Sprint 228 fixtures intact, no source diff.
  10. `cargo test --manifest-path src-tauri/Cargo.toml add_constraint` PASS — ≥ 12 fixtures (9 baseline + 3 new). Existing 9 pass with at most a 2-line struct-literal addition on `add_constraint_preview_foreign_key` (emitted SQL assertion at line 1325 unchanged).
  11. `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0.
  12. `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0.
  13. `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
  14. `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` = 0.
  15. `git diff --stat src/lib/tauri/ddl.ts` = 0.
  16. `git diff --stat src/components/ui/` = 0.
  17. `git diff --stat src/components/schema/CreateTableTypeCombobox.tsx` = 0.
  18. `git diff --stat src/components/schema/CreateTableDialog/Header.tsx` = 0 OR additive-only.
  19. `git diff --stat src/components/schema/CreateTableDialog/IndexesTabBody.tsx` = 0.
  20. `grep -n '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` = 0 hits.
  21. `grep -n '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` = 0 hits (Sprint 228 removal must not regress).
  22. `grep -n 'addConstraint' src/components/schema/CreateTableDialog.tsx` ≥ 1 hit.
  23. `grep -nE 'addConstraint|add_constraint' src-tauri/src/lib.rs` ≥ 1 hit (line 154 registration intact).
  24. `grep -nE 'FOREIGN KEY|REFERENCES' src-tauri/src/db/postgres/mutations.rs` ≥ 2 hits.
  25. `grep -nE 'ON DELETE|ON UPDATE' src-tauri/src/db/postgres/mutations.rs` ≥ 2 hits (Path A new emitter + new fixture byte-strings).
  26. `grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` = 0 hits.
  27. `grep -nE 'it\.only|it\.skip|describe\.skip|xit|it\.todo' src/components/schema/CreateTableDialog.test.tsx src/components/schema/CreateTableDialog/ForeignKeysTabBody.test.tsx` = 0.
  28. `git diff src/ src-tauri/ | grep "^+.*eslint-disable"` = 0.
  29. `git diff src/ | grep -E "^\+.*\bany\b"` = 0.
  30. `grep -rnE 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` = 0 hits.
  31. Vitest case asserts 0-constraint IPC sequence byte-equivalent to Sprint 228.
  32. Vitest case asserts happy-path IPC sequence with 1 FK + 1 CHECK + 1 UNIQUE + 0 indexes.
  33. Vitest case asserts composite FK preview substring (`FOREIGN KEY ("a","b") REFERENCES "T" ("x","y")`).
  34. Vitest case asserts CHECK preview substring (`ADD CONSTRAINT "<name>" CHECK (<expression>)`).
  35. Vitest case asserts table-level UNIQUE preview substring.
  36. Vitest case asserts constraint-failure-mid-chain abort + table+earlier-constraints stay applied + name surfaces verbatim.
  37. Vitest case asserts reference table picker populates from `useSchemaStore.tables` cache + triggers `loadTables` on cache miss.
  38. Vitest case asserts canonical Safe Mode warn-cancel message verbatim survives multi-statement bundle.
  39. (Optional) Manual UI smoke: `pnpm tauri dev` → CREATE TABLE with 1 FK (ON DELETE CASCADE) + 1 CHECK + 1 UNIQUE → all 3 visible in `psql \d <table>`. Document in `findings.md` if performed.

- **Required evidence**:
  - Changed files table (file → purpose → LOC delta).
  - Test counts (vitest before/after, cargo test before/after).
  - AC-229 coverage table (AC → vitest case name + line).
  - Verification check results (PASS/FAIL per numbered check).
  - Decision: tab layout = single FK tab with 3 sub-sections (locked by contract; confirm compliance).
  - Decision: reference table picker source = `useSchemaStore.tables[<conn>:<refSchema>]` (locked; confirm wiring).
  - Decision: constraint name auto-suggest format strings (`fk_<table>_<cols>` / `chk_<table>_<n>` / `uq_<table>_<cols>`).
  - Decision: failure-handling UX surface + verbatim error-message format string.
  - Decision: chain order across families (`[FKs, CHECKs, UNIQUEs]` vs `[FKs, UNIQUEs, CHECKs]`).
  - Decision: Path A backend extension landed (struct fields + emitter + 3 fixtures + 2-line struct-literal addition).
  - Confirmation that `useDdlPreviewExecution` / `SqlPreviewDialog` / `tauri.addConstraint` / `IndexesTabBody` / `Header` / `CreateTableTypeCombobox` / `AddConstraintRequest` body / `commands/rdb/ddl.rs::add_constraint` diffs = 0.
  - Confirmation Sprint 226+227+228 fixture preservation (`cargo test create_table create_index add_constraint` PASS; `composite_pk_byte_equivalent` + comment + `create_index_preview_*` fixture bodies untouched; `add_constraint_preview_foreign_key` SQL assertion unchanged).
  - Mongo path untouched proof (check 30).
  - TDD red-state evidence (`docs/sprints/sprint-229/tdd-evidence/red-state.log` or red-state commit message).
  - Manual UI smoke note if performed.
  - Assumptions made + residual risks.

## Evidence To Return

- Changed files table (file → purpose → LOC delta).
- Vitest before/after file + case counts; `cargo test create_table create_index add_constraint` before/after counts.
- AC-229-01..AC-229-12 coverage table (AC → vitest case name + assertion line).
- Verification 1-38 results (exit code + key output) + check 39 optional log.
- Decisions: tab layout, reference table picker source, name auto-suggest format, failure-UX text + surface, chain order, Path A backend extension scope.
- Freeze diffs (use `git diff --stat`).
- Mongo path untouched proof.
- TDD red-state evidence path.
- Assumptions + residual risks.

## References

- **Contract**: `docs/sprints/sprint-229/contract.md`.
- **Sprint 228 contract** (32 verification checks shape, freeze list pattern, partial-atomic policy C precedent): `docs/sprints/sprint-228/contract.md`.
- **Sprint 228 handoff** (Sprint 229 instructions in §"다음 sprint 가 알아야 할 것" → "Sprint 229 (Foreign Keys + Constraints tab)"): `docs/sprints/sprint-228/handoff.md`.
- **Sprint 228 findings** (chain shape rationale; reference column picker pattern hint): `docs/sprints/sprint-228/findings.md`.
- **Sprint 227 spec** (Phase 27 master spec line 53 — Sprint 229 scope statement): `docs/sprints/sprint-227/spec.md`.
- **Sprint 227 contract** (freeze list pattern): `docs/sprints/sprint-227/contract.md`.
- **Sprint 227 findings** (atomic policy C rationale at lines 118-119): `docs/sprints/sprint-227/findings.md`.
- **Sprint 226 handoff** (CREATE TABLE first cut, baseline byte-equivalent fixture): `docs/sprints/sprint-226/handoff.md`.
- **Sprint 214 hook reuse pattern**: `src/components/structure/useDdlPreviewExecution.ts` + `docs/sprints/sprint-214/handoff.md`.
- **Relevant files** (read before implementing):
  - `src/components/schema/CreateTableDialog.tsx` (Sprint 228 modal at 793 LOC; FK placeholder at lines 689-701).
  - `src/components/schema/CreateTableDialog.test.tsx` (existing 38 cases — Sprint 226+227+228 carry-overs).
  - `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` (Sprint 228 extracted body at 224 LOC — pattern reference for `ForeignKeysTabBody.tsx`).
  - `src-tauri/src/db/postgres/mutations.rs:495-595` (existing `add_constraint` impl — extend FK arm only; lines 1283-1444 contain the 9 existing add_constraint+drop_constraint fixtures; Sprint 228 byte-string at 1306-1327 stays).
  - `src-tauri/src/models/schema.rs:135-164` (`ConstraintDefinition` enum + `AddConstraintRequest` struct — extend `ForeignKey` arm only with 2 `#[serde(default)]` fields).
  - `src-tauri/src/commands/rdb/ddl.rs:99-110` (`add_constraint` Tauri command — DO NOT modify).
  - `src-tauri/src/lib.rs:154` (Tauri command registration — DO NOT modify).
  - `src/lib/tauri/ddl.ts:55-58` (`tauri.addConstraint` wrapper — DO NOT modify).
  - `src/types/schema.ts` (`ConstraintDefinition` TS discriminated union — extend `foreign_key` arm only with 2 optional fields).
  - `src/stores/schemaStore.ts:18` (`tables: Record<string, TableInfo[]>`) + `:178-190` (`loadTables`) + `:216-224` (`getTableColumns`) — read-only consumption; store body unchanged.
  - `src/components/structure/useDdlPreviewExecution.ts` (hook — DO NOT modify; chain runs inside the `prepareCommit` factory closure).
  - `.claude/rules/test-scenarios.md` (catch-block + reject-case test rule — apply to chain failure tests).
  - `.claude/rules/git-policy.md` (no `--no-verify`, no `LEFTHOOK=0`).
  - `.claude/rules/react-conventions.md` (no `any`; multi-checkbox group pattern).
  - `.claude/rules/rust-conventions.md` (no `unwrap()` outside tests; thiserror `AppError::Validation` for whitelist rejection).
  - `.claude/rules/testing.md` (Vitest + RTL by role/text; ≥ 70% line coverage on new code).

## Pre-flight notes for the Generator

1. **Backend `add_constraint` already exists.** Do NOT re-implement. Verify with `grep -n add_constraint src-tauri/src/db/postgres/mutations.rs` (≥ 1 impl + 9 fixtures expected). The Path A extension is FK-arm-only — non-FK match arms (PrimaryKey / Unique / Check) stay byte-equivalent.
2. **Path A backend extension scope**:
   - Add 2 fields to `ConstraintDefinition::ForeignKey { … }` enum arm in `src-tauri/src/models/schema.rs` with `#[serde(default)]`. Field type: `Option<String>`.
   - Inside `add_constraint`'s FK match arm, after the existing `format!("FOREIGN KEY ({}) REFERENCES {} ({})", …)` line, append `ON DELETE <action>` / `ON UPDATE <action>` only when `Some(action)` AND action matches the closed whitelist `{"NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"}` (case-sensitive uppercase, PG canonical form). Whitelist rejection → `AppError::Validation("Invalid ON DELETE action: <value>")`.
   - Existing fixture `add_constraint_preview_foreign_key` at lines 1306-1327 — the **emitted SQL assertion at line 1325** stays byte-equivalent (`ALTER TABLE "public"."orders" ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id")` — no trailing ON-clauses because both new fields default to `None`). The struct literal at lines 1314-1318 must add `on_delete: None, on_update: None` field initializers — Rust syntax requires complete field listings even with `#[serde(default)]` (which only affects serde, not Rust struct construction). This is the **single allowed mechanical 2-line diff** on existing fixtures.
3. **The chain runs inside `useDdlPreviewExecution.loadPreview`'s `prepareCommit` factory** — append a third loop after the Sprint 228 indexes loop:
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
   The hook's catch sets `previewError` from the thrown message — which already contains the failing constraint's name.
4. **Tab layout — single Foreign Keys tab with 3 sub-sections (locked).** Inside the FK tab body, render three labeled sub-areas: "Foreign Keys" (with `+ Foreign Key` button + FK row stack), "CHECK constraints" (with `+ CHECK` button + CHECK row stack), "Unique constraints" (with `+ Unique` button + UNIQUE row stack). Each sub-section's empty state is the dashed-border "No <name> declared. Click '+ <button>' to add one." pattern from Sprint 228 `IndexesTabBody.tsx:103-110`.
5. **Reference table picker** — read `useSchemaStore.getState().tables[<conn>:<refSchema>]`. If empty, call `useSchemaStore.getState().loadTables(connectionId, refSchema)` once on ref-schema change. Track `loading` per row to disable the table dropdown until the load resolves. Reference columns lazy-fetched via `useSchemaStore.getState().getTableColumns(connectionId, refTable, refSchema)` on ref-table change. Graceful free-text fallback when the fetch fails (network error / connection offline).
6. **Constraint name auto-suggest** — placeholder text only; user can override by typing. Reactive: re-derives when columns / table name change. Format:
   - FK: `fk_<table>_<col1>_<col2>...` (underscore-joined; e.g. `fk_orders_user_id`).
   - CHECK: `chk_<table>_<n>` (1-based row index; e.g. `chk_orders_1`).
   - UNIQUE: `uq_<table>_<col1>_<col2>...` (e.g. `uq_users_email`).
6.5. **Order of constraints in the chain** — within the ADD-CONSTRAINT batch, declared order is `[...validatedFks, ...validatedChecks, ...validatedUniques]` (Generator MAY reorder to `[FKs, UNIQUEs, CHECKs]` if there's a strong reason — document the choice and stay byte-stable across preview and execute).
7. **Failure surface text** — pick the verbatim wrapper format `Constraint "<name>" failed: <PG error>` and stick with it across the inline pane error slot AND any optional toast. The test asserts the failing constraint name appears verbatim somewhere in the user-facing surface — not the exact wrapper string. Generator's call on the wrapper, but document it in `findings.md`.
8. **Sprint 226+227+228 carry-over tests should pass with NO assertion-text changes EXCEPT the one Sprint 229-superseded flip** (Foreign Keys placeholder presence test — flips inverse). Mechanical query selector changes are allowed but assertion text strings are otherwise frozen byte-for-byte.
9. **No `it.skip`, no `--no-verify`** — see `.claude/rules/git-policy.md`. Hook failures must be fixed at the root (`cargo fmt`, `pnpm lint --fix`, etc.).
10. **CHECK expression is single-line `<input type="text">`**, not `<textarea>`. Multi-line + syntax highlighting is Sprint 230+ scope.
11. **ON DELETE / ON UPDATE default value** — pick `NO ACTION` (matches PG default) OR `null`-omitted (which serializes as undefined → backend's `#[serde(default)]` resolves to `None` → emitter omits the clause → PG defaults to `NO ACTION`). Generator picks one and documents in findings; both behave identically at PG.
12. **No FK self-reference fast-path** — atomic policy C handles this naturally. The CREATE TABLE creates the table first; subsequent ALTER TABLE ADD CONSTRAINT runs on the existing table. PG accepts FK from a table to itself when the table exists.
