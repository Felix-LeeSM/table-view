# Sprint Contract: sprint-138

## Summary

- Goal: ConnectionDialog가 모든 DBMS에 대해 같은 필드를 보여주고 user 기본값이 "postgres"로 박혀있던 버그를 해결한다. DBMS별로 다른 필드 집합과 기본값을 가지는 form을 분리.
- Audience: Phase 10 사용자 점검 #4 (DBMS-aware form).
- Owner: Generator (general-purpose)
- Verification Profile: `mixed`

## In Scope

- MODIFY `src/types/connection.ts` — `DATABASE_DEFAULTS`를 port 외에 user/db까지 포함하도록 확장 (예: `DATABASE_DEFAULT_FIELDS: Record<DatabaseType, { port; user; database }>`). 기존 `DATABASE_DEFAULTS` 시그니처는 그대로 두고 별도 export.
- CREATE `src/components/connection/forms/PgFormFields.tsx` (+ test)
- CREATE `src/components/connection/forms/MysqlFormFields.tsx` (+ test)
- CREATE `src/components/connection/forms/SqliteFormFields.tsx` (+ test)
- CREATE `src/components/connection/forms/MongoFormFields.tsx` (+ test)
- CREATE `src/components/connection/forms/RedisFormFields.tsx` (+ test)
- MODIFY `src/components/connection/ConnectionDialog.tsx` (+ test) — `db_type` switch routing → DBMS별 sub-component. `assertNever` 또는 exhaustive switch.

## Out of Scope

- 백엔드 `connection_test` command 변경 — form payload는 기존 ConnectionConfig 스키마와 호환.
- 백엔드 어댑터 추가 (ES, Redis 본격 구현은 별 sprint).
- ConnectionSwitcher / SchemaSwitcher (S134, S135 종료).
- Sidebar single-click semantics (S136), Mongo stale (S137), query editor (S139), 암호화 export/import (S140).

## Invariants

- 기존 `ConnectionConfig` 스키마 유지 (백엔드 호환).
- `paradigmOf(dbType)` 함수 시그니처 유지.
- URL parsing 모드: PG/MySQL/Mongo/Redis 그대로 작동, SQLite는 file path 직접 입력.
- DBMS shape sidebar(S135), Preview/persist(S136), DisconnectButton(S134), Mongo cache invalidate(S137) 동작 유지.
- 기존 ConnectionDialog 의 일반 동작 (이름, 그룹, 색상, 환경 라벨 등) 유지.

## Acceptance Criteria

- `AC-S138-01` `ConnectionDialog`가 선택된 `db_type`에 따라 다음 form shape를 보인다:
  - PG: host, port (default 5432), user (default `postgres`), password, database (default `postgres`), SSL
  - MySQL: host, port (default 3306), user (default `root`), password, database, SSL
  - SQLite: file path picker — host/port/user/password 필드 자체 부재; database name = file path basename (또는 file 자체)
  - MongoDB: host, port (default 27017), user (optional), password (optional), auth_source, replica_set, tls_enabled, default database
  - Redis: host, port (default 6379), username (optional), password (optional), database index (0–15, default 0), tls_enabled
- `AC-S138-02` db_type을 변경하면 form이 그 DBMS의 기본값으로 reset (단, host 등 사용자 입력은 보수적으로 보존). 신규 vitest test 동반.
- `AC-S138-03` 어떤 DBMS도 default user가 `postgres`로 박히지 않는다 (PG만 `postgres`, MySQL은 `root`, SQLite/Mongo/Redis는 빈 문자열 또는 N/A).
- `AC-S138-04` SQLite form은 "Choose file" 버튼 또는 textbox — host/port 필드 미렌더.
- `AC-S138-05` `<ConnectionDialog>` 내부에서 DBMS별 sub-component(`<PgFormFields>` 등) 분기 + `assertNever`.
- `AC-S138-06` URL parsing 모드는 PG/MySQL/Mongo/Redis 그대로 작동, SQLite는 file path 직접 입력으로 fallback.
- `AC-S138-07` 신규 vitest test 5개 (DBMS당 1개) — 기본값, 필드 존재/부재, db_type 전환, save payload shape.
- `AC-S138-08` 6 게이트 그린. 백엔드 `connection_test` command 변경 없음.

## Design Bar / Quality Bar

- `assertNever` 사용 — `any` 금지.
- 각 form sub-component는 PascalCase 파일, props interface export.
- 다크 모드 + a11y (aria-label/role) + 폼 키보드 네비게이션.
- SQLite file picker: Tauri file picker plugin 사용 — 실패/취소 케이스 가드.

## Verification Plan

### Required Checks

1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`
4. `pnpm contrast:check`
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
7. `pnpm exec eslint e2e/**/*.ts`

### Required Evidence

- 변경 파일 목록 (path + 한 줄 purpose)
- 7개 verification command 출력
- AC별 vitest test 이름 (5 DBMS x 시나리오)

## Test Requirements

### Unit Tests (필수)
- 5개 DBMS form sub-component test (각 1개 이상)
- ConnectionDialog db_type 전환 시 form shape switch test
- `DATABASE_DEFAULT_FIELDS` map 기본값 test

### Coverage Target
- 신규/수정 파일 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: PG default → MySQL default 전환
- [ ] 에러/예외: 알 수 없는 db_type → assertNever
- [ ] 경계 조건: SQLite file path 빈 입력 거부, Redis db index 16 거부
- [ ] 기존 기능 회귀 없음: 그룹, 색상, 환경 라벨, save payload

## Test Script / Repro Script

1-7. 7개 verification command

## Ownership

- Generator: general-purpose agent
- Write scope: `src/components/connection/`, `src/types/connection.ts`
- Merge order: S134 → S135 → S136 → S137 → **S138** → S139 → S140

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
