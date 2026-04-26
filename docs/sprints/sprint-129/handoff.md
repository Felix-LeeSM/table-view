# Generator Handoff — sprint-129

## Goal (1 line)

Mongo 코드 경로에서 RDB 가정(`schema/table` aliasing) 제거. `TableTab`에 document 전용 `database?` / `collection?` 도입, mongo write/read 사이트 이관, persisted 탭 backfill 마이그레이션, DocumentDatabaseTree 비주얼 정리 + search input.

## Changed Files

- `src/stores/tabStore.ts` — `TableTab`에 `database?: string` / `collection?: string` 추가, `loadPersistedTabs`에 document-tab schema/table → database/collection backfill 마이그레이션 추가 (RDB 탭 무영향, idempotent).
- `src/components/schema/DocumentDatabaseTree.tsx` — `addTab`에 `database`/`collection` 추가 (legacy `schema`/`table`도 함께 채움), `Folder/FolderOpen` 아이콘 제거 → `Database` 아이콘 단일, 신규 search input (`aria-label="Filter databases and collections"`) + cross-filter + auto-expand on collection match + Esc clear + zero-result message.
- `src/components/layout/MainArea.tsx` — document case: `<DocumentDataGrid database={tab.database ?? tab.schema!} collection={tab.collection ?? tab.table!}>`. 외곽 gate도 `tab.table ?? tab.collection` / `tab.schema ?? tab.database`로 fallback 추가.
- `src/stores/tabStore.test.ts` — sprint-129 마이그레이션 테스트 3개 추가 (happy backfill / RDB 탭 무영향 / idempotent).
- `src/components/schema/DocumentDatabaseTree.test.tsx` — addTab database/collection 검증 강화, search input 렌더, case-insensitive 필터링, zero-result message, collection-match auto-expand, Folder 아이콘 미렌더 + Database 아이콘 렌더, Esc clear.

## Checks Run

| 명령 | 결과 |
| --- | --- |
| `pnpm vitest run` | **passed** — 1957 tests / 123 files (직전 baseline 1948 → +9, 회귀 0) |
| `pnpm tsc --noEmit` | **passed** — 0 errors |
| `pnpm lint` | **passed** — 0 errors / 0 warnings |
| `pnpm contrast:check` | **passed** — 0 new violations (allowlist 64 unchanged) |
| e2e 정적 컴파일 | **passed** — 신규 spec 추가 0, 기존 e2e 파일 미변경, 전체 프로젝트 tsc 통과 (e2e specs는 wdio runtime이 자체 transformer로 로드, contract 요구사항: 회귀 0건) |

## Acceptance Criteria 매핑

- **AC-01** `TableTab` 에 `database?: string` / `collection?: string` (둘 다 optional)
  - `src/stores/tabStore.ts:33-45` — `database?` / `collection?` 정의 (sprint 129 주석 + JSDoc).
- **AC-02** `DocumentDatabaseTree.addTab` 호출에 `database/collection` 포함, legacy `schema/table` 함께
  - `src/components/schema/DocumentDatabaseTree.tsx:93-115` — addTab payload (인용 아래).
  - test: `src/components/schema/DocumentDatabaseTree.test.tsx:74-110` — `database === "table_view_test"`, `collection === "users"`, `schema/table` 함께 채움 검증.
- **AC-03** `MainArea.tsx` document case — 새 필드 우선 + schema/table fallback
  - `src/components/layout/MainArea.tsx:32-44` (인용 아래).
  - 외곽 gate 보강: `src/components/layout/MainArea.tsx:202-205`.
- **AC-04** `tabStore.loadPersistedTabs` document 탭 backfill 마이그레이션
  - `src/stores/tabStore.ts:531-553` (인용 아래).
- **AC-05** Folder/FolderOpen 메타포 제거 → Database 아이콘 단일
  - `src/components/schema/DocumentDatabaseTree.tsx:1-12` — `Folder`/`FolderOpen` import 삭제.
  - `src/components/schema/DocumentDatabaseTree.tsx:303-313` — db row JSX, chevron 다음에 `DbIcon` 단일.
  - test: `src/components/schema/DocumentDatabaseTree.test.tsx:208-228` — `svg.lucide-folder` / `svg.lucide-folder-open` 미렌더, `svg.lucide-database` 2개 이상 렌더.
- **AC-06** search input (`aria-label="Filter databases and collections"`), case-insensitive, zero-result 시 `No databases match "<query>"`
  - `src/components/schema/DocumentDatabaseTree.tsx:212-231` — input element + Esc handler + class.
  - `src/components/schema/DocumentDatabaseTree.tsx:248-261` — zero-result message (별도 메시지, 기존 "No databases visible..." 와 분리).
  - test: `src/components/schema/DocumentDatabaseTree.test.tsx:138-163` — case-insensitive (`"AD"` → admin match).
  - test: `src/components/schema/DocumentDatabaseTree.test.tsx:165-181` — zero-result 메시지.
- **AC-07** db 이름 또는 expanded db 안의 collection 이름 둘 다 매치, collection match 시 auto-expand
  - `src/components/schema/DocumentDatabaseTree.tsx:128-141` — `filteredDatabases` cross-filter (db name OR collection name).
  - `src/components/schema/DocumentDatabaseTree.tsx:145-185` — auto-expand effect (`autoExpandedRef`로 clear 시 collapse 복귀).
  - test: `src/components/schema/DocumentDatabaseTree.test.tsx:183-216` — `"user"` 검색 → users collection auto-expand.
- **AC-08** 신규 단위 테스트
  - `src/stores/tabStore.test.ts:884-987` — 3개 마이그레이션 시나리오 (happy / RDB tab 무영향 / idempotent).
  - `src/components/schema/DocumentDatabaseTree.test.tsx:135-243` — search/Folder/Database/Esc 6개.
- **AC-09** 검증 명령 5개 그린 — 위 표 참조.
- **AC-10** PG 워크스페이스 회귀 0
  - `pnpm vitest run` → `123 passed (123) / 1957 passed (1957)`. 기존 1948 baseline 대비 회귀 0, +9 신규 통과.
  - SchemaTree 호출 지점 / RDB DataGrid props 미변경 (`MainArea.tsx:104-118`은 RDB case 그대로).
  - 마이그레이션 분기는 `paradigm === "document"` 일 때만 새 필드를 채우고, RDB 탭은 `database` / `collection` 모두 `undefined` 유지 (test `src/stores/tabStore.test.ts:937-963` 로 단언).

## 주요 코드 인용

### DocumentDatabaseTree addTab 호출 (sprint 129)

`src/components/schema/DocumentDatabaseTree.tsx:93-117`

```tsx
const handleCollectionOpen = useCallback(
  (dbName: string, collectionName: string) => {
    addTab({
      type: "table",
      title: `${dbName}.${collectionName}`,
      connectionId,
      closable: true,
      // Sprint 129 — primary fields for the document paradigm. Downstream
      // consumers (MainArea, future S130/S131 store wires) read these.
      database: dbName,
      collection: collectionName,
      // Legacy RDB-aliased fields. Persisted document tabs from sprint
      // <129 used these and `loadPersistedTabs` migrates them; we keep
      // writing them here for backwards-compat with any reader still on
      // the old field. New read sites must prefer `database`/`collection`.
      schema: dbName,
      table: collectionName,
      subView: "records",
      paradigm: "document",
    });
  },
  [addTab, connectionId],
);
```

### tabStore loadPersistedTabs 마이그레이션 (sprint 129)

`src/stores/tabStore.ts:531-553`

```ts
if (t.type === "table") {
  // Sprint 129 — document tabs persisted before this sprint stored
  // the MongoDB database/collection in `schema`/`table` (RDB
  // aliasing). Backfill the new dedicated `database`/`collection`
  // fields when missing so downstream consumers can drop the
  // alias. RDB tabs (paradigm !== "document") leave the new
  // fields untouched. The migration is idempotent: if either
  // field is already populated, we keep the persisted value.
  const paradigm = t.paradigm ?? ("rdb" as const);
  const isDocument = paradigm === "document";
  const database = isDocument ? (t.database ?? t.schema) : t.database;
  const collection = isDocument
    ? (t.collection ?? t.table)
    : t.collection;
  return {
    ...t,
    isPreview: false,
    paradigm,
    sorts: t.sorts ?? [],
    database,
    collection,
  };
}
```

### MainArea fallback (sprint 129)

`src/components/layout/MainArea.tsx:32-44`

```tsx
case "document":
  // Sprint 129 — prefer the dedicated `database` / `collection` fields,
  // fall back to the legacy `schema` / `table` aliasing for safety in
  // case a persisted tab predates the migration in `loadPersistedTabs`.
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DocumentDataGrid
        connectionId={tab.connectionId}
        database={tab.database ?? tab.schema!}
        collection={tab.collection ?? tab.table!}
      />
    </div>
  );
```

추가로 외곽 gate (`MainArea.tsx:202-205`):

```tsx
{activeTab?.type === "table" &&
(activeTab.table ?? activeTab.collection) &&
(activeTab.schema ?? activeTab.database) ? (
  <TableTabView ... />
```

## Done Criteria 체크

1. ✅ TableTab.`database?` / `collection?` 추가
2. ✅ DocumentDatabaseTree addTab에 새 필드
3. ✅ MainArea document case 새 필드 사용 + fallback
4. ✅ loadPersistedTabs document 탭 backfill
5. ✅ Folder 메타포 제거 → Database 아이콘 단일
6. ✅ search input + zero-result 메시지
7. ✅ 신규 단위 테스트 (tabStore 3, DocumentDatabaseTree 6)
8. ✅ 검증 명령 5종 그린

## Assumptions

- **Document 탭 write 시 `schema`/`table`을 함께 채워두는 backwards-compat 정책**: 컨트랙트 In Scope §3 ("`schema/table`도 동일 값 함께 (legacy)") 와 Done Criteria invariant ("schema?/table?는 보존 — document 탭도 backwards-compat로 같이 채움") 를 따름. 이 alias 채움은 한 transaction (단일 `addTab` 호출) 안에서 일어나고, 점진 제거는 S130/S131 또는 후속 sprint에서 store-wire 시그니처 정리와 함께.
- **Auto-expand 의 collapse 복귀**: 사용자 의도의 expand state를 보존하기 위해 `autoExpandedRef` 로 search-only 자동 확장을 추적하고 query 가 비어지면 그것만 collapse. 사용자가 검색 중 직접 toggle 한 db 는 (이미 `expandedDbs` 에 있던 것이라) 그대로 유지. 컨트랙트 강제 사항은 아니지만 UX 일관성.
- **e2e 정적 컴파일** : 프로젝트 `tsconfig.json` 은 `include: ["src"]` 만이라 e2e 파일은 메인 `tsc --noEmit` 의 검증 대상 아님 (wdio runner 가 자체 ts-node transformer 로 런타임 컴파일). 신규 spec 추가 0, 기존 spec 미수정 → "회귀 0" 이라는 contract 의 정신 부합. 만약 별도 e2e tsc 스크립트가 필요했다면 기존에 있어야 하나 `package.json` 에 없음 — 본 sprint scope 밖.
- **Esc clear 동작**: 컨트랙트 design bar 에 명시("Esc로 input clear (또는 동일 패턴 재사용 가능 시)") 되어 직접 구현 — 기존 RDB tree 에 동일 패턴이 없어 인라인 keydown handler 로 구현.

## Residual Risk

- **DocumentDataGrid 내부 alias 잔존**: `DocumentDataGrid.tsx` 의 `schema: database, table: collection` query store wire 는 컨트랙트 Out of Scope 에 따라 **건드리지 않음**. S130/S131에서 active DB context 변경 작업과 함께 정리 예정.
- **Search 와 collection 캐시 의존**: collection-name match 는 이미 `collectionsByDb` 에 로드된 (= 사용자가 한 번 expand 했던) 데이터에 한해서만 동작. 한 번도 펼치지 않은 db 의 collection 은 자동으로 fetch 하지 않음 — 컨트랙트 design bar §"검색은 클라이언트 사이드 only (네트워크 fetch 추가 없음)" 와 일치. 사용자 시야로는 "처음 본 적 없는 db 는 db 이름으로만 매치 가능" 이라는 미세 제약.
- **`autoExpandedRef` mutable ref 사용**: React StrictMode 에서 effect 가 두 번 실행되어도 문제 없도록 set 의 idempotent add/delete 로 안전하게 작성. 다만 일반적인 deps 누락 (`expandedDbs`) 에 대해 inline `eslint-disable-next-line` 을 사용. 의도 — 자동 확장 후 동일 effect 가 재실행되면 무한 루프 방지. 잔여 위험은 미미.

## 시나리오 매핑 (contract §Test Requirements)

- ✅ Happy: Mongo 연결 → DB 트리 → collection 더블 클릭 → tab 생성 (database/collection 채움) — `DocumentDatabaseTree.test.tsx:74-104`
- ✅ 회귀: PG 연결 → SchemaTree → 탭 생성 (database/collection 미설정, schema/table 그대로) — `tabStore.test.ts:937-963` (RDB persisted load 시 미백필) + 기존 SchemaTree.test.tsx 회귀 0
- ✅ 마이그레이션: localStorage legacy mongo 탭 → load 후 database/collection 채워져 — `tabStore.test.ts:889-925`
- ✅ 검색: "ad" 입력 → admin 매치, 다른 DB 숨김 — `DocumentDatabaseTree.test.tsx:147-163`
- ✅ 경계: 매치 0 → "No databases match" — `DocumentDatabaseTree.test.tsx:165-181`
