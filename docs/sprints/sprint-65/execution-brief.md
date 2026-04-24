# Sprint 65 Execution Brief — Phase 6 plan B

## Objective

Sprint 63·64에서 깔아놓은 paradigm trait + enum-dispatch 위에 **첫 번째 document 어댑터인 MongoAdapter**를 도입한다. 이 스프린트의 MongoAdapter는 "연결/핑/네임스페이스 열람"까지만 구현하고 실제 문서 CRUD는 다음 스프린트로 넘긴다. 동시에 Sprint 64 handoff에 적힌 frontend `paradigm` 타이트닝 이월 피드백 2건을 함께 수습한다.

## Task Why

- Phase 6 전체 플랜(`/Users/felix/.claude/plans/idempotent-snuggling-brook.md`) Sprint B에 해당. Sprint 63에서 `DocumentAdapter` trait과 DTO를 `serde_json::Value` placeholder로 선언만 해뒀고, Sprint 64에서 `ActiveAdapter::Document` variant와 `as_document` accessor까지 배선됐다. 지금이 실제 mongo 연결을 처음 꽂는 시점이다.
- `ConnectionConfigPublic.paradigm: String`과 frontend `paradigm?` optional은 Sprint 64 평가 시 지적된 타입 안전성 약점이다. Mongo UI 분기가 실제로 도입되는 이번 스프린트가 타이트닝 적기.
- 테스트 인프라(`common/mod.rs`, `mongo_integration.rs`)를 깔아두지 않으면 Sprint 66 이후 문서 그리드/Find·Aggregate/편집 경로가 DB 없이 검증 불가 상태로 쌓인다.

## Scope Boundary

### In
- `mongodb`/`bson` crate 추가, `MongoAdapter` struct + `impl DbAdapter`/`impl DocumentAdapter`.
- `MongoAdapter`의 **connect/disconnect/ping/list_databases/list_collections**만 실제 구현.
- `DocumentAdapter` DTO(`FindBody`, `DocumentQueryResult`, `DocumentAdapter::insert_document/update_document/aggregate` 파라미터)의 `serde_json::Value` placeholder → `bson::Document` 전환.
- `ConnectionConfig`의 mongo 전용 optional 필드(`auth_source`, `replica_set`, `tls_enabled`) 추가 (serde `#[serde(default)]`로 역호환).
- `make_adapter`의 `DatabaseType::Mongodb` 분기.
- `ConnectionDialog.tsx` mongo 조건부 렌더 (auth source / replica set / TLS, `database` optional).
- Frontend `Connection`/`ConnectionConfig` 타입의 mongo 전용 필드와 **`paradigm` required 타이트닝**.
- `ConnectionConfigPublic.paradigm` 타입을 `String` → `Paradigm` enum으로 교체.
- `tests/common/mod.rs`의 Mongodb variant + `tests/mongo_integration.rs` happy path (connect → ping → list_databases → list_collections → disconnect; DB 불가 시 skip).

### Out
- `MongoAdapter::find/aggregate/insert_document/update_document/delete_document/infer_collection_fields`의 **실제** 구현은 Sprint 66+에서. 이번 스프린트에서는 `Err(AppError::Unsupported(...))` 스텁.
- 프론트엔드 `DocumentDatabaseTree`, 문서 그리드, Quick Look BSON 트리, Find/Aggregate 쿼리 모드, 인라인 편집/추가/삭제 — 모두 Sprint 66~69.
- MySQL/SQLite 어댑터(Phase 9).
- `execute_query`의 Mutex 보유 기간 축소(별도 스프린트로 이월).

## Invariants

- 기존 Tauri command 이름/payload shape 불변 — 32개 command 모두 보존.
- Postgres 통합 테스트 회귀 0 (`schema_integration`, `query_integration`).
- `PostgresAdapter`의 concrete inherent 메서드 시그니처 불변.
- 프론트엔드 `invoke(...)` 호출 사이트는 `paradigm` 타입 변경에서 파생되는 수정 외에는 건드리지 않는다.
- 기존 (non-mongo) `ConnectionConfig` 직렬화/역직렬화 결과가 깨지지 않는다 — 기존 테스트가 통과하는지로 검증.

## Done Criteria

1. `Cargo.toml`에 `mongodb = "3"`, `bson = "2"` 의존성 추가 및 `cargo tree`로 확인 가능.
2. `src-tauri/src/db/mongodb.rs` 신설 — `MongoAdapter` struct + `impl DbAdapter for MongoAdapter` (kind/connect/disconnect/ping). `ping`은 `adminCommand("ping")` 기반.
3. `impl DocumentAdapter for MongoAdapter` — `list_databases`는 `client.list_database_names()`, `list_collections(db)`는 `client.database(db).list_collection_names()`. 나머지 5개 메서드는 `Err(AppError::Unsupported(...))` 스텁이되, 각 스텁은 단위 테스트 1건으로 Unsupported 반환을 검증.
4. `DocumentAdapter` DTO (`FindBody.filter/sort/projection`, `DocumentQueryResult.columns/rows/raw_documents`, `insert_document`/`update_document`/`aggregate` 파라미터) 가 `bson::Document` 기반. `serde_json::Value` placeholder 흔적 없음.
5. `ConnectionConfig`에 `auth_source: Option<String>`, `replica_set: Option<String>`, `tls_enabled: Option<bool>` 필드 추가. `#[serde(default)]` 적용해 기존 config 직렬화 호환.
6. `commands/connection.rs::make_adapter`가 `DatabaseType::Mongodb => Ok(ActiveAdapter::Document(Box::new(MongoAdapter::new())))`를 반환. 단위 테스트 1건.
7. `ConnectionDialog.tsx`에서 `db_type === "mongodb"` 조건부로 auth source / replica set / TLS 체크박스 렌더, `database` 필드 optional. `ConnectionDialog.test.tsx`에 최소 1건 컴포넌트 테스트.
8. Frontend `Connection`/`ConnectionConfig` 타입에 mongo 전용 optional 필드 추가 + `paradigm` 필드가 required. `pnpm tsc --noEmit`에서 `?` 잔재 0.
9. Backend `ConnectionConfigPublic.paradigm` 타입이 `String` + `#[serde(default)]` 대신 `Paradigm` enum + `#[serde(rename_all = "lowercase")]` (또는 동등한 직렬화 규약). 프론트엔드 `Paradigm` 리터럴과 문자열 값 일치.
10. `src-tauri/tests/common/mod.rs`에 Mongodb variant (env: `MONGO_HOST`, `MONGO_PORT`, `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_DATABASE`). Mongo 어댑터 셋업 헬퍼 추가(`setup_mongo_adapter` 권장).
11. `src-tauri/tests/mongo_integration.rs` 신규 — connect → ping → list_databases → list_collections → disconnect happy path. DB 가용 불가 시 skip 메시지 + exit 0 (Postgres 패턴 모방).
12. 회귀 검증:
    - `cd src-tauri && cargo fmt --all -- --check`
    - `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
    - `cd src-tauri && cargo test --lib`
    - `cd src-tauri && cargo test --test schema_integration --test query_integration --test mongo_integration` (mongo는 DB 가용 시)
    - `pnpm tsc --noEmit`
    - `pnpm lint`
    - `pnpm vitest run`

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
  - 변경/추가 파일 목록 + 각 파일 역할.
  - 위 8개 check의 실행 명령 + 결과 요약.
  - `mongo_integration` 테스트의 connect/list_databases/list_collections 성공 로그(캡처 인용).
  - `ConnectionDialog.test.tsx`에 새로 추가된 테스트 이름과 파일 경로.
  - `bson::Document` 전환된 DTO의 before/after diff 요약.
  - `paradigm` enum 교체로 바뀐 JSON shape 예시 1건 (전/후).

## Evidence To Return

- Changed files and purpose.
- Checks run and outcomes (위 8개 check).
- Done criteria coverage with evidence (항목 → 근거 파일/line/로그).
- Assumptions made during implementation (e.g. bson 직렬화 규칙, connection string 조립 전략).
- Residual risk or verification gaps (e.g. DB 미가용 환경에서 mongo_integration skip 시 조건 브랜치를 실측하지 못함).

## Implementation Hints

- `MongoAdapter` 내부 상태는 Postgres와 동일하게 `Arc<Mutex<Option<Client>>>` + `Arc<Mutex<Option<String>>> /* default_db */` 조합으로 유지. async 컨텍스트이므로 `tokio::sync::Mutex` 사용.
- Connection string은 필드 조합으로 만들기보단 `mongodb::options::ClientOptions::parse_async`에 유사 URI를 넘기거나 builder 방식으로 `ClientOptions`를 조립. TLS/replica set/auth source는 `ClientOptions`에 직접 세팅하는 쪽이 URI 인코딩 이슈가 적다.
- `list_database_names` / `list_collection_names`의 시그니처는 `mongodb` 3.x에서 filter·options 인자가 optional. 필요 없으면 `None` 넘기면 됨.
- `bson::Document`는 `Default`가 빈 문서. `FindBody.filter`를 `Option`이 아니라 `bson::Document`로 두고 기본값을 `Document::new()`로 직렬화하는 쪽이 타입 단순.
- `DocumentQueryResult.raw_documents`는 향후 Quick Look에서 쓰므로 이번 스프린트에서도 `Vec<bson::Document>`로 유지. `rows: Vec<Vec<serde_json::Value>>`는 프론트 그리드 렌더와 호환되는 표현이 필요해지는 Sprint 66에서 다시 다듬을 여지 있음 — 지금은 빈 벡터 또는 사용하지 않는 상태로도 무방하나, DTO shape은 확정해둘 것.
- `ConnectionConfigPublic`이 `String` → `Paradigm` enum으로 바뀌면 `#[serde(rename_all = "lowercase")]`를 enum에 붙이고 frontend `Paradigm` 리터럴("rdb"/"document"/"search"/"kv")과 문자열 일치를 유지.
- `ConnectionDialog.tsx`의 조건부 필드는 기존 `db_type === "postgresql"` 분기 패턴을 따라간다. 테스트는 RTL + `userEvent`로 `db_type` 셀렉트를 mongo로 바꿨을 때 해당 필드가 DOM에 렌더되는지 확인.
- `tests/common/mod.rs`의 `test_config`가 `DatabaseType::Mongodb` variant를 만나면 mongo 환경변수를 읽어 `ConnectionConfig` 생성. 환경변수 누락 시 `None`을 반환 → `mongo_integration.rs`에서 skip.
- `mongo_integration.rs` skip 로직은 `println!("skipping: mongo not available")` 후 `return` 패턴을 기존 postgres 스킴과 맞춘다(참조: `tests/query_integration.rs`).
- 프런트엔드 `paradigm` required 타이트닝은 타입 정의 변경 + 모든 호출 사이트(invoke 결과 소비, 컴포넌트 props, store) 후속 수정이 따라온다. `pnpm tsc --noEmit`을 여러 번 돌려가며 `?` 관련 optional chaining을 정리하면 휘발성 에러가 줄어든다.

## References

- Contract: `docs/sprints/sprint-65/contract.md`
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md`
- 이전 스프린트 handoff:
  - `docs/sprints/sprint-63/handoff.md` (trait/DTO 선언)
  - `docs/sprints/sprint-64/handoff.md` (ActiveAdapter enum dispatch, AppError::Unsupported)
  - `docs/sprints/sprint-64/harness-result.md` (이월 피드백 4건 중 본 스프린트가 #1, #2 수습)
- Relevant files:
  - Backend: `src-tauri/Cargo.toml`, `src-tauri/src/db/mod.rs`, `src-tauri/src/db/postgres.rs`, `src-tauri/src/db/mongodb.rs` (신규), `src-tauri/src/error.rs`, `src-tauri/src/models/connection.rs`, `src-tauri/src/commands/connection.rs`, `src-tauri/src/lib.rs`
  - Tests: `src-tauri/tests/common/mod.rs`, `src-tauri/tests/mongo_integration.rs` (신규)
  - Frontend: `src/types/connection.ts`, `src/components/connection/ConnectionDialog.tsx`, `src/components/connection/ConnectionDialog.test.tsx`
