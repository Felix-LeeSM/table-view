# Sprint Contract: Sprint 17

## Summary

- Goal: DBMS별 파라미터화된 통합 테스트 + query_integration graceful skip 통일
- Audience: Generator / Evaluator
- Owner: Orchestrator
- Verification Profile: `command`

## In Scope

1. `src-tauri/tests/common/mod.rs` — `available_dbms()` 헬퍼 추가, MySQL 설정 준비
2. `src-tauri/tests/query_integration.rs` — `common::setup_adapter()` 사용으로 통일
3. `docker-compose.test.yml` — 포트를 환경변수로 오버라이드 가능하게 (`${PG_PORT:-5432}`)
4. `scripts/wait-for-test-db.sh` — 환경변수 포트 오버라이드 지원

## Out of Scope

- Cargo feature flags (sqlx mysql feature 활성화 안함 — MySqlAdapter 미구현)
- 실제 MySQL 통합 테스트 작성 (어댑터 없음)
- E2E CI 잡

## Invariants

- 376 frontend 테스트 통과
- 84 Rust lib 테스트 통과
- 기존 schema_integration 12 테스트 동작 동일
- 프로덕션 코드 변경 없음

## Acceptance Criteria

- AC-01: `query_integration.rs`의 모든 통합 테스트가 `common::setup_adapter()` 사용
- AC-02: `docker-compose.test.yml` 포트가 `${PG_PORT:-5432}`, `${MYSQL_PORT:-3306}` 형태
- AC-03: `scripts/wait-for-test-db.sh`가 `${PG_PORT:-5432}` 환경변수 지원
- AC-04: `cargo test --test query_integration` Docker 없이 exit 0
- AC-05: `cargo test --test schema_integration` Docker 없이 exit 0 (기존 동작 유지)

## Verification Plan

### Required Checks

1. `cargo test --test schema_integration --test query_integration` (Docker 없이) — exit 0
2. `cargo test --lib` — 84 pass
3. `pnpm vitest run` — 376 pass
4. `pnpm lint && pnpm tsc --noEmit` — clean

## Ownership

- Generator: Sprint 17 Generator Agent
- Write scope: `src-tauri/tests/common/mod.rs`, `src-tauri/tests/query_integration.rs`, `docker-compose.test.yml`, `scripts/wait-for-test-db.sh`
- Merge order: direct to main

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
