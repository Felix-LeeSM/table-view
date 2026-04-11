# Sprint Contract: sprint-0

## Summary

- Goal: 다중 컬럼 정렬 구현 (Phase 2 완료)
- Audience: Generator (제작자), Evaluator (평가자)
- Owner: Harness Orchestrator
- Verification Profile: `browser`

## In Scope

- DataGrid 단일 컬럼 정렬(`sort: { column, direction } | null`)을 다중 컬럼 정렬(`sorts: SortInfo[]`)로 변경
- 클릭 동작: 기존 정렬 초기화 후 해당 컬럼 ASC → DESC → none 사이클
- Shift+Click 동작: 정렬 목록에 컬럼 추가/토글/제거
- 헤더에 정렬 방향 화살표(↑/↓)와 순위 번호(1, 2, 3...) 표시
- `orderBy` 문자열을 콤마 분리 형태(`"col1 ASC, col2 DESC"`)로 직렬화하여 백엔드 전송
- Rust 백엔드 `query_table_data()`에서 콤마 분리 ORDER BY 파싱

## Out of Scope

- 단축키 변경 (없음)
- 새로운 Tauri 명령 추가 (기존 `query_table_data` 활용)
- 정렬 UI 커스터마이징 (화살표/번호 외 추가 요소 없음)
- 정렬 상태 저장/복원 (탭 전환 시 보존만)

## Invariants

- 기존 단일 컬럼 정렬 동작은 Click 시 그대로 유지되어야 함 (회귀 없음)
- 모든 테스트(DataGrid.test.tsx) 통과해야 함
- 정렬 변경 시 페이지가 1로 리셋되어야 함 (기존 동작 유지)
- 필터와 정렬이 동시에 적용되어야 함
- `pnpm test`와 `cargo test` 모두 통과해야 함

## Acceptance Criteria

- `AC-01`: Clicking a column header replaces all existing sorts with that column (cycles: ASC → DESC → none)
- `AC-02`: Shift+clicking a column header adds it to the sort list; if already present, toggles direction (ASC → DESC → removed); clicking with Shift on last sort removes it
- `AC-03`: Each sorted column header shows direction arrow (↑/↓) and rank number (1, 2, 3...) indicating sort priority
- `AC-04`: Backend parses comma-separated sort string `"col1 ASC, col2 DESC"` and applies ORDER BY clause with validated column names
- `AC-05`: Sort state persists across page changes and filter operations

## Design Bar / Quality Bar

- TypeScript strict mode 준수 (`any` 타입 금지)
- React 컴포넌트 규칙 준수 (PascalCase, props 인터페이스)
- Rust 클린 코드 (`cargo fmt`, `cargo clippy` 통과)
- 테스트 커버리지: 새로운 동작에 대한 테스트 추가

## Verification Plan

### Required Checks

1. `pnpm test` — 모든 프론트엔드 테스트 통과 (DataGrid.test.tsx 포함)
2. `cargo test` — 모든 백엔드 테스트 통과 (schema_integration.rs 포함)
3. `cargo fmt --check` — Rust 코드 포맷 검증
4. `cargo clippy --all-targets --all-features -- -D warnings` — Rust 린트 통과
5. `pnpm build` — 프론트엔드 빌드 성공

### Required Evidence

- Generator must provide:
  - 변경된 파일 목록과 변경 목적
  - 실행한 테스트 명령어와 결과
  - 각 AC를 만족한다는 구체적 증거 (스크린샷, 테스트 로그 등)
- Evaluator must cite:
  - 각 pass/fail 결정에 대한 구체적 증거
  - 누락되거나 부족한 증거에 대한 finding

## Test Script / Repro Script

1. 앱 실행: `cargo tauri dev`
2. 연결된 DB에서 테이블 선택
3. 컬럼 헤더 클릭 → 정렬 화살표만 표시 (단일 정렬)
4. 같은 컬럼 재클릭 → 화살표 방향 전환 (ASC → DESC)
5. 다시 클릭 → 정렬 해제
6. 첫 번째 컬럼 클릭 후 Shift+Click으로 두 번째 컬럼 추가 → 두 헤더에 화살표와 순위 번호(1, 2) 표시
7. Shift+Click으로 순서 변경 (마지막 컬럼 → 제거, 중간 컬럼 → 방향 토글)
8. 페이지 전환/필터 적용 후 정렬 상태 유지 확인
9. "Executed query" 패널에서 ORDER BY 절 확인 (`"col1 ASC, col2 DESC"`)

## Ownership

- Generator: Sprint 0 구현 전담
- Write scope:
  - `src/types/schema.ts` (SortInfo 타입 추가)
  - `src/components/DataGrid.tsx` (정렬 상태, 핸들러, 렌더링)
  - `src/components/DataGrid.test.tsx` (테스트 추가)
  - `src-tauri/src/db/postgres.rs` (ORDER BY 파싱)
  - `src-tauri/tests/schema_integration.rs` (통합 테스트)
- Merge order: 없음 (단일 Sprint)

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
