# Sprint 65 Contract — Phase 6 MongoAdapter 연결 + 테스트 인프라 (plan B)

> Phase 6 플랜 [`B`](/Users/felix/.claude/plans/zany-hugging-twilight.md)에 해당. Sprint 63(trait 선언) + 64(enum dispatch wiring) 위에 **첫 번째 document-paradigm 어댑터**를 도입한다.

## Scope
1. `mongodb = "3"`, `bson = "2"` 의존성 추가.
2. `src-tauri/src/db/mongodb.rs` 신규: `MongoAdapter` 타입 + `impl DbAdapter` + `impl DocumentAdapter`. 이번 스프린트에서는 **연결 수립 + `list_databases` + `list_collections`**까지만 동작. `find`/`aggregate`/`insert`/`update`/`delete`/`infer_collection_fields`는 `Err(AppError::Unsupported)` 반환 스텁.
3. `DocumentAdapter` DTO(`FindBody`, `DocumentQueryResult`, `DocumentId`, `aggregate.pipeline`)를 Sprint 63의 `serde_json::Value` placeholder에서 `bson::Document` 기반으로 전환.
4. `ConnectionConfig`에 MongoDB 전용 선택 필드 추가 (모두 `#[serde(default)]`로 역호환): `auth_source: Option<String>`, `replica_set: Option<String>`, `tls_enabled: Option<bool>`.
5. `make_adapter`에 `DatabaseType::Mongodb => ActiveAdapter::Document(Box::new(MongoAdapter::new()))` 분기 추가.
6. `ConnectionDialog.tsx`에 `db_type === "mongodb"` 조건부 필드 렌더 (auth source, replica set, TLS 체크박스). `database` 필드를 mongo일 때 optional 처리.
7. frontend `Connection`/`ConnectionConfig` 타입에 mongo 전용 필드 추가 + `paradigm` 필드를 optional에서 **required**로 타이트닝 (Sprint 64 이월 피드백 #1).
8. `ConnectionConfigPublic.paradigm`을 `String`+`serde(default)`에서 `Paradigm` enum으로 교체 (Sprint 64 이월 피드백 #2).
9. `src-tauri/tests/common/mod.rs`를 확장:
   - `test_config`에 `DatabaseType::Mongodb` variant 추가 (env: `MONGO_HOST`, `MONGO_PORT`, `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_DATABASE`).
   - `setup_adapter` 또는 병행 `setup_mongo_adapter` 도입.
10. `src-tauri/tests/mongo_integration.rs` 신규: connect → ping → list_databases → list_collections → disconnect happy path. DB 가용 불가 시 skip 메시지로 종료(기존 Postgres 패턴 모방).

## Done Criteria
1. **의존성**: `Cargo.toml`에 `mongodb`, `bson` 추가. `cargo tree`에서 확인 가능.
2. **MongoAdapter 런타임 연결**: `docker compose -f docker-compose.test.yml up -d mongodb` 후 `./scripts/wait-for-test-db.sh` 통과. `cargo test --test mongo_integration`이 connect/ping/list_databases/list_collections 경로를 성공으로 통과.
3. **`impl DbAdapter for MongoAdapter`**: `kind() = DatabaseType::Mongodb`, `connect`/`disconnect`/`ping` 구현. ping은 `db.adminCommand("ping")` 기반.
4. **`impl DocumentAdapter for MongoAdapter`**: `list_databases` = `client.list_database_names()`, `list_collections(db)` = `client.database(db).list_collection_names()`. 나머지 5개 메서드는 `Err(AppError::Unsupported(...))` 스텁이되, 각 스텁은 한 줄짜리 test로 Unsupported 반환을 검증.
5. **DTO bson 전환**: `FindBody.filter/sort/projection`, `DocumentQueryResult.columns/rows/raw_documents`, `DocumentAdapter::insert_document/update_document/aggregate` 파라미터가 `bson::Document` 기반. `serde_json::Value` placeholder 제거.
6. **ConnectionConfig 확장**: `auth_source`, `replica_set`, `tls_enabled` 필드 추가. 기존 non-mongo config 직렬화/역직렬화가 깨지지 않음(기존 테스트 통과로 검증).
7. **factory**: `make_adapter(&DatabaseType::Mongodb)`이 `Ok(ActiveAdapter::Document(...))` 반환. 단위 테스트 1건.
8. **ConnectionDialog 조건부 필드**: `db_type === "mongodb"` 일 때 auth source / replica set / TLS 체크박스가 렌더되고, `database` 필드가 optional. 단위/컴포넌트 테스트(`ConnectionDialog.test.tsx`)로 검증.
9. **Frontend `Paradigm` 타이트닝**: `Connection`/`ConnectionConfig` 타입의 `paradigm`이 required. invoke 호출 사이트 및 store/component에서 타입 오류 0. mongo 연결 시 `paradigm === "document"`로 분기 가능 (컴포넌트에서는 TODO placeholder만 렌더 — 실제 DocumentDatabaseTree는 Sprint 66).
10. **`ConnectionConfigPublic.paradigm`** 타입 교체: `String` → `Paradigm` enum (serde는 `#[serde(rename_all = "lowercase")]` 등 적용). 프론트엔드 타입과 문자열 일치.
11. **테스트 인프라**: `common/mod.rs::test_config`가 Mongodb variant 지원. `mongo_integration.rs`가 DB 가용/불가 양쪽에서 올바르게 동작(불가 시 skip 메시지 + exit 0).
12. **회귀 0 + 검증**:
    - `cd src-tauri && cargo fmt --all -- --check` 통과
    - `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` 통과
    - `cd src-tauri && cargo test --lib` 통과
    - `cd src-tauri && cargo test --test schema_integration --test query_integration --test mongo_integration` 통과 (mongo는 DB 가용 시)
    - `pnpm tsc --noEmit` 통과
    - `pnpm lint` 통과
    - `pnpm vitest run` 통과

## Out of Scope
- `MongoAdapter::find`/`aggregate`/`insert_document`/`update_document`/`delete_document`/`infer_collection_fields`의 실제 구현 (Sprint 66/C 이후).
- 프론트엔드 `DocumentDatabaseTree` 컴포넌트 (Sprint 66/C).
- 문서 그리드 / Quick Look / 인라인 편집 / Find-Aggregate 쿼리 모드 (Sprint 66~69).
- MySQL/SQLite adapter (Phase 9).
- `execute_query`의 Mutex 보유 기간 단축 (별도 sprint로 이월).

## Invariants
- 기존 Tauri command 이름/payload shape 불변.
- Postgres 통합 테스트 회귀 0.
- `PostgresAdapter` concrete inherent 메서드 시그니처 불변.
- 프론트엔드 `invoke(...)` 호출 사이트는 `paradigm` 타입 변경 외에는 수정하지 않는다.

## Verification Plan
- Profile: `mixed` — command 기반이 중심이지만 frontend 컴포넌트 테스트도 필수.
- Required checks:
  1. `cd src-tauri && cargo fmt --all -- --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `cd src-tauri && cargo test --lib`
  4. `docker compose -f docker-compose.test.yml up -d mongodb postgres` + `./scripts/wait-for-test-db.sh`
  5. `cd src-tauri && cargo test --test schema_integration --test query_integration --test mongo_integration`
  6. `pnpm tsc --noEmit`
  7. `pnpm lint`
  8. `pnpm vitest run` (ConnectionDialog mongo 조건부 필드 테스트 포함)
- Required evidence:
  - Generator: 변경/추가된 파일 목록과 목적, 각 command 실행 결과, `mongo_integration` 테스트의 connect/list_databases/list_collections 성공 로그, `ConnectionDialog.test.tsx`의 새 test 이름/위치, `bson::Document`로 전환된 DTO 전·후 diff 요약.
  - Evaluator: 위 8개 check 직접 실행, mongo 컨테이너 up/down, `grep`으로 `mongodb = "` 의존성 / `impl DocumentAdapter for MongoAdapter` 실재 확인, ConnectionDialog 렌더 분기 코드 확인, 프론트 `paradigm` required 전환이 시그니처에서 `?` 제거되었는지 확인.
