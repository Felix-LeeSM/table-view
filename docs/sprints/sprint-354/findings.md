# Sprint 354 — Findings

작성 2026-05-16.

## L2 — `schemaStore` 비-schema 메서드 인벤토리 (정확 5개)

State management strategy doc, line 521:

> `schemaStore` 의 비-schema 5 메서드
> (`queryTableData` / `executeQuery` / `executeQueryBatch` / `dropTable` /
> `renameTable`) → `lib/tauri/*` 직접 호출로 옮김.

`src/stores/schemaStore.ts` 의 5 메서드는 schema introspection 캐시와
관련 없이 `tauri.*` 한 줄을 통과시키는 책임 누수 (Action 만 가지고 cache state 가 없음).

| 메서드 | 현재 호출 사이트 (useSchemaStore) | 신규 호출 사이트 (lib/tauri 직접) | 참고 |
|---|---|---|---|
| `queryTableData` | `src/components/rdb/DataGrid.tsx:59` | `tauri.queryTableData` (`@lib/tauri/query.ts:15`) | DataGrid 뿐 |
| `executeQuery` | (없음 — store 내에 정의되어 있지만 컴포넌트 caller 0) | — (deadcode 제거) | `useQueryExecution.ts` 는 이미 `@lib/tauri` 직접 import |
| `executeQueryBatch` | `src/hooks/useDataGridPreviewCommit.ts:134` | `tauri.executeQueryBatch` (`@lib/tauri/query.ts:70`) | `useRawQueryGridEdit.ts:7` 는 이미 직접 import |
| `dropTable` | `src/hooks/useSchemaTableMutations.ts:48` (storeDrop) | `tauri.dropTable` (`@lib/tauri/ddl.ts:75`) | useSchemaTableMutations 가 storeDrop → tauri.dropTable 로 직접 |
| `renameTable` | `src/hooks/useSchemaTableMutations.ts:49` (storeRename) | `tauri.renameTable` (`@lib/tauri/ddl.ts:96`) | 동상 |

## 작업 노트

- `schemaStore` 메서드들은 모두 cache write 가 0 인 thin pass-through —
  store interface 에서 제거해도 정합성에 영향 없음.
- `useSchemaTableMutations` 의 `storeDrop`/`storeRename` selector 만
  `tauri.dropTable`/`tauri.renameTable` 직접 import 로 교체.
- `DataGrid` 의 `queryTableData` selector → `tauri.queryTableData` 직접
  import + 호출 사이트 시그니처는 동일하게 유지.
- `useDataGridPreviewCommit` 의 `executeQueryBatch` selector → 직접
  import.
- `executeQuery` 는 store 내에서 어디서도 read 되지 않음 (verified
  `grep -rn "useSchemaStore.*executeQuery" src/components src/hooks` →
  0 matches). 그냥 store 에서 제거.

## Invariant 검증

- `schemaStore` 의 schema-fetching 메서드 (`listSchemas`/`listTables`/
  `listViews`/`listFunctions`/`getTableColumns`/`getTableIndexes`/
  `getTableConstraints`/`listTriggers`/`getViewColumns`/
  `getViewDefinition`/`prefetchSchemaColumns`/`refreshTableTriggers`/
  `clearSchema`/`clearForConnection`/`clearForWorkspace`/
  `evictSchemaForName`) 는 모두 변경 0.
- Backend Tauri command signature 변경 0.
