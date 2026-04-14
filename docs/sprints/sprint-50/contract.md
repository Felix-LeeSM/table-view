# Sprint Contract: Sprint 50

## Summary

- Goal: DataGrid의 단일 행 선택을 다중 행 선택(Set 기반)으로 확장
- Audience: Generator, Evaluator
- Owner: harness
- Verification Profile: `command`

## In Scope

- `useDataGridEdit`의 `selectedRowIdx: number | null` → `selectedRowIds: Set<number>` 마이그레이션
- anchor row 개념 도입 (Shift+Click 범위 선택의 시작점)
- 일반 클릭: 단일 선택 (기존 동작)
- Cmd/Ctrl+Click: 개별 행 토글 (추가/해제)
- Shift+Click: anchor row부터 현재 행까지 범위 선택
- 다중 선택 시각적 하이라이트
- Delete Row 버튼이 다중 선택 행을 일괄 삭제하도록 업데이트
- 기존 단일 행 선택에 의존하는 모든 기능(인라인 편집, 행 추가 등)이 다중 선택과 호환되도록 수정

## Out of Scope

- 행 우클릭 컨텍스트 메뉴 (Sprint 51)
- Copy as 포맷 (Sprint 51)
- Duplicate Row (Sprint 52)
- Column drag reorder (Sprint 52)
- BLOB viewer (Sprint 53)
- SQL Uglify / Format selection (Sprint 53)
- Schema tree visuals (Sprint 54)

## Invariants

- `pnpm test` 기존 707개 테스트 모두 통과
- `pnpm tsc --noEmit` 타입 에러 0건
- `pnpm lint` ESLint 에러 0건
- `pnpm build` 성공
- 기존 단일 행 클릭 동작 유지 (클릭 → 해당 행만 선택)
- 기존 인라인 편집 워크플로우 유지 (더블클릭 → 편집 모드)
- 다크/라이트 테마 모두 정상 동작
- Rust 백엔드 변경 없음
- shadcn/ui 토큰 기반 스타일 유지

## Acceptance Criteria

- `AC-01`: 일반 클릭 시 해당 행만 선택된다 (기존 동작 유지)
- `AC-02`: Cmd/Ctrl 키를 누른 상태에서 클릭하면 해당 행이 선택 토글된다 (이미 선택됨 → 해제, 미선택 → 추가)
- `AC-03`: Shift 키를 누른 상태에서 클릭하면 마지막으로 단일 클릭한 행(anchor)부터 현재 클릭한 행까지 범위 선택된다
- `AC-04`: 선택된 모든 행에 시각적 하이라이트 배경색이 적용된다 (기존 단일 선택 색상과 동일)
- `AC-05`: Delete Row 버튼이 다중 선택된 모든 행을 일괄 삭제 대상으로 처리한다 (pendingDeletedRowKeys에 모두 추가)
- `AC-06`: 페이지 전환 시 선택 상태가 초기화된다
- `AC-07`: anchor row가 없는 초기 상태에서 Shift+Click 시 일반 클릭으로 동작한다
- `AC-08`: 단위 테스트가 새 선택 로직(일반 클릭, Cmd+Click, Shift+Click, 범위 선택, 일괄 삭제)을 커버한다

## Design Bar / Quality Bar

- 선택 상태 타입 변경 시 모든 의존 컴포넌트가 올바르게 업데이트됨
- Set<number> 기반으로 선택 상태 관리
- 기존 selectedRowIdx 참조를 모두 selectedRowIds로 마이그레이션

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 타입 체크 통과
2. `pnpm vitest run` — 전체 테스트 통과 (기존 + 신규)
3. `pnpm lint` — ESLint 에러 0건
4. `pnpm build` — 빌드 성공

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence
- Evaluator must cite:
  - concrete evidence for each pass/fail decision
  - any missing or weak evidence as a finding

## Test Requirements

### Unit Tests (필수)
- useDataGridEdit: 일반 클릭 → 단일 선택
- useDataGridEdit: Cmd+Click → 개별 토글
- useDataGridEdit: Shift+Click → 범위 선택
- useDataGridEdit: Shift+Click without anchor → 일반 클릭 fallback
- useDataGridEdit: 다중 선택 상태에서 Delete Row → 모든 선택 행 삭제 대상
- DataGridTable: 선택된 행에 하이라이트 클래스 적용
- DataGridToolbar: 다중 선택 시 Delete 버튼 활성화 상태

### Coverage Target
- 신규/수정 코드: 라인 70% 이상 권장

### Scenario Tests (필수)
- [x] Happy path: 클릭 → 단일 선택 → Cmd+Click → 다중 선택 → Delete → 일괄 삭제
- [x] 에러/예외: 빈 데이터(0행)에서 클릭, 마지막 행 이후 Shift+Click
- [x] 경계 조건: 전체 행 선택(Cmd+Click 모든 행), 페이지 전환 시 선택 초기화
- [x] 기존 기능 회귀 없음: 인라인 편집, 정렬, 필터 동일 동작

## Test Script / Repro Script

1. `pnpm vitest run src/components/datagrid/` — DataGrid 관련 테스트
2. `pnpm tsc --noEmit` — 타입 체크
3. `pnpm lint` — 린트 검사
4. `pnpm build` — 빌드

## Ownership

- Generator: harness-generator
- Write scope: src/components/datagrid/*, src/components/DataGrid.tsx
- Merge order: 타입 변경 → 훅 변경 → 테이블 컴포넌트 → 툴바 → DataGrid 본체

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in handoff.md
