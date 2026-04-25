# Sprint 108 Execution Brief

## Objective
ConnectionDialog DB type 변경 시 사용자 정의 port 가드 추가. ConfirmDialog 로 덮어쓰기 확인.

## Why
사용자가 의도치 않게 입력한 port 를 잃어버리는 사고 방지 (UI evaluation #CONN-DIALOG-2).

## Scope Boundary
- `src/components/connection/ConnectionDialog.tsx` 만 변경.
- 테스트.

## Invariants
- 1787 통과 유지.
- ConfirmDialog preset (sprint-95) 사용.
- paradigm 갱신 동기화.

## Done Criteria
1. 기본/빈/0 port 시 자동 갱신.
2. 커스텀 port 시 ConfirmDialog 표시.
3. Confirm "Use default port" → port 갱신.
4. Cancel "Keep port" → port 유지.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`

## Evidence To Return
- 변경 라인.
- 신규 테스트 케이스.
- 1787 → ?건 통과.
- AC-01..06 매핑.
