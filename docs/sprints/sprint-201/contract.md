# Sprint 201 — Contract

Sprint: `sprint-201` (refactor — `QueryTab.tsx` 1040-line component
분해).
Date: 2026-05-05.
Type: refactor (행동 변경 0; 컴포넌트 재구성).

`docs/PLAN.md` 의 "리팩토링 sequencing (Sprint 199–..., post-198 cycle)"
세 번째 항목. [`/CODE_SMELLS.md`](../../../CODE_SMELLS.md) §1-1 frontend
god file #3 (1040 라인) 의 just-in-time refactor — Sprint 199
(SchemaTree 5분할), Sprint 200 (DataGridTable 6분할) 에 이은
entry-pattern **3 번째 frontend 적용**.

## Sprint 안에서 끝낼 단위

- **모듈 구조 신설**: `QueryTab.tsx` (entry, modern 2018+ 패턴) +
  `QueryTab/` 하위 디렉토리 6 파일. `QueryTab.tsx` 자체는 1040 → 400
  줄 미만 modification (git --follow 으로 history 연결).
    - `QueryTab.tsx` — imports + `QueryTabProps` interface + store
      subscriptions + paradigm 파생 (sqlDialect / schemaNamespace /
      mongoExtensions / mongoFieldNames) + 4 hook 호출 (useQueryFavorites
      / useQueryExecution / useQueryEvents / useResizablePanel) + return
      JSX shell.
    - `QueryTab/queryHelpers.ts` — pure: `DocumentQueryContext` +
      `readDocumentContext` / `isRecord` / `isRecordArray` +
      `applyDbMutationHint` (Sprint 132 raw-query DB-change detection).
      store import 0, React import 0. catch {} 2곳 (verify-best-effort
      + outer guard) 그대로 보존.
    - `QueryTab/useQueryExecution.ts` — hook. handleExecute (~290 lines,
      4 분기) + runMongoAggregateNow + confirmMongoDangerous +
      cancelMongoDangerous + mongoGate (`useSafeModeGate`) +
      pendingMongoConfirm state. `react-hooks/exhaustive-deps` 억제 1곳
      + catch {} 1곳 (cancelQuery swallow) 그대로 보존.
    - `QueryTab/useQueryEvents.ts` — hook. 4 useEffect (cancel-query /
      format-sql Cmd+I / uglify-sql Cmd+Shift+I / toggle-favorites
      Cmd+Shift+F event listeners) + handleFormat callback + editorRef
      반환.
    - `QueryTab/useQueryFavorites.ts` — hook. 3 state (showSaveForm /
      favoriteName / showFavorites) + handleSaveFavorite +
      handleLoadFavoriteSql + addFavorite/favorites store sub.
    - `QueryTab/Toolbar.tsx` — `<QueryTabToolbar>` 컴포넌트 (~140
      lines). Run/Cancel + Format + Mongo Mode toggle (Find/Aggregate)
      + Save/Favorites buttons + 2 popover (Save form, FavoritesPanel
      mount).
    - `QueryTab/HistoryPanel.tsx` — `<QueryHistoryPanel>` 컴포넌트
      (~80 lines). collapsible list + QuerySyntax row + load button +
      clear button.
- **회귀 0**: 코드 동등성 — `pnpm vitest run` 결과 = pre-split.
  pre-split 의 `QueryTab.test.tsx` (2308 lines, 80 case) 무수정 통과.

## Acceptance Criteria

### AC-201-01 — 단일 1040-line 파일이 7 파일로 분할

- `src/components/query/QueryTab.tsx` (1040) → 400 줄 미만 modification
  (git diff: -600 이상, 동일 path 유지로 `git log --follow` 추적 가능).
- `src/components/query/QueryTab/{queryHelpers.ts, useQueryExecution.ts,
  useQueryEvents.ts, useQueryFavorites.ts, Toolbar.tsx, HistoryPanel.tsx}`
  6 파일 신규.
- 각 파일 700 라인 이하. `useQueryExecution.ts` 가 가장 클 가능성
  (handleExecute 자체가 ~290 라인).

### AC-201-02 — `<QueryTab>` props / 외부 사용 무변화

- `interface QueryTabProps` 시그니처 byte-for-byte 동결.
- `export default function QueryTab(...)` 위치 동일 (`QueryTab.tsx`
  파일).
- `<QueryTab tab={...} />` 를 import 하는 외부
  (`src/components/layout/MainArea.tsx`) 호출 코드 무수정.

### AC-201-03 — sub-file 인터페이스 명시

- `queryHelpers.ts` — pure exports. React 의존성 0, store 의존성 0.
- `useQueryExecution.ts` — hook export. 내부 store hooks subscribe,
  외부에서 actions / mongoGate / pendingMongoConfirm 반환.
- `useQueryEvents.ts` — hook export. window event listener + handleFormat.
- `useQueryFavorites.ts` — hook export. Favorites state + 2 handler.
- `Toolbar.tsx` — `<QueryTabToolbar>` 컴포넌트. Run/Cancel/Format/Mode/
  Save/Favorites props 받음.
- `HistoryPanel.tsx` — `<QueryHistoryPanel>` 컴포넌트. entries / handlers
  props.

### AC-201-04 — 행동 / DOM 동등성

- pre-split 의 `QueryTab.test.tsx` 의 모든 case 가 byte-for-byte 무수정
  통과. 다음 invariant 모두 보존:
  - Sprint 132 raw-query DB-change detection ("verify 실패 ≠ query 실패").
  - Sprint 188 mongo aggregate 3-tier gate (block / confirm / off).
  - Sprint 195 intent-revealing query lifecycle actions (completeQuery /
    failQuery / completeMultiStatementQuery).
  - Sprint 100 multi-statement breakdown.
  - Sprint 73 document paradigm find / aggregate routing.
  - Sprint 84 paradigm-aware loadQueryIntoTab.
  - Sprint 25 stale-closure 회피 deps 정책.

### AC-201-05 — CODE_SMELLS §2 / §4 입력 항목 보존

- `react-hooks/exhaustive-deps` 억제 1곳 (`QueryTab.tsx:598`) →
  `useQueryExecution.ts` 안에서 같은 deps + 의도 주석 보존. **본 sprint
  정리 X** — Sprint 207 후보.
- `catch {}` 3곳 (`QueryTab.tsx:129/144/331`) 모두 그대로 보존:
  - `:129` (verify-best-effort) → `queryHelpers.ts/applyDbMutationHint`.
  - `:144` (outer guard) → `queryHelpers.ts/applyDbMutationHint`.
  - `:331` (cancelQuery swallow) → `useQueryExecution.ts/handleExecute`.
  **본 sprint 정리 X** — Sprint 206 후보.

### AC-201-06 — 회귀 0 + 검증 명령 zero-error

- `pnpm vitest run` — 기존 case 무수정 통과.
- `pnpm tsc --noEmit` 0 / `pnpm lint` 0.
- frontend 변경 only — `cargo` 영역 미수정.

## Out of scope

- **다른 god file 분해** — `tabStore.ts` (1002) Sprint 205 후보,
  `db/postgres.rs` (3803) Sprint 203 후보, `DocumentDataGrid.tsx`
  (951), `useDataGridEdit.ts` (715) 등 — 별도 sprint.
- **QueryTab 자체 기능 추가** — 신규 paradigm / 신규 query mode / 신규
  shortcut 등.
- **handleExecute 4 분기 추가 분해** — document / SQL single / SQL
  multi 별 sub-hook 등. `useQueryExecution` 안에 통째로 흡수.
- **`react-hooks/exhaustive-deps` 억제 정리** — Sprint 207 후보.
- **`catch {}` 3곳 정리** — Sprint 206 후보.
- **CODE_SMELLS §3·5·6·7 정리** — Sprint 205+ 후보.

## 검증 명령

```sh
pnpm vitest run src/components/query/QueryTab.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모두 zero error. baseline 무가산.
