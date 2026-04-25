# Sprint 103 Execution Brief

## Objective
글로벌 단축키 cheatsheet 모달을 추가한다. `?` 또는 Cmd+/ 로 열리고, 검색 가능, 그룹별 표시.

## Why
사용자가 모든 단축키를 한눈에 발견할 수 있어야 한다 (UI evaluation P1 #8).

## Scope Boundary
- 신규 `src/components/shared/ShortcutCheatsheet.tsx`.
- `src/App.tsx` 핸들러 + 마운트.
- 테스트.

## Invariants
- 기존 단축키 동작 변경 금지.
- Layer-2 dialog preset 사용 (sprint-96 PreviewDialog 또는 TabsDialog).

## Done Criteria
1. `?` (input 가드 통과) → 모달 open.
2. Cmd+/ → 모달 open.
3. INPUT/TEXTAREA/SELECT/contenteditable focus 시 `?` 무시.
4. 단축키 그룹 라벨 + 검색 input + empty state.
5. `pnpm vitest run` / `tsc --noEmit` / `lint` 0.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - 변경 파일 목록 + 각 파일의 변경 라인 요약.
  - 신규 테스트 케이스 목록.
  - 1749 → ?건 통과 수.

## Evidence To Return
- Changed files with purpose.
- Test counts before/after.
- AC 매핑 (AC-01..07).
- 위험/가정/미해결 갭.
