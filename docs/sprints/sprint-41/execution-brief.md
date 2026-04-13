# Sprint Execution Brief: sprint-41

## Objective

- 쿼리 에디터의 3가지 핵심 버그를 수정: (1) null row 표시, (2) Cmd+Enter 미동작, (3) Tab 자동완성 미동작

## Task Why

- 사용자가 쿼리 에디터를 사용할 때 가장 기본적인 동작(실행, 자동완성)이 정상 동작해야 함

## Scope Boundary

- QueryEditor.tsx, QueryTab.tsx, QueryResultGrid.tsx만 수정
- SchemaTree, DataGrid, TabBar, tabStore 등은 수정하지 않음
- Rust 백엔드는 필요한 경우만 최소 수정

## Invariants

- 기존 CodeMirror 기능 유지 (구문 하이라이팅, 들여쓰기, 괄호 매칭)
- 자동완성 팝업 비활성 시 Tab = 들여쓰기
- 일반 Enter = 줄바꿈
- 기존 테스트 모두 통과

## Done Criteria

1. 빈/whitespace-only 쿼리 실행 시 null row 미표시, 실행 차단
2. Cmd+Enter → 줄바꿈 없이 쿼리 실행
3. Tab(자동완성 활성 시) → 자동완성 수락, 들여쓰기 없음

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run` — 전체 테스트 통과
  2. `pnpm tsc --noEmit` — 타입 체크 통과
  3. `pnpm lint` — 린트 에러 0건
- Required evidence:
  - 변경된 파일 목록과 목적
  - 테스트 실행 결과
  - 각 AC에 대한 증거

## Evidence To Return

- Changed files with purpose
- Commands/checks run and outcomes
- Acceptance criteria coverage with evidence
- Assumptions, risks, unresolved gaps

## References

- Contract: `docs/sprints/sprint-41/contract.md`
- Spec: `docs/sprints/sprint-41/spec.md`
- Relevant files:
  - `src/components/QueryEditor.tsx` — CodeMirror 설정, keymap
  - `src/components/QueryTab.tsx` — 쿼리 실행 핸들러
  - `src/components/QueryResultGrid.tsx` — 결과 표시
  - `src-tauri/src/db/postgres.rs` — execute_query (null row 원인 가능)
