# Sprint 201 — Handoff

Sprint: `sprint-201` (refactor — `QueryTab.tsx` 1040-line god file
분해).
Date: 2026-05-05.
Status: closed.
Type: refactor (행동 변경 0; 컴포넌트 재구성).

## 어디까지 했나

`QueryTab.tsx` (1040 lines, frontend god file #3) 를 entry shell
(231) + 6 sub-file 로 분해 — `queryHelpers` (150, pure) + 3 hook
(`useQueryExecution` 450 / `useQueryEvents` 135 / `useQueryFavorites`
92) + 2 component (`Toolbar` 203 / `HistoryPanel` 144). 외부 사용
(`<QueryTab>` props / default export 위치) 무변화, DOM 동등, 80 case
무수정 통과.

본 sprint 가 `docs/PLAN.md` 의 "리팩토링 sequencing (Sprint 199–...,
post-198 cycle)" **세 번째 항목** (Sprint 199 SchemaTree → Sprint 200
DataGridTable → Sprint 201 QueryTab). entry-pattern frontend 측 **3 번째
적용** 사례.

## Files changed

### Frontend (TS / React)

| 파일 | Purpose |
|------|---------|
| **MOD** `src/components/query/QueryTab.tsx` | 1040 → 231 (-809, -78%). entry shell — imports + `QueryTabProps` interface + paradigm 파생 (sqlDialect / schemaNamespace / mongoFieldNames / mongoExtensions / isDocument) + 4 hook 호출 (useQueryFavorites / useQueryExecution / useQueryEvents / useResizablePanel) + return JSX (Toolbar + Editor area inline + Resize handle + QueryResultGrid + HistoryPanel + ConfirmDangerousDialog). |
| **NEW** `src/components/query/QueryTab/queryHelpers.ts` | pure + Sprint 132 hook. `DocumentQueryContext` + `readDocumentContext` / `isRecord` / `isRecordArray` + `applyDbMutationHint` + `dispatchDbMutationHint`. catch {} 2곳 (verify-best-effort + outer guard) 보존. |
| **NEW** `src/components/query/QueryTab/useQueryExecution.ts` | hook — `handleExecute` (~290, 4 분기) + `runMongoAggregateNow` + `confirmMongoDangerous` + `cancelMongoDangerous` + `mongoGate` + `pendingMongoConfirm`. deps 억제 1곳 + catch {} 1곳 (cancelQuery swallow) 보존. store actions 5 직접 sub. |
| **NEW** `src/components/query/QueryTab/useQueryEvents.ts` | hook — 3 useEffect (cancel-query / format-sql Cmd+I / uglify-sql Cmd+Shift+I) + `handleFormat` callback + `editorRef`. |
| **NEW** `src/components/query/QueryTab/useQueryFavorites.ts` | hook — 3 state + `handleSaveFavorite` + `handleLoadFavoriteSql` + toggle-favorites useEffect (Cmd+Shift+F). |
| **NEW** `src/components/query/QueryTab/Toolbar.tsx` | `<QueryTabToolbar>` 컴포넌트. Run/Cancel + Format + Mongo Mode toggle + Save/Favorites buttons + 2 popover. `favorites` ctx prop 통째 받음. |
| **NEW** `src/components/query/QueryTab/HistoryPanel.tsx` | `<QueryHistoryPanel>` 컴포넌트. collapsible list + QuerySyntax row + Load/Clear. expanded state component-local. |
| **NEW** `docs/sprints/sprint-201/contract.md` | sprint contract — 6 AC 동결. |
| **NEW** `docs/sprints/sprint-201/findings.md` | 분해 전략 / 결정 / 트레이드오프 / out-of-scope 확인. AC-201-01 (231/-78%) 달성 사유 §0. |
| **NEW** `docs/sprints/sprint-201/handoff.md` | 본 파일. |

총 코드: 1 modified + 6 created (frontend). docs 3 신설.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-201-01 | `wc -l src/components/query/QueryTab.tsx src/components/query/QueryTab/*` | entry **231** + queryHelpers 150 + useQueryExecution 450 + useQueryEvents 135 + useQueryFavorites 92 + Toolbar 203 + HistoryPanel 144. **AC 목표 (400 미달) 달성** — handleExecute 290 lines 통째 흡수 + 모듈-top helper 5 개 통째 이동 + favorites/events 단일 hook 묶음. 모든 sub-file 700 한계 충족. |
| AC-201-02 | `git status` modified 파일 / `import QueryTab` 외부 caller | `QueryTab.tsx` 1개만 modified. `src/components/layout/MainArea.tsx` 무수정. `QueryTabProps` interface byte-for-byte 동결. default export 위치 보존. |
| AC-201-03 | 각 sub-file 최상단 JSDoc | 6 sub-file 모두 책임 / dependency / 외부 invariant 명시. queryHelpers (pure + Sprint 132 contract), useQueryExecution (Sprint 132/188/195/100/25 invariant), useQueryEvents (active-tab gate + document short-circuit), useQueryFavorites (mutual-exclusive popover + active-tab gate), Toolbar (Run/Cancel/Format/Mode 동작 + Save 폼 disabled), HistoryPanel (entries.length === 0 가드 + Sprint 84 paradigm-aware). |
| AC-201-04 | `pnpm vitest run src/components/query/QueryTab.test.tsx` | 1 file / 80 case 무수정 통과. Sprint 132 raw-query DB-change detection + Sprint 188 mongo aggregate 3-tier gate + Sprint 195 intent-revealing actions + Sprint 100 multi-statement breakdown + Sprint 73 document find/aggregate routing + Sprint 84 paradigm-aware loadQueryIntoTab + Sprint 25 stale-closure 회피 deps 모두 보존. |
| AC-201-05 | grep `eslint-disable` / `catch {}` | deps 억제 1곳 → `useQueryExecution.ts` 안에서 같은 deps + 의도 주석 보존. catch {} 3곳 모두 보존: verify-best-effort + outer guard → `queryHelpers.ts/applyDbMutationHint`, cancelQuery swallow → `useQueryExecution.ts/handleExecute`. **본 sprint 정리 X** — Sprint 206/207 후보. |
| AC-201-06 | full vitest / tsc / lint | 187 files / 2724 tests passed. tsc 0 / lint 0. baseline 무가산. cargo 영역 미수정. |

## Required checks (재현)

```sh
pnpm vitest run src/components/query/QueryTab.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모두 zero error. baseline 무가산.

## 다음 sprint 가 알아야 할 것

### entry-pattern 답습 (4th 적용)

본 sprint 가 Sprint 197 `mongodb.rs` 4분할 → Sprint 199 `SchemaTree.tsx`
5분할 → Sprint 200 `DataGridTable.tsx` 6분할 → Sprint 201 `QueryTab.tsx`
6분할 의 **4 번째 적용** 사례 (frontend 측 3 번째).

표준 패턴 (다음 god file 분해 — `tabStore.ts` 1002 / `db/postgres.rs`
3803 — 에서도 답습):

1. entry 파일 path 유지 — `git log --follow` 추적 가능.
2. sub-file 은 entry 와 같은 이름의 하위 디렉토리에 둠 (`QueryTab/`).
3. 각 sub-file 책임 분리: pure helpers / hooks / components.
4. 외부 caller import 무변화 — 시그니처 / export 위치 보존.
5. ctx 객체 패턴 (Toolbar 의 `favorites: QueryFavoritesState`) 으로
   prop drilling 압축.

### Sprint 200 → 201 비교

| | Sprint 200 (DataGridTable) | Sprint 201 (QueryTab) |
|--|----|----|
| Pre-split | 1071 | 1040 |
| Entry post | 501 (-53%) | **231 (-78%)** |
| Sub-file | 6 | 6 |
| AC entry target | 350 (미달) | 400 (달성) |
| 압축 한계 원인 | virtualized branch + spacer rows entry 결합 | (없음 — Editor area inline 만 entry 잔류) |

본 sprint 가 더 깊이 압축된 이유: handleExecute 290 lines 가 entry 와
약결합 (store actions / tab props 만 의존) 이라 hook 으로 통째 빠짐.
DataGridTable 의 virtualized branch 는 useVirtualizer instance + scroll
effect 와 강결합.

### 회귀 가드

- **deps 억제 line 위치 변경** — pre-split 의 `QueryTab.tsx:598` →
  post-split 의 `useQueryExecution.ts` 안. CODE_SMELLS §2 의 line
  reference 는 stale. Sprint 207 진입 시 새 line 으로 갱신.
- **catch {} 위치 변경** — pre-split 의 `:129/:144/:331` → post-split:
  `:129/:144` → `queryHelpers.ts/applyDbMutationHint` (동일 line 보존
  안 됨 — sub-file 안의 새 line). `:331` → `useQueryExecution.ts/
  handleExecute`. CODE_SMELLS §4 갱신 필요.
- **Toolbar 의 ⌘⏎ 라벨 unicode** — 기존 `"⌘⏎"` escape sequence
  → 본 sprint 에서 직접 unicode (`"⌘⏎"`) 로 변경. 동일 character 라
  rendering 변화 없음. JSX 의 string literal 비교 spec 가 있으면 risk
  — 현재 80 case 통과로 해당 spec 없음 확인.

### 외부 도구 의존성

없음. 추가 crate 0, 추가 npm 0.

### 폐기된 surface

없음. `<QueryTab>` 외부 인터페이스 / DOM / aria / default export 위치
모두 동일.

## 시퀀싱 메모

- Sprint 200 (`DataGridTable.tsx` 1071 → 501 + 6 sub-file) → **Sprint
  201** (`QueryTab.tsx` 1040 → 231 + 6 sub-file).
- 본 sprint 가 `docs/PLAN.md` "리팩토링 sequencing (Sprint 199–...,
  post-198 cycle)" 세 번째 항목.
- 다음 후보:
  - **Sprint 202** — TBD feature (sequencing 표 의 #4) 또는 god file
    트랙 유지.
  - **Sprint 203** — `db/postgres.rs` (3803) 4분할 (Sprint 197 답습).
  - **Sprint 205** — `tabStore.ts` (1002) 분해.
- 영속 표준은 `memory/engineering/conventions/refactoring/` 4 카테고리 (B / D / C / A).
- `docs/PLAN.md` 의 sequencing 표 갱신 시점 — cycle 종료 후 (Sprint
  208) 일괄 갱신 권장.

## Refs

- `docs/sprints/sprint-201/contract.md` — sprint contract.
- `docs/sprints/sprint-201/findings.md` — 결정 / 결과 / 트레이드오프 /
  회귀 risk 분석. AC-201-01 달성 사유 §0.
- `docs/sprints/sprint-200/handoff.md` — entry-pattern frontend 측
  reference (DataGridTable 6분할).
- `docs/sprints/sprint-199/handoff.md` — entry-pattern frontend 측
  최초 적용 (SchemaTree 5분할).
- `docs/sprints/sprint-197/handoff.md` — entry-pattern Rust 측
  최초 적용 (mongodb.rs 4분할).
- `CODE_SMELLS.md` §1-1 frontend god file table.
- `docs/PLAN.md` 의 "리팩토링 sequencing (Sprint 199–..., post-198 cycle)".
