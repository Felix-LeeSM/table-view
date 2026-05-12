# Sprint 263 Spec — schemaStore db-aware caching (ADR 0027 후속)

## Feature Description

`schemaStore` 의 5 캐시 차원 (`schemas` / `tables` / `views` / `functions` /
`tableColumnsCache`) 을 `(connId, db)` 별로 분리한다. 같은 connection 의
db1 ↔ db2 toggle 시 캐시가 재사용되어 reload 의 1-2 초 wait 가 사라진다.

본 sprint 는 ADR 0027 (Sprint 262) 의 "per `(connId, db)` 격리" 원칙을
`schemaStore` 까지 확장하는 mechanical 적용 — 별도 ADR 추가 없이 Sprint
262 spec 의 Follow-up #6 를 정직하게 이행.

## 배경 — 현재 한계

- `schemas: Record<connId, SchemaInfo[]>`,
  `tables: Record<"connId:schema", TableInfo[]>` 등 모든 키가 connection
  단위. DB 차원은 키에 없음.
- DbSwitcher 는 DB 전환 시 `clearForConnection(connId)` 로 connection 의
  전체 캐시를 wipe. 이 wipe 가 stale-leak 을 차단해 correctness 는 보장
  되지만, **toggle 마다 fresh fetch** 가 일어남.
- Sprint 262 가 workspace state 를 (connId, db) 별로 분리했기 때문에
  sidebar 의 expanded set / scrollTop 등은 toggle 시 자동 swap 되지만,
  그 위에 그려지는 schema 트리 데이터 자체는 매번 새로 받아야 하는 모순.

## ADR 0027 와의 관계

새 ADR 작성 안 함. ADR 0027 의 결정 (`(connId, db)` keyed cohesive
state) 을 `schemaStore` 에 적용하는 것은 **그 결정의 mechanical
consequence**. ADR 본문은 동결, status / superseded_by 만 갱신 가능
이라는 규칙대로 본문 수정 없이 그대로 둠.

## Sprint Breakdown

단일 sprint. 슬라이스 3 개:

1. **Slice A**: `schemaStore` 의 5 캐시 차원 모두 `(connId, db)` 키로 전환
   + action 시그니처 explicit-API + `useSchemaCache` 의 autoLoaded ref
   per-`(connId, db)` 화. TDD vertical slice.
2. **Slice B**: 22 callsite (production 16 + hooks 6) atomic migration.
   DbSwitcher 의 `clearForConnection` 호출 폐기 — toggle 캐시 보존이
   목적이므로 wipe 가 더 이상 필요 없음. Atomic commit.
3. **Slice C**: 회귀 가드 (vitest / tsc / lint / cargo clippy / cargo
   test) + handoff.

## Acceptance Criteria

### AC-263-01 — `schemaStore` 자료구조

#### Shape

```ts
interface SchemaState {
  schemas: Record<string /*connId*/, Record<string /*db*/, SchemaInfo[]>>;
  tables: Record<string /*connId*/, Record<string /*db*/, Record<string /*schema*/, TableInfo[]>>>;
  views: Record<string /*connId*/, Record<string /*db*/, Record<string /*schema*/, ViewInfo[]>>>;
  functions: Record<string /*connId*/, Record<string /*db*/, Record<string /*schema*/, FunctionInfo[]>>>;
  tableColumnsCache: Record<string /*connId*/, Record<string /*db*/, Record<string /*schema*/, Record<string /*table*/, ColumnInfo[]>>>>;
  loading: boolean;
  error: string | null;
  // actions (see AC-263-02)
}
```

- 모든 dimension 은 nested map (Sprint 262 의 `workspaces:
  Record<conn, Record<db, ...>>` 패턴과 동일). flat `"conn:db:schema"`
  string 키 회피 (separator 충돌 위험 없음, cleanup 한 줄).
- `Set` 사용 안 함 — array 가 localStorage round-trip 단순.

#### Action 시그니처 (Sprint 262 의 explicit-API 원칙 적용)

```ts
loadSchemas(connId: string, db: string): Promise<void>;
loadTables(connId: string, db: string, schema: string): Promise<void>;
loadViews(connId: string, db: string, schema: string): Promise<void>;
loadFunctions(connId: string, db: string, schema: string): Promise<void>;
prefetchSchemaColumns(connId: string, db: string, schema: string): Promise<void>;

getTableColumns(connId: string, db: string, table: string, schema: string): Promise<ColumnInfo[]>;
getTableIndexes(connId: string, db: string, table: string, schema: string): Promise<IndexInfo[]>;
getTableConstraints(connId: string, db: string, table: string, schema: string): Promise<ConstraintInfo[]>;
getViewColumns(connId: string, db: string, schema: string, viewName: string): Promise<ColumnInfo[]>;
getViewDefinition(connId: string, db: string, schema: string, viewName: string): Promise<string>;
queryTableData(connId: string, db: string, table: string, schema: string, ...): Promise<TableData>;

dropTable(connId: string, db: string, table: string, schema: string): Promise<void>;
renameTable(connId: string, db: string, table: string, schema: string, newName: string): Promise<void>;
executeQuery(connId: string, sql: string, queryId: string): Promise<QueryResult>;            // db 파라미터 없음 — 백엔드는 active pool 의 db 사용
executeQueryBatch(connId: string, statements: string[], queryId: string): Promise<QueryResult[]>;

evictSchemaForName(connId: string, db: string, schemaName: string): void;
clearForWorkspace(connId: string, db: string): void;       // **신규** — DB 한 개 분량만 evict
clearForConnection(connId: string): void;                  // 유지 — disconnect 시 connection 전체 wipe
clearSchema(connId: string): void;                         // 유지 (legacy alias)
```

- `executeQuery` / `executeQueryBatch` / `dropTable` / `renameTable` 등
  순수 backend pass-through 액션은 캐시 차원이 없으므로 db 파라미터를
  추가하지 *않는다* — 단, `dropTable` / `renameTable` 의 후속 evict
  콜은 explicit db 를 요구하므로 호출처에서 책임진다. (현 코드에선
  evict 가 `useSchemaTableMutations` 안에 있음 — db 파라미터 흐름은 그
  hook 까지.)
- 백엔드 tauri command 시그니처는 **변경 안 함**. 백엔드는 connection
  pool 의 active DB 를 사용하고, 프론트엔드는 fetch 시점의 activeDb 를
  cache key 로 사용. activeDb 와 backend pool 의 동기성은 DbSwitcher 의
  `await switchActiveDb` → `setActiveDb` 순서가 이미 보장.

### AC-263-02 — `useSchemaCache` db-aware

```ts
useSchemaCache(connectionId: string, db: string): UseSchemaCacheReturn;
```

- `db` 인자 추가. 모든 store action 호출에 db 전달.
- `autoLoadedRef` 가 `(connId, db)` pair 별로 mount-time auto-load 를
  단 한 번씩 트리거하도록 변경. `useRef<Set<string>>` 또는 동등한 구조.
- `expandSchema` / `refreshConnection` / `refreshSchema` 모두 db 전달.

#### TDD vertical slice

1. **트레이서 불릿**: `loadSchemas("conn1", "db1")` → `schemas[conn1][db1]`
   에 결과 저장. 다른 db 자리 미생성 (lazy create).
2. **다중-DB 격리**: `loadSchemas("conn1", "db1")` + `loadSchemas("conn1", "db2")`
   → 두 자리 모두 채워지고 서로 영향 없음.
3. **DB toggle 캐시 재사용**: 두 번 load 한 뒤 `clearForWorkspace("conn1", "db1")`
   → db1 자리만 빈다, db2 는 유지.
4. **`clearForConnection`**: connection 전체 wipe — 모든 db 자리 삭제.
5. **`evictSchemaForName`** 도 `(connId, db, schemaName)` 셋 모두 받아
   해당 자리만 evict.
6. **`useSchemaCache(connId, db)` mount auto-load 가 (connId, db) 별로 1회**
   — 같은 (connId, db) 로 remount 해도 (caller hook 의 autoLoadedRef 가
   유지될 때) 재로드 안 함.
7. **db 변경 시 새 mount auto-load**: `useSchemaCache("c1", "db1")` 후
   `useSchemaCache("c1", "db2")` 로 인자 변경 시 db2 auto-load 트리거.

### AC-263-03 — Caller atomic migration

22 callsite 모두 explicit `(connId, db)` 로 갱신:

- `src/components/schema/SchemaTree.tsx`, `SchemaTree/useSchemaTreeActions.ts`,
  `SchemaTree/dialogs.tsx`, `CreateTableDialog.tsx`,
  `CreateTableDialog/ForeignKeysTabBody.tsx`, `StructurePanel.tsx`,
  `ViewStructurePanel.tsx`
- `src/components/workspace/DbSwitcher.tsx` — `clearForConnection` 호출
  **폐기** (toggle 캐시 보존). disconnect 경로의 `clearSchema` 는 그대로.
- `src/components/rdb/DataGrid.tsx`, `query/QueryResultGrid.tsx`,
  `query/QueryTab/queryHelpers.ts`, `shared/QuickOpen.tsx`,
  `structure/IndexesEditor.tsx`, `structure/ConstraintsEditor.tsx`
- `src/hooks/useSchemaCache.ts`, `useSchemaTableMutations.ts`,
  `useSqlAutocomplete.ts`, `useDataGridPreviewCommit.ts`,
  `useConnectionLifecycle.ts`, `useMigrationExport.ts`,
  `useFkReferencePicker.ts`

db 해석은 callsite 마다 가장 가까운 source 사용:

- SchemaTree / SchemaTree 자식: 이미 Sprint 262 에서 도입된
  `useWorkspaceKeyForConnection(connectionId)` 로 (connId, db) 도출.
- DataGrid / StructurePanel / QueryTab: 탭에 이미 `database` 필드 존재
  (Sprint 262 lock). `tab.database` 사용.
- QuickOpen / useSqlAutocomplete 등 cross-cutting: `useCurrentWorkspaceKey()`.

### AC-263-04 — DbSwitcher cache-preservation 확인 테스트

`DbSwitcher.test.tsx` 에 신규 케이스:
- (conn1, db1) 에서 `schemas` 로드 → `clearForConnection` 호출되지 않음 →
  db1 ↔ db2 toggle 후 db1 캐시 그대로.

### AC-263-05 — 회귀 가드

- `pnpm vitest run` 통과 (3179 baseline 유지 또는 증가; 신규 TDD 케이스
  추가분 +α).
- `pnpm tsc --noEmit` exit 0.
- `pnpm lint` exit 0.
- `cargo clippy --all-targets --all-features -- -D warnings` exit 0
  (변경 없으나 회귀 확인).
- `cargo test` 회귀 0 (Rust 변경 없음).

## Out of Scope (Sprint 264+ 또는 backlog)

- **Mongo schema (db, collection) per-(connId, db) 분리** — 본 sprint 는
  RDB schemaStore 한정. documentStore (Mongo) 는 별도.
- **schema cache TTL** — toggle 캐시 보존이 목적이라 무한 보존. user 가
  schema 를 backend 에서 직접 수정한 경우 stale 가능. refresh 액션은
  여전히 동작하지만 자동 무효화는 본 sprint 범위 밖.
- **백엔드 tauri command 의 `database` 파라미터 추가** — 현재 backend
  pool 이 active DB 를 들고 있어 의미적으로 옳다. backend-level explicit
  명시는 별도 ADR + sprint.
- **`tableColumnsCache` 의 SQL autocomplete 영향 검증** —
  `useSqlAutocomplete` 가 이 캐시를 cross-DB 어떻게 다루는지 별도 audit
  필요. 본 sprint 는 cache key 만 분리, autocomplete 가 잘못된 (conn,
  db) 의 컬럼을 보여줄 수 있는 corner case 는 검증만 하고 다음 sprint
  로.

## Sprint Schedule

1. **Slice A** (~半 day): schemaStore + useSchemaCache TDD.
2. **Slice B** (~1 day): atomic caller migration + DbSwitcher.
3. **Slice C** (~半 day): regression + handoff.

총 ~2 일.
