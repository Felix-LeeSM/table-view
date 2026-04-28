# Sprint Contract: sprint-167

## Summary

- Goal: launcher에 Recent Connections 섹션 렌더링 + MRU 항목 더블클릭 시 activation
- Verification Profile: `command`

## In Scope

- RecentConnections 컴포넌트 생성 (launcher에 마운트)
- 각 항목에 connection 이름 + paradigm 아이콘 + 상대 시간("5분 전") 표시
- MRU 항목 더블클릭 → connection activation (handleActivate)
- 빈 상태 hint ("아직 사용한 연결이 없습니다")
- 최대 5개 표시

## Out of Scope

- E2E (Sprint 169)
- mruStore 추가 수정

## Invariants

- 기존 connectionStore 동작 불변
- 기존 MainArea 동작 불변

## Acceptance Criteria

- `AC-167-01`: Recent Connections 섹션이 launcher에 렌더링됨. 항목이 없으면 hint 표시.
- `AC-167-02`: 각 항목에 connection 이름 + DB type 뱃지 + 상대 시간 표시.
- `AC-167-03`: MRU 항목 더블클릭 시 onActivate(connId) 호출 → workspace 활성화.
- `AC-167-04`: 최대 5개까지만 표시.

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — ESLint 에러 0건
