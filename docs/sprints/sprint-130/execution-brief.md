# Sprint Execution Brief: sprint-130

## Objective

PG sub-pool LRU 8 + DbSwitcher 활성화. 본 sprint는 PG paradigm 한정.

- `PostgresAdapter`를 단일 `pool` 필드에서 `(db_name) → PgPool` sub-pool로 확장.
- LRU cap 8 / current_db 보호.
- 신규 Tauri command `switch_active_db(connection_id, db_name)` — paradigm 분기.
- `RdbAdapter::switch_database` trait method (default Unsupported).
- 프런트 thin wrapper + DbSwitcher의 항목 클릭이 실제 sub-pool 활성으로 dispatch.
- `connectionStore.activeStatuses[id].activeDb` 추적 + `setActiveDb` action.
- `schemaStore.clearForConnection(connectionId)` — DB 변경 시 사이드바 재로딩.
- 신규 RDB 탭에 `database = activeDb` 자동 채움.

## Task Why

S128에서 backend 통합 `list_databases` + DbSwitcher fetch on click이 갖춰졌고 S129에서 document 탭 자료 모델이 정리되었다. 본 sprint는 사용자에게 실제 "DB 전환" 동작을 노출 — 같은 connection 안에서 default 외 DB를 선택하면 사이드바 schema가 새 DB로 재로딩되고, 그 후 생성되는 query/data 탭은 새 DB context에서 실행. credentials 재입력은 안 한다 (sub-pool은 동일 config 재활용).

## Scope Boundary

- Mongo `use_db` 금지 — S131.
- raw-query DB-change 감지 (`\c`, `USE`, `SET search_path`) 금지 — S132.
- 단축키 / 신규 e2e spec 금지 — S133.
- SQLite/MySQL/Redis/ES adapter 구현 금지 — Phase 9.
- `connect_pool` / `disconnect_pool`의 외부 호출 시그니처 변경 금지.
- DocumentDataGrid 내부 store wire 시그니처 변경 금지.

## Invariants

- vitest + cargo test 회귀 0.
- e2e 정적 컴파일 회귀 0.
- credentials 재입력 없음.
- LRU cap = 8, current_db 보호.
- 사용자 시야 회귀 0: PG 워크스페이스에서 DbSwitcher 외관 동일, 클릭 시 실제 동작.
- aria-label 가이드 준수.
- PG 권한 부족 시 list_databases fallback (S128 동작) 그대로.

## Done Criteria

1. `PostgresAdapter` sub-pool 구조 + LRU + current_db 추적.
2. `switch_active_db(db_name)` method + 4 단위 테스트 (hit/miss/evict/current-protected).
3. `RdbAdapter::switch_database` trait + PostgresAdapter override.
4. Tauri command `switch_active_db(connection_id, db_name)` 등록 + paradigm 분기.
5. 모든 기존 PG pool-using method가 `active_pool()` helper 사용 + 회귀 0.
6. 프런트 `switchActiveDb.ts` thin wrapper + 단위 테스트.
7. DbSwitcher 항목 클릭 dispatch + 실패 toast + 단위 테스트.
8. `connectionStore.activeStatuses[id].activeDb` + `setActiveDb` + 단위 테스트.
9. `schemaStore.clearForConnection` + 단위 테스트.
10. 신규 RDB 탭에 `database` 자동 채움 + 레거시 persisted 탭 마이그레이션 안 함.
11. 검증 명령 7종 그린.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm vitest run` — 1957+ 그린
  2. `pnpm tsc --noEmit` — 0
  3. `pnpm lint` — 0
  4. `pnpm contrast:check` — 0 새 위반
  5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 0 fail
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 0
  7. e2e 정적 컴파일 회귀 0
- Required evidence:
  - 각 AC에 file:line / test:line 매핑
  - PostgresAdapter sub-pool struct 코드 인용
  - `switch_active_db` LRU evict 로직 코드 인용
  - 통합 Tauri command paradigm 분기 코드 인용
  - DbSwitcher handleSelect dispatch 코드 인용
  - `schemaStore.clearForConnection` 코드 인용
  - 신규 RDB 탭 database 자동 채움 코드 인용

## Evidence To Return

- Changed files + purpose 한 줄
- 7개 검증 명령 outcome
- AC-01..AC-12 매핑
- 가정 (e.g. "current_db evict 보호: cap 초과 + 모든 풀이 current_db이면 evict 안 함")
- 잔여 위험

## References

- Contract: `docs/sprints/sprint-130/contract.md`
- Master spec: `docs/sprints/sprint-125/spec.md` (S130 항목)
- 직전 sprint findings: `docs/sprints/sprint-129/findings.md` (있을 시)
- Relevant files:
  - `src-tauri/src/db/postgres.rs` (PostgresAdapter — single pool 현재 구조)
  - `src-tauri/src/db/mod.rs` (RdbAdapter trait)
  - `src-tauri/src/commands/meta.rs` (S128에서 만든 통합 command 파일)
  - `src-tauri/src/commands/connection.rs` (AppState, ActiveAdapter 분기)
  - `src-tauri/src/lib.rs` (`tauri::generate_handler!`)
  - `src/components/workspace/DbSwitcher.tsx`
  - `src/stores/connectionStore.ts` (activeStatuses)
  - `src/stores/schemaStore.ts`
  - `src/stores/tabStore.ts` (TableTab.database, createQueryTab/createDataTab)
  - `src/lib/api/listDatabases.ts` (참고 — 동일한 thin wrapper 패턴)
