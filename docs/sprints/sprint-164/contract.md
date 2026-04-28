# Sprint Contract: sprint-164

## Summary

- Goal: Drop indicator 시각 보강 + 키보드 DnD 접근성 + Phase 15 closure
- Verification Profile: `command`

## In Scope

- ConnectionGroup.tsx drop indicator에 "Drop here" 텍스트 개선 (기존 outline + bg만 있음)
- ConnectionItem에 drag handle 시각 단서 추가 (grip dots 아이콘)
- ConnectionList root drop zone 시각 보강
- keyboard focus 시 connection row가 drag 가능함을 나타내는 시각적 표시
- Phase 15 exit gate 검증

## Out of Scope

- 다중 선택 DnD (P2, Phase 15 spec에서도 P2)
- @dnd-kit 도입 (기존 HTML5 DnD가 기능적)

## Invariants

- 기존 DnD 동작 불변
- 기존 indent/collapse 동작 불변

## Acceptance Criteria

- `AC-164-01`: ConnectionItem에 drag handle 아이콘(GripVertical)이 visible. inGroup이면 handle이 indent 안쪽에 위치.
- `AC-164-02`: Drop target(group row)에 drag-over 시 "Move to [group name]" hint 텍스트 표시.
- `AC-164-03`: ConnectionList root drop zone에 drag-over 시 "Remove from group" hint 텍스트 표시.
- `AC-164-04`: Keyboard focus 시 connection row에 ring 스타일로 focus-visible 표시.
- `AC-164-05`: Phase 15 exit gate — skip-zero, AC-15-01~08 주요 항목 잠금.

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — ESLint 에러 0건
