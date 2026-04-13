# Sprint Contract: Sprint 45

## Summary

- Goal: 공통 유틸리티 & UI 프리미티브 추출
- Audience: Generator / Evaluator
- Owner: Harness Orchestrator
- Verification Profile: `command`

## In Scope

- `DB_TYPE_META`를 단일 위치(`src/lib/db-meta.ts`)에 정의하고 Sidebar, ConnectionItem에서 임포트 전환
- `truncateCell`을 단일 위치(`src/lib/format.ts`)에 정의하고 DataGrid, QueryResultGrid에서 임포트 전환
- 리사이즈 로직을 재사용 가능한 훅(`src/hooks/useResizablePanel.ts`)으로 추출하고 Sidebar, DataGrid, QueryTab에서 사용
- 기존 컴포넌트의 동작(시각, 인터랙션)이 변경되지 않음

## Out of Scope

- shadcn 프리미티브 적용 (Sprint 46-49)
- Dialog/Modal 통합 (Sprint 46)
- DataGrid/StructurePanel 분해 (Sprint 47-48)
- CSS 변수 전환

## Invariants

- 기존 테스트 전부 통과 (675+)
- `pnpm build` 성공
- `pnpm tsc --noEmit` 통과
- `pnpm lint` 에러 0건
- 기존 UI 시각적 변화 없음
- 기존 동작(리사이즈, DB 타입 표시, 셀 잘림)이 동일하게 동작

## Acceptance Criteria

- `AC-01`: `DB_TYPE_META`가 `src/lib/db-meta.ts`에 단일 정의되고 Sidebar.tsx와 ConnectionItem.tsx가 이를 임포트하여 사용. DB 타입 라벨 및 색상이 기존과 동일하게 표시됨
- `AC-02`: `truncateCell`이 `src/lib/format.ts`에 단일 정의되고 DataGrid.tsx와 QueryResultGrid.tsx가 이를 임포트하여 사용. 셀 잘림 동작이 기존과 동일함
- `AC-03`: 리사이즈 로직이 `src/hooks/useResizablePanel.ts` 훅으로 추출되고 Sidebar, DataGrid, QueryTab이 이를 사용. 드래그 리사이즈, 최소/최대 제약이 기존과 동일하게 동작함
- `AC-04`: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`, `pnpm lint` 모두 통과
- `AC-05`: 추출된 유틸리티/훅에 대한 단위 테스트가 존재함

## Design Bar

- `DB_TYPE_META`: Sidebar와 ConnectionItem에서 기존에 사용하던 속성(label, color, short)을 모두 포함하는 단일 타입
- `truncateCell`: DataGrid와 QueryResultGrid에서 기존에 사용하던 함수 시그니처와 동작을 유지
- `useResizablePanel`: Sidebar(가로), DataGrid(컬럼), QueryTab(가로)의 서로 다른 리사이즈 축/제약을 파라미터화

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 타입 체크 통과
2. `pnpm vitest run` — 전체 테스트 통과
3. `pnpm build` — 빌드 성공
4. `pnpm lint` — 린트 에러 0건
5. grep 확인: Sidebar와 ConnectionItem에 더 이상 로컬 DB_TYPE_META 정의가 없음
6. grep 확인: DataGrid와 QueryResultGrid에 더 이상 로컬 truncateCell 정의가 없음

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with evidence
  - 각 추출 모듈에 대한 테스트 결과
- Evaluator must cite:
  - concrete evidence for each pass/fail decision

## Test Requirements

### Unit Tests (필수)
- DB_TYPE_META 단위 테스트 (모든 DB 타입 포함 여부)
- truncateCell 단위 테스트 (긴 문자열, 짧은 문자열, null 등)
- useResizablePanel 훅 테스트 (마우스 이벤트 시뮬레이션)

### Scenario Tests (필수)
- [ ] Happy path: 임포트 전환 후 기존 동작 유지
- [ ] 기존 테스트 회귀 없음
- [ ] 빌드 성공

## Test Script / Repro Script

1. `pnpm tsc --noEmit`
2. `pnpm vitest run`
3. `pnpm build`
4. `pnpm lint`

## Ownership

- Generator: Agent
- Write scope: `src/lib/db-meta.ts`, `src/lib/format.ts`, `src/hooks/useResizablePanel.ts`, and modifications to Sidebar, ConnectionItem, DataGrid, QueryResultGrid, QueryTab
- Merge order: After Sprint 44

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
