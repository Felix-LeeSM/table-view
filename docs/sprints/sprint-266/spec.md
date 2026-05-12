# Sprint 266 Spec — RDB `execute_query` 의 `expected_database` 가드

## Feature Description

RDB execution Tauri command 들 (`execute_query`, `execute_query_batch`) 이
현재 `connection_id` 만으로 backend connection pool 의 활성 db 에 routing.
`DbSwitcher` 가 `switch_active_db` 를 호출해 pool 의 active db 를 바꾸는
사이에 in-flight 쿼리가 도착하면 잘못된 db 에서 실행될 race window 가
존재. Document 쪽 명령들 (`find_documents`, `list_mongo_collections` 등) 은
이미 `database` 를 explicit 으로 받고 있으므로 본 sprint 는 RDB 의 비대칭을
*minimal-correct* 옵트인 가드로 좁힘.

## 배경 — 현재 한계

- `execute_query(connection_id, sql, query_id)` 는 `state.active_connections`
  의 adapter 에 `.execute_sql(sql)` 를 위임. Adapter 내부의 sub-pool /
  `active_db` 가 호출 순간 어떤 db 를 가리키느냐에 따라 결과가 달라짐.
- `verify_active_db` 인프라 (Sprint 130-132) 가 존재하나 **post-mutation
  optimistic confirm** 용도. 매 쿼리 전 사전 검증은 안 함.
- Sprint 264 audit OoS #2 + Sprint 263 OoS #3 가 같은 갭을 다른 각도에서
  제기했지만 wide 마이그레이션 (60+ command 에 `database` 파라미터 일괄
  추가) 은 비용 대비 가치 불확실.

## ADR 0027 와의 관계

새 ADR 추가 안 함. ADR 0027 의 `(connId, db)` 단위 라우팅 원칙을 RDB
실행 경로에 **opt-in 가드**로 적용하는 mechanical consequence. 본문 동결.

## Sprint Breakdown

4 slice:

1. **Slice A**: `AppError::DbMismatch` variant 추가 + `execute_query_inner`
   가 optional `expected_database: Option<&str>` 받아 사전 검증. TDD
   트레이서 — mismatch 케이스가 fail → 가드 구현 → pass.
2. **Slice B**: `execute_query_batch_inner` 동일 패턴 미러.
3. **Slice C**: 2 Tauri command sig 에 `expected_database: Option<String>`
   추가 + frontend `executeQuery / executeQueryBatch` wrapper opt-in +
   `useQueryExecution` 이 `tab.database` 를 전달.
4. **Slice D**: 회귀 가드 + handoff.

## Acceptance Criteria

### AC-266-01 — `AppError::DbMismatch`

```rust
#[error("Database mismatch: expected '{expected}', backend pool has '{actual}'")]
DbMismatch { expected: String, actual: String },
```

- `(String)` 단일 필드 패턴이 아니라 named struct variant — `expected` 와
  `actual` 둘 다 frontend 가 분간해야 toast 메시지가 의미를 갖기 때문.
- `Serialize` impl 은 `to_string()` 그대로 — 기존 variant 와 동일.

### AC-266-02 — `execute_query_inner` 사전 검증

```rust
async fn execute_query_inner(
    state: &AppState,
    connection_id: &str,
    sql: &str,
    query_id: &str,
    expected_database: Option<&str>,
) -> Result<QueryResult, AppError> { ... }
```

- `expected_database` 가 `None` 이면 기존 동작 그대로 (회귀 0).
- `Some(expected)` 이면 adapter 의 `current_database().await?` 를 fetch.
  `unwrap_or_default()` 후 `expected` 와 byte-equal 비교. 다르면
  `DbMismatch { expected, actual }` 반환 — `execute_sql` 호출 전에.
- 검증은 `active_connections` lock 안에서 — `current_database()` 가
  `execute_sql("SELECT current_database()")` 로 round-trip 하는 default
  impl 일 수 있으므로 한 번의 lock 점유 안에서 둘 다 수행.

### AC-266-03 — `execute_query_batch_inner` 동일 패턴

- 동일 시그니처 변화 + 동일 의미.
- batch 의 일부 statement 가 `USE other_db` 같은 stateful 명령이라도 사전
  검증은 batch 시작 시점 1 회만 — sprint 의 minimal-correct 범위.

### AC-266-04 — Tauri command + frontend opt-in

- `execute_query` / `execute_query_batch` Tauri sig 에
  `expected_database: Option<String>` 추가.
- TypeScript `executeQuery(...) / executeQueryBatch(...)` wrapper signature
  에 optional `expectedDatabase?: string` 끝-positional 인자로 추가.
  기존 caller 는 변경 없이도 컴파일 (옵션 인자).
- `useQueryExecution` (raw query path) 가 `tab.database` 를 forward —
  document tab 은 RDB execute 가 어차피 unsupported 라 영향 없음.
- `pendingRdbConfirm` / `pendingRdbWarn` confirm 경로도 동일 forward.

### AC-266-05 — 회귀 가드

- `pnpm vitest run --no-file-parallelism` 3195 baseline 유지 (+ Sprint 266
  신규 케이스 ≥ 2: backend mismatch detection, frontend forward).
- `pnpm tsc --noEmit`, `pnpm lint` 통과.
- `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test`
  통과.

## Out of Scope

- **나머지 RDB command 들** (`list_schemas`, `list_tables`,
  `get_table_columns`, `execute_query_dry_run`, `query_table_data` …) 의
  `expected_database` 가드 — schema introspection 은 race 가 있어도 (다른
  db schema 가 잠깐 표시) 데이터 무결성 영향이 작음. Phase 2 후보.
- **Document RDB-style 마이그레이션** — 이미 `database` explicit, 적용
  불요.
- **`switch_active_db` 자체의 race 제어** — DbSwitcher UI 가 loading state
  로 후속 input 을 직렬화하므로 별 sprint.
- **`AppError::DbMismatch` 의 user-facing UX 디자인** — toast 메시지 + retry
  flow 는 별 sprint (본 sprint 는 error 가 통과되는지만).
