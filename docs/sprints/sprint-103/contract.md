# Sprint Contract: sprint-103

## Summary
- Goal: `?` 또는 Cmd+/ 입력 시 단축키 cheatsheet 모달이 열려 모든 단축키를 그룹별로 표시하고, 텍스트 검색을 지원한다. INPUT/TEXTAREA/SELECT/contenteditable 포커스 상태에서는 `?` 가 발화하지 않는다.
- Profile: `command`

## In Scope
- 신규 `src/components/shared/ShortcutCheatsheet.tsx`:
  - sprint-96 `PreviewDialog` (선호) 또는 `TabsDialog` 사용.
  - 단축키 그룹: Tabs (Cmd+W/Cmd+T/Cmd+Shift+T), Editing (Cmd+S/Cmd+I/Cmd+Shift+I), Navigation (Cmd+P/Cmd+R/F5), Panels (Cmd+,/Cmd+Shift+F/Cmd+Shift+C), Misc (`?`, Cmd+./Cmd+N).
  - 검색 input — 모든 단축키 라벨/키 라벨에 case-insensitive 부분일치 필터.
  - 검색 결과 0건 일 때 "No shortcuts match" empty state.
- `src/App.tsx`: `?` / Cmd+/ 핸들러 useEffect.
  - `?` 키 (Shift+/) 는 INPUT/TEXTAREA/SELECT/contenteditable 포커스 시 무시.
  - Cmd+/ 는 입력 필드 가드 적용 안 함 (modifier 조합이므로 텍스트 입력과 충돌 없음).
  - 모달은 컴포넌트 내부에서 `Esc` / 외부 클릭으로 닫힘 (Layer 1 dialog primitive 기본).
- 테스트:
  - `src/components/shared/__tests__/ShortcutCheatsheet.test.tsx` (필터링/그룹/empty state).
  - `src/App.test.tsx` 신규 또는 기존 — `?` 가드 + Cmd+/ 활성 케이스.

## Out of Scope
- 단축키 사용자 정의 (re-bind UI).
- macOS-vs-Windows 키 표기 분기 (`Cmd` ↔ `Ctrl`) — 현재 lib 패턴 따라 그대로 표기.
- 새 단축키 추가.

## Invariants
- 회귀 0 (기존 1749 통과 유지 + 신규).
- 기존 단축키 핸들러 동작 변경 금지.
- Layer-2 dialog preset 사용; ad-hoc Radix Dialog 직접 호출 금지.

## Acceptance Criteria
- AC-01: `?` 입력 (target 이 input/textarea/select/contenteditable 이 아닐 때) → cheatsheet 모달 열림.
- AC-02: Cmd+/ (또는 Ctrl+/) → cheatsheet 모달 열림.
- AC-03: INPUT focus 상태에서 `?` 입력 → 모달 안 열림.
- AC-04: 단축키들이 그룹 라벨 (Tabs / Editing / Navigation / Panels / Misc) 아래 표시.
- AC-05: 검색 input 에 "format" 입력 → "Format SQL" 행만 노출, 다른 행은 hide.
- AC-06: 검색 결과 0건 → "No shortcuts match" 표시.
- AC-07: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..07 evidence in handoff.md.
