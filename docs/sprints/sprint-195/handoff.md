# Sprint 195 — Handoff

Sprint: `sprint-195` (refactor — `tabStore` intent-revealing actions
for query lifecycle).
Date: 2026-05-02.
Status: closed.
Type: refactor (Sprint 196 토대).

## 어디까지 했나

QueryTab.tsx 의 7 곳 inline `useTabStore.setState((state) => ...)` 가드
패턴 + 6 곳 명시적 `addHistoryEntry({ ... 9 필드 ... })` 호출을 4 신규
intent action 으로 추출:

- `completeQuery(tabId, queryId, result)` — single-stmt success transition.
- `failQuery(tabId, queryId, errorMessage)` — single-stmt error transition.
- `completeMultiStatementQuery(tabId, queryId, payload)` — multi-stmt
  final transition (allFailed → error / 그 외 → completed with statements).
- `recordHistory(tabId, payload)` — tab 의 metadata 자동 추출, payload
  은 가변 4 필드만.

Sprint 196 의 `source` 필드 추가는 `recordHistory` 시그니처에 인자
1 개 + `queryHistoryStore.addHistoryEntry` payload 에 1 필드 추가 만으로
끝남 — callsite 변경 0 (default 사용 시).

## Files changed

| 파일 | Purpose |
|------|---------|
| `src/stores/tabStore.ts` (+131 / -0) | 4 신규 action 인터페이스 + 구현. queryHistoryStore import 추가. |
| `src/stores/tabStore.test.ts` (+218 / -0) | AC-195-01..03 신규 15 case (completeQuery 6 / completeMultiStatementQuery 3 / recordHistory 3 + makeQueryTab seed helper). |
| `src/components/query/QueryTab.tsx` (-180 / +33) | 7 setState site → 6 completeQuery/failQuery + 1 completeMultiStatementQuery; 6 addHistoryEntry → 6 recordHistory. useEffect deps array 갱신. addHistoryEntry import 제거 (clearHistory / historyEntries 만 남김). |
| **NEW** `docs/sprints/sprint-195/contract.md` | sprint contract. |
| **NEW** `docs/sprints/sprint-195/findings.md` | 7→1 패턴 / 6→1 history wrapper / multi-stmt 가드 / AC 매핑 / 후속. |
| **NEW** `docs/sprints/sprint-195/handoff.md` | 본 파일. |

총 코드 3 modified, docs 3 신설.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-195-01 | `pnpm vitest run src/stores/tabStore.test.ts` | **105 passed** (90 회귀 + 15 신규). |
| AC-195-02 | 위 동일 | `[AC-195-02-1..3]` allFailed / partial / all-success 3 case pass. |
| AC-195-03 | 위 동일 | `[AC-195-03-1..3]` query / non-query / missing 3 case pass. |
| AC-195-04 | callsite migration | `grep "useTabStore.setState\|addHistoryEntry" src/components/query/QueryTab.tsx` → 2 hit (둘 다 코멘트). production callsite 0. |
| Sprint 195 전체 | 4-set | **186 files / 2706 tests passed** (Sprint 194 baseline 186/2694 → +12 신규); tsc 0; lint 0; src-tauri/ empty. |

## Required checks (재현)

```sh
pnpm vitest run src/stores/tabStore.test.ts \
  src/stores/queryHistoryStore.test.ts \
  src/components/query/QueryTab.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
git diff --stat src-tauri/
```

기대값: 모두 zero error / 186 files / 2706 tests / src-tauri empty.

## 다음 sprint 가 알아야 할 것

### 진입점 / API

- `tabStore` 신규 action 4 종 — `completeQuery / failQuery /
  completeMultiStatementQuery / recordHistory`.
- 모두 stale-response 가드 내장 — late-arriving response (queryId
  미스매치) 는 silent no-op.
- `recordHistory` 는 tab 의 5 metadata 필드 자동 추출 → Sprint 196 의
  `source` 추가는 1 인자 + 1 필드 만으로 끝남.

### 회귀 가드

- `src/stores/tabStore.test.ts` (105 case) — query lifecycle 가드 시맨틱
  + multi-stmt 분기 + history wrapper.
- `src/components/query/QueryTab.test.tsx` (95 case 추정) — 무수정 통과.
  callsite 가 action 위로 옮겨졌어도 user-visible behavior 동일.

### 후속

- **Sprint 196 (FB-5b)** — `source: HistorySource` 필드 추가 + raw /
  grid-edit / ddl-structure / mongo-* 통합 audit. `recordHistory` 시그니처
  + `queryHistoryStore.addHistoryEntry` payload 에 1 필드 가산.

### 외부 도구 의존성

없음. Rust 변경 0. 추가 IPC 0.

## 폐기된 surface

- 없음. 신규 action 추가 (additive). 기존 `useTabStore.setState` 와
  `addHistoryEntry` 는 store-level 에서 그대로 노출 — 본 sprint 는
  callsite 만 옮김.

## 시퀀싱 메모

- Sprint 191 (SchemaTree decomposition) → Sprint 192 (DB export) →
  Sprint 193 (useDataGridEdit decomposition) → Sprint 194 (FB-4 Quick
  Look edit) → **Sprint 195** (tabStore intent actions).
- 다음 — Sprint 196 (FB-5b query history `source` 필드).

## Refs

- `docs/sprints/sprint-195/contract.md` — sprint contract.
- `docs/sprints/sprint-195/findings.md` — 결정 / 결과.
- `docs/refactoring-plan.md` Sprint 195 row.
