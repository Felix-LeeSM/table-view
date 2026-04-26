# Sprint Contract: sprint-131

## Summary

- **Goal**: Mongo paradigm의 in-connection DB switch를 활성화. `MongoAdapter`에 `active_db: Arc<Mutex<Option<String>>>` 추가 + `switch_active_db(db_name)` method. S130에서 만든 통합 Tauri command `switch_active_db`의 Document 분기를 `Err(Unsupported)` placeholder에서 실제 호출로 교체. 프런트 `DbSwitcher`는 paradigm 무관하게 동작 (S130에서 구현 완료) — 본 sprint는 Mongo 클릭 시 실제 use_db 효과 + 사이드바 collections 재로딩.
- **Audience**: Claude Code Generator agent.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (vitest + tsc + lint + contrast + cargo test + clippy + e2e 정적)

## Background (이미 잡힌 사실)

- S130에서 `RdbAdapter::switch_database` trait method 도입 (default `Err(Unsupported)`). PostgresAdapter override 동작 중.
- S130 통합 Tauri command `switch_active_db(connection_id, db_name)` (`src-tauri/src/commands/meta.rs:86-108`):
  - Rdb → live.
  - Document → `Err(Unsupported("Document paradigm DB switch lands in Sprint 131"))` placeholder.
  - Search/Kv → `Err(Unsupported)`.
- 현재 `MongoAdapter` 구조 (`src-tauri/src/db/mongodb.rs:97-100`):
  - `client: Arc<Mutex<Option<Client>>>`
  - `default_db: Arc<Mutex<Option<String>>>`
  - 모든 read/write method가 `db: &str` 파라미터로 호출되는 구조 (DocumentAdapter trait `list_collections(db)`, `find(db, collection, body)` 등).
- S130 프런트 `DbSwitcher.handleSelect`는 invoke → `setActiveDb` → `clearForConnection` → toast로 동작. paradigm 분기는 trigger의 enable predicate에서만 (`paradigm === "rdb" || paradigm === "document"` && connected).
- `documentStore` (`src/stores/documentStore.ts`):
  - `databases: Record<connectionId, DatabaseInfo[]>`
  - `collections: Record<connectionId:db, CollectionInfo[]>`
  - `clearConnection(connectionId)` 이미 존재.
- `DocumentDatabaseTree` (`src/components/schema/DocumentDatabaseTree.tsx`)가 사이드바 트리를 그리며, `documentStore.databases[connectionId]`와 `documentStore.collections[connectionId:db]`에서 읽는다.

## In Scope

### 백엔드: MongoAdapter active_db + switch_active_db

- `MongoAdapter` struct 확장:
  - 신규 필드 `active_db: Arc<Mutex<Option<String>>>`.
  - `connect()`에서 `default_db`와 함께 `active_db = config.database`로 init.
  - `disconnect()`에서 `active_db = None`로 reset.
- 신규 method `pub async fn switch_active_db(&self, db_name: &str) -> Result<(), AppError>`:
  - 빈 문자열 거부 → `AppError::Validation`.
  - 클라이언트 미연결 시 → `AppError::Connection("MongoDB connection is not established")`.
  - 클라이언트 검증 (cheap probe): `client.list_database_names()` 호출 → `db_name`이 결과에 포함되어 있는지 확인. 미포함이면 `AppError::Database("Database '<name>' not found on this connection")`.
    - 단 사용자 권한이 부족해서 `list_database_names`가 fail하면 (PG `list_databases` SQLSTATE 42501과 유사) **검증 스킵 + 그냥 set** — silent best-effort. 로그에 warning.
  - 검증 통과 시 `*active_db.lock().await = Some(db_name.to_string())` + `info!("Switched active Mongo db to {}", db_name)`.
- `current_db(&self) -> Option<String>`:
  - `active_db.lock().await.clone()`.
  - 향후 read/write 사이트가 사용 가능 (본 sprint는 trait method가 db 파라미터를 받으므로 기존 DocumentAdapter 시그니처 유지 — UI level이 `tab.database` / `activeDb`로 dispatch).

### 백엔드: Trait + Tauri command

- `DocumentAdapter` trait에 신규 default method:
  ```rust
  fn switch_database<'a>(
      &'a self,
      _db_name: &'a str,
  ) -> BoxFuture<'a, Result<(), AppError>> {
      Box::pin(async {
          Err(AppError::Unsupported(
              "This document adapter does not support database switching".into(),
          ))
      })
  }
  ```
  - MongoAdapter는 override → `self.switch_active_db(db_name)` delegate.
- `src-tauri/src/commands/meta.rs:96-108`의 Document 분기:
  - 기존 `Err(AppError::Unsupported("Document paradigm DB switch lands in Sprint 131"))`을
  - 새 `adapter.switch_database(&db_name).await`로 교체.

### 프런트: DocumentDatabaseTree 재로딩

- `DocumentDatabaseTree`가 mount 시 `documentStore.loadDatabases(connectionId)` 호출 (이미 있는 동작 가능성). active_db 변경 시 collections 재로딩이 필요:
  - **신규 동작**: `connectionStore.activeStatuses[id].activeDb`가 변경되면 `DocumentDatabaseTree`는 expanded된 db에 한정해서 자동 collections 재로딩 *없이 그대로*. 즉, 본 sprint는 트리 자체의 자동 재로딩은 추가하지 않는다 — `documentStore.clearConnection(connectionId)` 호출 시 트리가 자연스럽게 다시 fetch.
  - 단 `DbSwitcher.handleSelect`에서 paradigm이 document일 때 `documentStore.clearConnection(connectionId)`도 호출해 사이드바 collections 캐시를 비워야 한다.
- `DbSwitcher.tsx` 변경:
  - `handleSelect` 안에서 `paradigm === "rdb"`이면 `schemaStore.clearForConnection`, `paradigm === "document"`이면 `documentStore.clearConnection`을 호출.
  - 한 paradigm에 한정해서 부르도록 분기.
- 새 RDB 탭은 S130에서 `tab.database = activeDb`. **document 탭도 동일하게 `tab.database = activeDb`**:
  - 현재 `DocumentDatabaseTree`의 `addTab` 호출은 collection 더블클릭 시 `database, collection`를 set (S129).
  - 본 sprint는 신규 query/data 탭이 collection 클릭 *없이* (toolbar에서) 만들어질 때를 위해 `tabStore.createDocumentQueryTab` 같은 것이 있다면 거기에 `database = activeDb` 채움. 없으면 추가하지 않는다 — 현재 사용자 시나리오는 collection 더블클릭만 사용.

### 프런트: connectionStore — Mongo 연결도 activeDb 추적

- S130에서 `setActiveDb` action은 paradigm 무관하게 동작 중. `activeStatuses[id].activeDb`도 connect 시 default db로 set되어야 함:
  - 현재 S130 코드는 `paradigm === "rdb"`에 한정해 init했을 가능성 있음. **document paradigm도 동일하게 connect 시 activeDb = config.database로 init**.
  - 빈 db (mongo는 db 미지정 가능) → activeDb = undefined.

### 프런트: DbSwitcher 활성 표시

- Trigger label은 S130에서 `activeDb || "Database"`. paradigm 무관하게 동일.
- popover 안의 active item에 체크 마크 / `aria-selected="true"` (S130 이미 적용 가정).

## Out of Scope

- raw-query DB-change 감지 (`\c`, `USE`, `SET search_path`) — S132.
- 단축키 / 신규 e2e spec — S133.
- DocumentDataGrid 내부 store wire 시그니처 정리 — Phase 후속.
- MongoAdapter trait 메서드 시그니처를 (db 파라미터 → active_db 사용)으로 바꾸는 리팩터 — 본 sprint는 active_db만 추적, 호출자는 명시 db 전달 유지.
- Sub-pool / connection 재활용 — Mongo는 `Client` 자체가 multi-db. PG sub-pool 같은 LRU 불필요.
- SQLite/MySQL/Redis/ES adapter 구현.

## Invariants

- 기존 vitest + cargo test 회귀 0.
- e2e 정적 컴파일 회귀 0.
- 사용자 시야: PG 워크스페이스는 S130 동작 그대로. Mongo 워크스페이스는 DbSwitcher 클릭 시 실제 동작 (이전엔 Unsupported 에러).
- credentials 재입력 없음.
- aria-label 가이드 준수.
- Search/Kv paradigm 분기는 Unsupported 그대로.
- DocumentAdapter trait의 `list_databases`, `list_collections`, `find` 등 기존 시그니처 변경 0.

## Acceptance Criteria

- `AC-01` `MongoAdapter`에 `active_db: Arc<Mutex<Option<String>>>` 필드 추가. `connect()` / `disconnect()` lifecycle에 통합.
- `AC-02` `MongoAdapter::switch_active_db(db_name)`:
  - 빈 db_name → `AppError::Validation`.
  - 미연결 → `AppError::Connection`.
  - 존재하지 않는 db → `AppError::Database("Database '<name>' not found")`.
  - list_database_names 권한 부족 → silent best-effort set.
  - 성공 시 active_db mutate + info log.
- `AC-03` `DocumentAdapter::switch_database` trait default method (`Err(Unsupported)`). MongoAdapter override.
- `AC-04` `src-tauri/src/commands/meta.rs:96-108`의 Document 분기가 `adapter.switch_database(&db_name).await`로 교체. `Err(Unsupported("Document paradigm DB switch lands in Sprint 131"))` 문자열 제거.
- `AC-05` Tauri dispatch 단위 테스트 갱신:
  - `meta.rs` 기존 dispatch 테스트의 Document 케이스가 `Unsupported` 기대 → 신규: stub MongoAdapter가 `switch_database` 성공 반환 시 dispatcher도 OK 반환.
- `AC-06` 프런트 `DbSwitcher.handleSelect` 분기:
  - paradigm rdb → `schemaStore.clearForConnection` 호출.
  - paradigm document → `documentStore.clearConnection` 호출.
  - 그 외 → no clear (현재는 disabled 상태이므로 도달 안 됨).
- `AC-07` `connectionStore`의 connect path가 paradigm 무관하게 `activeDb = config.database` set (빈 db이면 undefined). 단위 테스트.
- `AC-08` 신규/갱신 단위 테스트:
  - `mongodb.rs`: `test_switch_active_db_rejects_empty`, `test_switch_active_db_returns_err_when_not_connected`. (live Mongo 필요한 테스트는 `#[ignore]`).
  - `meta.rs` dispatch tests: Document arm passes through OK on stub.
  - `src/components/workspace/DbSwitcher.test.tsx`: paradigm document 클릭 → invoke + `documentStore.clearConnection` 호출.
  - `connectionStore.test.ts`: Mongo 연결 시 activeDb = config.database.
- `AC-09` 검증 명령 모두 그린:
  - `pnpm vitest run` (1981+ baseline)
  - `pnpm tsc --noEmit`
  - `pnpm lint`
  - `pnpm contrast:check`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  - e2e 정적 컴파일 회귀 0.
- `AC-10` 사용자 시야 회귀 0:
  - PG 워크스페이스: S130 동작 그대로.
  - Mongo 워크스페이스: DbSwitcher 클릭 → 사이드바 collections 재로딩 (clearConnection 효과).
  - 비-rdb 비-document paradigm: DbSwitcher disabled (S128 동작 보존).

## Design Bar / Quality Bar

- `switch_active_db` 권한 fallback: `list_database_names` 실패 시 silent set + warn log. 사용자에게는 toast 노출 안 함 (best-effort).
- `MongoAdapter::switch_active_db`는 lock acquisition 순서 일관 (active_db보다 client 먼저).
- `DbSwitcher.handleSelect`: paradigm 분기는 단일 if/else, 공통 invoke 후 분기는 store 호출만.
- error toast 메시지에 db_name 포함 — 사용자 디버깅 용이.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 1981+ 그린.
2. `pnpm tsc --noEmit` — 0.
3. `pnpm lint` — 0.
4. `pnpm contrast:check` — 0 새 위반.
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 0 fail.
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 0.
7. e2e 정적 컴파일 회귀 0.

### Required Evidence

- Generator must provide:
  - 변경된 파일 + 의도 한 줄
  - 7개 검증 명령 outcome
  - AC-01..AC-10 매핑(file:line / test:line)
  - MongoAdapter active_db 추가 코드 인용
  - meta.rs Document 분기 교체 코드 인용
  - DbSwitcher paradigm clear 분기 코드 인용
- Evaluator must cite:
  - 각 AC pass/fail의 구체 evidence
  - Document dispatch 테스트가 OK 반환 (S131에서 활성)
  - Mongo connect 후 activeDb = config.database 단위 테스트
  - Mongo paradigm DbSwitcher 클릭 → documentStore.clearConnection 호출 (RTL)
  - PG 경로 회귀 0

## Test Requirements

### Unit Tests (필수)
- `mongodb.rs` (`#[cfg(test)]` mod):
  - `test_switch_active_db_rejects_empty_db_name`
  - `test_switch_active_db_returns_err_when_not_connected`
  - 라이브 Mongo 필요한 happy path는 `#[ignore]` + reason.
- `meta.rs`:
  - Document dispatch 테스트가 `Ok(())` 반환 검증.
- `DbSwitcher.test.tsx`:
  - document paradigm + connected → 클릭 → invoke + documentStore.clearConnection.
  - rdb paradigm 회귀 (S130 테스트 유지).
- `connectionStore.test.ts`:
  - mongo paradigm connect → activeDb = config.database.
  - 빈 db config (mongo) → activeDb undefined.

### Coverage Target
- 신규 코드 (active_db, switch_active_db, dispatch 갱신, paradigm clear 분기): 라인 80% 이상.

### Scenario Tests (필수)
- [ ] Happy: Mongo 연결 → DbSwitcher 클릭 → DB 선택 → 사이드바 collections 재로딩.
- [ ] 회귀: PG 연결 → DbSwitcher → S130 동작 그대로.
- [ ] 경계: 존재하지 않는 db_name → backend Err → 사용자 toast.
- [ ] 권한 부족: list_database_names fail → silent set 성공.

## Test Script / Repro Script

1. `pnpm install` (lockfile 변경 없으면 skip)
2. `pnpm vitest run`
3. `pnpm tsc --noEmit`
4. `pnpm lint`
5. `pnpm contrast:check`
6. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
7. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

## Ownership

- Generator: harness general-purpose agent
- Write scope:
  - `src-tauri/src/db/mongodb.rs` (active_db + switch_active_db + tests)
  - `src-tauri/src/db/mod.rs` (DocumentAdapter::switch_database trait method)
  - `src-tauri/src/commands/meta.rs` (Document arm 교체 + dispatch test 갱신)
  - `src/components/workspace/DbSwitcher.tsx` (paradigm clear 분기)
  - `src/components/workspace/DbSwitcher.test.tsx`
  - `src/stores/connectionStore.ts` (mongo paradigm activeDb init)
  - `src/stores/connectionStore.test.ts`
  - **금지**: SchemaTree, DocumentDataGrid 시그니처, raw-query, 단축키, 신규 e2e
- Merge order: 단일 commit `feat(workspace): mongo in-connection DB switch (sprint 131)`

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in `handoff.md`
- 기존 vitest + cargo test + e2e 정적 컴파일 회귀 0
