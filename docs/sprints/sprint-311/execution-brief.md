# Sprint Execution Brief: sprint-311 (Phase 28 Slice A5 — Run dispatch, 6 read methods)

## Objective

document-paradigm Run dispatch 를 mongosh 파서 기반으로 갈아끼움. 6 read
method (find/findOne/aggregate/countDocuments/estimatedDocumentCount/distinct)
를 A2 의 IPC 로 라우팅. Aggregate Safe Mode gate 유지. `tab.queryMode` 기반
분기는 dispatch 에서 제거 (history backwards-compat 만 잔존).

## Task Why

A3 가 토글을 지웠고 A4 가 snippet 메뉴를 깔았지만, 실제 Run 동작은 여전히
JSON.parse + queryMode 분기로 옛 방식이다. 사용자가 mongosh 표현식을 쳐도
파싱 안 됨 = 끝까지 안 통함. A5 가 이걸 연결한다.

Safe Mode aggregate gate (`$out`/`$merge` 차단/확인) 는 production
guardrail 이라 dispatch 교체 중에도 절대 회귀해선 안 됨.

## Scope Boundary

**Touch**:
- `src/components/query/QueryTab/useQueryExecution.ts`
- `src/components/query/QueryTab/useQueryExecution.test.ts(x)`
- `src/components/query/QueryTab/queryHelpers.ts` (옵션)
- `src/types/query.ts` (`resultKind` field)
- `src/stores/queryHistoryStore.ts` (JSDoc)
- 관련 영향 test files

**DO NOT touch**:
- write-path dispatch (A6)
- result panel 렌더링 polish (A6)
- editor surface (A3 동결)
- snippet menu (A4 동결)
- parser (A1 동결)
- backend (A2 동결)
- RDB editor

## Invariants

- RDB Run 비변경
- Safe Mode aggregate gate (STOP/WARN/INFO 행동) 100% 유지
- `pendingMongoConfirm` 가 처음 파싱된 pipeline 보유 (stale editor 영향 없음)
- No `any`, interface for props, function components only
- Sprint header comment 311
- TDD vertical slice — method 한 번에 하나씩

## Done Criteria

1. `pnpm vitest run` 통과 + 3548 baseline 매칭 (신규 테스트는 증가 허용)
2. `pnpm tsc --noEmit` / `lint` / `build` 0
3. 6 method dispatch RTL 통과 — 각 method 마다 parsed expression → 해당 IPC
4. parser-error / collection-mismatch RTL 통과
5. Aggregate STOP confirm 시 stale editor 영향 없음 RTL 통과
6. Query history 가 raw mongosh + parsed method 이름 기록 (단위)
7. `QueryResult.resultKind` 추가 + scalar/list 케이스 wire (rendering 은 A6)
8. `tab.queryMode === "aggregate"` 분기 dispatch 결정에서 제거
9. Sprint 311 마커 헤더 코멘트

## Verification Plan

- Profile: `mixed` (RTL + 회귀)
- Checks: vitest / tsc / lint / build / RTL 6+1+1+1 / grep `tab.queryMode`

## Evidence To Return

- 변경 파일 목록 + 목적
- 6 dispatch test name + parser-error / mismatch test name
- baseline vitest 매칭
- 자율 결정 (D-10+, dispatch helper 추출 여부, FindBody 변환 로직 위치 등)

## TDD Workflow Reminder

수직 슬라이스 — 권장 순서 (tracer 부터 복잡도 오름차순):
1. `find` parsed expression → `findDocuments` dispatch (가장 가깝게 기존
   동작 일치)
2. `aggregate` parsed pipeline → `aggregateDocuments` + Safe Mode gate 유지
3. parser-error → queryState.error (실패 경로)
4. collection mismatch → queryState.error
5. `countDocuments` → scalar QueryResult
6. `estimatedDocumentCount` → scalar
7. `distinct` → list
8. `findOne` → 단일 row grid
9. pendingMongoConfirm stale-editor 격리

각 슬라이스 RED → GREEN.

## References

- `docs/sprints/sprint-311/contract.md`
- `docs/sprints/sprint-307/spec.md` (A5 섹션)
- `docs/archives/phases/retired/phase-28-decision-log.md` — D-10+ 부터
- `src/lib/mongo/mongoshParser.ts` (A1)
- `src/lib/tauri/document.ts` — 6 IPC wrapper (A2 산출물)
- `src/lib/mongo/mongoSafety.ts` — `analyzeMongoPipeline`
- `src/hooks/useSafeModeGate.ts`
