# Sprint 66 Contract — Phase 6 컬렉션 사이드바 + 문서 그리드 (plan C)

> Phase 6 플랜 [`C`](/Users/felix/.claude/plans/idempotent-snuggling-brook.md)에 해당. Sprint 65에서 MongoAdapter 연결 + `list_databases`/`list_collections`까지 만들었고, 이번에는 **mongo 연결에서 database/collection 트리 탐색 → 컬렉션 더블클릭 → 문서 그리드 preview** 까지의 P0 읽기 경로를 완성한다.

## Scope

1. `MongoAdapter::infer_collection_fields(db, coll, sample)` 실제 구현 — `coll.find(None).limit(sample)`로 표본 문서를 모아 top-level 필드 이름/타입 최빈값/nullable을 추출. `_id`는 항상 첫 컬럼.
2. `MongoAdapter::find(db, coll, body)` 실제 구현 — `body.filter`, `body.sort`, `body.projection`, `body.skip`, `body.limit`를 그대로 드라이버에 위임. 각 문서는 (a) 사전 `infer`된 컬럼 순서로 flatten된 `Vec<serde_json::Value>` 형태의 `rows`, (b) 전체 BSON은 canonical extended JSON으로 직렬화한 `raw_documents`로 반환. 중첩 object/array cell은 `"{...}"`/`"[N items]"` sentinel 문자열.
3. `DocumentQueryResult.total_count` 계산: `estimated_document_count()` (정확 count는 out of scope).
4. `src-tauri/src/commands/document/` 모듈 신설 + `browse.rs` + `query.rs`:
   - `list_mongo_databases(connection_id)`
   - `list_mongo_collections(connection_id, database)`
   - `infer_collection_fields(connection_id, database, collection, sample_size?)`
   - `find_documents(connection_id, database, collection, body)` (페이징 그리드용 래퍼)
   - 각 command는 `state.active_connections.get(&id)?.as_document()?.method(...)` 패턴.
   - `tauri::generate_handler!`에 5개 command 이름 등록.
5. Frontend `src/lib/tauri.ts`에 위 5개 command wrapper 함수 추가.
6. Frontend `src/stores/schemaStore.ts` 또는 병행 `src/stores/documentStore.ts` 확장:
   - mongo 트리 탐색 상태: `databases[connectionId]`, `collections[{connectionId}:{db}]`, `collectionColumnsCache[{connectionId}:{db}:{coll}]`.
   - `loadMongoDatabases(connectionId)`, `loadMongoCollections(connectionId, db)`, `inferCollectionFields(connectionId, db, coll)`, `queryCollectionData(connectionId, db, coll, page, pageSize, sort?, filter?)`.
7. Frontend `src/components/schema/DocumentDatabaseTree.tsx` 신규 — `database → collection` 2단계 트리. 컬렉션 아이콘 + 더블클릭 시 `openTab`으로 문서 그리드 preview 탭 오픈.
8. `src/components/layout/Sidebar.tsx`와 `src/components/schema/SchemaPanel.tsx` (또는 관련 라우팅 지점)에서 `paradigm === "rdb"` → 기존 `SchemaTree`, `paradigm === "document"` → `DocumentDatabaseTree` 분기.
9. `src/stores/tabStore.ts::TableTab`에 `paradigm: Paradigm` 필드 추가 (기본값 `"rdb"`로 legacy persisted tab 역호환). `schema`/`table`은 paradigm에 따라 의미 재정의되지만 shape는 유지.
10. `src/components/layout/MainArea.tsx` (또는 관련 tab content router)에서 `paradigm === "document"`인 TableTab을 받으면 `DocumentGrid` 호환 경로로 데이터 소스를 스위치 (구현 상세: 기존 `DataGridTable`을 재사용하되 paradigm-aware data loader 경유).
11. `src/components/datagrid/DataGridTable.tsx`에 중첩 필드 sentinel cell renderer 확장 — `"{...}"`/`"[N items]"` 값은 monospace + 뱃지 톤으로 렌더하고, 해당 cell은 읽기 전용 상태로 표시 (클릭 시 편집 진입 금지). 기존 RDB cell 렌더링 회귀 0.

## Done Criteria

1. **`MongoAdapter::infer_collection_fields`**: 빈 컬렉션 → `vec![ColumnInfo { name: "_id", .. }]`만 반환. 샘플 100 기본, `sample_size` 파라미터로 override 가능. 타입 집계 규칙(최빈값, nullable)에 대해 단위 테스트 ≥ 2건.
2. **`MongoAdapter::find`**: `FindBody { filter, sort, projection, skip, limit }` → `DocumentQueryResult { columns, rows, raw_documents, total_count, execution_time_ms }` 반환. filter 빈 document + limit 300 happy path 단위 테스트 + 중첩 필드 sentinel 단위 테스트 각 1건 이상.
3. **`DocumentQueryResult.total_count`**: `estimated_document_count()` 경유. 컬렉션이 비어 있으면 0.
4. **Commands**: `list_mongo_databases`, `list_mongo_collections`, `infer_collection_fields`, `find_documents` 4개 command 등록 완료. `tauri::generate_handler!`에 실재. 단위 테스트 또는 통합 테스트로 happy path 1건씩 검증 (각 command가 `ActiveAdapter::Document` 경로를 통과).
5. **`tests/mongo_integration.rs` 확장**:
   - seed 단계에서 `table_view_test` DB에 `users` 컬렉션을 2~3 문서 insert (nested field 포함).
   - `infer_collection_fields`가 `_id` + 최소 1개 top-level 필드를 반환.
   - `find`가 `rows.len() == seeded count` + `raw_documents.len() == rows.len()` + 중첩 필드 sentinel 문자열 포함.
   - DB 미가용 시 skip + exit 0.
6. **Tauri wrapper**: `src/lib/tauri.ts`에 `listMongoDatabases`/`listMongoCollections`/`inferCollectionFields`/`findDocuments` (이름 카멜케이스) 함수 추가. TypeScript 타입은 `src/types/` 하위에 `DocumentQueryResult`/`FindBody`/`CollectionInfo`/`DatabaseInfo` 정의.
7. **documentStore(or schemaStore 확장)**: `loadMongoDatabases`/`loadMongoCollections`/`inferCollectionFields`/`queryCollectionData` 액션 동작. 단위 테스트 ≥ 4건 (action별 1건, stale 응답 덮어쓰기 방지 최소 1건).
8. **`DocumentDatabaseTree.tsx`**: mongo 연결 루트 → 확장 시 `list_mongo_databases` 호출 → DB 확장 시 `list_mongo_collections` 호출. 컬렉션 더블클릭 → 문서 그리드 탭 오픈. 컴포넌트 테스트 ≥ 2건 (렌더 + 더블클릭 액션).
9. **Sidebar/SchemaPanel paradigm 분기**: `connection.paradigm === "document"`일 때 `SchemaTree` 대신 `DocumentDatabaseTree` 렌더. `paradigm === "rdb"`는 기존 `SchemaTree` 유지. 컴포넌트 테스트로 분기 검증 ≥ 1건.
10. **`TableTab.paradigm: Paradigm`** 필드 추가. 기존 persist된 탭을 역직렬화할 때 missing paradigm은 `"rdb"`로 fallback. tabStore 단위 테스트 ≥ 2건 (신규 document 탭 생성 + legacy rdb 탭 복원).
11. **DataGridTable sentinel cell**: `"{...}"`/`"[N items]"` 문자열 cell이 해당 톤(`text-muted-foreground` 등 기존 디자인 토큰)으로 렌더되고 더블클릭해도 편집 진입 금지. RDB 테이블에서는 일반 문자열이 영향 받지 않도록 보장 — 타입이 `document` paradigm일 때만 sentinel 처리. 테스트 ≥ 1건.
12. **mongo 연결 문서 그리드 E2E 경로**: `pnpm tauri dev`를 수동 smoke하지 않아도, 다음이 자동 검증되어야 함:
    - `mongo_integration` 통합 테스트가 find/infer를 포함한 happy path를 통과한다 (DB 가용 시).
    - `vitest`의 컴포넌트 테스트로 `DocumentDatabaseTree` 더블클릭 → `tabStore.addTab`가 `paradigm: "document"`인 TableTab을 추가한다.
    - `DataGridTable`에 `paradigm: "document"` + sentinel cell이 담긴 mock rows를 주입했을 때 편집 진입이 차단된다.
13. **회귀 + 검증**:
    - `cd src-tauri && cargo fmt --all -- --check`
    - `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
    - `cd src-tauri && cargo test --lib`
    - `cd src-tauri && cargo test --test schema_integration --test query_integration --test mongo_integration`
    - `pnpm tsc --noEmit`
    - `pnpm lint`
    - `pnpm vitest run`

## Out of Scope

- BSON Quick Look 트리 뷰어 (`BsonTreeViewer.tsx`) — Sprint 67.
- Find/Aggregate **쿼리 탭** (CodeMirror JSON 모드, `QueryEditor` paradigm 분기, `execute_mongo_query` command) — Sprint 68.
- 인라인 편집 / 문서 추가/삭제 / MQL Preview — Sprint 69.
- `MongoAdapter::aggregate`/`insert_document`/`update_document`/`delete_document` 실제 구현 — Sprint 68~69.
- 정확한 `count_documents` — `estimated_document_count`만.
- 필드 inference의 deep-nested 탐색(현재 스프린트는 top-level만).
- MySQL/SQLite (Phase 9).

## Invariants

- 기존 Postgres Tauri command 이름/payload shape 불변.
- 기존 `TableTab`을 소비하는 컴포넌트(SchemaTree에서 연 RDB 탭, QuickOpen 결과, 세션 복원 경로)는 `paradigm` 필드 추가 후에도 정상 동작.
- `SchemaTree.tsx`의 기존 동작/테스트 회귀 0.
- `DataGridTable.tsx` RDB 경로 회귀 0 — sentinel 처리는 `paradigm === "document"` 조건 하에서만 활성화.
- `PostgresAdapter` concrete 메서드 시그니처 불변.
- Sprint 65에서 추가한 `Paradigm` enum / `ConnectionConfigPublic.paradigm` 직렬화 shape 불변.

## Verification Plan

- Profile: `mixed` — command 기반 검증 + frontend 컴포넌트 테스트 필수.
- Required checks:
  1. `cd src-tauri && cargo fmt --all -- --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `cd src-tauri && cargo test --lib`
  4. `docker compose -f docker-compose.test.yml up -d mongodb postgres` + `./scripts/wait-for-test-db.sh`
  5. `cd src-tauri && cargo test --test schema_integration --test query_integration --test mongo_integration`
  6. `pnpm tsc --noEmit`
  7. `pnpm lint`
  8. `pnpm vitest run`
- Required evidence:
  - Generator: 변경/추가된 파일 목록과 목적, 각 command 실행 결과, `mongo_integration`의 find/infer 성공 로그 인용, `DocumentDatabaseTree.test.tsx` 테스트 이름/위치, `DataGridTable` sentinel 테스트 이름/위치, `TableTab.paradigm` legacy 역직렬화 테스트 인용.
  - Evaluator: 위 8개 check 직접 실행, mongo 컨테이너 up/down, `grep`으로 신규 command 이름 실재 확인(`list_mongo_databases`, `list_mongo_collections`, `infer_collection_fields`, `find_documents`), `DocumentDatabaseTree`와 `SchemaTree`가 paradigm별로 분기 렌더되는지 코드 확인, `DataGridTable`의 sentinel 분기 코드 경로 확인.

## Test Requirements

- Rust 단위 테스트 ≥ 5건 (infer 빈 컬렉션 / infer 타입 집계 / find happy path / find projection+sort / sentinel 생성).
- Rust 통합 테스트: `mongo_integration.rs`에 seed+infer+find 시나리오 추가.
- Vitest 컴포넌트 테스트 ≥ 5건 (`DocumentDatabaseTree` 2건, paradigm 분기 1건, DataGridTable sentinel 1건, tabStore legacy 역호환 1건).
- `pnpm vitest run`의 총 통과 수가 Sprint 65 이후 회귀 없이 증가해야 한다.

## Scenario coverage

- Happy path: mongo 연결 → 사이드바에서 database 확장 → collection 확장 → 더블클릭 → 그리드에 기본 300행 렌더.
- 빈 컬렉션: infer는 `_id`만, find는 `rows: []` + `total_count: 0`.
- 중첩 필드: `{ profile: { email: "..." } }` 문서가 profile cell에 `"{...}"` sentinel로 렌더 + 편집 진입 불가.
- paradigm mismatch: rdb 연결에서 mongo command 호출 시 `AppError::Unsupported` 반환 (Sprint 64 `ActiveAdapter::as_document` 경로 단위 테스트로 커버된 상태).
- Legacy tab 복원: localStorage에 `paradigm` 없는 구 탭 → `"rdb"` fallback으로 복원.
