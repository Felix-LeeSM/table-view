# Sprint 64 Execution Brief — Phase 6 AppState/command 리팩터 (plan A2)

## Objective
Sprint 63에서 선언만 해둔 `ActiveAdapter` enum과 paradigm-별 trait을 실제 런타임에 연결한다. AppState가 더 이상 `PostgresAdapter`를 직접 품지 않고 enum을 품게 하며, 모든 Tauri command가 enum dispatch(`as_rdb()?.method(...)`)를 경유하도록 리팩터한다. 동작은 변하지 않는다(순수 내부 재배선). 동시에 Sprint 63 feedback(`AppError::Unsupported`, `NamespaceInfo::from` 테스트, `BoxFuture` 정리, `#[allow(dead_code)]` 제거)을 이 sprint에서 갚는다.

## Task Why
Sprint 63은 계약상 동작 불변이어야 했기 때문에 trait 계층을 선언만 해두고 call-site는 여전히 `PostgresAdapter` concrete 타입을 참조하고 있다. 이 상태에서는 MongoAdapter/MySQL/SQLite adapter를 추가하려 해도 call-site 하나당 두 번씩 타입 분기를 쓰게 된다. Sprint 65/B에서 MongoAdapter를 실제로 꽂으려면 지금 리팩터가 선행되어야 한다.

## Scope Boundary
- 변경 허용 파일:
  - `src-tauri/src/error.rs` (Unsupported variant 추가)
  - `src-tauri/src/commands/connection.rs` (AppState, factory, connect/disconnect/ping/test_connection enum dispatch)
  - `src-tauri/src/commands/schema.rs` → `src-tauri/src/commands/rdb/schema.rs` 및 `.../ddl.rs`로 분할·이동
  - `src-tauri/src/commands/query.rs` → `src-tauri/src/commands/rdb/query.rs`로 이동
  - `src-tauri/src/commands/rdb/mod.rs` (새 파일)
  - `src-tauri/src/commands/mod.rs` (pub mod rdb 등록)
  - `src-tauri/src/lib.rs` (invoke_handler 경로 갱신)
  - `src-tauri/src/db/mod.rs` (AppError::Unsupported 치환, BoxFuture 정리, `#[allow(dead_code)]` 제거, `NamespaceInfo::from` 테스트)
  - `src-tauri/src/models/connection.rs` (paradigm 필드)
  - `src/types/connection.ts` (Paradigm 타입)
- 절대 건드리지 말 것:
  - `src-tauri/src/db/postgres.rs`의 inherent `impl PostgresAdapter { ... }` (Sprint 63 invariant 유지). trait impl 블록은 필요 시 signature 정리 가능.
  - 프론트엔드 `invoke(...)` 호출 사이트 (command 이름 보존 필수).
  - 기존 통합 테스트 (`src-tauri/tests/*`).

## Invariants
- 모든 기존 Tauri command 이름 및 payload shape 불변.
- `ConnectionConfigPublic`에 `paradigm` 추가는 허용하지만 기존 필드 변경/삭제 금지.
- 통합 테스트 회귀 0.
- `PostgresAdapter` 기존 메서드 시그니처 불변.

## Done Criteria
contract.md의 Done Criteria 1~9를 모두 만족. 핵심:
1. `AppState.active_connections: Mutex<HashMap<String, ActiveAdapter>>`.
2. `make_adapter` factory 도입, 미지원 타입은 `AppError::Unsupported`.
3. `AppError::Unsupported(String)` variant 추가 + `ActiveAdapter::as_*` 4곳 치환 + 단위 테스트.
4. `commands/rdb/{schema,query,ddl}.rs`로 재조직, 각 함수는 `as_rdb()?.method(...)` 경유.
5. `lib.rs`에서 command 이름 보존하며 경로만 갱신.
6. `ConnectionConfigPublic`에 `paradigm` 직렬화.
7. `src/types/connection.ts`에 `Paradigm` 타입 + Connection 타입에 `paradigm` 필드.
8. `NamespaceInfo::from` 테스트, `BoxFuture` 일관성, `db/mod.rs`에 `#[allow(dead_code)]` 0개.
9. 검증 command 모두 통과.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `cd src-tauri && cargo fmt --all -- --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `cd src-tauri && cargo test --lib`
  4. `cd src-tauri && cargo test --test schema_integration --test query_integration`
  5. `pnpm tsc --noEmit`
  6. `pnpm lint`
  7. `pnpm vitest run`
  8. `grep -n '#\[allow(dead_code)\]' src-tauri/src/db/mod.rs` → 0줄
  9. `grep -rn 'commands::schema::\|commands::query::' src-tauri/src/lib.rs` → 0줄

## Evidence To Return
- 추가/이동된 파일 목록과 각 파일의 한 줄 목적
- 각 verification command의 실제 결과 (성공 시 요약, 실패 시 마지막 출력)
- `AppState` 전·후 스니펫 (변경 지점의 타입 변화)
- `ConnectionConfigPublic`의 `paradigm` 필드가 실제 payload에 직렬화된 예시 (단위 테스트 assertion 또는 `serde_json::to_string` 출력)
- `AppError::Unsupported` 단위 테스트 명칭/위치
- 가정, 위험, 미해결 지점

## 구현 힌트 (참고용, 강제 아님)

### AppState 교체 절차
```rust
// before
pub struct AppState { pub active_connections: Mutex<HashMap<String, PostgresAdapter>> }

// after
pub struct AppState { pub active_connections: Mutex<HashMap<String, ActiveAdapter>> }
```

### factory
```rust
pub(crate) fn make_adapter(db_type: &DatabaseType) -> Result<ActiveAdapter, AppError> {
    match db_type {
        DatabaseType::Postgresql => Ok(ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()))),
        other => Err(AppError::Unsupported(format!(
            "Database type {:?} is not supported yet", other
        ))),
    }
}
```

### command 본문 패턴
```rust
#[tauri::command]
pub async fn list_tables(
    state: State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<TableInfo>, AppError> {
    let map = state.active_connections.lock().await;
    let adapter = map.get(&connection_id)
        .ok_or_else(|| AppError::NotFound(format!("connection {connection_id} not active")))?;
    adapter.as_rdb()?.list_tables(&schema).await
}
```
주의: `ActiveAdapter::as_rdb()` 는 `Result<&dyn RdbAdapter, AppError>` 반환이므로 `?` 사용 가능.

### command 재조직
현재 `commands/schema.rs`는 조회(list_*, get_*) + DDL(drop_table, alter_table, …)이 섞여 있다. DDL 판별 기준:
- `drop_table`, `rename_table`, `alter_table`, `create_index`, `drop_index`, `add_constraint`, `drop_constraint` → `ddl.rs`
- 그 외 `list_*`, `get_*` → `schema.rs`
- `query_table_data` → `query.rs`
- `execute_query`, `cancel_query` → `query.rs`

### invoke_handler
```rust
.invoke_handler(tauri::generate_handler![
    commands::connection::list_connections,
    // …
    commands::rdb::schema::list_schemas,
    commands::rdb::schema::list_tables,
    commands::rdb::query::execute_query,
    commands::rdb::ddl::drop_table,
    // …
])
```
command 이름은 함수명으로 결정되므로 함수명을 그대로 옮기면 프론트 호출은 자연스럽게 유지된다.

### paradigm 태그
`ConnectionConfig`/`ConnectionConfigPublic` 직렬화 시점에 `db_type`을 기반으로 태그를 계산해 추가. 가장 깔끔한 방법은 `impl DatabaseType { pub fn paradigm(&self) -> &'static str }` 추가 후 `ConnectionConfigPublic::from`에서 주입.

### `BoxFuture` 정리
두 선택지 중 하나:
- (A) 모든 trait 메서드 return을 `BoxFuture<'_, Result<…, AppError>>`로 통일 → alias 사용화.
- (B) alias 삭제, 전부 `Pin<Box<…>>` 그대로 인라인.
가독성 측면에서 (A)를 추천. evidence에 선택 이유 기록.

### `#[allow(dead_code)]` 제거
AppState가 `ActiveAdapter`를 실제로 들고, command가 `as_rdb()`를 호출하면 대부분의 attribute는 자연스럽게 불필요해진다. 남은 경우(SearchAdapter/KvAdapter 등 호출 없음) — 그래도 `AppError::Unsupported`로 가는 factory 분기가 있으므로 enum variant 자체는 dead가 아니다. 컴파일 warning만 없게 정리하면 OK.

### `NamespaceInfo::from` 테스트
`db/mod.rs` 하단 `#[cfg(test)] mod tests { … }`에 2~3줄 테스트 하나 추가.

## 작업 순서 제안
1. `AppError::Unsupported` 먼저 추가 (다른 변경이 이에 의존).
2. `db/mod.rs` 정리: `#[allow(dead_code)]` 제거, `BoxFuture` 일관성, `as_*` → `Unsupported`, `NamespaceInfo::from` 테스트.
3. AppState 필드 타입 교체 + `make_adapter` 추가.
4. `commands/connection.rs`의 connect/disconnect/ping/test_connection을 enum dispatch로 수정.
5. `commands/schema.rs`, `commands/query.rs`를 `commands/rdb/{schema,ddl,query}.rs`로 분할·이동. 각 함수를 `as_rdb()?.method(...)` 패턴으로 수정.
6. `commands/mod.rs`, `lib.rs` 경로 갱신.
7. `ConnectionConfigPublic::paradigm` + `DatabaseType::paradigm()` 추가.
8. `src/types/connection.ts` 타입 추가.
9. verification command 순차 실행, 실패 시 수정 반복.
