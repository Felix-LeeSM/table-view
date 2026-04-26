# Sprint Contract: sprint-130

## Summary

- **Goal**: PG sub-pool LRU 8 도입 + DB switcher 활성화. PostgresAdapter가 `(connection_id, db_name) → PgPool` sub-pool을 lazily 생성/캐시 (cap 8, oldest idle evict). 새 Tauri command `switch_active_db(connection_id, db_name)`로 toolbar의 DbSwitcher 클릭이 실제 sub-pool 활성으로 이어진다. RDB 탭은 자기 `database`를 보유 — 새 탭은 toolbar 현재 DB를 사용. 사이드바 schema는 활성 DB 변경 시 재로딩. **Mongo는 S131에서 별도 처리** — 본 sprint는 PG paradigm 한정.
- **Audience**: Claude Code Generator agent.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (vitest + tsc + lint + contrast + cargo test + clippy + e2e 정적)

## Background (이미 잡힌 사실)

- S128에서 통합 `list_databases` Tauri command + `RdbAdapter::list_databases` trait method (default `Ok(Vec::new())`) + PG impl + DbSwitcher fetch on click 도입.
- S128의 DbSwitcher는 클릭 시 fetch + popover 표시. **항목 선택은 여전히 no-op + `toast.info`** (`src/components/workspace/DbSwitcher.tsx:128-136`).
- S129에서 `TableTab.database?` / `TableTab.collection?` 도입, document 탭 마이그레이션 추가.
- 현재 PostgresAdapter 구조 (`src-tauri/src/db/postgres.rs:142-215`):
  - `pool: Arc<Mutex<Option<PgPool>>>` — 단일 풀 per connection.
  - `connect_pool(config)` → 단일 풀 생성, `disconnect_pool()` → 단일 풀 close.
  - 모든 method (execute, execute_query, query_table_data, list_tables …)가 `let guard = self.pool.lock().await; let pool = guard.as_ref().ok_or_else(...)` 패턴으로 단일 풀 참조.
- AppState (`src-tauri/src/commands/connection.rs:68`): `active_connections: Mutex<HashMap<String, ActiveAdapter>>`. `keep_alive_loop`이 매 N초 ping.
- 사용자 시야: ConnectionSwitcher → connected만 노출. DbSwitcher → 클릭 시 list 표시. 클릭 시 no-op + 안내 토스트.

## In Scope

### 백엔드: PostgresAdapter sub-pool LRU 8

- `PostgresAdapter` struct 확장 (단일 mutex 안의 inner state로):
  - 단일 `pool: Arc<Mutex<Option<PgPool>>>` 필드를 다음으로 대체:
    ```rust
    inner: Arc<Mutex<PgPoolState>>
    ```
    where `PgPoolState`는:
    - `config: Option<ConnectionConfig>` — credentials 보존 (db_name 외).
    - `pools: HashMap<String, PgPool>` — db_name → pool.
    - `current_db: Option<String>` — 현재 활성 db.
    - `lru_order: VecDeque<String>` — 최근 사용 순서. 최신이 뒤.
- `connect_pool(config)`:
  - `current_db = Some(config.database.clone())`.
  - `pools.insert(config.database.clone(), pool)`, `lru_order.push_back(config.database)`.
  - `config_without_pool(config) → store as inner.config`.
- `disconnect_pool()`:
  - 모든 `pools` 값에 `.close().await`. `current_db = None`. `pools.clear()`. `lru_order.clear()`. `config = None`.
- 신규 method `pub async fn switch_active_db(&self, db_name: &str) -> Result<(), AppError>`:
  - `inner.lock().await`.
  - `pools.contains_key(db_name)`이면 `current_db = Some(db_name.to_string())`. lru_order에서 해당 entry 제거 후 push_back.
  - 그렇지 않으면 lazily 생성:
    - `config = inner.config.as_ref().ok_or(AppError::Connection("Not connected"))?`. `config.database = db_name`로 override (clone).
    - `PgPoolOptions::new().max_connections(5).acquire_timeout(...).connect_with(...)`.
    - LRU evict: `pools.len() >= 8` && `pools` 안에 같은 키 없으면 `lru_order.pop_front()` → 그 풀을 `pools.remove(...).close().await`. **단 current_db는 evict 대상에서 제외** — pop된 게 current이면 한 칸 더 진행.
    - `pools.insert(db_name.to_string(), new_pool)`. `lru_order.push_back(db_name.to_string())`. `current_db = Some(db_name.to_string())`.
  - 성공 시 `info!("Switched active PG db to {}", db_name)`.
- 신규 helper `async fn active_pool(&self) -> Result<PgPool, AppError>`:
  - `inner.lock().await`. `current_db.as_ref().ok_or(...)?`. `pools.get(current_db).cloned().ok_or(...)?`.
  - 모든 기존 pool-using method가 `self.pool.lock() ... guard.as_ref()` 대신 `self.active_pool().await?`를 호출하도록 일괄 치환.
- `current_database(&self) -> Option<String>` — `inner.lock().await; current_db.clone()`.

### 백엔드: Trait + Tauri command

- `RdbAdapter` trait에 신규 default method:
  ```rust
  fn switch_database<'a>(
      &'a self,
      _db_name: &'a str,
  ) -> BoxFuture<'a, Result<(), AppError>> {
      Box::pin(async {
          Err(AppError::Unsupported(
              "This adapter does not support database switching".into(),
          ))
      })
  }
  ```
  - PostgresAdapter는 이를 override하여 `self.switch_active_db(db_name)` 호출.
- 통합 Tauri command `src-tauri/src/commands/meta.rs`에 추가 (S128에서 만든 파일):
  ```rust
  #[tauri::command]
  pub async fn switch_active_db(
      state: tauri::State<'_, AppState>,
      connection_id: String,
      db_name: String,
  ) -> Result<(), AppError> { ... }
  ```
  - paradigm 분기:
    - `Rdb` → `adapter.switch_database(&db_name).await`.
    - `Document` → 본 sprint는 `Err(AppError::Unsupported(...))` 반환 (S131에서 활성).
    - `Search/Kv` → `Err(AppError::Unsupported(...))`.
- `src-tauri/src/lib.rs`의 `tauri::generate_handler!`에 `switch_active_db` 등록.

### 프런트: 신규 thin wrapper + DbSwitcher dispatch

- `src/lib/api/switchActiveDb.ts` — `invoke<void>("switch_active_db", { connectionId, dbName })` thin wrapper.
- 단위 테스트 `src/lib/api/switchActiveDb.test.ts`.
- `DbSwitcher.tsx`:
  - `handleSelect(dbName)` 동작 변경:
    1. `await switchActiveDb(connectionId, dbName)`.
    2. 성공 시 `connectionStore.setActiveDb(connectionId, dbName)`.
    3. `useSchemaStore.getState().clearForConnection(connectionId)` 호출 — 사이드바 트리 stale 무효화.
    4. `setOpen(false)`. 토스트는 success.
    5. 실패 시 `toast.error(...)`, popover 닫기.
  - 현재 활성 DB 표시: trigger label에 `activeStatuses[id]?.activeDb ?? defaultDb`.
- **Tab 생성**:
  - `useTabStore.createQueryTab` / `createDataTab`이 toolbar 현재 db 자동 픽업 (RDB paradigm일 때 `tab.database = activeDb`).
- **schemaStore 무효화**:
  - `src/stores/schemaStore.ts`에 `clearForConnection(connectionId: string)` 추가 — 해당 connection의 namespace/table 트리 캐시를 빈 상태로 리셋. 다음 SchemaTree mount 시 재fetch.

### 프런트: connectionStore 확장

- `connectionStore.ts`의 `activeStatuses[connectionId]` 객체에 `activeDb?: string` 추가:
  - 연결 성공 시 default `config.database`로 set.
  - `setActiveDb(connectionId, dbName)` action 추가 — connected 상태일 때만 mutate.
- 타입 정의 + 단위 테스트 보강.

### 프런트: tabStore 마이그레이션 + RDB 탭의 database

- S129에서 추가한 `TableTab.database?`를 RDB 탭에도 사용:
  - `createQueryTab(connectionId, ...)` / `createDataTab(...)`이 `paradigm === "rdb"`일 때 `database: activeDb` 채움.
  - **마이그레이션**: `loadPersistedTabs`에서 `paradigm === "rdb"` && `database === undefined`인 경우 connection의 default db를 채울 수 있는 정보가 없으면 그대로 둔다 (런타임에 fallback). RDB 탭은 마이그레이션을 강제하지 않는다 — invariant: "RDB tab은 안 채움" (S129 기존 invariant 유지).
- **새 invariant**: 새로 생성된 RDB 탭은 `database`를 set, persisted 레거시 RDB 탭은 그대로.
- 사이드바 SchemaTree는 `activeDb` 변경 시 cache miss → 재fetch.

### 사이드바 schema 재로딩

- `SchemaTree`가 사용하는 schemaStore selector가 `connectionId + activeDb` 조합 키로 캐시:
  - `clearForConnection(connectionId)`이 호출되면 그 connection 의 트리 데이터를 빈 상태로 리셋.
  - SchemaTree mount 시 빈 캐시이면 자동 fetch (이미 동작).
- **Out of scope**: SchemaTree 자체 시그니처 변경. 본 sprint는 schemaStore에 `clearForConnection` 추가 + DbSwitcher에서 호출만.

## Out of Scope

- Mongo `use_db` (S131).
- raw-query DB-change 감지 (`\c`, `USE`, `SET search_path`) — S132.
- 단축키 / 신규 e2e spec (S133).
- credentials 재입력 UX (sub-pool은 connection.rs의 same credentials 재활용).
- SQLite/MySQL/Redis/ES adapter 구현 (Phase 9).
- DocumentDataGrid 내부 store wire 시그니처 정리 (`schema/table` alias 제거).
- 백엔드 keep_alive_loop이 sub-pool 모두를 ping하는 작업 — 본 sprint는 active_pool만 ping (기존 동작 유지).

## Invariants

- 기존 vitest + Rust suite 회귀 0.
- e2e 정적 컴파일 회귀 0.
- credentials 재입력 없음 — sub-pool은 stored config 재활용.
- LRU cap = 8. 8번째 추가 시 가장 오래된 idle evict, current_db는 evict 대상 제외.
- `connect_pool` / `disconnect_pool`의 외부 호출 시그니처 보존.
- Mongo / Search / Kv paradigm 사용자 시야 회귀 0.
- aria-label 가이드 준수, 기존 라벨 보존.
- PG 권한 부족 시 `list_databases`가 단일 항목 fallback (S128 동작) 그대로.

## Acceptance Criteria

- `AC-01` `PostgresAdapter` 구조 — `(db_name) → PgPool` sub-pool 보유, current_db 추적, LRU order 추적. 단일 mutex inner state.
- `AC-02` `PostgresAdapter::switch_active_db(db_name)`:
  - 캐시 히트 → current_db 갱신 + LRU 끝으로 이동.
  - 캐시 미스 → lazy 생성 + LRU evict (cap 8 초과 시 가장 오래된 idle 풀 close, current_db 제외).
  - credentials 재활용 — config.database만 override.
  - 단위 테스트: hit/miss/evict/current-protected 4 시나리오.
- `AC-03` `RdbAdapter::switch_database` trait method 추가 (default `Err(Unsupported)`). PostgresAdapter override.
- `AC-04` Tauri command `switch_active_db(connection_id, db_name)` 등록. paradigm 분기 — Rdb 활성, 나머지는 `Unsupported` (Document는 S131).
- `AC-05` 모든 기존 PG pool-using method가 `active_pool()` 헬퍼 통해 동작. 기존 단위 테스트 회귀 0.
- `AC-06` 프런트 thin wrapper `src/lib/api/switchActiveDb.ts` + 단위 테스트.
- `AC-07` `DbSwitcher` 항목 클릭 → `switchActiveDb` invoke → `setActiveDb` → `clearForConnection` → popover close + success toast. 실패 → error toast.
- `AC-08` `connectionStore`에 `activeStatuses[id].activeDb` 추적 + `setActiveDb` action. connect 시 default db로 init. 단위 테스트.
- `AC-09` 신규 RDB 탭 생성 시 `tab.database = activeDb` 채움. 기존 persisted 레거시 RDB 탭은 마이그레이션 안 함 (S129 invariant 유지).
- `AC-10` `schemaStore.clearForConnection(connectionId)` 추가 + 단위 테스트.
- `AC-11` 검증 명령 모두 그린:
  - `pnpm vitest run` (1957+; S129 +9개 baseline)
  - `pnpm tsc --noEmit`
  - `pnpm lint`
  - `pnpm contrast:check`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  - e2e 정적 컴파일 회귀 0.
- `AC-12` 사용자 시야 회귀 0: PG 워크스페이스에서 DbSwitcher 클릭 → 사이드바 schema 재로딩이 자연스럽게 동작. Mongo / 비-RDB 워크스페이스 외관 동일.

## Design Bar / Quality Bar

- LRU 구현은 `VecDeque<String>` + linear scan으로 충분 (cap 8 → O(8) 무시). `LinkedHashMap` 도입 금지.
- Sub-pool 생성 실패 시 (잘못된 db_name 등) Error 메시지에 db_name 포함 — 디버깅 용이.
- `current_db` 보호 invariant: evict 진행 중 current_db에 도달하면 skip하고 다음 oldest로 이동. cap 초과인데 모든 풀이 current_db이면 (sentinel: 풀이 1개) evict 안 함.
- `switchActiveDb` invoke 실패 시 사용자에게 명확한 toast 메시지 — silent fail 금지.
- `setActiveDb`는 connected 상태 검사 — disconnected이면 no-op + warn 로그.
- DbSwitcher trigger label: `activeDb || "Database"` (정의 안 됨 → fallback 라벨).
- a11y: trigger의 `aria-haspopup="listbox"`, popover 안의 active item에 `aria-selected="true"` (이미 S128이 set).

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 1957+ 그린 (S129 baseline 1957 + 본 sprint 신규 테스트).
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
  - AC-01..AC-12 매핑(file:line / test:line)
  - PostgresAdapter sub-pool struct 코드 인용
  - `switch_active_db` LRU evict 로직 코드 인용
  - DbSwitcher handleSelect dispatch 코드 인용
  - `clearForConnection` schemaStore 추가 인용
- Evaluator must cite:
  - 각 AC pass/fail의 구체 evidence
  - LRU evict 4 시나리오 단위 테스트 통과
  - DbSwitcher click → schemaStore 무효화 통합 검증 (RTL)
  - PG 권한 부족 시 list_databases fallback 회귀 0

## Test Requirements

### Unit Tests (필수)
- `src-tauri/src/db/postgres.rs` (또는 별도 `tests` mod):
  - `test_switch_active_db_cache_hit_updates_lru`
  - `test_switch_active_db_cache_miss_creates_lazy_pool`
  - `test_switch_active_db_evicts_oldest_when_cap_exceeded`
  - `test_switch_active_db_protects_current_db_from_eviction`
  - `test_switch_active_db_returns_err_when_not_connected`
- `src-tauri/src/commands/meta.rs`:
  - `switch_active_db` paradigm dispatch 테스트 (Document/Search/Kv → Unsupported).
- `src/lib/api/switchActiveDb.test.ts` — invoke wrapper happy/error.
- `src/components/workspace/DbSwitcher.test.tsx`:
  - 항목 클릭 → switchActiveDb invoke → setActiveDb → clearForConnection.
  - invoke 실패 → error toast.
  - 활성 DB가 trigger label에 표시.
- `src/stores/connectionStore.test.ts`:
  - connect 후 activeDb = config.database.
  - setActiveDb idempotent + disconnected no-op.
- `src/stores/schemaStore.test.ts`:
  - clearForConnection이 해당 connection의 캐시만 비움.
- `src/stores/tabStore.test.ts`:
  - 신규 RDB 탭 생성 시 database가 activeDb로 채워짐.
  - 레거시 persisted RDB 탭의 database는 undefined 그대로 (마이그레이션 안 함).

### Coverage Target
- 신규 코드 (sub-pool, switch_active_db, schemaStore.clearForConnection): 라인 80% 이상.

### Scenario Tests (필수)
- [ ] Happy: PG 연결 → DbSwitcher 클릭 → DB 선택 → 사이드바 재로딩 → 새 query 실행 시 새 DB context.
- [ ] LRU evict: 9개 DB 전환 → 첫 번째 풀 close.
- [ ] Current 보호: cap 도달 후 current_db 유지 → 다음 oldest evict.
- [ ] 권한 부족: list_databases fallback → 단일 항목.
- [ ] 회귀: Mongo 연결 → DbSwitcher 클릭 → 클릭 시 Unsupported 토스트 (S131에서 활성). 본 sprint는 Mongo 클릭이 fail해도 OK — DbSwitcher가 paradigm 가드 가능.

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
  - `src-tauri/src/db/postgres.rs` (sub-pool struct + switch_active_db + active_pool helper)
  - `src-tauri/src/db/mod.rs` (RdbAdapter::switch_database trait method)
  - `src-tauri/src/commands/meta.rs` (switch_active_db Tauri command)
  - `src-tauri/src/lib.rs` (handler registration)
  - `src/lib/api/switchActiveDb.ts` + `.test.ts`
  - `src/components/workspace/DbSwitcher.tsx` + `.test.tsx`
  - `src/stores/connectionStore.ts` + `.test.ts` (activeDb tracking)
  - `src/stores/schemaStore.ts` + `.test.ts` (clearForConnection)
  - `src/stores/tabStore.ts` + `.test.ts` (RDB tab database autofill)
  - **금지**: Mongo `use_db`, raw-query 감지, 단축키, 신규 e2e, DocumentDataGrid alias 정리
- Merge order: 단일 commit `feat(workspace): PG sub-pool LRU 8 + active DB switch (sprint 130)`

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in `handoff.md`
- 기존 vitest + cargo test + e2e 정적 컴파일 회귀 0
