# Sprint Execution Brief: sprint-135

## Objective

Toolbar `SchemaSwitcher`를 제거하여 schema 선택 SoT를 sidebar tree 단일로 통합하고, sidebar tree가 `connection.db_type`에 따라 schema layer를 동적으로 fold/skip 하도록 만든다 (PG/MSSQL은 3-레벨, MySQL/MariaDB는 2-레벨, SQLite는 1-레벨, Mongo는 이미 분리됨). Stale "Coming in Sprint" 문구가 남아있으면 제거하고 grep 가드 test로 영구 차단.

## Task Why

Phase 9에서 toolbar에 SchemaSwitcher를 도입했으나 사용자 점검(2026-04-27)에서 "schema 선택은 sidebar 한 곳에서만 하는 게 자연스럽다"는 의견이 나왔다. 동시에 MySQL/SQLite처럼 schema layer가 없는 DBMS에서 sidebar에 인공 schema row가 그려지는 어색함도 있다. SoT 통합 + 트리 shape DBMS-agnostic을 한 sprint에서 처리한다.

## Scope Boundary

- 변경 가능: `src/components/workspace/`, `src/components/schema/`, `src/types/connection.ts` (필요 시).
- 변경 금지: 백엔드(Rust) schema list API, ConnectionDialog form, query editor, import/export, single-click preview semantics(S136).
- DocumentDatabaseTree (Mongo)는 회귀 가드만 — 분기 로직 변경 금지.

## Invariants

- PG schema/expand/collapse/즐겨찾기/검색 동작 유지.
- Mongo `database → collection` 2-레벨 (S129 회귀).
- DbSwitcher 동작 유지.
- Sprint 126/129/134 sidebar swap + DisconnectButton 동작 유지.
- 키보드 단축키 (Cmd+, / Cmd+1..9 / Cmd+W / Cmd+T / Cmd+S / Cmd+N / Cmd+P) 유지.

## Done Criteria

1. `SchemaSwitcher.tsx` + `SchemaSwitcher.test.tsx` 삭제, `WorkspaceToolbar.tsx`에서 미참조.
2. PG sidebar tree = `database → schema → table` 3-레벨.
3. MySQL/MariaDB sidebar tree = `database → table` 2-레벨, schema row 미렌더.
4. SQLite sidebar tree = 단일 root → table list 1-레벨.
5. Mongo sidebar tree 회귀 가드 그린.
6. `Coming in Sprint 1[2-3][0-9]` regex 0 매치 (이미 0건이면 grep 가드 test로 영구 차단).
7. db_type별 트리 깊이 vitest test 4개(PG/MySQL/SQLite/Mongo) 그린.
8. 7개 verification command 그린.

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
  - `grep -rn "SchemaSwitcher" src/ e2e/` → 0 hits
  - `grep -rEn "Coming in Sprint 1[2-3][0-9]" src/ e2e/` → 0 hits
  - 신규 db_type별 트리 깊이 vitest test 이름

## Evidence To Return

- 변경 파일 목록 (path + 한 줄 purpose)
- 7개 verification command 출력
- AC-S135-01 ~ AC-S135-08 각각의 증거 라인
- grep 결과 (SchemaSwitcher / "Coming in Sprint 1[2-3][0-9]" 0 hits)
- 가정/리스크

## References

- Contract: `docs/sprints/sprint-135/contract.md`
- Master spec: `docs/sprints/sprint-134/spec.md` (Phase 10 합본)
- S134 baseline: `docs/sprints/sprint-134/handoff.md`
- Lesson trigger: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- Relevant files (read first):
  - `src/components/workspace/SchemaSwitcher.tsx` + test
  - `src/components/workspace/WorkspaceToolbar.tsx` + test
  - `src/components/workspace/RdbSidebar.tsx`, `DocumentSidebar.tsx`
  - `src/components/workspace/DbSwitcher.tsx` + test
  - `src/components/schema/SchemaTree.tsx` + test
  - `src/components/schema/DocumentDatabaseTree.tsx`
  - `src/types/connection.ts` — `DatabaseType` enum / `db_type` 정의
  - `src/stores/connectionStore.ts`, `src/stores/schemaStore.ts`
