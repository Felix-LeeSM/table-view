# Sprint Execution Brief: sprint-232

## Objective

`query_table_data` 의 `order_by = None` 분기에서 ORDER BY 절이 emit
되지 않아 PG heap order 그대로 row 가 출력되는 문제를 닫는다. 결과:
(a) DataGrid 가 사용자 sort 입력 없이도 deterministic 한 PK ASC 순서로
rendering, (b) UPDATE 직후 PG 가 dead tuple + new tuple-at-tail 로
처리하면서 발생하는 "수정한 row 가 맨 아래로 내려가는" 사용자 보고
회귀 (2026-05-07) 가 동시 해결. Helper 함수 `build_default_order_clause`
를 추출해 unit test 로 PK ASC fallback 을 deterministic 하게 보증한다.

## Task Why

사용자 (2026-05-07) 보고: "기본적으로 id 기반으로 sorting 하게
해주고, update 했을 때 update 한 row 가 가장 밑으로 내려가는 버그
수정해줘". 두 complaints 의 root cause 는 하나 — `query_table_data`
가 `order_by = None` 일 때 ORDER BY 를 emit 하지 않으므로, PG 의
SELECT \* 가 heap order 를 반환한다. UPDATE 는 heap 에서 dead tuple +
new tuple-at-tail 을 만들어 row 가 맨 아래로 이동. PK ASC 를 default
로 emit 하면 두 증상이 모두 닫힌다.

Phase 5 Sprint 62 cycle 에서 DataGrid UX 개선 다수 진행됐지만 이 항목은
잔존. Sprint 232 가 closure.

## Scope Boundary

In:
- `src-tauri/src/db/postgres/queries.rs` 의 `query_table_data`
  (line 378-573) 안의 `order_clause` 도출 로직 — 사용자 입력 parse
  후 비어 있으면 PK fallback. PK fallback 로직은 free function
  `build_default_order_clause(columns: &[ColumnInfo]) -> String` 으로
  추출.
- 동일 파일 `mod tests` 에 ≥ 5 case 신설 (helper 단위 테스트).
- `docs/PLAN.md` Feature sequencing 표 7번 row → ✓.
- `docs/sprints/sprint-232/{findings.md,handoff.md,tdd-evidence/red-state.log}`.

Out:
- Frontend `DataGrid.tsx` (rdb), `DocumentDataGrid` (Mongo), Mongo
  adapter, MySQL/SQLite adapter.
- Sprint 233/234 항목, ConnectionDialog UX 개선.
- `decideSafeModeAction` / `analyzeStatement` / Safe Mode store 본문.
- Sprint 226-231 freeze 산출물.
- DESC default / multi-column UI / column reorder.

## Invariants

- Sprint 226-231 backend fixture (`create_table` 16/16, `create_index`
  11/11, `add_constraint` 12/12, `list_types` 2/2) byte-equivalent
  PASS.
- `useDdlPreviewExecution.ts`, `SqlPreviewDialog.tsx`,
  `cross-window-*.test.tsx`, `window-lifecycle.ac141.test.tsx`,
  `connectionStore.ts`, `schemaStore.ts`, `safeModeStore.ts`,
  `src/lib/safeMode.ts`, `src/lib/sql/sqlSafety.ts`,
  `useQueryExecution.ts`, `QueryTab.tsx`, `ConnectionDialogBody.tsx`,
  Sprint 226-230 frozen file (CreateTableDialog tabs +
  `usePostgresTypes.ts` / `postgresTypes.ts` /
  `CreateTableTypeCombobox.tsx`) 모두 diff = 0.
- Frontend `DataGrid.tsx` (rdb) `sorts.length === 0` 일 때 `orderBy
  = undefined` 송신 (line 179-182) 보존 — fallback 발동 trigger.
- 신규 `it.skip` / `eslint-disable` / `any` / silent `catch{}` 0.

## Done Criteria

1. **AC-232-01** — `query_table_data(... order_by = None ...)` →
   PK 컬럼 ≥ 1 인 경우 `executed_query` 가 `ORDER BY "<pk>" ASC[, …]`
   을 포함.
2. **AC-232-02** — `query_table_data(... order_by = Some("name DESC")
   ...)` → 사용자 입력 그대로 emit, fallback 발동 안 함.
3. **AC-232-03** — PK 0 인 테이블 + `order_by = None` → ORDER BY 미emit
   (현행 보존).
4. **AC-232-04** — `executed_query` 가 effective ORDER BY 를 그대로
   반영. 사용자에게 visible.
5. **AC-232-05** — Rust 단위 테스트 ≥ 5 case (`build_default_order_clause`
   helper). 최소 1 case 가 TDD red→green capture
   (`docs/sprints/sprint-232/tdd-evidence/red-state.log`).
6. **AC-232-06** — Sprint 226-231 회귀 0. 4-set verification + clippy +
   cargo test PASS.
7. **AC-232-07** — `docs/PLAN.md` 7번 row → ✓ 갱신.

## Verification Plan

- Profile: `command + static`.
- Required checks (12):
  1. `pnpm vitest run` PASS — file count ≥ 220.
  2. `pnpm tsc --noEmit` exit 0.
  3. `pnpm lint` exit 0.
  4. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
     --all-features -- -D warnings` exit 0.
  6. `cargo test --manifest-path src-tauri/Cargo.toml` PASS — Sprint
     226-231 backend test 모두 동일 결과.
  7. `cargo test --manifest-path src-tauri/Cargo.toml
     build_default_order_clause` PASS — 신규 fixture ≥ 4 case.
  8. `git diff --stat src/components/structure/useDdlPreviewExecution.ts
     src/components/structure/SqlPreviewDialog.tsx` = 0.
  9. `git diff --stat src/__tests__/cross-window-*.test.tsx
     src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
  10. `git diff --stat src/stores/connectionStore.ts
      src/stores/schemaStore.ts src/stores/safeModeStore.ts
      src/lib/safeMode.ts src/lib/sql/sqlSafety.ts
      src/components/query/QueryTab/useQueryExecution.ts
      src/components/query/QueryTab.tsx
      src/components/connection/ConnectionDialog/ConnectionDialogBody.tsx`
      = 0.
  11. `grep -nE 'is_primary_key' src-tauri/src/db/postgres/queries.rs`
      ≥ 1 hit.
  12. `grep -nE 'build_default_order_clause'
      src-tauri/src/db/postgres/queries.rs` ≥ 2 hits.
- Required evidence:
  - 변경 파일 표 (file → purpose).
  - cargo test before/after count.
  - AC-232-NN ↔ Rust test name + line table.
  - 12 verification check 결과.
  - Frontend audit (예상: diff = 0).
  - TDD red→green log capture.
  - assumption + residual risk.

## Evidence To Return

- Changed files and purpose:
  - `src-tauri/src/db/postgres/queries.rs` — helper 추출 + call site
    wired + test module 확장.
  - `docs/PLAN.md` — Feature sequencing row 갱신.
  - `docs/sprints/sprint-232/{contract.md,execution-brief.md,findings.md,
    handoff.md,tdd-evidence/red-state.log}`.
- Checks run and outcomes (12 required checks 결과 표).
- Done criteria coverage with evidence (AC ↔ test name + line, code
  site line).
- Assumptions:
  - `columns: Vec<ColumnInfo>` 가 `query_table_data` 시작에 이미 fetch
    되어 있고 `is_primary_key` 필드가 정확. (`get_table_columns_inner`
    이 PG `pg_constraint` join 으로 이미 채움 — 기존 동작).
  - PK 컬럼이 `columns` 배열에 declared order 로 들어 있음. PG
    `pg_attribute.attnum` order 가 declared order 와 일치
    (Sprint 100+ 의 schema fetch 가 `ORDER BY ordinal_position`).
  - 사용자가 `order_by = Some("")` 또는 whitespace-only string 을 보낸
    경우는 frontend 에서 미발생 (`sorts.length > 0 ? join(',') :
    undefined`). 그러나 backend 에서는 split 후 valid part 가 0 이면
    fallback 발동 — defensive.
- Residual risk:
  - View / materialized view / table-without-PK 의 경우 fallback 미동작,
    heap order 유지. 사용자 보고 시나리오 (UPDATE row shifts) 는
    PK 가 있는 일반 테이블에 한정되므로 회귀 닫힘에는 충분.
    PK 없는 view 의 deterministic ordering 은 별도 sprint.
  - PG `pg_constraint` 의 `is_primary_key` derivation 이 partition
    parent table / inheritance child 에서 edge case 가 있을 수 있음.
    Sprint 100+ 의 기존 `get_table_columns_inner` 가 이를 어떻게
    처리하는지는 본 sprint 변경 범위 외. fallback 은 그 결과를
    그대로 신뢰.
  - Performance: `id ASC` 는 PK index 를 그대로 사용하므로 추가
    cost 0. composite PK 도 PK btree index hit. PK index 가 없는
    edge case (사용자 `pg_dump`/manual import 로 PK constraint 가
    빠진 경우) 는 sequential scan + sort 가 발생 — 그러나 이는
    `is_primary_key == false` 로 returning 되므로 fallback 자체가
    발동하지 않음 (안전).
  - cargo test 가 사용 중인 sqlx-mock 또는 기존 test fixture 가 helper
    호출에 영향받지 않음 — helper 는 free function 이고
    `query_table_data` 본문에서만 호출.

## References

- Contract: `docs/sprints/sprint-232/contract.md`
- Findings: `docs/sprints/sprint-232/findings.md` (Generator 작성)
- Relevant files:
  - `src-tauri/src/db/postgres/queries.rs:378-573` — `query_table_data`
    (fix site 본문).
  - `src-tauri/src/db/postgres/queries.rs:500-526` — 현행 `order_by`
    parse 로직 (확장 site).
  - `src-tauri/src/db/postgres/queries.rs:677-808` — `mod tests` (신규
    case 추가 site).
  - `src-tauri/src/models/schema.rs:15-25` — `ColumnInfo`
    (`is_primary_key: bool`).
  - `src/components/rdb/DataGrid.tsx:179-182` — `orderBy = sorts.length
    > 0 ? join(',') : undefined` (frontend 송신 site, 변경 없음).
  - `src/lib/tauri/query.ts:5-25` — `queryTableData` IPC wrapper.
  - `src/stores/schemaStore.ts:245-265` — store-level delegation.
  - `docs/PLAN.md:151-158` — Feature sequencing 표 (post-225 cycle, 7번
    row 갱신 대상).
  - `docs/sprints/sprint-231/contract.md` — 직전 sprint 컨트랙트
    (format reference).
