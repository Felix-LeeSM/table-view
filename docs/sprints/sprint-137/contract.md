# Sprint Contract: sprint-137

## Summary

- Goal: Mongo에서 toolbar로 DB를 swap해도 sidebar collection list가 default DB를 고집하는 stale 버그를 잡고, PG sidebar의 row-count 숫자가 estimate인지 exact인지 사용자가 알 수 있도록 라벨/툴팁을 명확히 한다 (또는 우클릭 → exact COUNT(*) 액션 제공).
- Audience: Phase 10 사용자 점검 #10 (Mongo stale) + #12 (PG row count 의미).
- Owner: Generator (general-purpose)
- Verification Profile: `mixed`

## In Scope

- MODIFY `src-tauri/src/db/mongodb.rs` — `list_collections`가 stored default db가 아닌 `use_db`로 설정한 active db의 collections를 반환하도록 수정. cargo test 동반.
- MODIFY `src-tauri/src/commands/document/` 관련 command (메타 fetch 진입점) — active db propagation 확인.
- MODIFY `src/components/schema/DocumentDatabaseTree.tsx` (+ test) — DB 변경 시 fetch 트리거 (effect deps에 active db 추가, 이전 캐시 invalidate).
- MODIFY `src/components/schema/SchemaTree.tsx` (+ test) — PG row count cell에 (a) `aria-label`/tooltip "Estimated row count (pg_class.reltuples)" 추가 OR (b) 우클릭 컨텍스트 메뉴 → "Show exact COUNT(*)" 액션. 둘 중 하나 구현.
- (b) 옵션 시: CREATE `src-tauri/src/commands/rdb/exact_row_count.rs` (또는 기존 query.rs에 핸들러) — `SELECT COUNT(*) FROM <safely_quoted_table>` 실행. 거대 테이블 confirm dialog.
- 신규 vitest + cargo test 동반.

## Out of Scope

- 그 외 sidebar / toolbar 동작 (S134~S136 완료)
- DBMS-aware connection form (S138)
- Paradigm-aware query editor (S139)
- 암호화 export/import (S140)
- Mongo collection 스키마 sampling 변경
- PG view/function row count

## Invariants

- Sprint 132 raw-query DB-change 감지 미파손
- DBMS shape (S135) — PG 3-레벨, MySQL 2-레벨, SQLite 1-레벨 유지
- Preview/persist semantics (S136) 유지
- DisconnectButton (S134) 동작 유지
- 백엔드 connection_test command 변경 없음
- DocumentDatabaseTree 의 기존 단방향 데이터 흐름 (database list → 선택 → collection fetch) 보존

## Acceptance Criteria

- `AC-S137-01` `src-tauri/src/db/mongodb.rs::list_collections`가 `use_db("alpha")` 후 alpha의 컬렉션을 반환 — 신규 cargo test가 어서션. 현재 stale 원인(코드 라인)을 handoff에 명시.
- `AC-S137-02` 프런트: `DbSwitcher`에서 Mongo DB swap 발생 시 `DocumentDatabaseTree`가 새 DB의 collections를 즉시 fetch (이전 캐시 invalidate). 신규 vitest test (모킹된 invoke).
- `AC-S137-03` PG sidebar table row count 숫자에 (a) `aria-label`/tooltip "Estimated row count (pg_class.reltuples)" 포함 OR (b) 우클릭 → "Show exact COUNT(*)" 액션 + 결과 inline 표시 — 둘 중 하나가 구현. 사용자가 숫자 의미를 알 수 있어야 함.
- `AC-S137-04` (옵션 b 선택 시) 거대 테이블 가드: 우클릭 exact count 실행 시 confirm dialog "This may be slow on large tables — continue?" 노출. 옵션 (a) 만 선택 시 N/A로 명시.
- `AC-S137-05` 회귀 가드: PG sidebar 트리 expand/collapse, S132 raw-query DB-change 감지 미파손.
- `AC-S137-06` 6 게이트 + cargo test + e2e static lint 그린.

## Design Bar / Quality Bar

- Rust: SQL injection 방지 — `exact_row_count` 구현 시 식별자(table/schema)는 `quote_ident` 또는 화이트리스트 검증.
- 다크 모드 + a11y (aria-label/role) 유지.
- 신규 test는 사용자 관점 query.

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

- 변경 파일 목록
- 7개 verification command 출력
- AC별 vitest/cargo test 이름

## Test Requirements

### Unit Tests (필수)
- AC-01: cargo test `mongodb::tests::list_collections_uses_active_db` (또는 동등)
- AC-02: vitest DocumentDatabaseTree DB swap test
- AC-03: vitest SchemaTree row count tooltip OR context menu test
- AC-04: 옵션 b 선택 시 confirm dialog test

### Coverage Target
- 신규/수정 파일 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: Mongo use_db → list_collections returns new db's collections
- [ ] 에러/예외: PG exact count 거대 테이블 confirm reject
- [ ] 경계 조건: stale 캐시 invalidate
- [ ] 기존 기능 회귀 없음: PG expand/collapse, S132 raw-query DB-change

## Test Script / Repro Script

1-7. 7개 verification command

## Ownership

- Generator: general-purpose agent
- Write scope: `src-tauri/src/db/mongodb.rs`, `src-tauri/src/commands/`, `src/components/schema/`, `src/types/`(필요 시)
- Merge order: S134 → S135 → S136 → **S137** → S138 → S139 → S140

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
