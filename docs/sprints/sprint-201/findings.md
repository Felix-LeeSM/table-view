# Sprint 201 — Findings

Sprint: `sprint-201` (refactor — `QueryTab.tsx` 1040-line 분해).
Date: 2026-05-05.
Status: closed.

## §0 — entry line target 달성

contract 의 AC-201-01 은 "1040 → 400 줄 미만". 실측 결과 **231 lines**
(-78%). Sprint 200 의 "350 미달 → 501" 사례를 답습해 보수적 한계
(400) 잡았는데 실제로는 더 깊이 압축됨.

압축 가능 이유:
- `handleExecute` (~290 lines, 4 분기) 통째로 `useQueryExecution` 흡수
  — Sprint 200 의 DataGridTable 은 virtualized branch / spacer rows 가
  entry 와 강결합이라 분리 못 했음. 본 sprint 는 그런 결합 없음.
- `applyDbMutationHint` 와 helper 4개를 모듈-top 에서 `queryHelpers.ts`
  로 통째 이동. entry 의 imports 도 19 → 14 줄로 단축.
- favorites / events 를 단일 hook 으로 묶음 — entry 는 hook 결과만
  받아 prop 으로 전달.
- Editor area (paradigm router) 만 entry inline 유지 — 의존도 (sqlDialect
  / schemaNamespace / mongoExtensions / editorRef / queryMode) 분리 비용
  > 이득.

## §1 — 분해 전략 (자율 진행)

interactive planning 거치지 않고 agent 가 자율 진행 (사용자 승인 후
"진행해" 명령). DOD draft 단계의 6 sub-file 제안을 그대로 채택.

| Sub-file | 책임 | lines |
|----------|------|-------|
| `queryHelpers.ts` | pure: DocumentQueryContext + readDocumentContext + isRecord + isRecordArray + applyDbMutationHint + dispatchDbMutationHint | 150 |
| `useQueryExecution.ts` | handleExecute (4 분기) + runMongoAggregateNow + confirmMongoDangerous + cancelMongoDangerous + mongoGate + pendingMongoConfirm | 450 |
| `useQueryEvents.ts` | 3 useEffect (cancel-query / format-sql / uglify-sql) + handleFormat + editorRef | 135 |
| `useQueryFavorites.ts` | 3 state + 2 handler + toggle-favorites useEffect | 92 |
| `Toolbar.tsx` | Run/Cancel + Format + Mode toggle + Save/Favorites + 2 popover | 203 |
| `HistoryPanel.tsx` | collapsible history list + Load/Clear | 144 |

설계 결정 중 implementation 도중 변경 1건:
- **toggle-favorites useEffect 위치** — 초기 plan 은 useQueryEvents 안.
  실제 작성 시 favorites state setter 의존도가 높아 useQueryFavorites
  안으로 이동. 책임 단위가 더 명료해짐 (favorites 관련 모든 logic 한
  파일).

## §2 — Sub-file 의존성 / 외부 contract

```
QueryTab.tsx (entry, 231)
  ├── queryHelpers.ts          (150, pure + Sprint 132 hook)
  ├── useQueryExecution.ts     (450) ─→ queryHelpers, useSafeModeGate, @lib/tauri
  ├── useQueryEvents.ts        (135) ─→ @lib/tauri, @lib/sql/sqlUtils
  ├── useQueryFavorites.ts     (92)
  ├── Toolbar.tsx              (203) ─→ useQueryFavorites (type only), FavoritesPanel
  └── HistoryPanel.tsx         (144) ─→ QuerySyntax
```

깊이 1, 순환 없음. 외부 caller / test 무수정:

- `src/components/layout/MainArea.tsx` — `<QueryTab tab={tab} />` 무변화.
- `src/components/query/QueryTab.test.tsx` (2308 lines, 80 case) —
  default import (`import QueryTab from "./QueryTab"`) 보존.

## §3 — 회귀 가드 / 행동 동등

`pnpm vitest run` baseline:

- QueryTab.test.tsx / 80 case (pre-split = post-split).
- 전체 187 files / 2724 tests passed.
- `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0.

보존된 invariant:

- **Sprint 132 raw-query DB-change detection** — `dispatchDbMutationHint`
  helper 가 single + multi statement path 양쪽에서 fire-and-forget.
  catch {} 2곳 (verify-best-effort + outer guard) 그대로.
- **Sprint 188 mongo aggregate 3-tier gate** — block / confirm / off
  결정 순서 + running-state set 이전 처리 보존. pendingMongoConfirm
  state 가 useQueryExecution 안.
- **Sprint 195 intent-revealing query lifecycle actions** — completeQuery
  / failQuery / completeMultiStatementQuery 의 stale-response guard 가
  store action 측에 있어 hook 분리에 영향 없음.
- **Sprint 100 multi-statement breakdown** — 마지막 success result +
  per-statement breakdown + history entry status (any failed → error)
  로직 그대로.
- **Sprint 73 document paradigm find/aggregate** — JSON.parse 가드 +
  isRecord/isRecordArray type narrowing + FindBody shape detection.
- **Sprint 84 paradigm-aware loadQueryIntoTab** — HistoryPanel 의
  entry-level defaults (paradigm ?? "rdb", queryMode ?? "sql") 보존.
- **Sprint 25 stale-closure 회피 deps 정책** — `useQueryExecution` 안의
  `eslint-disable-next-line react-hooks/exhaustive-deps` + 의도 주석 +
  10개 deps 그대로.

## §4 — 트레이드오프 / 회귀 risk

### Toolbar 의 favorites prop 통째 받음 (ctx 패턴)

13 개 prop 을 분해해서 나열하는 대신 `favorites: QueryFavoritesState`
1 prop. Sprint 199 SchemaTreeRowsContext / Sprint 200 DataGridRowContext
답습. Toolbar 안에서 destructure 하므로 사용 사이트 가독성 동일.

### Editor area entry inline 유지

`switch (tab.paradigm)` 4 분기 (rdb/document/kv/search) + assertNever 가
entry 의 ~70 lines 차지. 분리 시 sub-component 가 sqlDialect /
schemaNamespace / mongoExtensions / editorRef / updateQuerySql /
handleExecute 6 props 받아야 — prop drilling 비용이 가독성 이득보다
큼. Sprint 200 의 virtualized branch entry 유지 결정과 같은 reasoning.

### `dispatchDbMutationHint` helper 신설

기존 entry 에 인라인된
```ts
void applyDbMutationHint(
  tab.connectionId,
  tab.paradigm,
  sql,
  useConnectionStore.getState().setActiveDb,
  useSchemaStore.getState().clearForConnection,
);
```
패턴이 single + multi statement path 양쪽에 있었음 (2번 반복). helper
로 lift — `dispatchDbMutationHint(connectionId, paradigm, sql)` 3 args.
호출 사이트 단축 + store snapshot 읽기 패턴 single source.

이는 contract §"Out of scope" 의 "신규 helper 추가" 와 경계선 — 본
sprint 는 분해 only. 그러나 같은 패턴 2회 반복을 helper 로 lift 하는
것은 Sprint 199/200 의 entry-pattern 정의에 부합 (pure helper 로 추출).
findings 에 명시해 추적 가능하게.

### useQueryExecution 의 store sub 직접 호출

hook 이 useTabStore 5개 actions 직접 sub. entry 가 sub 후 prop drilling
대안과 비교해:
- 직접 sub: hook 의 args 단순 (tab 1개), 하지만 hook 이 store 결합.
- prop drilling: hook 이 store-agnostic, 하지만 args 6개.

**직접 sub 채택** — Sprint 195 intent-revealing actions 도입 이후 hook
이 store 결합도를 가지는 게 자연스러움 (action 자체가 contract).

## §5 — out of scope 확인

contract §"Out of scope" 항목 모두 본 sprint 에서 손대지 않음:

- 다른 god file (`tabStore.ts`, `db/postgres.rs`, `DocumentDataGrid.tsx`,
  `useDataGridEdit.ts`) 미수정.
- QueryTab 자체 기능 추가 0.
- handleExecute 4 분기 추가 분해 (document/SQL single/SQL multi 별
  sub-hook) — `useQueryExecution` 안에 통째 흡수.
- `react-hooks/exhaustive-deps` 억제 1곳 — Sprint 207 후보로 그대로
  보존 (`useQueryExecution.ts` 안에서 같은 line 위치).
- catch {} 3곳 — Sprint 206 후보로 그대로 보존:
  - verify-best-effort + outer guard → `queryHelpers.ts`.
  - cancelQuery swallow → `useQueryExecution.ts/handleExecute`.

## §6 — 영속 표준 / 후속 입력

- 본 분해는 `memory/conventions/refactoring/memory.md` 의 4 카테고리
  중 **B (책임 분할 분해)**.
- entry-pattern 의 **4 번째 적용 사례** (Sprint 197/199/200 → 201).
  표준 패턴이 다음 god file 분해 (`tabStore.ts` 1002 — Sprint 205
  후보, `db/postgres.rs` 3803 — Sprint 203 후보) 에서도 답습 예정.
- ctx 객체 패턴 (`SchemaTreeRowsContext` → `DataGridRowContext` →
  `QueryFavoritesState` Toolbar prop) — 후속 god file 분해에서도
  prop drilling 압축 표준으로 굳어짐.
- `dispatchDbMutationHint` 같은 single-line helper lift 는 분해 sprint
  에서 같은 패턴 N회 반복 → helper 1개 패턴으로 정착. CODE_SMELLS 입력
  보다는 분해 부산물.
