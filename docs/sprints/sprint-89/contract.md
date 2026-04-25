# Sprint Contract: sprint-89

## Summary

- Goal: 백엔드 PostgreSQL FK 수집 쿼리와 프론트 `parseFkReference` 의 문자열 포맷을 `"schema.table(column)"` 형태로 정렬하고, sprint-88 fixture 로 양방향 검증해 영구히 분기하지 않게 한다. FK 아이콘 가시성 개선.
- Audience: Generator + Evaluator
- Owner: Generator
- Verification Profile: `mixed` (command + RTL DOM 단언; Playwright 불필요)

## In Scope

- `src-tauri/src/db/postgres.rs` 의 FK 수집 쿼리 포맷 변경 + 순수 함수 추출.
- `src/components/datagrid/DataGridTable.tsx` 의 `parseFkReference` export + FK 아이콘 가시성 클래스 완화.
- `src/components/datagrid/DataGridTable.parseFkReference.test.ts` 갱신 (sprint-88 inline regex 복제 제거 + import + 단언 뒤집기).
- `src/components/datagrid/DataGridTable.fk-navigation.test.tsx` 신규 통합 테스트.
- `src-tauri/tests/` 또는 `postgres.rs` `#[cfg(test)]` 모듈에 fixture 기반 round-trip 테스트.

## Out of Scope

- MySQL / SQLite FK 수집 쿼리 정렬 (별도 sprint).
- `src/components/DataGrid.tsx` 의 `handleNavigateToFk` 본문 수정 (호출 시그니처 그대로 사용).
- FK 아이콘 디자인 변경 (색/크기/모양). 가시성 opacity 만.

## Invariants

- sprint-88 산출물의 schema/API 변경 금지 — 소비만:
  - `tests/fixtures/fk_reference_samples.json` ($schema, samples 형식 유지)
  - `src/__tests__/utils/expectNodeStable.ts` API
  - `.claude/rules/test-scenarios.md` 규칙
  - `docs/sprints/sprint-88/catch-audit.md`
- `CLAUDE.md`, `memory/` 수정 금지.
- 기존 `pnpm vitest run` (1625 tests) 와 `cargo test` 회귀 0.
- `DataGridTable.parseFkReference.test.ts` 는 sprint-88 의 regression-first 구조를 **갱신** (delete & rewrite 금지) — `// TODO regression(sprint-89)` 주석 3곳을 자연스럽게 회수.
- 신규 catch 블록은 `.claude/rules/test-scenarios.md` 규칙 준수 (빈 catch 금지).

## Acceptance Criteria

- `AC-01` PostgreSQL adapter 가 FK 참조를 `"<schema>.<table>(<column>)"` 형태로 생성한다. 직렬화 로직은 SQL 인라인이 아닌 Rust 순수 함수 (`format_fk_reference` 등) 로 추출돼 단위 테스트 가능.
- `AC-02` `parseFkReference` 가 `src/components/datagrid/DataGridTable.tsx` 에서 export 되고, sprint-88 fixture 의 모든 sample 에 대해 양방향(직렬화→파싱→원본 복원) 일치를 양쪽 CI 에서 단언.
- `AC-03` FK 컬럼 + non-null 셀에서 링크 아이콘이 호버 없이도 최소 가시 (`opacity-40` 이상 또는 동등). 호버 시 더 선명. 비-FK 컬럼 또는 NULL 셀에서는 아이콘 미렌더.
- `AC-04` FK 아이콘 클릭 시 `onNavigateToFk(schema, table, column, cellValue)` 인자가 정확히 전달됨이 통합 테스트로 단언.
- `AC-05` sprint-88 의 "현재 포맷은 null 반환" 회귀 증명 테스트가 새 단언으로 갱신되며, `// TODO regression(sprint-89)` 주석 3곳이 모두 회수된다 (`grep` 결과 0). 백엔드 포맷 함수와 프론트 파서가 동일 fixture 를 통과.

## Design Bar / Quality Bar

- Rust 순수 함수는 escape 정책을 명시하거나 입력 가정 (식별자에 점/괄호 미포함) 을 docstring 에 기록.
- TS 파서는 fixture 의 모든 happy-path sample 에 대해 round-trip 일치. 실패 케이스(잘못된 입력) 도 1개 이상 단위 테스트.
- 통합 테스트는 RTL `render` + `userEvent.click` 으로 FK 아이콘 클릭 → mock `onNavigateToFk` 인자 단언.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 0 failures.
2. `pnpm tsc --noEmit` — exit 0.
3. `pnpm lint` — exit 0.
4. `cd src-tauri && cargo test` — 0 failures (fixture round-trip 포함).
5. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — 0 warnings.
6. `grep -rn "TODO regression(sprint-89)" src/` — 결과 0 라인.
7. `grep -n "export function parseFkReference\|export { parseFkReference\|export const parseFkReference" src/components/datagrid/DataGridTable.tsx` — 1 라인 이상.
8. Fixture round-trip 양쪽 통과:
   - TS: `parseFkReference(sample.expected)` → `{schema, table, column}` 원본 복원.
   - Rust: `format_fk_reference(sample.schema, sample.table, sample.column)` → `sample.expected`.

### Required Evidence

- Generator must provide:
  - Changed files (production + test) 와 목적
  - 위 8개 check 의 출력 요약 (pass/fail + 핵심 라인)
  - Rust 순수 함수의 시그니처 + 단위 테스트 라인 번호
  - FK 아이콘 opacity 클래스 변경의 before/after diff
  - 통합 테스트 경로 + mock 단언 라인
- Evaluator must cite:
  - 각 AC 별 실제 파일 라인 인용
  - fixture round-trip 두 방향 모두 통과 증거
  - sprint-88 invariant (handoff 인계 산출물) 회귀 없음

## Test Requirements

### Unit Tests (필수)
- AC-01: Rust `format_fk_reference` 단위 테스트 ≥ 3 (fixture sample 소비).
- AC-02: TS `parseFkReference` 단위 테스트 ≥ 3 + 잘못된 입력 1.
- AC-03/04: RTL 통합 테스트 (FK 셀 렌더 + 클릭).

### Coverage Target
- 신규 코드 라인 70% 이상.

### Scenario Tests (필수)
- [x] Happy path: 표준 schema.table(column) 입력
- [x] 에러/예외: 잘못된 입력 → null 반환
- [x] 경계 조건: NULL 셀에서 아이콘 미렌더
- [x] 회귀 없음: sprint-88 산출물 + 기존 1625 tests 통과

## Test Script / Repro Script

1. Sprint-89 변경 후 위 8개 Required Check 명령을 순서대로 실행.
2. 모두 0 errors/0 warnings.
3. 통합 테스트가 mock 인자 검증을 통과.

## Ownership

- Generator: 단일 agent, 단일 attempt 우선.
- Write scope: contract In Scope 의 파일만.
- Merge order: sprint-89 자체 단일 PR.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `findings.md`
