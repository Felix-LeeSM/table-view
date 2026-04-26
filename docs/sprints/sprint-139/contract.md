# Sprint Contract: sprint-139

## Summary

- Goal: SQL editor가 paradigm 분기 없이 SQL keyword 사전을 쓰는 lesson(2026-04-27)을 닫는다. Mongo는 별도 컴포넌트(`MongoQueryEditor`)로 추출, RDB는 단일 SQL editor가 connection의 db_type에 따라 dialect별 keyword 사전(pg / mysql / sqlite)을 swap.
- Audience: Phase 10 사용자 점검 #3 (paradigm-aware query editor).
- Owner: Generator (general-purpose)
- Verification Profile: `mixed`

## In Scope

- MODIFY `src/lib/sqlDialect.ts` (+ test) — 기존 `databaseTypeToSqlDialect` 그대로, dialect별 keyword 사전 export 추가 또는 별 파일.
- CREATE `src/lib/sqlDialectKeywords.ts` (+ test) — `getKeywordsForDialect(dialect: DatabaseType): string[]` (PG: RETURNING, ILIKE, SERIAL, $$, JSONB; MySQL: AUTO_INCREMENT, LIMIT n,m, REPLACE INTO; SQLite: PRAGMA, WITHOUT ROWID, IIF).
- CREATE `src/components/query/MongoQueryEditor.tsx` (+ test) — Mongo 전용 editor; 자체 autocomplete provider는 MQL operators(`$match`, `$group`, `$lookup`, `$project`, `$sort`, `$limit`, `$unwind`, `$facet`, `$addFields`, …) + 활성 collection 필드명만 제공. SQL keyword 0개.
- CREATE `src/components/query/SqlQueryEditor.tsx` (+ test) — RDB 전용; connection의 db_type에 따라 SQLDialect + dialect별 keyword 사전을 swap.
- MODIFY `src/components/query/QueryTab.tsx` (+ test) — `paradigm === "document"` → `<MongoQueryEditor>`, `paradigm === "rdb"` → `<SqlQueryEditor>` routing. 기존 `<QueryEditor>` 는 thin router로 narrow 또는 호출 그대로 유지(thin router 권장).
- MODIFY `src/hooks/useSqlAutocomplete.ts` (+ test) — dialect 인자에 따라 keyword 사전 swap.
- MODIFY 기존 `QueryEditor.tsx` — `paradigm === "document"` 분기 제거 (Mongo는 별 컴포넌트로 이동), 또는 thin router로 좁힘.

## Out of Scope

- Redis / Elasticsearch query editor 본격 구현 — Redis는 placeholder 또는 단순 textarea; ES는 본 sprint 비-목표.
- ConnectionDialog (S138 종료).
- Sidebar / Toolbar (S134~S137 종료).
- 암호화 export/import (S140).
- 백엔드(Rust) 변경 없음.

## Invariants

- `paradigmOf(dbType)` 시그니처 유지.
- DBMS-aware connection form(S138) 동작 유지.
- DBMS shape sidebar(S135), Preview/persist(S136), DisconnectButton(S134), Mongo cache(S137) 미파손.
- 기존 query 실행 동작 (raw query, 결과 grid, 로그) 미파손.
- MongoSyntax / SqlSyntax / QuerySyntax 컴포넌트 (있다면) 회귀 가드.

## Acceptance Criteria

- `AC-S139-01` `MongoQueryEditor`가 신규 컴포넌트로 추출. autocomplete provider는 MQL operators + collection 필드명만; SQL keyword 0개. 신규 vitest test가 (a) `$match`, `$group` 등이 후보로 제공됨 (b) `SELECT`, `FROM` 등이 제공되지 않음을 어서션.
- `AC-S139-02` `QueryTab`이 `paradigm === "document"` 일 때 `<MongoQueryEditor>`를 렌더, `paradigm === "rdb"` 일 때 `<SqlQueryEditor>` (또는 thin `<QueryEditor>` rdb-only) 렌더. 신규 vitest test 어서션.
- `AC-S139-03` Rdb editor는 connection.db_type에 따라 CodeMirror `SQLDialect`를 swap 하고, autocomplete keyword 집합도 dialect별로 swap (pg → `RETURNING`, `ILIKE`, `SERIAL`; mysql → `AUTO_INCREMENT`, `REPLACE INTO`; sqlite → `PRAGMA`, `WITHOUT ROWID`). 사전 swap이 실제로 일어남을 vitest로 어서션.
- `AC-S139-04` Redis paradigm은 query editor에서 collection 개념이 없으므로 placeholder ("Redis ad-hoc query is coming in Phase 11") 또는 단순 textarea — Redis editor는 non-goal이지만 paradigm `"kv"` 가 들어와도 crash X.
- `AC-S139-05` paradigm/db_type swap 시 mongo extensions가 SQL editor에 새지 않고 그 역도 마찬가지 — 회귀 vitest test.
- `AC-S139-06` 6 게이트 + e2e static lint 그린.

## Design Bar / Quality Bar

- `assertNever` 또는 exhaustive switch — `any` 금지.
- Mongo / SQL editor는 본인 paradigm 의 autocomplete provider 만 등록.
- 다크 모드 + a11y 유지.

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
- AC별 vitest test 이름

## Test Requirements

### Unit Tests (필수)
- AC-01: MongoQueryEditor autocomplete test (MQL ops 포함, SQL 미포함)
- AC-02: QueryTab paradigm routing test
- AC-03: SqlQueryEditor dialect-keyword swap test (PG/MySQL/SQLite)
- AC-04: Redis paradigm placeholder test
- AC-05: paradigm 전환 시 cross-contamination 회귀 가드

### Coverage Target
- 신규/수정 파일 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: PG tab → SqlQueryEditor + PG keywords
- [ ] 에러/예외: 알 수 없는 paradigm → assertNever 또는 fallback
- [ ] 경계 조건: paradigm swap (rdb ↔ document) 시 stale extension 누출 없음
- [ ] 기존 기능 회귀 없음: query 실행, 결과 grid, 로그

## Test Script / Repro Script

1-7. 7개 verification command

## Ownership

- Generator: general-purpose agent
- Write scope: `src/components/query/`, `src/hooks/use*Autocomplete.ts`, `src/lib/sqlDialect*.ts`
- Merge order: S134 → S135 → S136 → S137 → S138 → **S139** → S140

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
