# Sprint 263 Handoff — schemaStore db-aware caching

## Status

Complete. 모든 AC 충족, 모든 회귀 게이트 통과.

## Regression Gates

| 게이트 | 결과 |
|---|---|
| `pnpm vitest run --no-file-parallelism` | 258 files / 3187 tests passed |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `cargo clippy --all-targets --all-features -- -D warnings` | exit 0 |
| `cargo test` | 12 passed; 0 failed |

`--no-file-parallelism` 사용 사유 — 기본 병렬 실행에서 `vitest-pool-runner`
worker timeout 두 건이 환경적으로 발생 (16분 wall-clock). 단일 fork 로
재실행 시 모두 통과. 실 코드 회귀가 아닌 환경 flake.

## AC Verification

### AC-263-01 — `schemaStore` 자료구조
- `src/stores/schemaStore.ts` — 5 캐시 차원 모두 `ByConn<ByDb<...>>` 로 nested.
- 모든 mutating action 시그니처에 `db: string` 명시.
- `clearForWorkspace(connId, db)` 신규 추가. `clearForConnection(connId)` /
  `clearSchema(connId)` 유지.
- `executeQuery` / `executeQueryBatch` 는 db 파라미터 없음 — 백엔드 pool 이
  active db 보유.
- backend tauri command 시그니처 변경 없음. 프론트엔드 cache key 만 분리.

### AC-263-02 — `useSchemaCache` db-aware
- 시그니처: `useSchemaCache(connectionId, db)`.
- 빈 `db` sentinel 가드 — `useSchemaCache.ts` mount effect 가 `!db` 일 때
  early-return (transient unresolved-db 상태 회피).
- `autoLoadedRef` key 가 ``${connId}|${db}`` — 같은 (connId, db) remount
  재로드 안 함.
- `expandSchema` / `refreshSchema` / `refreshConnection` 모두 db 명시.

### AC-263-03 — 22 callsite atomic migration
- 모든 callsite 가 nested 캐시 read + explicit-db write 로 전환.
- `useWorkspaceKeyForConnection` 으로 db 도출 (SchemaTree 계열).
- `tab.database` 로 db 흐름 (DataGrid / StructurePanel / QueryTab).
- `useCurrentWorkspaceKey` 로 cross-cutting hook 도출 (QuickOpen).
- `useSqlAutocomplete(connectionId, db)` — `tab.database ?? ""` 흘림.
- `EMPTY_BY_SCHEMA = Object.freeze({})` selector 안정화 — re-render churn
  회피.

### AC-263-04 — DbSwitcher cache 보존
- `DbSwitcher.tsx` 에서 `clearForConnection` 호출 제거 + `useSchemaStore`
  import 제거.
- 신규 테스트 케이스 "preserves the schema caches across a successful DB
  toggle (AC-263-04)" — db1/db2 nested seed 후 toggle 시 캐시 그대로
  남음을 단언.

### AC-263-05 — 회귀 게이트
- vitest baseline 3179 → 3187 (+8 신규 케이스 추가, 회귀 0).
- 신규 케이스: `useSchemaCache.test.ts` 4건 (AC-191-02-1/2/3/4),
  `schemaStore.test.ts` 다중-DB / `clearForWorkspace` / autoLoaded 케이스,
  `useSqlAutocomplete.test.ts` "excludes tables from other databases" 1건,
  `SchemaTree.workspace-state.test.tsx` 1건, `DbSwitcher.test.tsx` 1건.

## Key Production Changes

| 파일 | 변경 요약 |
|---|---|
| `src/stores/schemaStore.ts` | 5 캐시 차원 nested; 모든 action 시그니처에 db 추가; `clearForWorkspace` 신규 |
| `src/hooks/useSchemaCache.ts` | `(connId, db)` 시그니처; empty-db sentinel 가드; per-(connId,db) autoLoadedRef |
| `src/components/workspace/DbSwitcher.tsx` | `clearForConnection` 호출 폐기 — toggle 시 캐시 보존 |
| `src/components/schema/SchemaTree.tsx` | selector 단계에서 `tables[connId]?.[db] ?? EMPTY_BY_SCHEMA` 로 pre-slice |
| `src/components/schema/SchemaTree/useSchemaTreeActions.ts` | `useWorkspaceKeyForConnection` 가 `useSchemaCache` 호출 위로 이동 |
| `src/components/rdb/DataGrid.tsx` | `database` prop 추가 → `queryTableData` 에 전달 |
| `src/components/schema/StructurePanel.tsx`, `ViewStructurePanel.tsx` | `database` prop 추가 → 5 store action 호출에 전달 |
| `src/components/structure/IndexesEditor.tsx`, `ConstraintsEditor.tsx` | `database` prop 추가 → `getTableColumns` 전달 |
| `src/components/schema/CreateTableDialog.tsx` | `database` prop 추가; `refTablesByKey` / `refColumnsByKey` nested traversal |
| `src/components/schema/DropTableDialog.tsx`, `RenameTableDialog.tsx` | `database` prop 추가 → mutation 전달 |
| `src/components/query/QueryResultGrid.tsx`, `QueryTab.tsx` | `database` 흘림 → `tableColumnsCache` nested lookup |
| `src/components/shared/QuickOpen.tsx` | `activeStatuses[conn.id].activeDb` 로 db 도출 후 nested 순회 |
| `src/hooks/useSqlAutocomplete.ts` | `(connectionId, db)` 시그니처; nested cache 순회 |
| `src/hooks/useSchemaTableMutations.ts` | `dropTable` / `renameTable` 에 db 추가; `setNested3<V>` immutable helper |
| `src/hooks/useFkReferencePicker.ts` | `(connectionId, database)` 시그니처 |
| `src/hooks/useMigrationExport.ts` | `exportSchema` / `exportDatabase` 에 db 추가 |
| `src/components/layout/MainArea.tsx` | `tab.database ?? ""` 를 자식들에 전달 |

## Test Helper Changes

| 헬퍼 / 파일 | 변경 |
|---|---|
| `src/components/schema/__tests__/schemaTreeTestHelpers.ts` | `setSchemaStoreState` 가 legacy flat-key 시드 (`{ conn1: [...] }`, `{ "conn1:public": [...] }`) 를 `db1` sentinel 하에 nested 형태로 자동 변환. 신규 nested seed 도 passthrough. |
| `SchemaTree.dbms-shape.test.tsx`, `SchemaTree.virtualization.test.tsx`, `SchemaTree.preview.test.tsx`, `SchemaTree.preview.entrypoints.test.tsx`, `SchemaTree.rowcount.test.tsx` | 파일별 local `setSchemaStoreState` 도 동일 translation; 다중-conn 테스트는 conn id 별 `activeStatuses` 자동 seed. |
| `src/components/rdb/__tests__/dataGridTestHelpers.tsx` | `database="db1"` 기본값 추가. |
| `src/components/schema/__tests__/structurePanelTestHelpers.tsx` | `renderPanel` 기본값에 `database` 추가. |

Test seed translation 은 어댑터 — production 코드에는 backwards-compat
shim 없음. 12개 SchemaTree 테스트 파일 중 10개가 어댑터로 무변경 통과.
나머지 2개 (lifecycle, refresh) 와 actions 1건은 assertion 시그니처 갱신
(`("conn1", "public")` → `("conn1", "db1", "public")`) 으로 처리.

## Out of Scope (다음 sprint 후보)

spec.md §Out of Scope 와 동일:

1. **Mongo schema (db, collection) per-(connId, db) 분리** — RDB 한정.
   `documentStore` 는 별도.
2. **schema cache TTL** — 자동 무효화 없음. user 가 backend 에서 직접
   수정한 경우 refresh action 필요.
3. **백엔드 tauri command 의 `database` 파라미터 추가** — 현재 backend
   pool 이 active DB 를 들고 있어 의미적으로 옳다. backend-level explicit
   명시는 별도 ADR + sprint.
4. **`tableColumnsCache` cross-DB autocomplete corner case audit** — 본
   sprint 는 cache key 분리까지. `useSqlAutocomplete` 가 활성 (conn, db)
   외 컬럼을 노출할 가능성은 추가 audit 필요.

## Lessons Captured

- **Test helper 어댑터 vs per-file rewrite**: 12개 테스트 파일을 일괄
  마이그레이션할 때 shared helper 한 곳에 shape translator 를 두면
  대다수 파일이 무변경 통과. assertion 시그니처 갱신은 grep + targeted
  Edit 로 따로 처리. production 코드에는 shim 없음 — translation 은
  test infra 한정.
- **Selector stability**: `tables[connId]?.[db] ?? {}` 처럼 inline literal
  을 selector return value 로 쓰면 매 render `{}` 가 새 reference 라
  React 가 churn. `EMPTY_BY_SCHEMA = Object.freeze({})` 한 모듈-레벨
  상수로 stable reference 유지.
- **Vitest worker timeout**: 258 file / 16분 wall-clock 의 default
  parallel 실행에서 worker timeout flake. `--no-file-parallelism` 으로
  안정. CI 시 동일 옵션 검토 가치 있음.
