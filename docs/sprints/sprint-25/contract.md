# Sprint Contract: Sprint 25

## Summary

- Goal: QueryTab에 Run/Cancel 툴바 버튼 + 단축키 안내 추가
- Owner: Orchestrator
- Verification Profile: `mixed`

## In Scope

- QueryTab 상단에 툴바 영역 추가
- idle/error/completed 상태에서 ▶ Run 버튼 표시
- running 상태에서 ■ Cancel 버튼으로 전환
- "Cmd+Return" 단축키 안내 텍스트 표시
- 테스트 코드 작성 (TDD)

## Out of Scope

- 페이지네이션 개선 (Sprint 26)
- 미리보기 탭 (Sprint 29)

## Invariants

- 480 프론트엔드 테스트 + 145 Rust 테스트 통과
- 기존 QueryTab/QueryEditor 동작 유지

## Acceptance Criteria

- `AC-01`: QueryTab에 툴바가 표시됨 (Run 버튼 포함)
- `AC-02`: idle 상태에서 ▶ Run 버튼이 활성화됨
- `AC-03`: running 상태에서 ■ Cancel 버튼으로 전환됨
- `AC-04`: "Cmd+Return" 단축키 안내 텍스트가 표시됨
- `AC-05`: 빈 SQL에서 Run 버튼이 비활성화됨

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크
3. `pnpm lint` — 린트
