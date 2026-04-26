# Sprint Execution Brief: sprint-128

## Objective

백엔드 통합 command `list_databases(connection_id)` 도입 + 프런트엔드 `<DbSwitcher>` enable + fetch on click. **선택은 여전히 no-op** (S130/S131에서 활성). PG 권한 부족 시 현재 DB 단일 fallback.

- RdbAdapter trait에 `list_databases` 메서드 추가, default impl `Ok(vec![])`. PostgresAdapter는 `SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname` 구현 + 권한 부족 fallback.
- 통합 Tauri command — paradigm 분기 (rdb / document / search / kv).
- TS thin wrapper + DbSwitcher 동작 변경 (paradigm rdb/document면 enabled, 클릭 → fetch + popover).
- 항목 선택은 inline hint 표시 + 스토어 mutation 0.

## Task Why

S127에서 toolbar의 DB switcher가 자리만 잡혔지만 read-only. 사용자에게 "이 connection 안에 어떤 DB가 있는가"를 노출하는 메타 레이어가 S130/S131의 실제 switch 동작에 선행되어야 한다. PG의 다중 DB 환경 + Mongo의 동일 connection에서 다중 DB 작업은 두 paradigm 모두에서 흔한 워크플로우. SQLite/MySQL/Redis/ES는 Phase 9에서 어댑터 추가 시 자연스럽게 동작.

## Scope Boundary

- 실제 DB 전환 (sub-pool / use_db) 금지 — S130/S131.
- LRU 캐시 / connection pool 시그니처 변경 금지 — S130.
- raw-query lex 금지 — S132.
- DocumentSidebar 정합 변경 금지 — S129.
- 단축키 / 신규 e2e spec 추가 금지 — S133.
- 기존 `list_mongo_databases` 시그니처 보존.

## Invariants

- vitest 1934 + Rust suite 회귀 0.
- 기존 e2e 정적 컴파일 무회귀.
- RdbAdapter trait 확장은 default impl로 (다른 RDB 구현 컴파일 깨짐 0).
- ActiveAdapter::Search/Kv 분기 누락 금지 — graceful empty return.
- 사용자 시야 회귀 0: kv/search/disconnected 상태에서 DbSwitcher 외관 동일.

## Done Criteria

1. RdbAdapter trait `list_databases` 추가, default `Ok(vec![])`.
2. PostgresAdapter `list_databases` 구현 + 권한 부족 fallback + 단위 테스트.
3. 통합 Tauri command 등록, 4 paradigm 분기.
4. 기존 list_mongo_databases 회귀 0.
5. TS wrapper + DbSwitcher 동작 변경 + 단위 테스트.
6. 항목 선택은 no-op + inline hint.
7. 검증 명령 7종 그린.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm vitest run` — 1934+ 그린
  2. `pnpm tsc --noEmit` — 0
  3. `pnpm lint` — 0
  4. `pnpm contrast:check` — 0 새 위반
  5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  7. e2e 정적 컴파일 무회귀
- Required evidence:
  - 각 AC에 file:line / test:line 매핑
  - 통합 command paradigm 분기 코드 인용
  - PG 권한 fallback 로직 코드 인용
  - DbSwitcher fetch on click 코드 인용
  - 항목 선택이 진짜 no-op (스토어 mutation 0) RTL 증거
  - kv/search paradigm 호출이 빈 배열 반환 Rust 테스트

## Evidence To Return

- Changed files + purpose 한 줄
- 7개 검증 명령 outcome 요약
- AC-01..AC-12 매핑
- 가정 (e.g. "PG 권한 부족 SQLSTATE 매칭은 sqlx::Error::Database로 분기")
- 잔여 위험

## References

- Contract: `docs/sprints/sprint-128/contract.md`
- Master spec: `docs/sprints/sprint-125/spec.md`
- 직전 sprint findings: `docs/sprints/sprint-127/findings.md`
- Relevant files:
  - `src-tauri/src/db/mod.rs` (RdbAdapter / DocumentAdapter / ActiveAdapter)
  - `src-tauri/src/db/postgres.rs` (PostgresAdapter)
  - `src-tauri/src/db/mongodb.rs` (MongoAdapter — `list_databases` 이미 있음)
  - `src-tauri/src/commands/document/browse.rs` (`list_mongo_databases` 보존 대상)
  - `src-tauri/src/commands/connection.rs` (AppState, ActiveAdapter 분기 패턴)
  - `src-tauri/src/lib.rs` (`tauri::generate_handler!`)
  - `src/components/workspace/DbSwitcher.tsx`
  - `src/lib/api/` (TS thin wrapper 위치)
  - `src/stores/tabStore.ts` (`useActiveTab`)
  - `src/stores/connectionStore.ts` (`activeStatuses`)
