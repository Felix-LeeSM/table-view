# Sprint 195 — Findings

Sprint: `sprint-195` (refactor — `tabStore` intent-revealing actions).
Date: 2026-05-02.
Status: closed.

## 1. 7 setState 사이트가 사실상 1 패턴

### 발견

QueryTab.tsx 의 7 사이트 모두 동일한 guarded transition 모양을 inline
으로 풀어 씀:

```ts
useTabStore.setState((state) => {
  const current = state.tabs.find((t) => t.id === tab.id);
  if (
    current &&
    current.type === "query" &&
    current.queryState.status === "running" &&
    "queryId" in current.queryState &&
    current.queryState.queryId === queryId
  ) {
    return {
      tabs: state.tabs.map((t) =>
        t.id === tab.id && t.type === "query"
          ? { ...t, queryState: <new state> }
          : t,
      ),
    };
  }
  return state;
});
```

가드 조건 4 개:
- (a) tab 존재
- (b) `type === "query"`
- (c) `queryState.status === "running"` (running 상태에서만 전이)
- (d) `queryState.queryId === queryId` (queryId 매치 — stale response
  보호)

7 사이트 = (single-stmt success / single-stmt error) × {RDB / Mongo
find / Mongo aggregate} + multi-stmt final 1 곳.

### 결정

3 action 으로 추출:
- `completeQuery(tabId, queryId, result)` — 6 사이트 (single-stmt success).
- `failQuery(tabId, queryId, errorMessage)` — 6 사이트 (single-stmt error).
- `completeMultiStatementQuery(tabId, queryId, payload)` — 1 multi-stmt
  사이트.

multi-stmt 만 별도 액션으로 둔 이유: payload 에 `statementResults` /
`lastResult` / `allFailed` / `joinedErrorMessage` 4 필드가 추가로 묶여
들어가 single-stmt 와 시그니처가 다르고, completed 분기에 `statements`
필드 (per-stmt breakdown) 가 추가됨. 합치려면 union 시그니처가 필요
했고 callsite 가 더 어색해져 분리 유지.

## 2. `addHistoryEntry` 6 사이트 → `recordHistory` 1 사이트 모양

### 발견

기존 `addHistoryEntry({ sql, executedAt, duration, status, connectionId,
paradigm, queryMode, database, collection })` 은 9 필드 중 5 필드
(`connectionId / paradigm / queryMode / database / collection`) 가
모두 tab 에서 자동 추출 가능. 즉 callsite 는 가변 4 필드 (`sql /
executedAt / duration / status`) 만 갖고 있으면 됨.

### 결정

`recordHistory(tabId, { sql, executedAt, duration, status })` wrapper
액션을 tabStore 에 추가. 내부에서 tab 을 lookup → 5 필드 자동 채움 →
queryHistoryStore 에 dispatch.

### Why this lives in tabStore (not queryHistoryStore)

queryHistoryStore 는 paradigm-agnostic — tab 의 존재 / shape 를 모름.
"tab 의 query 결과를 history 에 기록" 이라는 시맨틱은 tabStore 의 권한
영역. 그래서 wrapper 가 tabStore 에서 시작해 queryHistoryStore 의
add-action 을 호출하는 형태가 정합성 있음.

### Sprint 196 적용 포인트

`source` 필드 추가는 본 wrapper 시그니처에 인자 1 개 추가 (`source:
HistorySource`) 만으로 끝남. callsite 6 곳은 "어디서 발사된 history
인지" 만 명시하면 됨 (현재 모두 `"raw"` 가 default 이므로 default 인자
사용 시 callsite 변경 0).

## 3. multi-stmt 의 `lastResult: null` 가드

### 발견

`completeMultiStatementQuery` 의 `allFailed === false` 분기는
`completed` 로 전이하는데 `QueryState.completed` 의 contract 는
`result: QueryResult` (non-nullable). 호출자의 `allFailed` 판정 로직
상 적어도 1 statement 가 success 이면 `lastResult` 가 non-null 이지만
inline guard 가 `lastResult!` 비-null 단언으로 강제했음.

### 결정

action 안에서 `lastResult` 가 null 인 케이스를 defensive 로 error 분기
로 떨어뜨림. callsite 동작 변경 0 (도달 불가능 path 의 fallback).

## 4. AC 매핑

| AC | 검증 | 증거 |
|----|------|------|
| AC-195-01 | completeQuery / failQuery 가드 | `[AC-195-01-1..6]` 6 case — 매치 / 미스매치 / non-running / missing tab × 2. |
| AC-195-02 | completeMultiStatementQuery 분기 | `[AC-195-02-1..3]` allFailed / partial / all-success. |
| AC-195-03 | recordHistory metadata 자동 추출 | `[AC-195-03-1..3]` query tab / non-query tab / missing tab. |
| AC-195-04 | callsite migration | `grep "useTabStore.setState\|addHistoryEntry" src/components/query/QueryTab.tsx` → 2 hit (둘 다 주석 안). production callsite 0. |
| AC-195-05 | 회귀 0 | full vitest 186 files / 2706 tests pass (Sprint 194 baseline 2694 → +12 신규). tsc 0 / lint 0. |

## 5. 검증 4-set

```
pnpm vitest run                    # 186 files / 2706 tests passed
pnpm tsc --noEmit                  # 0 errors
pnpm lint                          # 0 warnings
git diff --stat src-tauri/         # empty
```

baseline (Sprint 194 종료): 186 files / 2694 tests. delta: +12 cases
(15 신규 - 3 inline 단언 sanity). file count 동일.

## 6. 후속

- **Sprint 196 (FB-5b)** — `source: HistorySource` 추가. `recordHistory`
  시그니처에 인자 1 개 + `addHistoryEntry` payload 에 1 필드 추가.
  callsite 6 곳은 default 사용 시 무수정.
- queryState 외 표면 (tab activate / persistence / ipc-bridge) 는
  본 sprint 범위 밖. 미터치.
- `getCurrentWindowLabel()` 가드된 ipc-bridge 의 `SYNCED_KEYS` allowlist
  와 신규 액션은 직교 — 액션은 single-window 에서만 호출되므로 broadcast
  대상 아님 (state 변경은 broadcast 시 전파).
