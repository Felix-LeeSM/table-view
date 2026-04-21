# Sprint Contract: Sprint 16

## Summary

- Goal: Docker Compose 테스트 DB 플릿 구축 + 공유 테스트 설정 모듈 + lefthook/CI 수정
- Audience: Generator / Evaluator
- Owner: Orchestrator
- Verification Profile: `command`

## In Scope

1. `docker-compose.test.yml` 생성 — PostgreSQL, MySQL, MongoDB 서비스 (healthcheck, credentials)
2. `scripts/wait-for-test-db.sh` — 각 서비스 healthy 대기 스크립트
3. `src-tauri/tests/common/mod.rs` — 공유 테스트 설정 (per-DBMS config, graceful skip)
4. `src-tauri/tests/schema_integration.rs` — 공유 모듈 사용 + graceful skip 패턴
5. `src-tauri/tests/query_integration.rs` — 공유 모듈 사용
6. `package.json` — `test:docker` 스크립트 추가
7. `lefthook.yml` — pre-push에서 통합 테스트 제외 (Docker 없이 실패 방지)
8. `.github/workflows/ci.yml` — integration-tests 잡 추가 (Docker services)

## Out of Scope

- Cargo feature flags (db-postgres, db-mysql) — Sprint 17
- DBMS별 파라미터화된 테스트 — Sprint 18
- E2E CI 잡 (WebdriverIO) — Sprint 19
- MongoDB/Redis 통합 테스트 (어댑터 미구현)

## Invariants

- 모든 기존 단위 테스트 통과 (376 frontend + 84 Rust lib)
- `cargo test --lib` 결과 동일
- `pnpm vitest run` 결과 동일
- 프로덕션 코드 변경 없음
- `pnpm lint`, `pnpm tsc --noEmit` 통과

## Acceptance Criteria

- `AC-01`: `docker compose -f docker-compose.test.yml up -d` 가 PostgreSQL(5432), MySQL(3306) 컨테이너를 시작하고 각각 healthy 상태가 됨
- `AC-02`: `scripts/wait-for-test-db.sh` 실행 시 모든 서비스가 accepting connections일 때 exit 0
- `AC-03`: `src-tauri/tests/common/mod.rs` 가 `test_config(DatabaseType)` 과 `setup_adapter(DatabaseType)` 제공
- `AC-04`: `cargo test --test schema_integration` 이 Docker DB 없이 실행 시 모든 테스트가 skip (exit 0)
- `AC-05`: Docker PostgreSQL 실행 중 `cargo test --test schema_integration` 통과 (12 tests)
- `AC-06`: `package.json` 에 `test:docker` 스크립트 존재
- `AC-07`: `lefthook.yml` pre-push가 통합 테스트 제외 (`--lib --test storage_integration`)
- `AC-08`: `.github/workflows/ci.yml` 에 Docker service 기반 integration-tests 잡 존재

## Design Bar / Quality Bar

- Docker Compose 서비스는 healthcheck 필수
- 테스트 credentials: `testuser/testpass`, DB명: `table_view_test`
- graceful skip: 연결 실패 시 `println!` 후 `return`, panic 없음
- 포트 충돌 시 환경변수로 오버라이드 가능 (`TEST_PG_PORT` 등)

## Verification Plan

### Required Checks

1. `docker compose -f docker-compose.test.yml up -d` — exit 0, services healthy
2. `cargo test --test schema_integration` (Docker 없이) — 모든 테스트 skip, exit 0
3. `cargo test --test schema_integration` (Docker 켜진 상태) — 12 tests pass
4. `cargo test --test query_integration` (Docker 켜진 상태) — 기존 + 신규 통과
5. `cargo test --lib` — 84 tests pass
6. `pnpm vitest run` — 376 tests pass
7. `pnpm lint && pnpm tsc --noEmit` — clean

## Test Script / Repro Script

1. `docker compose -f docker-compose.test.yml up -d && bash scripts/wait-for-test-db.sh`
2. `cargo test --manifest-path src-tauri/Cargo.toml --test schema_integration --test query_integration`
3. `docker compose -f docker-compose.test.yml down -v`

## Ownership

- Generator: Sprint 16 Generator Agent
- Write scope: `docker-compose.test.yml` (new), `scripts/wait-for-test-db.sh` (new), `src-tauri/tests/common/mod.rs` (new), `src-tauri/tests/schema_integration.rs` (refactor), `src-tauri/tests/query_integration.rs` (refactor), `package.json` (add script), `lefthook.yml` (update), `.github/workflows/ci.yml` (add job)
- Merge order: direct to main

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in handoff.md
