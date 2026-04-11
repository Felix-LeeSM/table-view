# Sprint Contract: sprint-10

## Summary

- Goal: ConnectionGroup 컴포넌트 테스트 추가 (0% → 70%+)
- Audience: Generator, Evaluator
- Owner: Claude Code
- Verification Profile: `command`

## In Scope

- ConnectionGroup.tsx 접기/펼치기, 이름 변경, 컨텍스트 메뉴, 드래그앤드롭 테스트

## Out of Scope

- ConnectionItem 테스트 (Sprint 9 완료)
- ConnectionDialog 테스트
- ContextMenu 테스트 (이미 커버됨)
- 프로덕션 코드 수정

## Invariants

- 기존 282개 테스트 모두 통과
- 프로덕션 코드 변경 없음

## Acceptance Criteria

- AC-01: 그룹 헤더에 그룹 이름과 연결 수 표시
- AC-02: 클릭 시 접기/펼치기 토글 (ChevronRight ↔ ChevronDown)
- AC-03: 펼쳐진 상태에서 연결 목록 렌더링
- AC-04: 접힌 상태에서 연결 목록 숨김
- AC-05: 우클릭 시 컨텍스트 메뉴 표시 (Rename, Delete Group)
- AC-06: Rename 메뉴 클릭 시 인라인 이름 변경 입력
- AC-07: 이름 변경 Enter 제출 시 updateGroup 호출
- AC-08: 이름 변경 Escape 시 취소
- AC-09: 빈 이름이나 동일 이름은 updateGroup 호출 안 함
- AC-10: Delete Group 메뉴 클릭 시 removeGroup 호출
- AC-11: 드래그앤드롭으로 연결을 그룹으로 이동
- AC-12: ConnectionGroup.tsx 라인 커버리지 70%+

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm vitest run --coverage` — ConnectionGroup 70%+
3. `pnpm tsc --noEmit` — 타입 체크

## Test Requirements

### Unit Tests (필수)
- AC-01~AC-12 각각 대응 테스트

### Coverage Target
- ConnectionGroup.tsx: 70%+

## Ownership

- Generator: general-purpose
- Write scope: `src/components/ConnectionGroup.test.tsx`
- Merge order: 단일 커밋

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
