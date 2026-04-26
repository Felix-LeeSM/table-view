# Sprint Execution Brief: sprint-139

## Objective

Mongo query tab에 SQL 사전이 흘러가는 lesson(2026-04-27)을 닫는다. Mongo는 별도 컴포넌트(`MongoQueryEditor`)로 추출하고, RDB는 단일 SQL editor가 connection의 db_type에 따라 dialect별 keyword 사전(pg / mysql / sqlite)을 swap. QueryTab이 paradigm에 따라 routing.

## Task Why

QueryEditor가 paradigm 분기를 내부에서 하면서도 autocomplete 사전은 SQL 단일 — Mongo tab에서 `SELECT`, `FROM` 같은 SQL 키워드가 후보로 뜨는 사용자 점검 #3 이슈가 발생. paradigm 별로 컴포넌트를 분리해 cross-contamination 을 구조적으로 차단한다. 동시에 기존 SQL 사전이 dialect 무관이라 `ILIKE`, `RETURNING` 같은 PG-only 키워드가 MySQL 탭에서도 보이는 문제도 dialect-별 사전으로 정리.

## Scope Boundary

- 변경 가능: `src/components/query/`, `src/hooks/useSqlAutocomplete.ts`, `src/lib/sqlDialect*.ts`.
- 변경 금지: 백엔드(Rust), ConnectionDialog, sidebar, toolbar, import/export.
- Redis / ES editor 본격 구현 금지 — placeholder 만.

## Invariants

- 기존 query 실행 동작 (raw query, 결과 grid, 로그, history) 미파손.
- DBMS-aware connection form(S138), DBMS shape(S135), Preview(S136), DisconnectButton(S134), Mongo cache(S137) 동작 유지.
- 키보드 단축키 유지.
- MongoSyntax / SqlSyntax / QuerySyntax 회귀 가드.

## Done Criteria

1. `MongoQueryEditor` 신규 컴포넌트 — MQL operators + collection 필드명 autocomplete. SQL keyword 0개.
2. `SqlQueryEditor` 신규 컴포넌트 (또는 thin `QueryEditor` rdb-only narrow) — db_type 별 SQLDialect + dialect-별 keyword 사전 swap.
3. `QueryTab` paradigm routing: document → MongoQueryEditor, rdb → SqlQueryEditor, kv → placeholder, search → placeholder.
4. dialect별 keyword 사전 helper (`getKeywordsForDialect`) 신규.
5. `useSqlAutocomplete` 가 dialect 인자에 따라 keyword 사전 swap.
6. paradigm/db_type 전환 시 cross-contamination 가드 vitest test.
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
  - AC별 vitest test 이름

## Evidence To Return

- 변경 파일 목록 (path + 한 줄 purpose)
- 7개 verification command 출력
- AC-S139-01..06 증거
- 가정 (예: MongoQueryEditor 가 useMongoAutocomplete 위에 어떤 식으로 자체 provider 를 등록했는지)
- 리스크

## References

- Contract: `docs/sprints/sprint-139/contract.md`
- Master spec: `docs/sprints/sprint-134/spec.md` (Phase 10)
- Lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- Sprint 82 dialect baseline: `docs/sprints/sprint-82/handoff.md` (참고)
- Sprint 83 mongo extension baseline: `docs/sprints/sprint-83/handoff.md` (참고)
- Relevant files (read first):
  - `src/components/query/QueryEditor.tsx` + `.test.tsx`
  - `src/components/query/QueryTab.tsx` + `.test.tsx`
  - `src/hooks/useSqlAutocomplete.ts` + `.test.ts`
  - `src/hooks/useMongoAutocomplete.ts` + `.test.ts`
  - `src/lib/sqlDialect.ts` + `.test.ts`
  - `src/lib/mongoAutocomplete.ts` + `.test.ts`
  - `src/types/connection.ts` (`DatabaseType`, `Paradigm`)
