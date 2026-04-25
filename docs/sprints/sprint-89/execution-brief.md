# Sprint Execution Brief: sprint-89

## Objective

백엔드 PostgreSQL FK 수집 쿼리와 프론트 `parseFkReference` 의 문자열 포맷을 `"schema.table(column)"` 형태로 정렬하고, sprint-88 의 공유 fixture 로 양방향 검증해 영구히 분기하지 않게 한다. FK 아이콘이 호버 없이도 최소 가시 상태로 보이도록 발견성 개선.

## Task Why

P1 사용자 리포트(#FK-1). FK 참조 점프 기능의 뼈대(Rust 모델, PG 쿼리, TS 파서, 아이콘 렌더, 새 탭 생성) 가 전 구간 구현돼 있지만 백엔드/프론트 포맷 계약 drift 로 한 번도 작동하지 않은 사일런트 버그. sprint-88 fixture 인프라로 계약을 못박아 재발 차단.

## Scope Boundary

**쓰기 허용**:
- `src-tauri/src/db/postgres.rs` — FK 쿼리 + 순수 함수 추출
- `src/components/datagrid/DataGridTable.tsx` — `parseFkReference` export + FK 아이콘 가시성 클래스
- `src/components/datagrid/DataGridTable.parseFkReference.test.ts` — sprint-88 의 regression-first 테스트 갱신
- `src/components/datagrid/DataGridTable.fk-navigation.test.tsx` — 신규 통합 테스트
- `src-tauri/src/db/postgres.rs` `#[cfg(test)]` 모듈 또는 `src-tauri/tests/` — Rust round-trip 테스트

**쓰기 금지**:
- 모든 sprint-88 산출물 (fixture JSON, helper, catch-audit, rules 파일)
- MySQL/SQLite adapter
- `src/components/DataGrid.tsx` (네비게이션 핸들러)
- `CLAUDE.md`, `memory/`

## Invariants

- sprint-88 산출물의 schema/API 변경 금지 — 소비만.
- `CLAUDE.md`, `memory/` 수정 금지.
- 기존 `pnpm vitest run` (1625 tests) 와 `cargo test` 회귀 0.
- sprint-88 의 regression-first 테스트는 **갱신** (새 파일 작성/삭제 금지). `// TODO regression(sprint-89)` 주석 3곳 자연스럽게 회수.
- 신규 catch 블록은 빈 catch 금지 (sprint-88 규칙).

## Done Criteria

1. PostgreSQL adapter 가 `"<schema>.<table>(<column>)"` 포맷 생성. Rust 순수 함수로 추출 + 단위 테스트.
2. `parseFkReference` export. sprint-88 fixture 의 모든 sample 에 대해 양방향(직렬화→파싱→원본 복원) 일치를 양쪽 CI 에서 단언.
3. FK 컬럼 + non-null 셀에서 아이콘이 호버 없이도 최소 가시(`opacity-40` 이상). 호버 시 더 선명. 비-FK/NULL 셀에서는 미렌더.
4. FK 아이콘 클릭 시 `onNavigateToFk(schema, table, column, cellValue)` 인자가 통합 테스트에서 단언.
5. `// TODO regression(sprint-89)` 주석 3곳 회수 (`grep` 결과 0). 백엔드 + 프론트 동일 fixture 통과.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `cd src-tauri && cargo test`
  5. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  6. `grep -rn "TODO regression(sprint-89)" src/` → 0 라인
  7. `grep -n "export.*parseFkReference" src/components/datagrid/DataGridTable.tsx` → 1+ 라인
  8. Fixture round-trip 양쪽 통과
- Required evidence:
  - 변경 파일 + 목적
  - 위 8개 명령 출력 요약
  - Rust 함수 시그니처 + 단위 테스트 라인
  - FK 아이콘 클래스 변경 diff
  - 통합 테스트 경로 + mock 단언

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence (AC 별 라인 인용)
- Assumptions made during implementation
- Residual risk or verification gaps

## References

- Contract: `docs/sprints/sprint-89/contract.md`
- Spec: `docs/sprints/sprint-89/spec.md`
- Handoff from sprint-88: `docs/sprints/sprint-88/handoff.md`
- Sprint-88 fixture: `tests/fixtures/fk_reference_samples.json`
- Sprint-88 regression test: `src/components/datagrid/DataGridTable.parseFkReference.test.ts`
