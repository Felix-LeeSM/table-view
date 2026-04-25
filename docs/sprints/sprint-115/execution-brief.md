# Sprint Execution Brief: sprint-115

## Objective
SchemaTree 의 펼쳐진 가시 노드 평탄 리스트를 만들어 길이가 200 초과 시 `@tanstack/react-virtual` 로 가상화. 그 이하면 기존 nested render 유지 (회귀 0).

## Task Why
DBMS 가 1000+ 테이블을 가지면 모든 행을 DOM 에 그리는 게 비싸서 트리 펼침/스크롤 jank. 가상화로 viewport 외 행 미렌더.

## Scope Boundary
- **건드리지 말 것**:
  - F2 rename / 키보드 / 검색 / context menu 의 동작 자체.
  - SchemaTree 의 외부 prop API.
- **반드시 보존**:
  - sprint-107 F2 rename Dialog flow.
  - 기존 100 테스트의 fixture 크기 (가상화 미발동 path 보장).
  - aria-expanded / aria-label.

## Invariants
- 가시 노드 ≤ 200: 기존 nested JSX. 모든 fixture 가 DOM.
- 가시 노드 > 200: 평탄 리스트 + virtualizer. spacer `<div aria-hidden="true">` 로 높이 보존.
- F2 rename 은 평탄 리스트의 item 행에서 사용 가능.

## Done Criteria
1. SchemaTree.tsx 평탄화 + threshold-based 가상화 경로.
2. 신규 SchemaTree.virtualization.test.tsx (1000 테이블 / DOM 캡 / 펼침-접힘 / F2).
3. 1822 baseline + 신규 테스트 통과.
4. tsc/lint 0.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - 변경 파일 + 목적
  - 새 helper / 평탄화 함수 시그니처
  - 가상화 path 발동 단언 (DOM 행 수)
  - F2 rename 동작 확인

## Evidence To Return
- 변경 파일 + 목적
- 명령어 결과 (vitest 통과 수, tsc/lint 0)
- AC-01..07 단언
- 가정/리스크
