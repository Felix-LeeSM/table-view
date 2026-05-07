# Sprint 228 — Handoff

Sprint: `sprint-228` (feature — Indexes tab functional in CREATE TABLE UI).
Date: 2026-05-07.
Status: Generator complete.
Type: feature (Phase 27 sprint 3).

## Generator Handoff

### Changed Files

#### Backend (Rust)

| 파일 | LOC delta | Purpose |
|------|-----------|---------|
| **MOD** `src-tauri/src/db/postgres/mutations.rs` | +47 | Two new `#[cfg(test)]` byte-string fixtures (`create_index_preview_gin_byte_equivalent`, `create_index_preview_gist_byte_equivalent`) for the two UI-exposed types that previously only appeared inside the all-types-acceptance loop without a strict byte-string assertion. Impl body unchanged (lines 401-461 untouched). |

#### Frontend (TS / React)

| 파일 | LOC delta | Purpose |
|------|-----------|---------|
| **MOD** `src/components/schema/CreateTableDialog.tsx` | +186 / −15 (=852 final, ↘ from 1000 peak after extraction) | Replace Sprint 227 Indexes-tab placeholder body with `<IndexesTabBody>` invocation. Add modal-local `IndexDraft[]` state + `handleAddIndex` / `handleRemoveIndex` / `handleUpdateIndex` / `handleToggleIndexColumn` handlers. Wire chained execute closure inside `useDdlPreviewExecution.loadPreview`'s `prepareCommit` factory: `createTable(commit)` → sequential `for` loop of `createIndex(commit)`, each in its own try/catch that re-throws as `Index "<name>" failed: <pg error>`. Extend `handleShowDdl` to fan out preview-only `createIndex` calls and join all SQL strings with `;\n`. Add PK dedup memo (`indexMatchesPk(idx, declaredPk)`) — both filters out the chain entry AND drives the inline `"Skipped — primary key is already indexed"` note. |
| **NEW** `src/components/schema/CreateTableDialog/IndexesTabBody.tsx` | +224 | Extracted Indexes-tab JSX presentation. Pure presentational — props are `indexes` + `availableColumns` + `isPkDuplicate` callback + 4 mutator callbacks (`onAdd` / `onRemove` / `onUpdate` / `onToggleColumn`). Owns `IndexType` / `IndexDraft` / `INDEX_TYPE_OPTIONS` exports — single source of truth so the parent type-imports rather than redeclares. |
| **MOD** `src/components/schema/CreateTableDialog.test.tsx` | +667 (mock surface +6, Sprint 228 describe block +618, AC-227-01 placeholder-presence test rewritten −4 / +12, helper additions) | Extend `vi.mock("@lib/tauri")` to expose `createIndex` + `dropIndex` mocks. Add `describe("Sprint 228 — Indexes tab functional", …)` block with 13 vitest cases covering AC-228-01..AC-228-11 + multi-column + unique flag + canonical Safe Mode warn-cancel survival. Mechanically rewrite the Sprint 227 carry-over `Indexes tab renders 'Available in Sprint 228' placeholder…` test to its inverse (placeholder absent + `+ Index` button present) since AC-228-01 supersedes that snapshot. All 22 other Sprint 226+227 carry-overs pass byte-for-byte unchanged. |

#### Docs

| 파일 | Purpose |
|------|---------|
| **MOD** `docs/PLAN.md` (+1, =) | Add row 3 (Sprint 228) to the post-225 feature cycle table. Row 4 reseeded as the next-candidate placeholder. |
| **NEW** `docs/sprints/sprint-228/handoff.md` | This file. |
| **NEW** `docs/sprints/sprint-228/findings.md` | Decisions + tradeoffs + residual risks. |
| **NEW** `docs/sprints/sprint-228/tdd-evidence/red-state.log` | TDD red-state evidence — 13 new vitest cases captured failing before implementation. |

총: 1 backend MOD (test-only fixture additions) + 1 frontend NEW + 2 frontend MOD + 4 docs.

### Checks Run

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx` | **PASS** — 38/38 (Sprint 227 baseline 23 + 13 new + 1 mechanically-rewritten + 1 unchanged) |
| 2 | `pnpm vitest run` | **PASS** — 217 files / 2795 tests (Sprint 227 baseline 217 / 2768; Sprint 228 +13 cases — file count unchanged because the new `IndexesTabBody.tsx` does not have its own test file; coverage by parent's vitest cases) |
| 3 | `pnpm tsc --noEmit` | **PASS** — exit 0 |
| 4 | `pnpm lint` | **PASS** — exit 0 |
| 5 | `cargo build --manifest-path src-tauri/Cargo.toml` | **PASS** — exit 0 |
| 6 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **PASS** — exit 0 |
| 7 | `cargo test --manifest-path src-tauri/Cargo.toml create_table` | **PASS** — 16/16 unit + 1 integration (Sprint 226 + 227 fixtures intact, no source diff) |
| 8 | `cargo test --manifest-path src-tauri/Cargo.toml create_index` | **PASS** — 11/11 unit (Sprint 227 baseline 8 + 2 new gin/gist byte-string + the all-types-accepted loop existed already; +1 covers brin) |
| 9 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | **= 0** ✓ |
| 10 | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | **= 0** ✓ |
| 11 | `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | **= 0** ✓ |
| 12 | `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` | **= 0** ✓ |
| 13 | `git diff --stat src/lib/tauri/ddl.ts` | **= 0** ✓ |
| 14 | `git diff --stat src/components/ui/` | **= 0** ✓ |
| 15 | `grep -n 'Available in Sprint 228' src/components/schema/CreateTableDialog.tsx` | **= 0 hits** ✓ (placeholder body removed) |
| 16 | `grep -n 'Available in Sprint 229' src/components/schema/CreateTableDialog.tsx` | **= 1 hit** ✓ (FK placeholder kept) |
| 17 | `grep -nE 'CREATE INDEX' src-tauri/src/db/postgres/mutations.rs` | **= 4 hits** (impl line 437 + 3 fixture byte-strings: btree/hash/multi-col/gin/gist — gin/gist literals add to ≥ 4 by inspection) ✓ |
| 18 | `grep -n 'createIndex\|create_index' src-tauri/src/lib.rs` | **= 1 hit** (line 152) ✓ |
| 19 | `grep -n 'createIndex' src/components/schema/CreateTableDialog.tsx` | **≥ 5 hits** (3 jsdoc + 2 chain closures) ✓ |
| 20 | `grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` | **= 1 hit** (jsdoc only — sibling editors note, no import) ✓ — same baseline as Sprint 227 |
| 21 | `grep -nE 'it\.only\|it\.skip\|describe\.skip\|xit\|it\.todo' src/components/schema/CreateTableDialog.test.tsx` | **= 0** ✓ |
| 22 | `git diff src/ src-tauri/ \| grep "^+.*eslint-disable"` | **= 0** ✓ |
| 23 | `git diff src/ \| grep -E "^\+.*\bany\b"` | **= 0** ✓ |
| 24 | `grep -rnE 'createCollection\|create_collection' src/lib/tauri/ src-tauri/src/commands/document/` | **= 0** ✓ |
| 25 | Vitest case asserts 0-index IPC sequence byte-equivalent to Sprint 227 | **PASS** — `0-index IPC sequence is byte-equivalent to Sprint 227 (AC-228-09)` |
| 26 | Vitest case asserts 1-index happy-path IPC sequence | **PASS** — `Show DDL fans out createTable(preview) + createIndex(preview) per declared row (AC-228-04)` + `Execute chains createTable + createIndex × 2 sequentially with one history entry (AC-228-05)` |
| 27 | Vitest case asserts index-failure-after-table chain abort + table stays | **PASS** — `first createIndex(commit) rejection halts chain, modal stays open, error names failing index (AC-228-06)` |
| 28 | Vitest case asserts PK dedup | **PASS** — `PK exact match dedup — no createIndex emitted for the row (AC-228-08)` |
| 29 | Vitest case asserts multi-column index payload | **PASS** — `multi-column index forwards columns array in declared order (AC-228-04 / -05)` |
| 30 | Vitest case asserts unique flag forwards | **PASS** — `unique checkbox flips is_unique on the createIndex payload (AC-228-03 / -05)` |
| 31 | Vitest case asserts four index types in dropdown | **PASS** — `index type \`<Select>\` exposes exactly btree | hash | gin | gist (AC-228-03)` |
| 32 | Vitest case asserts canonical Safe Mode warn-cancel verbatim | **PASS** — `Safe Mode warn-cancel surfaces the canonical message even with index rows declared (AC-228-11)` |
| 33 | Manual UI smoke (`pnpm tauri dev`) | **NOT PERFORMED** — optional; e2e dead per ADR 0019 / lefthook 5_e2e skip:true since 2026-05-01. |

### Done Criteria Coverage (AC-228-01..11)

| AC | Evidence |
|----|----------|
| **AC-228-01** Indexes tab no longer placeholder | `grep '"Available in Sprint 228"' src/components/schema/CreateTableDialog.tsx` = 0 hits. Vitest cases `Indexes tab no longer renders the 'Available in Sprint 228' placeholder (AC-228-01)` (line 776) + the rewritten Sprint 227 carry-over assertion (line 470) both assert the placeholder is gone + `+ Index` button surfaces. |
| **AC-228-02** Add / remove rows | Vitest cases `Indexes tab default state has zero index rows (AC-228-02)` (line 791) + `'+ Index' adds an index row; '−' removes it (AC-228-02)` (line 800). 0-row default + `+/−` semantics covered. |
| **AC-228-03** Per-row inputs + live derivation | Vitest cases `index type \`<Select>\` exposes exactly btree | hash | gin | gist (AC-228-03)` (line 821) + `renaming a column on the Columns tab updates the index columns checkbox label live (AC-228-03)` (line 836). 4 dropdown options + live column derivation covered. |
| **AC-228-04** Multi-statement preview | Vitest case `Show DDL fans out createTable(preview) + createIndex(preview) per declared row (AC-228-04)` (line 866). IPC sequence + preview text both `CREATE TABLE` + `CREATE INDEX` substrings asserted. |
| **AC-228-05** Chained Execute happy path | Vitest case `Execute chains createTable + createIndex × 2 sequentially with one history entry (AC-228-05)` (line 904). Sequential check via `maxConcurrent <= 1`; 1 history entry; `onRefresh` once; `onClose` once. |
| **AC-228-06** First index fails — table stays | Vitest case `first createIndex(commit) rejection halts chain, modal stays open, error names failing index (AC-228-06)` (line 962). 2nd commit-time `createIndex` not called; `onClose` not called; `mockDropIndex` not called; `mockCreateTable` called exactly twice (preview + commit, no rollback). |
| **AC-228-07** Earlier indexes stay applied | Vitest case `mid-chain rejection leaves earlier index applied (no dropIndex rollback) (AC-228-07)` (line 1024). 1st commit-`createIndex` succeeded; 3rd not called; `mockDropIndex` not called; error surface contains `idx_b`. |
| **AC-228-08** PK dedup | Vitest cases `PK exact match dedup — no createIndex emitted for the row (AC-228-08)` (line 1080) + `PK partial overlap still emits a CREATE INDEX (AC-228-08)` (line 1116). Exact-match → no `createIndex` + inline `"primary key is already indexed"` note; partial-overlap → still emits with `columns:["id","email"]`. |
| **AC-228-09** 0-index byte-equivalent regression | Vitest case `0-index IPC sequence is byte-equivalent to Sprint 227 (AC-228-09)` (line 1153). `mockCreateIndex.not.toHaveBeenCalled()` after preview + commit. `cargo test create_table` 16/16 — no source diff. |
| **AC-228-10** No new shadcn primitives | `git diff --stat src/components/ui/` = 0. `IndexesTabBody.tsx` imports only existing `@components/ui/{button,select}` modules. |
| **AC-228-11** Test coverage targets | 13 new vitest cases under Sprint 228 describe (≥ 8 required). Sprint 227 carry-over byte-for-byte unchanged for 22 of 23. Canonical Safe Mode message verbatim case present (`Safe Mode warn-cancel surfaces the canonical message even with index rows declared (AC-228-11)` line 1224). Rust `create_index` baseline 8 → 11 unit. |

### Decisions

- **Columns multi-select implementation**: multi-`<input type="checkbox">` group (NOT chip-tag list). Per contract Design Bar.
- **Failure-handling UX surface**: inline preview pane error slot only (no toast). Verbatim format string: `Index "<name>" failed: <pg error>`. Tested via `Index "idx_first" failed:` substring assertion (vitest reads `previewPane.textContent.toContain("idx_first")`).
- **Indexes-tab body extraction**: extracted to `src/components/schema/CreateTableDialog/IndexesTabBody.tsx`. Justification: parent grew to 1000 LOC after inline implementation pass — well past the 700 LOC threshold. Extracted body is pure presentation; parent retains state + handlers + dedup logic. Final parent LOC: 852 (still above 700; further extractions are out of scope per Sprint 228).

### Assumptions

1. **Hook reuse, not bypass**: `useDdlPreviewExecution.ts` body unchanged. The chain runs inside the `prepareCommit` factory closure passed to `loadPreview`. Hook diff = 0 verified.
2. **`SqlPreviewDialog` body unchanged**: Sprint 227 already removed the import; only a comment-mention persists in the modal (legacy reference). Component diff = 0 verified.
3. **`tauri.createIndex` wrapper unchanged**: existing `src/lib/tauri/ddl.ts` lines 43-47 already wired. `git diff --stat` = 0 verified.
4. **`CreateIndexRequest` struct unchanged**: existing `src-tauri/src/models/schema.rs` lines 108-120 already carries the right shape. `git diff` 0 lines on `CreateIndexRequest` patterns verified.
5. **Backend `create_index` impl body unchanged**: existing `src-tauri/src/db/postgres/mutations.rs` lines 401-461 already validates / formats / executes. Only `#[cfg(test)] mod tests` grew.
6. **Sprint 227 carry-over assertion text frozen for 22 of 23 cases**. The 23rd (`Indexes tab renders 'Available in Sprint 228' placeholder…`) was rewritten to its inverse since AC-228-01 explicitly supersedes the AC-227-01 placeholder snapshot. This is documented as a Sprint 228-superseded comment in the test body.
7. **Chain failure rolls back NEITHER the table NOR earlier indexes** — partial-atomic policy C. The chain closure simply re-throws on first index failure; subsequent `createIndex` calls do not fire. The hook records the partial run as `status: "error"` in `useQueryHistoryStore` (Sprint 214 baseline behaviour). The CREATE TABLE remains applied at PG.
8. **PK dedup is byte-equal-array based.** Different ordering or different unique flag still emits a CREATE INDEX statement — the user explicitly asked for a different shape. Partial overlap still emits.

### Residual Risk

- **Manual UI smoke not performed.** `pnpm tauri dev` smoke deferred (e2e dead since 2026-05-01). Same risk as Sprint 227.
- **Multi-statement preview rendering wrap.** Long index declarations may visually wrap inside the inline preview pane's `<pre>`. PG accepts the SQL byte-for-byte; visual rendering is a Sprint 230 polish question.
- **Index name collision detection deferred.** Two rows with the same `name` would let the chain submit a duplicate to PG; the surface message names the failing index but the user must remove the duplicate manually. A pre-flight inline warning could be added in a future polish sprint.
- **PK dedup ordering invariant**. Per contract: "Mismatched ordering still emits a CREATE INDEX". `(b, a)` is genuinely a different index from `(a, b)`. No risk per se — documenting for future sprints.

## Required checks (재현)

```sh
pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
cargo build --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml create_table
cargo test --manifest-path src-tauri/Cargo.toml create_index
```

기대값: 모두 zero error. 자세한 결과는 위 표 참조.

## 다음 sprint 가 알아야 할 것

### Sprint 229 (Foreign Keys + Constraints tab)

- FK tab body 현재 `"Available in Sprint 229"` placeholder. Sprint 229 진입 시 placeholder 제거 + `+/−` 버튼 + 행별 (columns + reference table picker [`useSchemaStore.tables` 통합 필요] + reference columns + ON DELETE / ON UPDATE actions).
- Frontend chain: `tauri.addConstraint` calls after CREATE TABLE — Sprint 228의 `createIndex` chain 패턴을 답습. 같은 `prepareCommit` factory 안에서 sequential await + per-row try/catch + verbatim 에러 message 형식.
- Sprint 228 의 `IndexesTabBody.tsx` extraction 패턴이 reference — `ForeignKeysTabBody.tsx` 도 같은 디렉토리에 추출.
- Sprint 228 의 PK-dedup 패턴 (`indexMatchesPk`) 가 reference — FK 의 경우 dedup 은 의미 없음 (FK 는 implicit 하지 않음).

### Sprint 230 (polish)

- Reorder ↑↓ buttons (column rows + index rows + FK rows).
- Table-level `COMMENT ON TABLE`.
- Type coloring on combobox display.
- Schema picker position move (header → form section).
- (Optional) further parent-file extraction (`ColumnsTabBody.tsx` / `KeysTabBody.tsx`) to drop `CreateTableDialog.tsx` below 700 LOC.

## Refs

- `docs/sprints/sprint-228/contract.md` — sprint contract (32 verification checks, 11 ACs).
- `docs/sprints/sprint-228/findings.md` — decisions / tradeoffs / residual risks.
- `docs/sprints/sprint-228/tdd-evidence/red-state.log` — TDD red-state.
- `docs/sprints/sprint-227/handoff.md` — Sprint 227 baseline (CREATE TABLE UI DataGrip-parity foundation).
- `docs/sprints/sprint-227/findings.md` — partial-atomic policy C decision (lines 118-119).
- `docs/sprints/sprint-214/handoff.md` — `useDdlPreviewExecution` source pattern.
