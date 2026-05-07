# Sprint Contract: sprint-232

## Summary

- Goal: DataGrid의 RDB 테이블 view 가 user 가 명시적인 sort 를 누르지
  않은 초기 상태에서도 PG heap order 가 아닌 결정적인 PK ASC 순서로
  rendering 되도록 한다. 부수효과로 사용자가 보고한 "UPDATE 한 row 가
  맨 아래로 내려가는 버그" (PG 가 dead tuple + new tuple-at-tail 로
  처리하기 때문) 가 동시 해결된다. 단일 root cause = `query_table_data`
  의 `order_by = None` 분기에서 ORDER BY 절이 emit 되지 않는 것.
- Audience: 2026-05-07 사용자 보고 — "기본적으로 id 기반으로 sorting
  하게 해주고, update 했을 때 update 한 row 가 가장 밑으로 내려가는
  버그 수정해줘". Phase 5 Sprint 62 cycle (DataGrid UX) 의 잔존 항목.
- Owner: harness Generator
- Verification Profile: `command + static`

## In Scope

- `src-tauri/src/db/postgres/queries.rs` 의 `query_table_data` 함수
  (line 378-573) — `order_by` 파라미터가 `None` 이거나, `Some(...)`
  이지만 split 후 valid part 가 0 인 경우, fallback 으로 table 의 PK
  컬럼 (`columns: Vec<ColumnInfo>` 의 `is_primary_key == true`) 들을
  declared order 그대로 `"col" ASC, …` 으로 ORDER BY 절에 emit. PK 가
  하나도 없으면 ORDER BY 미발생 (현행 보존).
- 동일 파일 `mod tests` 에 SQL-builder 단위 테스트 4-5건 신설 — pure
  helper 가 없으므로 default ORDER BY 도출 로직만을 추출한 free
  function `build_default_order_clause(columns: &[ColumnInfo]) -> String`
  를 도입하고 그 함수를 직접 호출해서 fixture assertion. 호환을 위해
  `query_table_data` 본문도 동일 helper 를 사용하도록 wired.
- `executed_query` 가 사용자에게 노출하는 SQL 문자열도 같은 helper 의
  결과를 그대로 반영 — 사용자가 grid 의 bottom strip / history 에서
  보는 SQL 이 `ORDER BY "id" ASC LIMIT 300 OFFSET 0` 형태로 출력된다.
- TDD: 테스트 먼저 작성 → 빨강 (현재 코드는 helper 미존재 → compile
  error 또는 helper 호출 시 빈 string 이 emit 되는 것을 RED 로 캡처)
  → 구현 → 초록.

## Out of Scope

- Frontend `DataGrid.tsx` (rdb) 의 `sorts` state 또는 컬럼 헤더 클릭
  UI — 이미 정상 동작. user-explicit sort 는 우선순위가 높고 현재
  코드 그대로 backend 로 전달됨.
- `DocumentDataGrid` (Mongo) — Mongo 는 `_id` natively ordering, 변경
  불필요.
- DESC default — id ASC 가 정규 컨벤션. 후속 사용자 요청이 들어오면
  별도 sprint.
- Multi-column user sort UI — 별도 backlog.
- Sprint 233/234 항목 (UPDATE SET autocomplete / 종합 polish).
- `splitSqlStatements`, `analyzeStatement`, `decideSafeModeAction`,
  Safe Mode store/lib body — Sprint 231 freeze 그대로.
- 모든 Sprint 226-231 frozen file (CreateTableDialog tabs / 백엔드
  `create_table` / `create_index` / `add_constraint` / `list_types`
  fixture / `useDdlPreviewExecution` / `SqlPreviewDialog` /
  `cross-window-*` / `connectionStore` / `schemaStore` / `safeModeStore`
  / `safeMode.ts` / `sqlSafety.ts` / `useQueryExecution.ts` /
  `QueryTab.tsx` / `ConnectionDialogBody.tsx`).

## Invariants

- Sprint 226-231 backend fixture (`create_table` 16/16, `create_index`
  11/11, `add_constraint` 12/12, `list_types` 2/2) byte-equivalent
  PASS.
- `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` /
  `cross-window-*.test.tsx` / `window-lifecycle.ac141.test.tsx` /
  `connectionStore.ts` / `schemaStore.ts` / `safeModeStore.ts` /
  `src/lib/safeMode.ts` / `src/lib/sql/sqlSafety.ts` /
  `useQueryExecution.ts` / `QueryTab.tsx` / `ConnectionDialogBody.tsx`
  diff = 0.
- 사용자가 `order_by = Some("name DESC")` 를 보낸 explicit 케이스에서는
  현행 emit (`ORDER BY "name" DESC`) 그대로 — fallback 발동 안 함
  (override 우선).
- 사용자가 `order_by = Some("nonexistent_col ASC, garbage")` 처럼 모든
  parts 가 invalid 일 때만 fallback 발동. 이는 명시적 의도 (모든
  part 가 invalid = 사실상 None 과 동치) 로 간주.
- 신규 `it.skip` / `eslint-disable` / `any` / silent `catch{}` 0.
- Frontend test (vitest) 변경 0 — backend-only 변화 + executed_query
  string 만 영향, 기존 frontend assertion 은 default value (`undefined`)
  을 보내고 있으므로 mock 답변에는 의존하지 않음.

## Acceptance Criteria

- `AC-232-01` — `query_table_data(... order_by = None ...)` 호출 후,
  `columns` 에 `is_primary_key == true` 인 컬럼이 ≥ 1 개 있으면 빌드된
  SQL 의 `executed_query` 필드가 `ORDER BY "<pk1>" ASC[, "<pk2>"
  ASC …]` 절을 포함한다 (PK 컬럼은 `columns` 의 declared 순서). 동일
  결정이 `count_sql` 과 무관함 (COUNT 는 ORDER BY 영향 없음 — 변경 X).

- `AC-232-02` — `query_table_data(... order_by = Some("name DESC") ...)`
  호출 후, ORDER BY 가 사용자 입력 그대로 (`ORDER BY "name" DESC`)
  emit. PK fallback 발동 안 함. 사용자 입력에 valid + invalid 가
  mixed 인 경우 (예: `"name DESC, garbage_col ASC"`), 기존 behavior
  보존 — valid part 만 emit (`ORDER BY "name" DESC`), fallback 발동
  안 함.

- `AC-232-03` — `columns` 에 `is_primary_key == true` 가 0 인 테이블에
  대해 `order_by = None` 호출 → ORDER BY 절 미emit (현행 보존). SQL
  은 `SELECT * FROM ... [WHERE ...] LIMIT N OFFSET M` 으로 끝난다.
  Sprint 226-231 invariant 와 호환 — 기존 behavior 변경 없음.

- `AC-232-04` — `executed_query` 필드 (사용자에게 grid bottom strip /
  history 패널 / `executed_query` API surface 에 노출되는 SQL 문자열)
  가 effective ORDER BY 절을 그대로 반영. 백엔드가 자동으로 채운
  fallback 도 사용자에게 visible — 디버깅 가능 (사용자가 "왜 id ASC
  로 sort 됐지?" 라고 물으면 SQL 문자열로 즉시 확인).

- `AC-232-05` — Rust 단위 테스트 신규 ≥ 5 case (`mod tests` 안):
  1. `[AC-232-01] build_default_order_clause_single_pk` — `vec![pk("id"), col("name")]` 입력
     → `" ORDER BY \"id\" ASC"`.
  2. `[AC-232-01] build_default_order_clause_composite_pk` — `vec![pk("tenant_id"),
     pk("user_id"), col("email")]` 입력 → `" ORDER BY \"tenant_id\" ASC, \"user_id\" ASC"`.
  3. `[AC-232-03] build_default_order_clause_no_pk_returns_empty` — `vec![col("a"),
     col("b")]` 입력 → `""`.
  4. `[AC-232-01] build_default_order_clause_quotes_embedded_double_quote` — `vec![pk("we\"ird")]`
     입력 → `" ORDER BY \"we\"\"ird\" ASC"` (PG identifier escape rule 유지).
  5. `[AC-232-02] build_default_order_clause_returns_empty_for_zero_pk_does_not_clobber_user_input` —
     별개 test 가 아닌 documentation test. user override 우선순위는 `query_table_data`
     호출자 책임이므로, helper 자체는 PK 만 본다는 invariant 를 명시.
  추가:
  6. `[AC-232-01 회귀]` — Sprint 226 fixture pattern 답습한 `users` 테이블
     mock columns (id pk + name + email) 로 helper 호출 → 정확히 `"id" ASC`
     하나만 emit. 사용자의 UPDATE-row-shifts 시나리오에 대한 deterministic
     보증.

- `AC-232-06` — Sprint 226-231 회귀 0. 4-set verification (`pnpm vitest
  run` / `pnpm tsc --noEmit` / `pnpm lint` / `cargo build --manifest-path
  src-tauri/Cargo.toml`) exit 0. `cargo clippy --manifest-path
  src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  exit 0. `cargo test --manifest-path src-tauri/Cargo.toml` PASS —
  `create_table` 16/16, `create_index` 11/11, `add_constraint` 12/12,
  `list_types` 2/2, 기타 baseline 동일.

- `AC-232-07` — `docs/PLAN.md` Feature sequencing (post-225 cycle) 표
  7번 row 를 다음으로 갱신 — placeholder `Phase 27 sprint 6 폴리시
  후보` 에서 실제 Sprint 232 ✓ row 로 전환:
  ```
  | 7 | **232** ✓ | feature | (Phase 5 잔존) | DataGrid default ORDER BY by PK …
  ```
  Sprint 232 row 의 placeholder text 는 Sprint 233/234 row 로 분리
  (별도 row 추가).

## Design Bar / Quality Bar

- Helper 추출: `build_default_order_clause(columns: &[ColumnInfo]) ->
  String` — `query_table_data` 본문 안의 inline 로직이 아닌 free
  function 으로 분리한다. 이유: (a) 테스트 가능성 (현재 SQL builder
  inline logic 은 pool-bound `query_table_data` 함수 안에 있어 unit
  test 가 곤란), (b) 후속 sprint 에서 다른 RDB adapter 가 같은 helper
  를 재사용 가능 (현재는 PG only 구현이지만 helper 자체는 PG-specific
  identifier 인용만 의존).
- Helper signature: `pub(super) fn build_default_order_clause(columns:
  &[ColumnInfo]) -> String`. 반환값은 `" ORDER BY ..."` (선두 공백 포함)
  또는 빈 string. 호출자가 직접 `format!("... {}{} LIMIT ...",
  where_clause, order_clause, ...)` 패턴에 그대로 흡수 가능.
- `query_table_data` 본문에서 `order_clause` 가 user-supplied path
  이후에도 빈 string 이면 `order_clause =
  build_default_order_clause(&columns);` 한 줄 추가. 기존 user-
  supplied parsing 로직은 byte-equivalent 보존.
- Identifier quoting: `"<col>"` 형태 PG 표준. embedded `"` 는 `""`
  로 escape (existing convention `replace('"', "\"\"")` 답습).
- 새 vitest case 는 0 — backend-only 변경. Frontend `DataGrid.tsx`
  `sorts.length === 0` 일 때 `orderBy = undefined` 로 보내는 것을
  유지 (line 179-182) — fallback 발동 trigger.
- 모든 새 Rust test case 에 작성 사유 + 날짜 (2026-05-07) 1줄 주석.

## Verification Plan

### Required Checks

1. `pnpm vitest run` PASS — file count ≥ 220 (≥ Sprint 231) — 변경
   없이 그대로.
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
    ≥ 1 hit (PK fallback wiring).
12. `grep -nE 'build_default_order_clause'
    src-tauri/src/db/postgres/queries.rs` ≥ 2 hits (declaration + call
    site + ≥ 4 test references).

### Required Evidence

- Generator must provide:
  - 변경 파일 표 (file → purpose) — 최소 3 파일
    (`queries.rs` / `docs/PLAN.md` /
    `docs/sprints/sprint-232/{contract.md,execution-brief.md,findings.md,
    handoff.md,tdd-evidence/red-state.log}`).
  - cargo test before/after count.
  - AC-232-NN ↔ Rust test name + line table.
  - 12 verification check 결과.
  - Frontend 변경 여부 audit (예상: diff = 0).
  - TDD red→green capture
    (`docs/sprints/sprint-232/tdd-evidence/red-state.log`).
  - Assumption + residual risk.
- Evaluator must cite:
  - 각 AC 별 test case + line.
  - 12 verification check 별 PASS/FAIL.
  - 사용자 repro scenario (UPDATE → re-fetch → row stays at id-ordered
    position) 의 unit-level 보증 근거 (deterministic ORDER BY).

## Test Requirements

### Unit Tests (필수)

- AC-232-01 (default fallback) ↔ ≥ 2 case (single PK / composite PK).
- AC-232-02 (user override 우선) ↔ helper 자체는 PK only — invariant
  comment 만 (caller-level integration test 는 OOS, helper 에 user
  param 안 넘김).
- AC-232-03 (no PK) ↔ ≥ 1 case (empty string 반환).
- AC-232-04 (quote escape) ↔ ≥ 1 case (embedded `"` 인 PK column
  이름).
- AC-232-05 (regression baseline) ↔ ≥ 1 case (users-style mock).

### Coverage Target

- `build_default_order_clause` 신규 라인 100% (5 case 가 모든 분기
  커버 — empty/single/composite/escape/users-mock).
- 전체 CI 기준 (라인 40% / 함수 40% / 브랜치 35%) 동결.

### Scenario Tests (필수)

- [x] Happy path — single PK `id` ASC fallback (AC-232-01 case 1).
- [x] 경계 조건 — composite PK 순서 보존 (case 2), no PK
  (case 3), embedded `"` (case 4).
- [x] 에러/예외 — N/A (helper 는 throw 없음, 빈 vector → 빈 string).
- [x] 기존 기능 회귀 없음 — Sprint 226-231 frozen fixture 유지.

## Test Script / Repro Script

1. (현재 상태 — fix 전) `pnpm tauri dev` → PG 테이블 (예: `users`,
   PK `id`) 열기 → 기본 sort 없이 그대로 → 임의 row 의 셀 더블클릭
   → 값 변경 → Save → re-fetch. **회귀**: 변경된 row 가 grid 의
   가장 마지막 행으로 이동.
2. (fix 후) 동일 단계 → Save → re-fetch → 변경된 row 가 `id` 정렬
   기준으로 원래 위치 유지. SQL bottom strip / history 에 `ORDER BY
   "id" ASC LIMIT 300 OFFSET 0` 표기.
3. (fix 후) composite PK 테이블 (예: `tenant_user (tenant_id,
   user_id)`) → re-fetch SQL 에 `ORDER BY "tenant_id" ASC, "user_id"
   ASC` 표기.
4. (fix 후) PK 없는 view 또는 unlogged 테이블 → re-fetch SQL 에
   ORDER BY 절 없음 (현행 보존). Heap order 그대로 — 사용자 인지
   필요.
5. (fix 후) 사용자가 컬럼 헤더 클릭 → `name DESC` sort → re-fetch SQL
   에 `ORDER BY "name" DESC` (override 우선).

## Ownership

- Generator: harness Generator agent.
- Write scope:
  - `src-tauri/src/db/postgres/queries.rs` (helper + call site + test
    module 확장).
  - `docs/PLAN.md` (sequencing 표 7번 row 갱신).
  - `docs/sprints/sprint-232/{contract.md,execution-brief.md,findings.md,
    handoff.md,tdd-evidence/red-state.log}`.
- Merge order: 단일 commit. tree 단위 1-commit (per
  `feedback_sprint_comment_cleanup.md`).

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- 12 verification checks 모두 PASS.
- 7 acceptance criteria 모두 evidence 와 함께 `handoff.md` 에 링크.
- `docs/PLAN.md` 7번 row 가 ✓ 로 갱신.
- `docs/sprints/sprint-232/tdd-evidence/red-state.log` 가 RED 상태를
  보존.
- 사용자 repro 시나리오 (Test Script 1 → 2) 가 fix 후 deterministic
  하게 동작.
