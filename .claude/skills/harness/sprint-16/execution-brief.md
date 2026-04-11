# Sprint Execution Brief: Sprint 16

## Objective

Docker Compose 테스트 DB 플릿 구축, 공유 테스트 설정 모듈 생성, 기존 통합 테스트 리팩토링, lefthook/CI 파이프라인 수정.

## Task Why

현재 12개 schema_integration 테스트와 15개 query_integration 테스트가 PostgreSQL 없이 실패/스킵됨. Docker로 DB를 띄우면 즉시 27개 통합 테스트가 통과함. 또한 다중 DBMS(PostgreSQL, MySQL) 지원을 위한 기반을 마련해야 함.

## Scope Boundary

- 프로덕션 코드 변경 없음 (src/ 및 src-tauri/src/ 수정 금지)
- 단위 테스트 수정 없음
- MongoDB/Redis 통합 테스트 작성 안함 (어댑터 미구현)
- Cargo feature flags 변경 없음 (sqlx features 그대로 유지)

## Invariants

- 376 frontend 테스트 통과
- 84 Rust lib 테스트 통과
- pnpm lint, pnpm tsc --noEmit 통과
- cargo fmt, cargo clippy 통과

## Done Criteria

1. `docker compose -f docker-compose.test.yml up -d` 가 PG + MySQL 컨테이너 시작
2. `cargo test --test schema_integration` Docker 없이 exit 0 (모든 테스트 skip)
3. `cargo test --test schema_integration` Docker 켜진 상태에서 12 tests pass
4. `cargo test --test query_integration` Docker 켜진 상태에서 pass
5. `test:docker` 스크립트가 존재하고 동작함
6. lefthook pre-push가 통합 테스트 제외
7. CI workflow에 integration-tests 잡 존재

## Verification Plan

- Profile: command
- Required checks:
  1. `docker compose -f docker-compose.test.yml up -d` — exit 0
  2. `bash scripts/wait-for-test-db.sh` — exit 0
  3. `cargo test --test schema_integration` (Docker 없이) — exit 0, 모두 skip
  4. `cargo test --lib` — 84 pass
  5. `pnpm vitest run` — 376 pass
  6. `pnpm lint && pnpm tsc --noEmit` — clean
- Required evidence:
  - Docker compose up 실행 로그
  - 각 cargo test 실행 결과
  - 변경 파일 목록

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- Assumptions made during implementation
- Residual risk or verification gaps

## References

- Contract: `.claude/skills/harness/sprint-16/contract.md`
- Relevant files:
  - `docker-compose.yml` — 현재 단일 PostgreSQL 서비스
  - `src-tauri/tests/schema_integration.rs` — 12개 통합 테스트 (panic on no DB)
  - `src-tauri/tests/query_integration.rs` — 15개 통합 테스트 (graceful skip)
  - `src-tauri/tests/storage_integration.rs` — 기존 통합 테스트 참조
  - `src-tauri/Cargo.toml` — dependencies
  - `src-tauri/src/db/mod.rs` — DB adapter 구조
  - `src-tauri/src/db/postgres.rs` — PostgresAdapter 구현
  - `src-tauri/src/models/connection.rs` — ConnectionConfig, DatabaseType
  - `lefthook.yml` — git hooks
  - `.github/workflows/ci.yml` — CI pipeline
  - `package.json` — scripts
