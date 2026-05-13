# Sprint 277 Handoff — MySQL seed infrastructure (label re-cast)

- 종료일: 2026-05-13
- Phase: 17 (sprint prerequisite)
- 라벨 정정 sprint — 실제 작업 산출물은 commit `8946aaa` (메시지에 sprint-250
  으로 박혀 있음). main 의 `897b254` (DataGrid 편집 UX, 2026-05-09) 가 이미
  sprint-250 라벨을 점유했기 때문에 본 sprint 가 후속 marker 로 정정한다.
  Push 후 history rewrite 가 불가하므로 비-destructive 정정 — `8946aaa`
  commit message 자체는 그대로 두고, PLAN / handoff / sprint table 에서는
  sprint-277 로 참조한다.

## 배경

Phase 17 (MySQL 어댑터) 본체 진입 전 prerequisite 인 seed infrastructure
작업. 두 commit 이 sprint 라벨 충돌 상태로 main 에 들어감:

- `897b254` (2026-05-09) — sprint-250 / DataGrid 편집 UX (onBlur commit +
  modal-aware Esc discard).
- `8946aaa` (2026-05-13) — sprint-250 / MySQL seed infrastructure. **본
  sprint 277 의 실제 산출물.**

`897b254` 가 먼저 main 에 들어가 sprint-250 라벨을 정당하게 점유. `8946aaa`
의 라벨은 충돌 — 본 sprint 277 으로 재 식별.

## 산출물 (commit 8946aaa 본문 인용)

### Docker / 환경

- `docker-compose.yml`: `mysql:8.0` 서비스 추가 (port 13306 = prod 3306 +
  10000), `mysqladmin ping` healthcheck, named volume `mysqldata`.

### Seed

- `e2e/fixtures/seed.mysql.sql` (NEW): PG seed mirror — `BIGINT
  AUTO_INCREMENT` (PG `SERIAL` 대체), `UNIQUE KEY`, FK constraint, InnoDB
  ENGINE + `DEFAULT CHARSET=utf8mb4`. Idempotent: `INSERT IGNORE` +
  `INSERT ... SELECT ... FROM DUAL WHERE NOT EXISTS`.

### Script

- `scripts/fixtures/mysql.ts` (NEW): `postgres.ts` 의 shape 미러 —
  `mysqlEnvConn()`, `ensureMysqlDatabase()`, `dropMysqlDatabase()`,
  `mysqlIsPopulated()` (Sprint 17 본체에서 wire-up 예정 — 현재 stub 으로
  `false` 반환), `applyMysql()` (현재 `NotImplemented` throw — Sprint 17
  본체에서 `mysql2` 클라이언트로 구현).
- `scripts/db/wait.sh`: MySQL 브랜치 추가 — `mysqladmin ping` 폴링.
- `scripts/wait-for-test-db.sh`: stale MySQL 브랜치 정정 (컨테이너 이름
  `table_view_test_mysql` → `table_view_mysql`).

### Backend

- `src-tauri/tests/common/mod.rs`: `MysqlEndpoint` struct +
  `mysql_endpoint()` + `mysql_test_config() -> Option<ConnectionConfig>`.
  ENV 로 endpoint 지정 가능 — Sprint 17 본체의 integration test 에서 사용.

### Dependency

- `package.json` + `pnpm-lock.yaml`: `mysql2 ^3.11.0` devDependency
  (Sprint 17 본체의 TS-side client 용).

### Docs

- `docs/RISKS.md`: RISK-018 closure — "MySQL service 가 docker-compose 에
  정의되지 않음" 위험 해소.

## 검증 (commit 8946aaa 시점)

- `docker compose up -d mysql` healthy.
- seed apply 2x idempotent (INSERT IGNORE / NOT EXISTS).
- 행 수: users 2 / orders 1 / products 1.
- `cargo build` / `pnpm tsc` / `pnpm lint` / `cargo clippy` / vitest 38
  fixture 테스트 통과.

## 잔여 / Sprint 17 본체로 이월

- `applyMysql` 가 `NotImplemented` throw — `mysql2` 클라이언트로 wire-up
  필요.
- `make_adapter` (src-tauri/src/commands/connection.rs) 가 `DatabaseType::Mysql`
  에 대해 여전히 `Unsupported` 반환 — Sprint 17 본체에서 `MysqlAdapter` 와
  교체.
- CLI `index.ts` 의 `targetMode` enum 이 "mysql" 모름 — Sprint 17 본체의
  F-Refactor Part 1 (`ConnectionConfig` variant 확장) 에서 처리.
- `scripts/wait-for-test-db.sh` 가 존재하지 않는 `docker-compose.test.yml`
  을 참조 (pre-existing tech debt; 본 sprint out-of-scope).

## 라벨 정정 이력

- 2026-05-13 14:39 — `8946aaa` 가 sprint-250 으로 main 에 들어감.
- 2026-05-13 ~21:00 — sprint-250 라벨 점유 충돌 확인 (`897b254` 가 이미
  사용 중).
- 사용자 결정 (B 안) — destructive history rewrite 회피 + 새 commit 으로
  정정 marker 추가.
- 본 handoff = 정정 marker. PLAN.md `Phase 17 row` 도 `Sprint 277 seed
  infra` 로 갱신.

## 관련

- 실제 작업 commit: `8946aaa feat(sprint-250): MySQL seed infrastructure (Phase 17 prerequisite)`.
- 라벨 충돌 점유 commit: `897b254 feat(grid): Sprint 250 — DataGrid 편집 UX`.
- 다음 단계: Phase 17 본체 (MysqlAdapter wire-up).
