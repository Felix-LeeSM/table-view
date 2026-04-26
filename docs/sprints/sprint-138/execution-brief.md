# Sprint Execution Brief: sprint-138

## Objective

ConnectionDialog가 모든 DBMS에 대해 같은 필드(host/port/user/password/db)를 보여주고 user 기본값이 "postgres"로 박혀있던 버그를 해결한다. DBMS별로 다른 필드 집합과 기본값을 가지는 form sub-component(`PgFormFields`, `MysqlFormFields`, `SqliteFormFields`, `MongoFormFields`, `RedisFormFields`)를 분리하고 ConnectionDialog가 `db_type`에 따라 routing.

## Task Why

사용자 점검(2026-04-27)에서 "DBMS별로 필드가 달라야 한다"는 피드백 + "user 기본값이 항상 `postgres`로 박혀 있다"는 명확한 버그가 드러났다. 한 sprint에서 5개 DBMS form을 분리하고 기본값을 정상화한다. 백엔드 호환성을 깨지 않는 선에서 frontend-only 작업.

## Scope Boundary

- 변경 가능: `src/components/connection/`, `src/types/connection.ts`.
- 변경 금지: 백엔드 `connection_test` command, ConnectionList/Group/Item 동작, sidebar/toolbar.
- 새 백엔드 어댑터 추가 금지 (ES, Redis 본격 구현은 별 sprint).

## Invariants

- `ConnectionConfig` 스키마 유지 (백엔드 호환).
- `paradigmOf(dbType)` 시그니처 유지.
- URL parsing PG/MySQL/Mongo/Redis 동작.
- DBMS shape(S135), Preview(S136), DisconnectButton(S134), Mongo cache(S137) 미파손.

## Done Criteria

1. 5개 form sub-component 신규 (PG/MySQL/SQLite/Mongo/Redis) + 각 test.
2. ConnectionDialog가 db_type 변경 시 sub-component switch routing (`assertNever`).
3. user 기본값이 PG=`postgres`, MySQL=`root`, 그 외 빈 문자열 또는 N/A.
4. SQLite form은 file path만 — host/port/user/password 필드 미렌더.
5. URL parsing 동작 보존 (SQLite fallback).
6. db_type 전환 시 host 등 사용자 입력은 보수적으로 보존, port/user는 새 DBMS default로 reset.
7. 7개 verification command 그린.

## Verification Plan

- Profile: mixed
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `pnpm contrast:check`
  5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  7. `pnpm exec eslint e2e/**/*.ts`
- Required evidence:
  - 7개 명령 출력 (last 20 lines)
  - 5 DBMS x form test 이름 + 통과 라인
  - ConnectionDialog db_type switch 시나리오 vitest test

## Evidence To Return

- 변경 파일 목록 (path + 한 줄 purpose)
- 7개 verification command 출력
- AC-S138-01..08 증거
- 가정 (예: SQLite file picker 의 Tauri plugin 의존)
- 리스크

## References

- Contract: `docs/sprints/sprint-138/contract.md`
- Master spec: `docs/sprints/sprint-134/spec.md` (Phase 10)
- Lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- Relevant files (read first):
  - `src/types/connection.ts` (DatabaseType, DATABASE_DEFAULTS, ConnectionConfig, ConnectionDraft)
  - `src/components/connection/ConnectionDialog.tsx` + test
  - `src/components/connection/ConnectionItem.tsx`
  - `src/lib/api/` (Tauri command 시그니처)
  - 기존 file picker plugin (있다면) — `src-tauri/Cargo.toml` `tauri-plugin-dialog` 등
