# Sprint Contract: sprint-163

## Summary

- Goal: Group 내 connection에 nested indent 시각 추가 + group collapse 상태 persistence
- Verification Profile: `command`

## In Scope

- ConnectionItem에 group 소속 시 indent(padding-left) 추가
- ConnectionGroup collapse 상태를 localStorage에 persist
- indent/collapse 동작 단위 테스트

## Out of Scope

- Drop indicator 보강 (Sprint 164)
- Keyboard DnD (Sprint 164)
- 다중 선택 (Sprint 164)

## Invariants

- 기존 DnD 동작 불변
- 기존 context menu 동작 불변
- ConnectionList 렌더링 회귀 없음

## Acceptance Criteria

- `AC-163-01`: Group 소속 ConnectionItem의 padding-left가 16px(또는 pl-6 등) 증가. ungrouped는 기존 유지.
- `AC-163-02`: Group collapse 상태가 localStorage에 persist. App 재시작 후에도 보존.
- `AC-163-03`: Collapse 상태 변경 시 localStorage 즉시 갱신.

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — ESLint 에러 0건
