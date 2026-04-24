# Sprint Contract: sprint-84 (Query history paradigm metadata + paradigm-aware restore)

## Summary

- Goal: 모든 쿼리 실행이 history entry 에 `paradigm` + `queryMode` + (document 인 경우) `database` / `collection` 메타데이터를 같이 기록. 저장된 entry 를 double-click 또는 "Load into editor" 로 복원할 때 entry 의 paradigm 이 active tab 과 일치하면 같은 tab 을 in-place 업데이트, 다르면 paradigm/queryMode/database/collection 을 보존한 새 query tab 을 생성·focus.
- Audience: SQL 사용자 + Mongo 사용자. 특히 paradigm 을 섞어 사용하는 상황 (RDB tab 에서 실행한 쿼리를 다른 탭에서, 또는 Mongo find/aggregate 를 다른 Mongo 탭에서 복원).
- Owner: Generator agent (general-purpose).
- Verification Profile: `mixed`

## In Scope

- `src/stores/queryHistoryStore.ts` — `QueryHistoryEntry` 를 `paradigm: Paradigm`, `queryMode: QueryMode`, `database?: string`, `collection?: string` 로 확장. `addHistoryEntry` 시그니처가 이 필드들을 받도록 확장 (모두 optional 로 받고 기본값은 rdb/sql 로 정규화).
- `src/stores/queryHistoryStore.test.ts` — 신규 필드 보존 + 기본값 regression + 기존 entries/globalLog 불변 성질 테스트.
- `src/stores/tabStore.ts` — `loadQueryIntoTab(payload): void` 등의 paradigm-aware 복원 helper 추가. 시그니처 예: `{ connectionId, paradigm, queryMode, database?, collection?, sql }`. 현재 active tab (또는 대상 tab) 이 같은 paradigm/queryMode 면 in-place `updateQuerySql` + `setQueryMode`, 다르면 `addQueryTab(connectionId, {paradigm, queryMode, database, collection})` 후 생성된 tab 에 `updateQuerySql` 으로 sql 주입.
- `src/stores/tabStore.test.ts` — `loadQueryIntoTab` 의 4 분기 (same paradigm same mode / same paradigm different mode / different paradigm / no active tab) 테스트.
- `src/components/query/QueryTab.tsx`:
  - 5 개 `addHistoryEntry({...})` 호출부 전부 `paradigm: tab.paradigm`, `queryMode: tab.queryMode`, `database: tab.database`, `collection: tab.collection` 필드를 추가.
  - double-click + "Load into editor" 버튼의 `updateQuerySql(tab.id, entry.sql)` 호출을 `loadQueryIntoTab({connectionId, paradigm, queryMode, database, collection, sql})` 경로로 교체 (entry 의 paradigm 을 소스로).
- `src/components/query/QueryTab.test.tsx` — 3 shape 별 history 기록 (rdb/sql, document/find, document/aggregate) + restore 분기 2 가지 (same paradigm in-place, different paradigm spawns new tab).
- (선택적) `src/components/query/GlobalQueryLogPanel.tsx` — entry 에 paradigm tag 가 들어오도록 필드만 읽어 전달 (rendering 변경은 Sprint 85 scope; 이 sprint 에서는 entry 가 metadata 를 갖는지 *저장 관점*만 검증).

## Out of Scope

- Sprint 85 scope: history viewer 의 paradigm-aware highlighting, SqlSyntax/MongoSyntax 분기. 이 sprint 는 **메타데이터 저장/복원** 만 담당.
- RDB autocomplete / highlighting (Sprint 82 완료) 및 Mongo autocomplete / highlighting (Sprint 83 완료) 는 전부 불변.
- 백엔드 `src-tauri/**` 는 전혀 건드리지 않음.
- DataGrid / DocumentDataGrid / BsonTreeViewer / QuickLookPanel 은 건드리지 않음.
- `useSqlAutocomplete`, `useMongoAutocomplete`, `src/lib/sqlDialect.ts`, `src/lib/mongoAutocomplete.ts` 는 건드리지 않음.

## Invariants

- `src-tauri/**` diff 0.
- `QueryEditor.tsx` diff 0 (Sprint 82/83 에서 확정된 편집 경험 불변).
- `useSqlAutocomplete.ts`, `useMongoAutocomplete.ts`, `sqlDialect.ts`, `mongoAutocomplete.ts` 수정 금지.
- 기존 `addHistoryEntry` 호출자 중 `paradigm` 필드를 명시하지 않은 것이 있어도 **기본값 `"rdb"` / `"sql"`** 로 돌아가야 함 (backwards compat).
- 이미 persist 된 `QueryHistoryEntry` (legacy) 를 어떤 경로로 읽어도 defensive default 로 `paradigm: "rdb"` / `queryMode: "sql"` 를 부여 — throw 없음.
- `useQueryHistoryStore.getState().entries` / `globalLog` 의 기존 필드 (`id`, `sql`, `executedAt`, `duration`, `status`, `connectionId`) 는 shape 그대로.
- RDB tab 의 동작은 byte-for-byte 불변 (Sprint 82 baseline).
- Document tab 의 실행 경로는 byte-for-byte 불변 (Sprint 83 baseline).
- React convention: 함수 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix, 테스트는 사용자 관점 쿼리.

## Acceptance Criteria

- `AC-01` — RDB tab 에서 `handleExecute` 가 완료된 후 `useQueryHistoryStore.getState().entries[0]` 가 `{paradigm: "rdb", queryMode: "sql"}` 를 포함. `database`/`collection` 은 `undefined`.
- `AC-02` — Document+find tab 에서 실행 후 `entries[0]` 가 `{paradigm: "document", queryMode: "find", database: "db", collection: "coll"}` 를 포함.
- `AC-03` — Document+aggregate tab 에서 실행 후 `entries[0]` 가 `{paradigm: "document", queryMode: "aggregate", database: "db", collection: "coll"}` 를 포함.
- `AC-04` — `globalLog[0]` 도 AC-01~03 와 동일한 shape 의 metadata 를 포함 (entry 한 번의 write 로 두 리스트 모두 반영).
- `AC-05` — Legacy entry (paradigm 필드 없음) 가 store 에 주입되었을 때 consumer 가 읽을 때 `paradigm === "rdb"`, `queryMode === "sql"` 로 정규화됨. Throw 없음. 테스트는 store selector 가 반환한 값을 단언.
- `AC-06` — `loadQueryIntoTab({connectionId, paradigm: "rdb", queryMode: "sql", sql: "SELECT 1"})` 호출 시 active tab 이 같은 paradigm/mode 면 같은 tab ID 가 유지되고 `sql` 이 업데이트됨. `tabs.length` 변화 없음.
- `AC-07` — active tab 의 paradigm 이 entry 와 다르면 `loadQueryIntoTab` 이 새 query tab 을 생성하고 그 tab 에 sql 을 주입 + focus. `tabs.length` +1, `activeTabId` 가 새 tab.
- `AC-08` — Document paradigm restore 시 `database` / `collection` 이 새 tab 에 반영됨 (`tab.database === entry.database`). find → aggregate 복원 시 `queryMode` 가 `"aggregate"` 로 갱신.
- `AC-09` — 기존 tab 에서 double-click 과 "Load into editor" 버튼이 둘 다 같은 `loadQueryIntoTab` 경로를 호출 (회귀 방지). RTL 테스트가 두 경로 모두 확인.
- `AC-10` — RDB restore 가 Mongo history entry 를 load 해도 (paradigm mismatch) 기존 RDB tab 의 `sql` / `paradigm` 이 오염되지 않음 (새 tab 이 만들어지므로 기존 tab 은 그대로).
- `AC-11` — `pnpm tsc --noEmit`, `pnpm lint` 0 에러 / 0 경고.
- `AC-12` — `git diff --stat HEAD -- src-tauri/` empty.
- `AC-13` — 최소 10 개 신규 테스트 (각 AC 1 개 이상 매핑). 전체 vitest regression 0 (Sprint 83 baseline 1506 개 전부 pass).

## Design Bar / Quality Bar

- `loadQueryIntoTab` 은 `tabStore` 내부에 함수로 둠 — React 컴포넌트 내 inline 분기 금지. 단일 진입점.
- `QueryHistoryEntry` 는 `paradigm: Paradigm`, `queryMode: QueryMode` 를 **required** 로 선언하되, `addHistoryEntry` 의 payload 에서는 optional 을 허용하고 store 내부에서 defaulting. 기존 호출자에게 TypeScript 에러가 강제되지 않도록.
- Legacy 호환은 store read path 에서도 한 번 더 normalize (persisted localStorage 가 도입되면 즉시 쓰기 위한 방어). 이 sprint 에서 queryHistoryStore 자체는 persist 되지 않으므로 runtime 은 항상 new shape 이지만, consumer selector 레벨에서 defensive default 를 남김.
- `loadQueryIntoTab` 의 분기 로직:
  1. `activeTabId` 가 `null` 또는 active tab 이 query tab 이 아니면 → 새 tab 생성.
  2. active query tab 의 `paradigm` 이 entry paradigm 과 다르거나, `connectionId` 가 다르면 → 새 tab 생성.
  3. 같은 paradigm + 같은 connectionId 이면 in-place: `updateQuerySql` + `setQueryMode` (document 의 경우 database/collection 이 다르면 새 tab 을 만드는 것도 허용 — 이 sprint 는 "같은 paradigm + 같은 connectionId" 매칭까지만 요구).
- Entry 의 paradigm 필드를 읽는 위치에서 언제나 `entry.paradigm ?? "rdb"` / `entry.queryMode ?? "sql"` 정규화. 복수 곳의 보호벽.
- 새 tab 생성 시 `addQueryTab(connectionId, {paradigm, queryMode, database, collection})` 직후 반환된 tab id 를 찾기 위해 store `getState().activeTabId` 를 재조회 (addQueryTab 은 setter 로 activeTabId 를 갱신하므로).

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 타입 에러 0.
2. `pnpm lint` — 경고/에러 0.
3. `pnpm vitest run src/stores/queryHistoryStore.test.ts src/stores/tabStore.test.ts src/components/query/QueryTab.test.tsx` — 타겟 테스트 전부 pass.
4. `pnpm vitest run` — 전체 suite Sprint 83 baseline (1506) 유지 또는 증가, regression 0.
5. `git diff --stat HEAD -- src-tauri/` 빈 출력.
6. `git diff --stat HEAD -- src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/QuickLookPanel.tsx src/hooks/useSqlAutocomplete.ts src/hooks/useMongoAutocomplete.ts src/lib/sqlDialect.ts src/lib/mongoAutocomplete.ts src/components/query/QueryEditor.tsx src/components/query/QueryEditor.test.tsx src/components/query/GlobalQueryLogPanel.tsx` 빈 출력.

### Required Evidence

- 변경/추가 파일 목록 + 각 파일 역할.
- `QueryHistoryEntry` 새 필드 선언 file:line + defaulting 위치 file:line.
- `loadQueryIntoTab` 구현 file:line + 분기 branch 설명.
- `QueryTab.tsx` 의 5 개 `addHistoryEntry` 호출부 각각의 paradigm/queryMode/database/collection 전달 file:line.
- `QueryTab.tsx` 의 double-click 과 "Load into editor" 버튼이 `loadQueryIntoTab` 경로로 교체된 file:line.
- AC-01 ~ AC-13 → 테스트 이름 또는 file:line 매핑.
- `git diff --stat HEAD -- src-tauri/` 및 forbidden-path 빈 출력 증명.

## Test Requirements

### Unit Tests (필수)
- `queryHistoryStore.test.ts`:
  - rdb/document+find/document+aggregate 3 shape 에 대해 entry/globalLog 양쪽에 metadata 가 포함됨.
  - Legacy entry (paradigm 생략) 를 시뮬레이션 (직접 `set({entries: [...legacyEntry]})`) 시 consumer 가 selector 를 통해 읽을 때 rdb/sql 기본값.
  - `addHistoryEntry` 가 paradigm 생략 시 rdb/sql 기본값.
- `tabStore.test.ts`:
  - `loadQueryIntoTab` — no active tab 시 새 tab 생성.
  - `loadQueryIntoTab` — active tab 이 table tab 일 때도 새 tab 생성.
  - `loadQueryIntoTab` — 같은 paradigm + 같은 connection 이면 in-place update.
  - `loadQueryIntoTab` — 다른 paradigm 이면 새 tab + 원본 tab 불변.
  - `loadQueryIntoTab` — document mode 복원 시 database/collection 이 새 tab 에 보존.
- `QueryTab.test.tsx`:
  - RDB tab 실행 후 history entry shape 단언.
  - Document+find tab 실행 후 entry + globalLog shape 단언.
  - Document+aggregate tab 실행 후 entry shape 단언.
  - double-click 이 `loadQueryIntoTab` 을 호출 (직접 spy 또는 state 관찰).
  - "Load into editor" 버튼이 같은 경로 호출.

### Coverage Target
- 전체: 라인 40%, 함수 40%, 브랜치 35%.
- 신규/수정 코드: 라인 70% 이상 권장.

### Scenario Tests (필수)
- [ ] Happy path — RDB tab 실행 → rdb/sql metadata 기록.
- [ ] Happy path — Document+find tab 실행 → document/find + db/coll.
- [ ] Happy path — Document+aggregate tab 실행 → document/aggregate + db/coll.
- [ ] 에러/예외 상황 — Legacy entry 읽기 시 safe default, throw 없음.
- [ ] 경계 조건 — active tab 없음, active tab 이 table tab 인 상태에서 restore.
- [ ] 기존 기능 회귀 없음 — RDB autocomplete (Sprint 82) / Mongo autocomplete (Sprint 83) 전부 동작, 전체 suite pass.

## Test Script / Repro Script

1. `pnpm install` (lock 변경 시) → `pnpm tsc --noEmit && pnpm lint`.
2. `pnpm vitest run src/stores/queryHistoryStore.test.ts src/stores/tabStore.test.ts src/components/query/QueryTab.test.tsx` → pass.
3. `pnpm vitest run` → 전체 pass.
4. 수동 스모크 (optional): `pnpm tauri dev` → Postgres 탭에서 쿼리 실행 → History 리스트 확인 → double-click 시 같은 탭에서 SQL 교체. 다른 탭(Mongo) 으로 가서 그 entry 를 "Load into editor" → 새 RDB tab 이 열리는지 확인.

## Ownership

- Generator: general-purpose agent (single pass).
- Write scope:
  - `src/stores/queryHistoryStore.ts`
  - `src/stores/queryHistoryStore.test.ts`
  - `src/stores/tabStore.ts`
  - `src/stores/tabStore.test.ts`
  - `src/components/query/QueryTab.tsx`
  - `src/components/query/QueryTab.test.tsx`
- Merge order: Sprint 83 이후, Sprint 85 이전.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
