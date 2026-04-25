# Sprint 104 Execution Brief

## Objective
모든 글로벌 단축키에 INPUT/TEXTAREA/SELECT/contenteditable 가드를 일괄 적용. 가드는 공통 헬퍼로 단일화.

## Why
사용자가 입력 필드에서 타이핑 중 Cmd+W/T/I 등이 발화해 입력 흐름을 끊는 문제 (UI evaluation #KEY-1).

## Scope Boundary
- 신규 헬퍼 `src/lib/keyboard/isEditableTarget.ts`.
- `src/App.tsx` 모든 shortcut useEffect 갱신.
- `src/components/shared/ShortcutCheatsheet.tsx` inline 가드를 헬퍼로 교체.
- 헬퍼 단위 테스트.

## Invariants
- 기존 단축키 동작 유지 (input focus 외 상황에서 회귀 0).
- 1757 통과 유지.

## Done Criteria
1. INPUT/TEXTAREA/SELECT/contenteditable focus 시 모든 글로벌 단축키 미발화.
2. body focus 시 모든 단축키 정상 발화.
3. 헬퍼 단위 테스트 통과.
4. `pnpm vitest run` / `tsc` / `lint` 0.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - 변경 파일 + 변경 라인 요약.
  - 헬퍼 테스트 케이스.
  - 1757 → ?건 통과.

## Evidence To Return
- AC 매핑.
- 위험/가정/미해결 갭.
