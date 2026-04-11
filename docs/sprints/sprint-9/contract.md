# Sprint Contract: sprint-9

## Summary

- Goal: ConnectionList + ConnectionItem 컴포넌트 테스트 추가 (0% → 70%+)
- Audience: Generator, Evaluator
- Owner: Claude Code
- Verification Profile: `command`

## In Scope

- ConnectionList.tsx 드래그앤드롭, 루트 연결 목록, 그룹 목록, 힌트 표시 테스트
- ConnectionItem.tsx 더블클릭 연결, 컨텍스트 메뉴, 드래그, 삭제 확인 테스트

## Out of Scope

- ConnectionGroup.tsx 테스트 (Sprint 10)
- ConnectionDialog.tsx 테스트
- ContextMenu.tsx 테스트 (이미 커버됨)
- connectionStore 자체 테스트 (이미 존재)
- 프로덕션 코드 수정

## Invariants

- 기존 234개 테스트 모두 통과
- 프로덕션 코드 변경 없음

## Acceptance Criteria

- AC-01: ConnectionList가 루트 연결(groupId===null)을 ConnectionItem으로 렌더링
- AC-02: ConnectionList가 그룹을 ConnectionGroup으로 렌더링
- AC-03: 연결 있고 그룹 없을 때 드래그 힌트 표시
- AC-04: ConnectionList 루트 드롭존에서 drop 시 moveConnectionToGroup(connId, null) 호출
- AC-05: ConnectionItem이 연결 이름과 DB 타입 배지(PG/MY/SQ/MG/RD) 렌더링
- AC-06: ConnectionItem 상태 표시 (connected=초록, error=빨강+툴팁, disconnected=회색)
- AC-07: ConnectionItem 더블클릭 시 connectToDatabase 호출
- AC-08: ConnectionItem 우클릭 시 컨텍스트 메뉴 표시
- AC-09: 컨텍스트 메뉴에서 Connect/Disconnect 토글
- AC-10: 컨텍스트 메뉴에서 Edit → ConnectionDialog 열기
- AC-11: 컨텍스트 메뉴에서 Delete → 삭제 확인 다이얼로그
- AC-12: 삭제 확인에서 Delete 클릭 시 removeConnection 호출
- AC-13: ConnectionItem 드래그 시작 시 draggedConnectionId 설정
- AC-14: ConnectionList.tsx + ConnectionItem.tsx 각각 70%+ 라인 커버리지

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm vitest run --coverage` — 각 파일 70%+, 전체 65%+
3. `pnpm tsc --noEmit` — 타입 체크 통과

## Test Requirements

### Unit Tests (필수)
- AC-01~AC-13 각각 대응 테스트

### Coverage Target
- ConnectionList.tsx: 70%+
- ConnectionItem.tsx: 70%+

### Scenario Tests (필수)
- [ ] Happy path: 연결 목록 렌더링 → 더블클릭 연결 → 컨텍스트 메뉴
- [ ] 에러: 연결 에러 상태 표시
- [ ] 경계 조건: 빈 연결, 드래그앤드롭, 그룹 없음
- [ ] 기존 기능 회귀 없음

## Ownership

- Generator: general-purpose
- Write scope: `src/components/ConnectionList.test.tsx`, `src/components/ConnectionItem.test.tsx`
- Merge order: 단일 커밋

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
