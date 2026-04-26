# Sprint Contract: sprint-135

## Summary

- Goal: Toolbar `SchemaSwitcher`를 완전 제거하고 schema 선택권을 sidebar tree 단일 SoT로 통합. Sidebar tree는 `connection.db_type`에 따라 schema layer를 동적으로 생략 (PG/MSSQL은 3-레벨, MySQL/SQLite는 2-레벨, Mongo는 이미 분리됨). 비활성 toolbar 컨트롤의 stale tooltip(이번에는 다른 stale 문구가 있다면) 갱신.
- Audience: Phase 10 사용자 점검 #7 (toolbar disabled tooltip + sidebar schema location).
- Owner: Generator (general-purpose)
- Verification Profile: `mixed`

## In Scope

- DELETE `src/components/workspace/SchemaSwitcher.tsx` + `SchemaSwitcher.test.tsx`
- MODIFY `src/components/workspace/WorkspaceToolbar.tsx` (+ test) — SchemaSwitcher import/렌더 제거
- MODIFY `src/components/schema/SchemaTree.tsx` (+ test) — `connection.db_type`에 따라 schema layer fold/skip 분기
  - PG (postgresql), MSSQL → render schema row (database → schema → table)
  - MySQL, MariaDB → schema row 미렌더 (database → table 2-레벨)
  - SQLite → 단일 root → table list
- MODIFY `src/components/workspace/RdbSidebar.tsx` — db_type 전달 (이미 받고 있다면 SchemaTree로 forward 확인)
- MODIFY `src/components/workspace/DbSwitcher.tsx` (+ test) — disabled tooltip이 stale 문구 ("Coming in Sprint 130" 등)를 가리키면 현실 안내로 교체. 단, grep 결과 이미 0건이라면 이 항목은 "no-op + grep 가드 추가".
- CREATE `src/components/schema/SchemaTree.dbms-shape.test.tsx` 또는 SchemaTree.test.tsx에 신규 describe 추가 — db_type별 트리 깊이 어서션 (PG=3, MySQL=2, SQLite=1, Mongo=N/A별도 분기).
- 회귀 가드 grep test: "Coming in Sprint 1[2-3][0-9]" 정규식 0 매치 강제.

## Out of Scope

- ConnectionSwitcher 관련 (S134에서 종료)
- Sidebar single-click preview semantics (S136)
- Mongo switch-DB stale (S137)
- DBMS-aware connection form (S138)
- Paradigm-aware query editor (S139)
- 백엔드 schema list API 변경 — 백엔드는 그대로 두고 프런트에서 깊이 결정
- Mongo (DocumentDatabaseTree) 변경 — 회귀 가드만

## Invariants

- PG schema/expand/collapse/즐겨찾기/검색 동작 유지
- Mongo `database → collection` 2-레벨 (S129 회귀 가드)
- DbSwitcher (toolbar의 DB 전환) 동작 유지
- Sprint 126/129 sidebar swap 동작 유지
- DisconnectButton (S134) 동작 유지
- Cmd+, / Cmd+1..9 / Cmd+W / Cmd+T / Cmd+S / Cmd+N / Cmd+P 동작 유지

## Acceptance Criteria

- `AC-S135-01` `SchemaSwitcher.tsx` + `SchemaSwitcher.test.tsx` 삭제, `WorkspaceToolbar.tsx`에서 import/render 미참조. `pnpm tsc --noEmit` 0 에러.
- `AC-S135-02` PG connection sidebar tree는 `database → schema → table` 3-레벨로 표시.
- `AC-S135-03` MySQL connection sidebar tree는 `database → table` 2-레벨, schema row 절대 미렌더 (placeholder/stale schema row 제거).
- `AC-S135-04` SQLite connection sidebar tree는 단일 root → table list 1-레벨, 인공적 "main" schema row 없음.
- `AC-S135-05` Mongo connection sidebar는 `database → collection` 2-레벨 (회귀 가드 vitest).
- `AC-S135-06` Stale tooltip 문구 ("Coming in Sprint 1[2-3][0-9]") regex 0 매치를 grep test로 강제 — 이미 0건이라면 가드 test로 영구 fix.
- `AC-S135-07` SchemaTree (또는 sidebar 트리)에 `db_type`별 트리 깊이 분기 + 신규 vitest test가 4개 db_type(PG/MySQL/SQLite/Mongo)에서 깊이를 어서션.
- `AC-S135-08` 6 게이트 그린 + e2e static lint.

## Design Bar / Quality Bar

- `assertNever` 또는 명시적 `db_type` switch — `any` 금지.
- 다크 모드 + a11y (aria-label/role) 유지.
- 신규 test는 사용자 관점 query (`getByRole`, `getByText`) — `getByTestId` 최후 수단.

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

- Generator must provide:
  - 변경 파일 목록 (path + 한 줄 purpose)
  - 7개 verification command 출력 (last 20 lines)
  - 각 AC별 vitest test 이름 + 통과 라인
  - `grep -rn "SchemaSwitcher" src/ e2e/` 결과 0 hits 확인
  - `grep -rEn "Coming in Sprint 1[2-3][0-9]" src/ e2e/` 결과 0 hits 확인
- Evaluator must cite 각 AC별 구체 증거.

## Test Requirements

### Unit Tests (필수)
- AC-S135-02/03/04/05: SchemaTree.dbms-shape.test.tsx (또는 SchemaTree.test.tsx 신규 describe) — 4개 db_type 깊이 어서션.
- AC-S135-06: stale tooltip grep guard test (간단한 static test).
- AC-S135-01: WorkspaceToolbar.test.tsx에서 SchemaSwitcher 부재 어서션.

### Coverage Target
- 신규/수정 파일 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: PG sidebar render → 3-레벨 트리
- [ ] 에러/예외: 알 수 없는 db_type → assertNever
- [ ] 경계 조건: SQLite 단일 root, MySQL 2-레벨
- [ ] 기존 기능 회귀 없음: Mongo 2-레벨, DbSwitcher

## Test Script / Repro Script

1-7. 7개 verification command
8. `grep -rn "SchemaSwitcher" src/ e2e/` — 0 hits
9. `grep -rEn "Coming in Sprint 1[2-3][0-9]" src/ e2e/` — 0 hits

## Ownership

- Generator: general-purpose agent
- Write scope: `src/components/workspace/`, `src/components/schema/`, `src/types/connection.ts` (필요 시)
- Merge order: S134 → **S135** → S136 → … → S140

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
