# Sprint Execution Brief: sprint-84 (Query history paradigm metadata + paradigm-aware restore)

## Objective

- `QueryHistoryEntry` 가 `paradigm` / `queryMode` / `database?` / `collection?` 필드를 운반하도록 확장.
- `QueryTab.tsx` 의 5 개 `addHistoryEntry` 호출부에 현재 tab 의 paradigm / queryMode / database / collection 을 전달.
- `tabStore` 에 `loadQueryIntoTab(payload)` helper 를 신설해 entry 복원을 paradigm-aware 로 수행 (같은 paradigm/connection 이면 active tab 에 in-place update, 아니면 새 tab 생성·focus).
- QueryTab 의 History 리스트의 double-click 및 "Load into editor" 버튼이 둘 다 `loadQueryIntoTab` 을 호출.
- Legacy entries 는 읽기 시 `paradigm: "rdb"` / `queryMode: "sql"` 기본값으로 정규화되어 throw 없이 다뤄짐.

## Task Why

- Sprint 82/83 이 편집 경험의 provider 대칭을 완성했고, 이제 history 저장/복원도 provider 를 기억해야 round-trip 이 깨지지 않는다. 그렇지 않으면 Mongo 에서 실행한 `[{"$match": ...}]` 를 나중에 load 했을 때 RDB 탭에서 JSON 이 SQL 로 해석되어 syntax error 로 보임.
- Sprint 85 (history viewer highlighting) 가 entry 의 paradigm 필드에 의존하므로, Sprint 84 가 그 기반을 선제적으로 마련.
- 기존 사용자 환경 (localStorage persisted history) 이 아직 없지만, 현재 in-memory store 도 legacy shape 수용을 통해 향후 persist layer 추가 시 migration 비용 0 으로 접근.

## Scope Boundary

**수정 허용**:
- `src/stores/queryHistoryStore.ts` — `QueryHistoryEntry` 필드 확장 + `addHistoryEntry` 입력 확장 + legacy default normalize.
- `src/stores/tabStore.ts` — `loadQueryIntoTab(payload)` helper 추가.
- `src/components/query/QueryTab.tsx` — 5 개 `addHistoryEntry` 호출부 필드 확장 + double-click/button restore 로직 교체.
- 테스트 파일 (`queryHistoryStore.test.ts`, `tabStore.test.ts`, `QueryTab.test.tsx`).

**절대 수정 금지 (diff 0)**:
- `src-tauri/**` 전체.
- `src/components/query/QueryEditor.tsx`, `src/components/query/QueryEditor.test.tsx` — Sprint 82/83 확정.
- `src/hooks/useSqlAutocomplete.ts`, `src/hooks/useMongoAutocomplete.ts`, `src/lib/sqlDialect.ts`, `src/lib/mongoAutocomplete.ts` — autocomplete / 편집 경험은 Sprint 82/83 에서 완료, 이 sprint 가 건드릴 이유 없음.
- `src/components/datagrid/**`, `src/components/DataGrid.tsx`, `src/components/DocumentDataGrid.tsx`, `src/components/shared/BsonTreeViewer.tsx`, `src/components/shared/QuickLookPanel.tsx` — 병렬 agent 경로.
- `src/components/query/GlobalQueryLogPanel.tsx` — Sprint 85 scope (rendering). 이 sprint 는 metadata 가 entry 에 들어가는지까지만 검증.
- `src/components/query/QueryLog.tsx` — 변경 없음 (위 renderer 는 sprint 85).

## Invariants

- `src-tauri/**` diff 0.
- RDB 탭의 편집/실행 경험 (Sprint 82 기준) byte-for-byte 불변.
- Document 탭의 편집/실행 경험 (Sprint 83 기준) byte-for-byte 불변.
- `QueryHistoryEntry` 의 기존 필드 (`id`, `sql`, `executedAt`, `duration`, `status`, `connectionId`) shape 불변.
- `useQueryHistoryStore` 의 기존 액션 (`clearHistory`, `clearGlobalLog`, `filteredGlobalLog`, `copyEntry`, `setSearchFilter`, `setConnectionFilter`) 동작 불변.
- `useTabStore` 의 기존 액션 전체 동작 불변 (`loadQueryIntoTab` 은 추가이지 기존 것을 대체하지 않음).
- React convention: 함수 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix.

## Done Criteria

1. `QueryHistoryEntry` 가 `paradigm: Paradigm` + `queryMode: QueryMode` 필수 필드와 `database?: string` + `collection?: string` optional 필드를 갖는다.
2. `addHistoryEntry` payload 는 paradigm/queryMode 를 optional 로 받아 store 내부에서 `"rdb"`/`"sql"` 기본값을 주입한다 (기존 호출자 TS 에러 방지).
3. `QueryTab.tsx` 의 5 개 `addHistoryEntry` 호출부가 `paradigm: tab.paradigm`, `queryMode: tab.queryMode`, `database: tab.database`, `collection: tab.collection` 을 전달한다.
4. `useQueryHistoryStore.getState().entries[0]` 과 `globalLog[0]` 둘 다 새 metadata 를 포함한다 (store 가 한 번의 `addHistoryEntry` 로 양쪽에 write).
5. `tabStore.loadQueryIntoTab({connectionId, paradigm, queryMode, database, collection, sql})` 이 존재한다.
6. Active tab 이 같은 paradigm + 같은 connectionId 이면 `loadQueryIntoTab` 이 같은 tab 의 sql 을 교체 + `queryMode` 를 일치시킴 (document 모드 전환 지원).
7. Active tab 이 다른 paradigm 또는 다른 connectionId 이면 `loadQueryIntoTab` 이 `addQueryTab` 으로 새 tab 을 만들고 sql 을 주입 + activeTabId 를 그 tab 으로 갱신.
8. `QueryTab.tsx` 의 history 리스트 double-click 핸들러와 "Load into editor" 버튼의 `onClick` 이 둘 다 `loadQueryIntoTab({..., paradigm: entry.paradigm ?? "rdb", queryMode: entry.queryMode ?? "sql", database: entry.database, collection: entry.collection, sql: entry.sql, connectionId: ...})` 를 호출 (connectionId 는 entry.connectionId 우선, 없으면 tab.connectionId).
9. 최소 10 개 신규 테스트. 각 AC 매핑.
10. `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` 전부 pass.
11. `git diff --stat HEAD -- src-tauri/` empty 및 forbidden-path 전부 diff 0.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm lint`
  3. `pnpm vitest run src/stores/queryHistoryStore.test.ts src/stores/tabStore.test.ts src/components/query/QueryTab.test.tsx`
  4. `pnpm vitest run` — 전체 suite regression (baseline 1506)
  5. `git diff --stat HEAD -- src-tauri/` empty
  6. `git diff --stat HEAD -- src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/QuickLookPanel.tsx src/hooks/useSqlAutocomplete.ts src/hooks/useMongoAutocomplete.ts src/lib/sqlDialect.ts src/lib/mongoAutocomplete.ts src/components/query/QueryEditor.tsx src/components/query/QueryEditor.test.tsx src/components/query/GlobalQueryLogPanel.tsx src/components/query/QueryLog.tsx` empty

## Evidence To Return

- 변경/추가 파일 목록 + 각 파일 목적.
- `QueryHistoryEntry` 새 필드 선언 file:line.
- `addHistoryEntry` 내부 defaulting 위치 file:line.
- `loadQueryIntoTab` 구현 file:line + 4 분기 설명 (no active / same paradigm same conn / different paradigm / different conn).
- `QueryTab.tsx` 의 5 개 `addHistoryEntry` 호출부의 새 필드 전달 file:line (5 개 전부).
- double-click 및 "Load into editor" 버튼이 `loadQueryIntoTab` 경로로 교체된 file:line.
- AC-01 ~ AC-13 → 테스트 이름 또는 file:line 매핑.
- `git diff --stat HEAD -- src-tauri/` 및 forbidden-path 빈 출력 증명.
- Assumptions:
  - `loadQueryIntoTab` 은 *active* tab 을 기준으로 분기. entry 가 다른 connectionId 를 가진 경우에도 연결 객체가 store 에 존재한다고 가정 (dangling connection 은 이 sprint 범위 밖 — 새 tab 을 만들되 그 tab 은 connectionId 만 보존).
  - Document 모드에서 database/collection 이 *다른* 경우에도 같은 tab 에 in-place update 로 허용 (entry 가 새 database/collection 을 지정하면 tab 의 database/collection 은 유지, sql/queryMode 만 교체). 이렇게 처리하면 사용자가 현재 집중하고 있는 collection context 를 잃지 않음 — 이 sprint 는 paradigm 레벨 매칭만 강제.
  - globalLog 의 metadata 는 entry 와 동일 객체 (addHistoryEntry 에서 같은 `newEntry` 를 globalLog 와 entries 양쪽에 prepend 하므로 자동).
- Residual risk: `loadQueryIntoTab` 의 "same connectionId" 판정이 현재 tab 의 database/collection 은 비교하지 않음 — 사용자 관점에서 다른 collection 의 entry 를 load 해도 tab 의 collection context 는 그대로 유지. Sprint 85 이후 UX 피드백에 따라 재검토 가능.

## References

- Master spec: `docs/sprints/sprint-81/spec.md` (Sprint 84 섹션, 특히 AC-1~5)
- Sprint 82 handoff: `docs/sprints/sprint-82/handoff.md`
- Sprint 83 handoff: `docs/sprints/sprint-83/handoff.md`
- Relevant files (read-only, 참고용):
  - `src/stores/queryHistoryStore.ts` — 현 shape
  - `src/stores/tabStore.ts` — 현 `addQueryTab` / `updateQuerySql` / `setQueryMode`
  - `src/components/query/QueryTab.tsx` L74 (store access), L262/L295/L349/L382/L454 (addHistoryEntry 호출부), L781/L803 (restore 호출부)
  - `src/types/connection.ts` — `Paradigm` type
