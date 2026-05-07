# Sprint 232 — Findings

Date: 2026-05-07.
Owner: harness Generator.

## Decisions / Tradeoffs

### 1. Free function vs inline branch

`build_default_order_clause` 는 free `pub(super) fn` 으로 추출했다.
대안은 `query_table_data` 본문 안에 `if order_clause.is_empty() { …
columns.iter().filter(…) … }` inline. inline 이 더 짧지만 unit
테스트가 곤란 — `query_table_data` 는 `PgPool` bound 이라 mock 없이는
호출 불가. helper 추출 비용 = 18 줄 (선언 + doc) 대비 이득 = 6 case
가 pool 없이 deterministic 검증 + 후속 sprint 가 다른 RDB adapter 에
재사용 시 변경 0. 비용/이득 명확.

### 2. user override 우선순위는 helper 가 아니라 caller 결정

`build_default_order_clause(columns)` 는 user `order_by` 를 보지
않는다. caller (`query_table_data`) 가 user-supplied path 를 먼저
실행하고, 그 결과가 비어 있을 때만 helper 를 호출. 이렇게 하면
helper 가 단순해지고 (PK 만 본다), 후속 sprint 가 fallback 로직만
바꾸고 싶을 때 user-parse 코드를 건드리지 않아도 된다.

### 3. PK 0 → 빈 string (현행 보존)

PK 가 없는 view / unlogged 테이블 / PK constraint 없이 import 된
테이블은 fallback 발동하지 않고 ORDER BY 미emit (현행). 이유:
non-PK 컬럼을 임의로 sort 하면 (a) 어떤 컬럼인가에 대한 의도가
모호해지고, (b) PK index hit 가 아닌 sequential scan + sort 가
발생해 큰 테이블에서 성능 회귀. Sprint 232 의 회귀 closure 는
PK 가 있는 일반 테이블 한정으로도 충분 (사용자 보고된 시나리오 =
`UPDATE` 가능한 일반 row, 즉 PK 있는 테이블).

### 4. `id ASC` 가 아니라 PK ASC

사용자 요청은 "id 기반". 하지만 일부 테이블의 PK 는 `id` 가 아닐
수 있다 (예: composite PK, 또는 `uuid` 컬럼명, `users_id` 등).
`columns` 의 `is_primary_key` 가 source of truth — `id` 라는 이름에
hard-code 하지 않는다. composite PK 도 declared 순서대로 ASC chain.
사용자가 의도한 정신 (`row 가 deterministic 한 자리에 머물러야
한다`) 은 PK ASC 로 정확히 충족된다.

### 5. Frontend 변경 0

`DataGrid.tsx` (rdb) 는 이미 `sorts.length === 0 ? undefined :
sorts.map(...).join(', ')` 로 `orderBy` 를 보낸다 (line 179-182).
fallback 은 이 `undefined` (= Tauri payload `null` = backend `None`)
경로에서 발동. user 가 컬럼 헤더 클릭하면 `sorts.length > 0` 이
되고 backend 가 user override 경로로 들어가므로 fallback 발동
안 함. Frontend 코드 변경 = 0, frontend test 변경 = 0.

### 6. AC-232 audit — Frontend 변경 필요 여부

Audit 결과: 필요 없음. 근거:
- `src/components/rdb/DataGrid.tsx:179-182` — `sorts.length === 0`
  일 때 `orderBy = undefined` 송신. 이미 fallback trigger.
- `src/lib/tauri/query.ts:5-25` — `queryTableData(... orderBy?: string,
  ...)` 의 `orderBy ?? null` → backend `Option<&str>::None`.
- `src/stores/schemaStore.ts:245-265` — store-level pass-through.
- `src/components/datagrid/*` — DocumentDataGrid (Mongo) 는 별개
  paradigm, 변경 없음.
- 기존 frontend test (`DataGrid.sort.test.tsx` / `schemaStore.test.ts`)
  는 mock 의 응답값에만 의존하고 `orderBy` 인자가 `undefined` 인지
  검증. 변경 없음.

## RED → GREEN

`docs/sprints/sprint-232/tdd-evidence/red-state.log` 에 cargo
compile error 11건 (E0425 cannot find function in this scope) 보존.
helper 구현 후 cargo test 6/6 PASS:

```
test db::postgres::queries::tests::build_default_order_clause_empty_columns_returns_empty ... ok
test db::postgres::queries::tests::build_default_order_clause_no_pk_returns_empty ... ok
test db::postgres::queries::tests::build_default_order_clause_composite_pk ... ok
test db::postgres::queries::tests::build_default_order_clause_users_table_regression ... ok
test db::postgres::queries::tests::build_default_order_clause_single_pk ... ok
test db::postgres::queries::tests::build_default_order_clause_quotes_embedded_double_quote ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 375 filtered out
```

## Risks / Followups

1. **PK index 가 없는 edge case**: PG 의 `pg_constraint` 는 PK
   constraint 가 있는데 underlying btree index 가 corrupt 되거나
   manually drop 된 경우에도 `is_primary_key == true` 를 그대로
   반환할 수 있음. 이런 비정상 상태에서는 ORDER BY 가 sequential scan
   + sort 로 대체되어 큰 테이블에서 latency spike 가능. 그러나 본 sprint
   는 schema fetch 의 PK derivation 을 신뢰하므로 OOS — 별도 hardening
   sprint.

2. **non-RDB paradigm**: MongoDB / SQLite / MySQL adapter 는 본 sprint
   의 helper 를 호출하지 않음. SQLite/MySQL 도 같은 회귀가 있을
   수 있으나 (현행 verify 필요) 본 sprint 에서는 PG only. 사용자 보고는
   PG 한정.

3. **multi-column user sort UI 와의 상호작용**: Sprint 234 의 column
   reorder ↑↓ 가 `sorts` array 를 multi-element 로 만들면 user
   override 경로로 들어감 — fallback 발동 안 함. 두 sprint 간 충돌
   없음.

4. **User `order_by = Some("garbage_col_only")`** (모든 valid part
   == 0): 기존 `order_clause = String::new()` 그대로 → fallback 진입
   = PK ASC. 이는 의도된 동작 (모든 part 가 invalid 라면 default 가
   더 안전). 만약 사용자 의도가 "ORDER BY 없음" 이라면 frontend 가
   `orderBy = ""` 또는 sentinel 을 보내야 하는데, 현재는 그런 path
   없음. 후속 sprint 에서 sentinel 도입 시 helper signature 확장 가능.

5. **수정 row 의 visual feedback**: PK ASC fallback 만으로는 사용자가
   "내가 방금 수정한 row 가 어느 자리에 있는지" 를 시각적으로
   확인하기 어렵다. Sprint 234 polish 의 cross-tab visual feedback
   항목과 묶어서 row highlight 로 보강 가능 — 별도 issue.

## References

- Contract: `docs/sprints/sprint-232/contract.md`
- Brief: `docs/sprints/sprint-232/execution-brief.md`
- RED log: `docs/sprints/sprint-232/tdd-evidence/red-state.log`
- Code:
  - `src-tauri/src/db/postgres/queries.rs:21-49` — helper 정의 (Sprint 232 doc + body).
  - `src-tauri/src/db/postgres/queries.rs:556-572` — `query_table_data` call site.
  - `src-tauri/src/db/postgres/queries.rs:826-959` — `mod tests` Sprint 232 block.
- Frontend audit:
  - `src/components/rdb/DataGrid.tsx:179-182` — orderBy 송신 (변경 0).
  - `src/lib/tauri/query.ts:5-25` — IPC wrapper (변경 0).
  - `src/stores/schemaStore.ts:245-265` — store delegation (변경 0).
