# Sprint Contract: sprint-311 (Phase 28 Slice A5 — Run dispatch parser-driven, 6 read methods)

## Summary

- Goal: `useQueryExecution.ts` 의 document-paradigm Run 분기를
  `parseMongoshExpression` (A1) 로 갈아끼우고, 6 read method
  (`find`/`findOne`/`aggregate`/`countDocuments`/`estimatedDocumentCount`/
  `distinct`) 를 A2 의 신규 IPC 로 dispatch. `tab.queryMode` 기반 분기 제거.
- Verification Profile: `mixed` (RTL + 회귀)

## In Scope

- `src/components/query/QueryTab/useQueryExecution.ts` — document Run 분기
  전체 교체.
- `src/components/query/QueryTab/useQueryExecution.test.ts(x)` — 6 method
  dispatch 테스트 + parser-error case + collection mismatch case.
- `src/components/query/QueryTab/queryHelpers.ts` (옵션) — dispatch helper
  추출 시 사용.
- `src/types/query.ts` — `QueryResult` 가 `resultKind?: "grid" | "scalar"
  | "list"` 추가 (count/distinct 의 scalar/list 표시를 위해; rendering
  분기는 A6 가 polish — A5 는 wire 만).
- `src/stores/queryHistoryStore.ts` (또는 동등) — JSDoc: document
  paradigm entry 의 `queryMode` 는 parsed method 이름이 들어감.
- 관련 test files — `tab.queryMode === "aggregate"` 분기 가정 삭제.

## Out of Scope

- Write methods (insertOne/insertMany/updateOne/updateMany/deleteOne/
  deleteMany/bulkWrite) — A6 (Sprint 312).
- Scalar/list result panel 의 렌더링 polish (A6).
- Editor surface 변경 (A3 동결).
- snippet menu (A4 동결).
- mongoshParser 자체 (A1 동결).
- RDB Run dispatch — 손대지 않음.
- `src-tauri/`.

## Invariants

- **RDB 회귀 zero**: SQL paradigm Run 동작 비변경.
- **Safe Mode aggregate gate 유지**: `analyzeMongoPipeline` +
  `safeModeGate.decide` 가 parser 가 추출한 pipeline 위에서 그대로 동작.
  STOP-tier → `ConfirmDestructiveDialog`, WARN-tier → `MqlPreviewModal`.
- **`pendingMongoConfirm` 가 parsed pipeline 보유**: 다이얼로그 confirm
  시 editor text 를 다시 파싱하지 않음. editor 가 dialog 중간에 바뀌어도
  처음 파싱된 값 사용.
- **No `any`** in TS, function components, interface for props.
- **Sprint header comment** Sprint 311.
- **TDD vertical slice** — method 1개씩 RED → GREEN.

## Acceptance Criteria

- **AC-01** Document Run 이 `parseMongoshExpression(sql)` 를 우선 호출.
  파서 에러 시 `queryState.error` 로 메시지 노출, IPC 미호출. RTL.
- **AC-02** `tab.collection` 이 set 이고 parsed collection 과 다르면
  `queryState.error` 가 `"Editor targets collection 'X' but tab is bound
  to 'Y'."` (또는 동등 정확 메시지) 로 설정. `tab.collection` unset 인
  free-form tab 은 parsed collection 사용. `tab.database` 는 항상 tab 의
  것 사용.
- **AC-03** Method dispatch:
  - `find(filter, options?)` + cursor chain → `findDocuments` with
    FindBody shape (`sort`/`limit`/`skip`/`projection`). `.toArray()` 는
    no-op.
  - `findOne(filter, options?)` → `findOneDocument` IPC → 단일 row
    QueryResult (A6 가 scalar panel 로 polish; A5 는 grid 의 단일 row).
  - `aggregate(pipeline)` → `aggregateDocuments` + Safe Mode gate.
    `.toArray()` 허용 + 무시.
  - `countDocuments(filter)` → `countDocuments` IPC → 1col(`count`)/1row
    QueryResult, `resultKind: "scalar"`.
  - `estimatedDocumentCount()` → `estimatedDocumentCount` IPC → 동일
    scalar shape.
  - `distinct(field, filter?)` → `distinctDocuments` IPC → 1col(`value`)/
    N row QueryResult, `resultKind: "list"`.
- **AC-04** Aggregate STOP-tier (`$out`/`$merge`) → `pendingMongoConfirm`
  설정. confirm 콜백이 **처음 파싱된 pipeline** 으로 재실행 — editor 가
  바뀌어도 영향 없음. RTL: editor 텍스트 변경 후 confirm 클릭 → 첫 파싱된
  pipeline 으로 IPC.
- **AC-05** Query history (`useQueryHistoryStore`) 가 raw mongosh expression
  (`sql` 그대로) + `paradigm: "document"` 를 기록. `queryMode` 필드는 parsed
  method 이름 (`"find"`, `"aggregate"`, `"countDocuments"` 등) 보관 — 기존
  filter/search UI 가 호환.
- **AC-06** Backend IPC 에러 (namespace 빈값 / driver fail) → `queryState.error`
  로 동일하게 surface. cancel-token flow 는 find/aggregate (A2 가 cancel
  지원) 에서 유지.
- **AC-07** `tab.queryMode === "aggregate"` 분기 로직이 더 이상 dispatch
  결정에 영향을 미치지 않음. `grep -n "tab.queryMode" src/components/query/QueryTab/useQueryExecution.ts`
  의 결과가 (a) 0 매치, 또는 (b) history backwards-compat 기록 외에는
  없음.
- **AC-08** `pnpm vitest run` exit 0, sprint-310 baseline 3548 / 10 skipped
  대비 회귀 0 (A5 신규 테스트 증가는 허용).
- **AC-09** `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` 0.
- **AC-10** `QueryResult.resultKind` 가 type 에 추가됨 — `"grid" | "scalar"
  | "list" | undefined` (A6 가 `"writeSummary"` 추가). 기존 사용처는
  optional 이라 회귀 없음.

## Verification Plan

### Required Checks

1. `pnpm vitest run` exit 0 + baseline 매칭
2. `pnpm tsc --noEmit` exit 0
3. `pnpm lint` exit 0
4. `pnpm build` exit 0
5. RTL — 6 method dispatch (각 IPC mock + parsed expression 입력)
6. RTL — parser error → queryState.error
7. RTL — collection mismatch → queryState.error
8. RTL — confirm 콜백이 stale editor text 영향 안 받음

### Required Evidence

- 변경 파일 + 목적
- 각 method dispatch test name
- baseline vitest 매칭 (3548)
- parser/collection mismatch test name
- pendingMongoConfirm 가 stale pipeline 사용 안 함을 lock 한 test name

## Exit Criteria

- 모든 AC 통과
- Sprint 311 commit ready
