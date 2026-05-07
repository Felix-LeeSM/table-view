# Sprint 228 Evaluator Scorecard

Date: 2026-05-07
Evaluator: harness Evaluator agent
Phase: 27 sprint 3 — Indexes tab functional

## Verdict: **PASS**

## Per-Dimension Scores (System rubric)

| Dimension | Score | Reasoning |
|-----------|-------|-----------|
| **Correctness** (35%) | **9/10** | Indexes tab is fully interactive; chain logic in `CreateTableDialog.tsx:378-432` cleanly threads `tauri.createTable(commit)` → sequential `for-await tauri.createIndex` with per-iteration try/catch re-throwing as `Index "<name>" failed: <pg error>` (line 425-427). PK dedup `indexMatchesPk` (line 114-121) runs in `declaredIndexesForChain` memo (line 355-362) — used by both preview fan-out (line 401) AND commit loop (line 416), so dedup is consistent across both paths. All 11 ACs covered with concrete vitest evidence. |
| **Completeness** (25%) | **9/10** | All 11 ACs implemented + tested. 13 new vitest cases land under `describe("Sprint 228 — Indexes tab functional")` (CreateTableDialog.test.tsx:716). Optional ≤2 Rust fixtures exercised (`create_index_preview_gin_byte_equivalent` + `gist` companion at mutations.rs:1077-1118) — bringing baseline 8 → 11 (handoff says 11). Backend `create_index` impl body diff = 0; only `#[cfg(test)] mod tests` grew. `CreateIndexRequest` struct + `tauri.createIndex` wrapper + Tauri command unchanged. PK dedup inline note "Skipped — primary key is already indexed" present at IndexesTabBody.tsx:204. |
| **Reliability** (20%) | **9/10** | All 7 freeze invariants pass `git diff --stat = 0`: useDdlPreviewExecution.ts, SqlPreviewDialog.tsx, cross-window-*, window-lifecycle.ac141, connectionStore.ts, schemaStore.ts, ddl.ts, src/components/ui/. `composite_pk_byte_equivalent` Rust fixture passes unchanged. 0-index IPC sequence byte-equivalent to Sprint 227 (vitest case at line 1207 asserts `mockCreateIndex.not.toHaveBeenCalled()` after preview+commit). Mongo path untouched (grep = 0). Atomic policy C correctly implemented — no `dropIndex` rollback path. Modal-local `useState` only; no new store, no new IPC. |
| **Verification Quality** (20%) | **8/10** | TDD red-state log captures 13 failing cases before green (red-state.log:24-53). Tests assert behaviour, not implementation: IPC mock-call sequence verified via `mock.calls` array; sequential ordering verified via `inflight/maxConcurrent <= 1` at test line 902-908; `mockDropIndex.not.toHaveBeenCalled()` for AC-228-07 rollback non-occurrence; preview pane DOM textContent assertions for failing-index name visibility. Rebuilt AC-227-01 placeholder-presence carry-over (test line 469-486) is justified in findings.md §2 (placeholder explicitly superseded by AC-228-01). Manual UI smoke not performed (acknowledged residual risk; same status as Sprint 227). |
| **Overall** | **8.75/10** | |

## Independent Verification Results (32 contract checks)

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` | **PASS** — 38/38 (3.29s) |
| 2 | `pnpm vitest run` (full suite) | **PASS** — 217 files / 2795 tests / 39.49s |
| 3 | `pnpm tsc --noEmit` | **PASS** — exit 0 |
| 4 | `pnpm lint` | **PASS** — exit 0 |
| 5 | `cargo build --manifest-path src-tauri/Cargo.toml` | **PASS** — exit 0 |
| 6 | `cargo clippy --all-targets --all-features -- -D warnings` | **PASS** — exit 0 |
| 7 | `cargo test create_table` | **PASS** — 16 unit + 1 integration; `composite_pk_byte_equivalent` ok |
| 8 | `cargo test create_index` | **PASS** — 11 unit fixtures (baseline 8 + 2 new gin/gist + 1 serde roundtrip) |
| 9 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | **= 0** |
| 10 | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | **= 0** |
| 11 | `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | **= 0** |
| 12 | `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` | **= 0** |
| 13 | `git diff --stat src/lib/tauri/ddl.ts` | **= 0** |
| 14 | `git diff --stat src/components/ui/` | **= 0** |
| 15 | `grep '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` | **= 0 hits** |
| 16 | `grep '"Available in Sprint 229"' src/components/schema/CreateTableDialog.tsx` | **= 1 hit** (line 702) |
| 17 | `grep -E 'CREATE INDEX' src-tauri/src/db/postgres/mutations.rs` | **= 4 hits** literal `CREATE INDEX` (5 if including `CREATE UNIQUE INDEX` via `CREATE.*INDEX`); impl line 437 + 4 fixture byte-strings |
| 18 | `grep 'create_index' src-tauri/src/lib.rs` | **= 1 hit** (line 152) |
| 19 | `grep 'createIndex' src/components/schema/CreateTableDialog.tsx` | **= 5 hits** (3 jsdoc + 2 chain closure call sites) |
| 20 | `grep 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` | **= 1 hit** (jsdoc-only mention; not imported — same as Sprint 227 baseline) |
| 21 | `grep 'it.only|it.skip|describe.skip|xit|it.todo' CreateTableDialog.test.tsx` | **= 0** |
| 22 | `git diff src/ src-tauri/ \| grep '^+.*eslint-disable'` | **= 0** |
| 23 | `git diff src/ \| grep '^\+.*\bany\b'` | **= 0** |
| 24 | `grep 'createCollection|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` | **= 0** |
| 25 | Vitest 0-index IPC sequence byte-equivalent | **PASS** — test "0-index IPC sequence is byte-equivalent to Sprint 227 (AC-228-09)" line 1207 |
| 26 | Vitest 1-index happy-path IPC sequence | **PASS** — test "Show DDL fans out createTable(preview) + createIndex(preview) per declared row (AC-228-04)" line 846 |
| 27 | Vitest index-failure-after-table chain abort | **PASS** — test "first createIndex(commit) rejection halts chain, modal stays open, error names failing index (AC-228-06)" line 968 |
| 28 | Vitest PK dedup | **PASS** — tests at line 1120 (exact match) + 1171 (partial overlap) |
| 29 | Vitest multi-column index payload | **PASS** — test at line 1238 |
| 30 | Vitest unique flag forwards | **PASS** — test at line 1265 |
| 31 | Vitest four index types in dropdown | **PASS** — test at line 801; also asserts `brin` is hidden |
| 32 | Vitest canonical Safe Mode warn-cancel verbatim | **PASS** — test at line 1294 |
| 33 | Manual UI smoke (`pnpm tauri dev`) | **NOT PERFORMED** — optional; e2e dead per ADR 0019 |

**Independent verification: 32 / 32 PASS** (excluding optional check 33).

## Sprint Contract Status (AC-228-01..11)

- [x] **AC-228-01** Placeholder removed — grep = 0 hits (check 15); editor body mounts via `<IndexesTabBody>` (CreateTableDialog.tsx:680).
- [x] **AC-228-02** Add/remove rows + 0-row default — IndexesTabBody.tsx:103-109 renders empty-state hint when no rows; `+ Index` (line 96) and `−` (line 211) wired.
- [x] **AC-228-03** Per-row inputs + live derivation — `<input>` name (line 122), `<Select>` type (line 131), checkbox unique (line 156), checkbox columns (line 187). `availableColumns` prop derives from parent's `validPkColumns` memo (CreateTableDialog.tsx:212-216, 682) — same `useMemo` dep, so column rename live-updates.
- [x] **AC-228-04** Multi-statement preview — `handleShowDdl` (line 378-432) fans out preview-only `createIndex` calls in `for` loop (line 401-403), joins with `;\n` (line 408).
- [x] **AC-228-05** Chained Execute — `prepareCommit` factory closure (line 410-431) awaits createTable then sequentially createIndex; vitest `maxConcurrent <= 1` assertion (test line 947).
- [x] **AC-228-06** First-index-fail → table stays — try/catch re-throws (line 419-428); `mockCreateTable` called exactly twice (preview+commit, no rollback); modal stays open (`onClose` not called).
- [x] **AC-228-07** Mid-chain fail — earlier indexes stay applied; `mockDropIndex.not.toHaveBeenCalled()` (test line 1115).
- [x] **AC-228-08** PK dedup — `declaredIndexesForChain` memo (line 355-362) filters via `indexMatchesPk`; same list used by both preview (line 401) AND commit (line 416). Inline note rendered when `dedupe` true (IndexesTabBody.tsx:202-206).
- [x] **AC-228-09** 0-index byte-equivalent regression — vitest line 1207; `composite_pk_byte_equivalent` Rust fixture passes unchanged.
- [x] **AC-228-10** No new shadcn primitives — `git diff --stat src/components/ui/` = 0.
- [x] **AC-228-11** Coverage — 13 new vitest cases (≥ 8 required); Rust `create_index` 11 fixtures (baseline 8). Canonical Safe Mode warn-cancel verbatim case at test line 1294.

## Top 3 Concerns

### P3 — Manual UI smoke not performed
- Risk: a runtime surface bug (e.g. Radix `<Select>` z-index inside the Tabs/Dialog stack, multi-statement preview wrap visual) could ship undetected.
- Mitigation: same residual risk as Sprint 227; e2e dead since 2026-05-01 (ADR 0019). Acknowledged in findings.md §4.
- Suggestion: run `pnpm tauri dev` smoke before tagging the sprint commit; capture `psql \di` output in findings.md if executed.

### P3 — Index name collision detection deferred
- Risk: Two Indexes-tab rows with the same `name` would result in the second `createIndex` call failing at PG (`relation already exists`). Frontend currently relies on backend validation — the surface message will name the duplicate but the user must remove it manually.
- Mitigation: chain failure surface (`Index "<name>" failed: …`) names the failing row; recovery is one click away. Documented in findings.md §4.
- Suggestion: a Sprint 230 polish could add a pre-flight inline warning when two rows share a name.

### P3 — Empty-name rows silently filtered
- Risk: A user adds a row but doesn't fill the `name`. The row simply doesn't fire (filtered out of `declaredIndexesForChain` at line 357). The UI does not flag this as an error state — there's no per-row validation surface.
- Mitigation: Acceptable per contract — Out-of-Scope item. Per-row inline error is a Sprint 230 polish.
- Suggestion: a future polish sprint could add inline validation hints when a row has columns checked but no name (or vice versa).

## Hot-fix observations (out of Sprint 228 scope)

The orchestrator made two pre-Evaluator hot-fix changes outside the Sprint 228 contract. Per orchestrator instructions, these are NOT scored against Sprint 228 ACs. I checked them for regressions:

### (a) `CreateTableTypeCombobox.tsx` — radix popover hot-fix
- Replaced `--radix-popover-content-available-height` with fixed `max-h-60` + `overflow-y-auto` + `avoidCollisions={false} side="bottom"` (lines 183-184).
- **Regression risk: none observed.** All Sprint 227 combobox carry-over tests in `CreateTableTypeCombobox.test.tsx` continue to pass via the full vitest run (217 files / 2795 tests). The Sprint 228 vitest cases that exercise the type combobox (e.g. typing "numeric(10,4)" at test line 557) also pass.
- Logical concern: `avoidCollisions={false} side="bottom"` will render off-bottom-of-viewport when the modal sits at the bottom edge. The 240px max-height + scroll mitigates the worst case. UX trade-off; not a regression.

### (b) `CreateTableDialog/Header.tsx` — extracted compound header
- Pure presentational extraction matching `ConnectionDialog` pattern. Same JSX (`DialogHeader layout="column"` + title + close X + schema picker), no behaviour change.
- **Regression risk: none observed.** The parent now imports `CreateTableDialogHeader` (CreateTableDialog.tsx:11, 463) instead of inlining. All Sprint 227 schema-picker tests at test lines 500-544 pass (which exercise this header's combobox + selection-update flows) — confirmed via the 38/38 CreateTableDialog test pass.
- Aria-label `"Target schema"` on the SelectTrigger (Header.tsx:77) preserves the contract used by Sprint 227's `getByRole("combobox", { name: "Target schema" })` assertion.

Neither hot-fix touches contract invariants (`useDdlPreviewExecution.ts`, `SqlPreviewDialog.tsx`, cross-window suite, stores, `create_index` Rust impl). Both ride alongside Sprint 228 cleanly.

## Feedback for Generator

None — sprint passes all required checks and ACs. Only P3 polish items deferred to Sprint 230 per contract.

## Ready to commit: **YES**

All 32 verification checks PASS. All 11 ACs covered with concrete file:line evidence. All 7 freeze invariants hold (`git diff --stat = 0`). Sprint 226 + 227 byte-equivalent regression preserved (`composite_pk_byte_equivalent` ok). 13 new vitest cases lock the new behaviour with sequence + sequential + dedup + failure-name-surface assertions. TDD red-state evidence captured. Hot-fix changes (a + b) ride alongside without regression.
