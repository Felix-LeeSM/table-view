# Sprint 66 Execution Brief — Phase 6 plan C

## Objective

Mongo 연결에서 **database/collection 트리 탐색 → 컬렉션 더블클릭 → 문서 그리드 preview** 까지 P0 읽기 경로를 완성한다. 백엔드는 `MongoAdapter::infer_collection_fields`와 `MongoAdapter::find`의 스텁(Sprint 65)을 실제 구현으로 교체하고, 프론트엔드는 `DocumentDatabaseTree` 컴포넌트 + paradigm 분기 + TableTab paradigm 필드 + DataGridTable sentinel cell까지 얹는다.

## Task Why

- Sprint 65에서 MongoAdapter connect/ping/list_databases/list_collections까지 만들었고, "그 다음 화면을 열어주는 것"이 이 스프린트의 존재 이유다.
- 사이드바와 그리드가 paradigm별로 분기되지 않으면 Sprint 67(Quick Look) / 68(쿼리 탭) / 69(편집)이 얹힐 자리가 없다. 이번 스프린트가 paradigm 기반 UI 라우팅을 처음으로 실작동시키는 지점.
- TabStore의 `TableTab.paradigm` 필드는 이후 스프린트에서 소비될 공통 판단 데이터. legacy persisted tab 역호환까지 여기서 해결해두지 않으면 배포 후 세션 복원이 깨진다.

## Scope Boundary

### In
- `MongoAdapter::infer_collection_fields(db, coll, sample_size)` 실제 구현 (스텁 해제).
- `MongoAdapter::find(db, coll, body)` 실제 구현 (스텁 해제).
- `estimated_document_count`를 `total_count`에 매핑.
- `src-tauri/src/commands/document/{browse,query}.rs` 신규 4개 command.
- `tauri::generate_handler!` 등록 갱신.
- Frontend `src/lib/tauri.ts` wrapper 4개, `src/types/` 신규 타입(`DocumentQueryResult`, `FindBody`, `CollectionInfo`, `DatabaseInfo`).
- Frontend store 액션: `loadMongoDatabases`/`loadMongoCollections`/`inferCollectionFields`/`queryCollectionData`. (`schemaStore` 확장 or 병행 `documentStore` 도입은 generator 재량 — 기존 RDB 캐시와 분리만 지키면 됨.)
- 신규 `DocumentDatabaseTree.tsx` 컴포넌트 + 테스트.
- Sidebar/SchemaPanel paradigm 분기.
- `TableTab.paradigm: Paradigm` 필드 추가 + legacy 탭 역호환.
- `DataGridTable` sentinel cell renderer (`paradigm === "document"` 조건부).
- `mongo_integration.rs`에 seed + infer + find 시나리오 추가.

### Out
- `BsonTreeViewer` / Quick Look 패널 (Sprint 67).
- Find/Aggregate 쿼리 **탭** 및 JSON CodeMirror 모드 (Sprint 68).
- 인라인 편집, 문서 추가/삭제, MQL Preview (Sprint 69).
- `MongoAdapter::aggregate/insert/update/delete` 실제 구현.
- 정확한 `count_documents`, deep-nested field inference.
- MySQL/SQLite (Phase 9).

## Invariants

- 기존 Postgres Tauri command 이름/payload shape 불변.
- 기존 `TableTab` 소비 경로 회귀 0 (RDB 탭 생성, QuickOpen, 세션 복원).
- `SchemaTree` 기존 동작 + 테스트 회귀 0.
- `DataGridTable` RDB 경로 회귀 0 — sentinel 분기는 `paradigm === "document"`일 때만.
- `PostgresAdapter` concrete 메서드 시그니처 불변.
- Sprint 65의 `Paradigm` enum / `ConnectionConfigPublic.paradigm` 직렬화 shape 불변.

## Done Criteria

1. `MongoAdapter::infer_collection_fields`가 샘플 문서에서 top-level 필드 이름/타입 최빈값/nullable을 추출. `_id`는 항상 첫 컬럼. 빈 컬렉션 → `_id`만. 단위 테스트 ≥ 2건.
2. `MongoAdapter::find`가 `FindBody` → `DocumentQueryResult`를 채움. rows는 pre-inferred 컬럼 순서 기준 flatten, 중첩 object/array cell은 sentinel. `raw_documents`는 canonical extended JSON. `execution_time_ms` 측정.
3. `total_count`는 `estimated_document_count`.
4. 4개 command (`list_mongo_databases`, `list_mongo_collections`, `infer_collection_fields`, `find_documents`)가 `generate_handler!`에 등록되고 `as_document()` 경로로 dispatch.
5. `mongo_integration.rs`에서 `table_view_test.users` 컬렉션에 2~3개 seed 문서 insert 후 infer/find happy path 검증. DB 미가용 시 skip + exit 0 (Sprint 65 패턴).
6. `src/lib/tauri.ts`에 4개 wrapper 추가. `src/types/`에 DocumentQueryResult/FindBody/CollectionInfo/DatabaseInfo 타입 정의.
7. store action 4개가 동작하며 stale 응답 덮어쓰기 방지(요청 스냅샷/취소 가드) 테스트 포함.
8. `DocumentDatabaseTree.tsx` 신규 + 테스트 ≥ 2건 (expand 렌더, 더블클릭 → addTab).
9. Sidebar/SchemaPanel에서 `connection.paradigm`으로 트리 분기. 테스트 1건.
10. `TableTab.paradigm` 필드 + legacy 역호환 (`paradigm` 없는 persisted tab → `"rdb"`). tabStore 테스트 ≥ 2건.
11. DataGridTable sentinel cell 렌더 + 편집 진입 차단. `paradigm === "document"` 조건부. 테스트 ≥ 1건.
12. 회귀 검증(이번 스프린트 verification plan 8 checks)이 전부 통과.

## Verification Plan

- Profile: `mixed`
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
  - 변경/추가 파일 목록 + 역할.
  - 8개 check 실행 결과 요약.
  - `mongo_integration`의 find/infer 성공 로그(rows.len, columns.len 인용).
  - `DocumentDatabaseTree.test.tsx` 테스트 이름/파일 경로.
  - `DataGridTable` sentinel 테스트 이름/파일 경로.
  - tabStore legacy 탭 역호환 테스트 인용.

## Evidence To Return

- Changed files and purpose.
- Checks run and outcomes.
- Done criteria coverage with evidence (항목 → 근거).
- Assumptions (예: raw_documents JSON shape, sample_size default=100, store 분리 vs 통합 결정).
- Residual risk (예: nested deep inference 미구현, BsonTreeViewer 부재로 Quick Look은 Sprint 67에서 온전해짐).

## Implementation Hints

- **BSON → JSON 변환**: `bson::Bson::to_string()`는 relaxed/extended JSON 구분이 있으니 `bson::to_bson` + `serde_json`로 canonical extended JSON을 만들 때는 `bson::Bson` 값의 `serde` 직렬화 경로를 확정해두어야 한다. `mongodb::bson::Bson` 기본 serde는 extended JSON(`$oid`, `$date`) 방식으로 직렬화.
- **rows flatten**: 각 cell에 대해 `match bson::Bson { Document(_) => "{...}", Array(arr) => format!("[{} items]", arr.len()), _ => scalar_to_json }`. scalar는 `serde_json::Value`로 그대로.
- **컬럼 추출**: infer 시 필드 카운트가 샘플에서 `total` 아닌 것을 nullable로 기록. `data_type` 문자열은 RDB와 모양 맞추기 위해 `"ObjectId"`, `"String"`, `"Int32"`, `"Document"`, `"Array"` 같은 BSON type name을 쓰면 됨.
- **commands**: `src-tauri/src/commands/document/mod.rs`에 `pub mod browse; pub mod query;` 선언 후 `commands/mod.rs`에 `pub mod document;` 추가. `lib.rs::invoke_handler`에 4개 command 추가.
- **TabStore paradigm 역호환**: 기존 persist된 JSON에 `paradigm` 키가 없으면 `"rdb"` 기본값. `src/stores/tabStore.ts`의 `restoreTabs`/`loadFromStorage` 경로에서 migration 함수로 처리.
- **`DocumentDatabaseTree`**: `SchemaTree.tsx`의 레이아웃/아이콘 토큰을 재사용하되, 데이터 소스만 mongo store에서 가져온다. expand 로직은 "최초 expand 시 lazy load"가 SchemaTree와 동일하다면 그대로 모방.
- **paradigm 분기 위치**: `Sidebar.tsx` 또는 `SchemaPanel.tsx` 중 현재 SchemaTree를 마운트하는 쪽. connection 객체에 `paradigm`이 required로 들어오는 것은 Sprint 65에서 이미 확보됨.
- **DataGridTable sentinel**: `paradigm` prop을 받아 `paradigm === "document"` + cell 값이 `"{...}"` 또는 `^\[\d+ items\]$`이면 readonly + muted 렌더. 편집 진입 가드는 `useDataGridEdit`의 `beginEdit` 경로에서 차단.
- **store 분리 vs 통합**: 기존 `schemaStore.ts`가 이미 RDB 중심으로 커서 혼합이 어렵다면 `documentStore.ts`를 새로 만드는 편이 파일 비대화 방지에 유리. 하지만 코드 중복을 피하려면 store 하나에 mongo-specific slice를 덧붙여도 무방. 선택지는 generator 재량 — 다만 캐시 키는 mongo 전용 키(예: `${connId}:${db}:${coll}`)로 분리.
- **`find` default values**: filter 빈 document, sort None, projection None, skip 0, limit 300. `FindBody`를 TS 쪽에서 생성할 때는 `Record<string, unknown>` 수준으로 허용하되 백엔드 역직렬화 시점에 `bson::Document`로 변환.
- **seed 로직**: `mongo_integration.rs`에서 `client.database("table_view_test").collection::<bson::Document>("users")`에 `insert_many`로 문서 주입 후 테스트 말미에 `drop()`으로 정리하면 재실행 시 깨끗.

## References

- Contract: `docs/sprints/sprint-66/contract.md`
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md` (Sprint C 섹션)
- 이전 스프린트 handoff:
  - `docs/sprints/sprint-65/handoff.md` (MongoAdapter 연결, DocumentAdapter 스텁, Paradigm enum, mongo 테스트 인프라)
  - `docs/sprints/sprint-64/handoff.md` (ActiveAdapter::as_document 경로)
- Relevant files:
  - Backend: `src-tauri/src/db/mongodb.rs`, `src-tauri/src/db/mod.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/document/{browse,query}.rs` (신규), `src-tauri/src/lib.rs`
  - Tests: `src-tauri/tests/mongo_integration.rs`, `src-tauri/tests/common/mod.rs`
  - Frontend: `src/lib/tauri.ts`, `src/types/schema.ts` 또는 `src/types/document.ts` (신규), `src/stores/schemaStore.ts` or `src/stores/documentStore.ts`, `src/stores/tabStore.ts`, `src/components/schema/DocumentDatabaseTree.tsx` (신규), `src/components/layout/Sidebar.tsx`, `src/components/schema/SchemaPanel.tsx`, `src/components/datagrid/DataGridTable.tsx`, `src/components/datagrid/useDataGridEdit.ts`
