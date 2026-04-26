# Sprint Execution Brief: sprint-132

## Objective

Raw-query DB-change 감지 + 검증. 토큰 기반 lexer로 PG `\c`, `SET search_path`, MySQL `USE`, Redis `SELECT n` 매치. QueryTab.executeQuery 직후 hook → optimistic setActiveDb + paradigm 분기 store clear → 백엔드 cheap verify → 불일치 시 toast.warn + 보정. 주석/문자열 false positive 0.

## Task Why

S130/S131에서 toolbar의 DbSwitcher로 명시적 전환은 동작하지만, raw query 안에서 `\c another_db`를 실행하면 backend의 active_db는 바뀌나 frontend (사이드바, DB switcher trigger label)는 stale. 사용자가 manual switch 안 하면 트리/탭이 잘못된 DB의 schema를 보여준다.

## Scope Boundary

- 단축키 / 신규 e2e spec 금지 — S133.
- MySQL/SQLite/Redis adapter 구현 금지 — Phase 9.
- 새 trait method 추가 금지 — Tauri command가 직접 `execute_sql` 또는 `current_active_db` 호출.
- 사용자 UI badge 추가 금지 — toast로 충분.
- Multi-statement 모든 매치 추출 금지 — 마지막만.

## Invariants

- vitest + cargo test 회귀 0.
- e2e 정적 컴파일 회귀 0.
- 사용자 시야 회귀 0.
- false positive 0 (주석/문자열 안).
- aria-label 가이드 준수.
- credentials 재입력 없음.

## Done Criteria

1. `src/lib/sqlDialectMutations.ts` + `extractDbMutation(sql, dialect)` + 20+ 단위 테스트.
2. `src/lib/api/verifyActiveDb.ts` thin wrapper + 3+ 단위 테스트.
3. `QueryTab.tsx` executeQuery 직후 hook + paradigm 분기 + try/catch.
4. Tauri command `verify_active_db(connection_id)` 등록 + paradigm 분기 + dispatch tests.
5. `QueryTab.test.tsx`에 4+ 시나리오 (happy / mismatch / no-match / false positive).
6. 검증 명령 7종 그린.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm vitest run` — 1986+ 그린
  2. `pnpm tsc --noEmit` — 0
  3. `pnpm lint` — 0
  4. `pnpm contrast:check` — 0 새 위반
  5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 0 fail
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 0
  7. e2e 정적 컴파일 회귀 0
- Required evidence:
  - 각 AC에 file:line / test:line 매핑
  - extractDbMutation 핵심 로직 인용
  - QueryTab hook 추가 인용
  - verify_active_db dispatch 인용
  - false positive 0 단위 테스트 인용

## Evidence To Return

- Changed files + purpose 한 줄
- 7개 검증 명령 outcome
- AC-01..AC-10 매핑
- 가정 (e.g. "verify는 SELECT current_database() 1회 round-trip / Mongo는 메모리 accessor")
- 잔여 위험

## References

- Contract: `docs/sprints/sprint-132/contract.md`
- Master spec: `docs/sprints/sprint-125/spec.md` (S132 항목)
- 직전 sprint findings: `docs/sprints/sprint-131/findings.md`
- Relevant files:
  - `src/components/query/QueryTab.tsx` (`executeQuery` 호출 사이트, 라인 ~334, ~427)
  - `src/lib/sqlTokenize.ts` / `src/lib/sqlDialect.ts` (기존 lexer 인프라 — 참고)
  - `src/stores/connectionStore.ts` (`setActiveDb`)
  - `src/stores/schemaStore.ts` (`clearForConnection`)
  - `src/stores/documentStore.ts` (`clearConnection`)
  - `src-tauri/src/commands/meta.rs` (S130/S131 통합 command 파일)
  - `src-tauri/src/db/mongodb.rs` (`current_active_db` accessor)
  - `src-tauri/src/db/postgres.rs` (`execute_sql`로 `current_database()` 호출 가능)
  - `src/lib/api/switchActiveDb.ts` (참고 — 동일 thin wrapper 패턴)
