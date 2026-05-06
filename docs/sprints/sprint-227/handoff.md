# Sprint 227 — Handoff

Sprint: `sprint-227` (feature — CREATE TABLE UI DataGrip-parity foundation).
Date: 2026-05-07.
Status: Generator complete (orchestrator-finalized after stream timeout). Evaluator pending.
Type: feature (Phase 27 sprint 2).

## Generator Handoff

### Changed Files

#### Backend (Rust)
| 파일 | Purpose |
|------|---------|
| **MOD** `src-tauri/src/models/schema.rs` (+10) | `ColumnDefinition.comment: Option<String>` (`#[serde(default)]`) — additive, Sprint 226 callers tolerate omission. |
| **MOD** `src-tauri/src/db/postgres/mutations.rs` (+229) | `create_table` extended to emit `COMMENT ON COLUMN "<schema>"."<table>"."<col>" IS '<escaped>'` per commented column, after CREATE TABLE, in same transaction. Single-quote escape (`O'Brien` → `'O''Brien'`). Empty comments emit no statement. ≥ 2 new Rust unit fixtures + Sprint 226 byte-equivalent fixture preserved. |

#### Frontend (TS / React)
| 파일 | Purpose |
|------|---------|
| **MOD** `src/components/schema/CreateTableDialog.tsx` (667 lines) | Full redesign: Target schema dropdown header + `Tabs` (Columns / Keys / Indexes / Foreign Keys) + per-column type combobox + per-column comment input + inline collapsible DDL preview pane. Drops `SqlPreviewDialog` import (modal-on-modal removed). Reuses `useDdlPreviewExecution` (Sprint 214) without modification — modal owns inline pane JSX, hook owns state slots. Indexes / Foreign Keys tab body = `"Available in Sprint 228"` / `"Available in Sprint 229"` placeholder, no inputs. |
| **MOD** `src/components/schema/CreateTableDialog.test.tsx` (667 lines) | 23 cases — Sprint 226 carry-over (mechanical query adaptation for tab structure) + new AC-227-01..08. |
| **NEW** `src/components/schema/CreateTableTypeCombobox.tsx` (179 lines) | Filterable type combobox over canonical PG type list. ↑↓/Enter/Esc keyboard nav. Free-text fallback (`numeric(10,4)` blur commits verbatim). Stays in `src/components/schema/` (not generalized — contract: no anticipatory abstraction). |
| **NEW** `src/components/schema/CreateTableTypeCombobox.test.tsx` (145 lines) | 6 cases — filter / keyboard / free-text fallback. |
| **NEW** `src/lib/sql/postgresTypes.ts` (53 lines) | Canonical PG type list (≥ 25 entries: serial / bigserial / smallserial / integer / bigint / smallint / varchar / varchar(255) / text / boolean / timestamp / timestamptz / date / time / numeric / numeric(10,2) / real / double precision / uuid / jsonb / json / bytea / inet / cidr / interval / char / money / tsvector / xml). |
| **NEW** `src/lib/sql/postgresTypes.test.ts` (67 lines) | 6 cases — list shape + filter helpers. |
| **MOD** `src/components/schema/SchemaTree/dialogs.tsx` (+19) | Pass `availableSchemas` prop to `CreateTableDialog` from `useSchemaStore.schemas[connectionId]`. |
| **MOD** `src/types/schema.ts` (+8) | `ColumnDefinition.comment?: string` mirror. |
| **MOD** `src/components/schema/SchemaTree.actions.test.tsx` (+~30) | Mechanical query adaptation for Sprint 226 carry-over cases (tab-aware `getByLabelText` scoping). |
| **MOD** `src/__tests__/no-stale-sprint-tooltip.test.ts` (+19) | Sprint 227 placeholder text (`"Available in Sprint 228"` / `"Available in Sprint 229"`) added to allowlist. |

#### Docs
| 파일 | Purpose |
|------|---------|
| **NEW** `docs/sprints/sprint-227/spec.md` | Master spec — 8 ACs, 4 tabs, schema picker, type combobox, column comment, inline DDL preview. |
| **NEW** `docs/sprints/sprint-227/contract.md` | 32 verification checks. |
| **NEW** `docs/sprints/sprint-227/execution-brief.md` | Generator brief. |
| **NEW** `docs/sprints/sprint-227/tdd-evidence/red-state.log` | TDD red-state evidence. |
| **NEW** `docs/sprints/sprint-227/handoff.md` | This file. |
| **NEW** `docs/sprints/sprint-227/findings.md` | Decisions + tradeoffs + residual risk. |

총: 2 backend MOD + 6 frontend NEW + 4 frontend MOD + 6 docs.

### Checks Run

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx src/components/schema/CreateTableTypeCombobox.test.tsx src/lib/sql/postgresTypes.test.ts` | **PASS** — 35/35 tests, 3 files |
| 2 | `pnpm vitest run` | **PASS** — 217 files / 2768 tests (Sprint 226 = 215/2745, +2 files +23 tests) |
| 3 | `pnpm tsc --noEmit` | **PASS** — exit 0 |
| 4 | `pnpm lint` | **PASS** — exit 0 |
| 5 | `cargo build --manifest-path src-tauri/Cargo.toml` | **PASS** — exit 0 |
| 6 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **PASS** — exit 0 |
| 7 | `cargo test --manifest-path src-tauri/Cargo.toml create_table` | **PASS** — 1 integration + Rust unit fixtures (filtered set passes) |
| 10 | `git diff --stat src/components/structure/useDdlPreviewExecution.ts` | = 0 ✓ |
| 11 | `git diff --stat src/components/structure/SqlPreviewDialog.tsx` | = 0 ✓ |
| 12 | `git diff --stat src/__tests__/cross-window-*.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | = 0 ✓ |
| 13 | `git diff --stat src/stores/connectionStore.ts src/stores/schemaStore.ts` | = 0 ✓ |
| 20 | `grep -nE 'COMMENT ON COLUMN' src-tauri/src/db/postgres/mutations.rs` | = 3 hits ✓ (line 219, 241, fixture 1457) |
| 21 | `grep -nE '#\[serde\(default\)\]' src-tauri/src/models/schema.rs` | ≥ 1 ✓ (lines 103, 116, 118) |
| 32 | `grep -rn 'SqlPreviewDialog' src/components/schema/CreateTableDialog.tsx` | 0 ✓ (only mention in comment line 40 — import removed) |

### Done Criteria Coverage (AC-227-01..08)

| AC | Evidence |
|----|----------|
| **AC-227-01** Tabbed modal | `CreateTableDialog.tsx` `<Tabs>` with 4 panels. Indexes/FK tab body = canonical placeholder. Vitest cases assert tab labels + placeholder text + no inputs in placeholder tabs. |
| **AC-227-02** Target schema picker | Modal header `<Select>` populated from `useSchemaStore.schemas[connectionId]`. Default = pre-filled schema. Selection updates Tauri payload + invalidates cached preview. Vitest case asserts dropdown list + change behavior. |
| **AC-227-03** Type combobox | `CreateTableTypeCombobox.tsx` filterable + keyboard nav + free-text fallback. PG type list in `src/lib/sql/postgresTypes.ts`. 6 vitest cases (filter, keyboard, blur free-text). |
| **AC-227-04** Column comment | Per-column comment input. Backend `ColumnDefinition.comment: Option<String>`. SQL emission: COMMENT ON COLUMN per commented column with `'`-doubled escape. Empty → no statement. ≥ 2 Rust fixtures + Sprint 226 byte-equivalent regression fixture passes. |
| **AC-227-05** Inline DDL preview | Collapsible region replaces `SqlPreviewDialog`. Show/Hide toggle + auto-fetch on open + edit invalidates cache. Vitest cases assert preview→commit IPC sequence + cache invalidation. |
| **AC-227-06** Keys tab houses PK | PK multi-select moved to Keys tab. Tab switch preserves form state. PK options derive live from column names. Vitest case asserts cross-tab state preservation. |
| **AC-227-07** Footer + Safe Mode parity | Cancel + Execute footer (no separate Preview SQL button). `useDdlPreviewExecution` reused. Canonical warn-cancel message verbatim. Single history entry per commit (hook-internal). |
| **AC-227-08** Sprint 226 regression | `composite_pk_byte_equivalent` Rust fixture passes unmodified. Sprint 226 vitest carry-over cases pass with mechanical tab-scoping adaptation. |

### Assumptions

1. **`useDdlPreviewExecution` reuse, not bypass**: hook is render-agnostic; modal renders `previewSql` / `previewLoading` / `previewError` directly inside inline pane. Hook diff = 0 verified.
2. **`SqlPreviewDialog` body untouched**: only the *import path* in `CreateTableDialog.tsx` removed; sibling editors (`ColumnsEditor`, `IndexesEditor`, `ConstraintsEditor`) keep using it. Component diff = 0 verified.
3. **Combobox primitive**: chose `Popover` + filtered list (instead of cmdk `Command`) — minimizes new primitive surface; canonical PG type list is small (≤ 30 entries) so a simple filter is sufficient.
4. **Tabs primitive**: shadcn `Tabs` keeps inactive panels mounted (not unmounted) — modal-local form state preserves across tab switches without lifting.
5. **Sprint 226 vitest carry-over migration**: only query selectors changed (`getByLabelText("Column name")` → scoped via Columns tab panel); assertion text strings unchanged. Per contract: assertion-text changes would have been P1.
6. **Schema picker single-schema case**: dropdown still renders even if connection has only one schema (no auto-collapse) — consistent UX.
7. **Comment with `;`**: single-quote-wrapped literal preserves `;` verbatim. Backend's `;`-split for Safe Mode analysis treats CREATE / COMMENT ON as `safe`, so analysis is unaffected.
8. **History source `"ddl-structure"`**: emitted by `useDdlPreviewExecution` internally (not by `CreateTableDialog.tsx` directly) — contract check 19 may be a false-positive if interpreted strictly. Behavioral assertion (vitest spy on `addHistoryEntry`) is the authoritative evidence.

### Residual Risk

- **Stream timeout during Generator phase** — orchestrator finalized handoff after agent timeout. Code is complete and verification 4-set passes; this handoff was authored from inspection rather than from agent self-report.
- **Manual UI smoke not performed** — `pnpm tauri dev` smoke deferred. Optional per spec; no e2e suite available (lefthook 5_e2e skip:true since 2026-05-01).
- **Comment containing `\n`** — emitted verbatim inside single-quoted PG literal. PG accepts but rendering in inline preview pane may visually wrap; not asserted as a vitest case (Generator's call — low priority).
- **Sprint 228+ unblocking** — Indexes / FK tabs are present-but-disabled placeholders. Sprint 228 must (a) replace placeholder body with form, (b) chain `tauri.createIndex` calls after `tauri.createTable` per partial-atomic policy C.

## Required checks (재현)

```sh
pnpm vitest run src/components/schema/CreateTableDialog.test.tsx
pnpm vitest run src/components/schema/CreateTableTypeCombobox.test.tsx
pnpm vitest run src/lib/sql/postgresTypes.test.ts
pnpm vitest run src/components/schema/SchemaTree.actions.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
cargo build --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml create_table
```

기대값: 모두 zero error.

## 다음 sprint 가 알아야 할 것

### Sprint 228 (Indexes tab)

- Indexes tab body 현재 `"Available in Sprint 228"` placeholder. Sprint 228 진입 시 placeholder 제거 + `+/−` 버튼 + 행별 (name + columns + type [btree/hash/gin/gist] + unique flag) 입력.
- Frontend chain: `tauri.createTable({preview_only:false})` 성공 후 → 각 declared index 별 `tauri.createIndex({preview_only:false})` 순차 호출. Partial-atomic policy C — 인덱스 실패 시 CREATE TABLE rollback **하지 않음** (DataGrip 패턴).
- DDL Preview pane 가 chained statements 모두 표시 — preview SQL 가 multi-statement (CREATE TABLE + COMMENT ON + CREATE INDEX × N).

### Sprint 229 (Foreign Keys + Constraints tab)

- FK 행 입력: columns + reference table picker (schema-tree integration 필요) + reference columns + ON DELETE / ON UPDATE actions.
- May fold in CHECK / UNIQUE.
- Frontend chain: `tauri.addConstraint` calls after CREATE TABLE.

### Sprint 230 (polish)

- Reorder ↑↓ 버튼.
- Table-level COMMENT ON TABLE.
- Type coloring on combobox display.

## Refs

- `docs/sprints/sprint-227/contract.md` — sprint contract.
- `docs/sprints/sprint-227/findings.md` — decisions / tradeoffs.
- `docs/sprints/sprint-226/handoff.md` — Sprint 226 baseline (CREATE TABLE first cut).
- `docs/sprints/sprint-214/handoff.md` — `useDdlPreviewExecution` source pattern.
- `docs/sprints/sprint-213/handoff.md` — ConnectionDialog Tabs/modal pattern source.
