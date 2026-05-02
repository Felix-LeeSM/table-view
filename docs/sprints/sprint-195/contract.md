# Sprint 195 — Contract

Sprint: `sprint-195` (refactor / drive-by — `tabStore` intent-revealing
actions).
Date: 2026-05-02.
Type: refactor (Sprint 196 의 `source` 필드 토대).

`docs/refactoring-plan.md` Sprint 195 row + smell §3.1 (UI 가
`tabStore.setState` 로 queryState 직접 교체). QueryTab.tsx 의 7 사이트
가 같은 guarded `running → completed | error` 패턴을 inline 으로 풀어
쓰고 있음. Sprint 196 의 query history `source` 필드 추가가 7 사이트
× 6 history call 을 다시 건드리지 않도록 **action 표면 1 곳 만들고**
호출지를 그 위로 옮긴다. Sprint 196 의 callsite 변경은 0 — 액션
시그니처에 인자 1 개 추가만으로 끝나도록 설계.

## Sprint 안에서 끝낼 단위

- `tabStore` 에 신규 3 action 추가:
    - `completeQuery(tabId, queryId, result)` — 가드:
      `tab.queryState.status === "running"` AND `queryState.queryId === queryId`.
      통과 시 `{ status: "completed", result }` 로 전이. 미스매치는 stale
      응답으로 간주, no-op (기존 inline 가드와 동치).
    - `failQuery(tabId, queryId, errorMessage)` — 위와 동일 가드, 통과
      시 `{ status: "error", error }`.
    - `completeMultiStatementQuery(tabId, queryId, payload)` — multi-stmt
      시나리오. payload 은 `{ statementResults, lastResult, allFailed }`.
      가드는 위 2 와 동일. 통과 시 allFailed → `error`, 그 외 →
      `completed` (with `statementResults` + `result: lastResult`).
- `tabStore` 에 history wrapper 액션 추가:
    - `recordHistory(tabId, payload)` — tab 의 `connectionId / paradigm /
      queryMode / database / collection` 을 자동 추출해
      `queryHistoryStore.addHistoryEntry` 로 dispatch. payload 은 `{ sql,
      executedAt, duration, status }`. tab 이 `query` type 이 아니거나
      찾지 못하면 silent no-op (테스트 fixture 보호).
- QueryTab.tsx 의 7 setState site → 신규 action 호출로 치환.
- QueryTab.tsx 의 6 `addHistoryEntry({ ... })` 호출 → `recordHistory`
  로 치환.
- 회귀 0 — 모든 기존 QueryTab / tabStore / queryHistory 테스트 무수정
  통과.

## Acceptance Criteria

### AC-195-01 — `completeQuery` / `failQuery` 가드 시맨틱

신규 action 의 가드는 inline 시그니처와 동치.

- `completeQuery` / `failQuery` 는 (a) tab 미존재 / (b) `type !== "query"`
  / (c) `queryState.status !== "running"` / (d) `queryState.queryId !==
  queryId` 4 조건 중 하나 발생 시 no-op (state 미변경).
- 통과 시 해당 tab 의 `queryState` 만 `{ status, result | error }` 로
  교체. 다른 tab / 다른 필드 (sql, queryMode 등) 는 보존.

테스트: `src/stores/tabStore.test.ts` 신규 `[AC-195-01-1..6]` —
- complete: 가드 4 분기 + 통과 + 다른 tab 보존 = 6 case.
- fail: 동일 패턴 6 case.

### AC-195-02 — `completeMultiStatementQuery` allFailed 분기

multi-statement payload 의 `allFailed` 가 true 면 error, 그 외 completed.

- `allFailed === true` → `{ status: "error", error: <joined> }`.
- `allFailed === false` → `{ status: "completed", result: lastResult,
  statementResults }`.
- 가드는 위와 동일.

테스트: `[AC-195-02-1..3]` — allFailed / partial / all-success 3 case.

### AC-195-03 — `recordHistory` tab metadata 자동 추출

`recordHistory(tabId, { sql, executedAt, duration, status })` 호출이
queryHistoryStore 에 entry 1 개 등재. paradigm / queryMode / connectionId
/ database / collection 은 tab 에서 자동 추출.

- tab 이 query type 이면 위 5 필드 자동 반영.
- tab 이 query type 이 아니거나 미존재면 silent no-op (history 미등재).

테스트: `[AC-195-03-1..3]` — query tab / non-query tab / 미존재 tab
3 case.

### AC-195-04 — QueryTab.tsx callsite migration

`useTabStore.setState((state) => ...)` 의 7 사이트 모두 신규 action
호출로 치환. `addHistoryEntry({ ... 명시적 6 필드 ... })` 의 6 사이트
모두 `recordHistory(tab.id, { ... 4 필드 ... })` 로 치환.

- `git grep "useTabStore.setState" src/components/query/` → 0 hit.
- `git grep "addHistoryEntry" src/components/query/QueryTab.tsx` →
  0 hit (wrapper 가 대신 호출).

### AC-195-05 — 회귀 0

기존 vitest baseline (Sprint 194 종료: 186 files / 2694 tests) 무변경
+ 신규 actions 의 테스트만 가산.

## Out of scope

- 신규 `source` 필드 추가 — Sprint 196 (FB-5b) 본 작업.
- `addHistoryEntry` payload 의 raw / grid-edit / ddl-structure / mongo-*
  통합 audit — Sprint 196 본 작업.
- `tabStore` 의 queryState 외 표면 (tab activate / persistence / ipc-bridge)
  은 미터치.

## 검증 명령

```sh
pnpm vitest run src/stores/tabStore.test.ts \
  src/stores/queryHistoryStore.test.ts \
  src/components/query/QueryTab.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모든 테스트 green. tsc 0 / lint 0. Rust 변경 없음.
