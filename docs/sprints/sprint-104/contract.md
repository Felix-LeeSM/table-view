# Sprint Contract: sprint-104

## Summary
- Goal: 모든 글로벌 단축키에 INPUT/TEXTAREA/SELECT/contenteditable 일괄 가드 적용 — 신규 단축키도 자동 보호. 가드는 공통 헬퍼로 단일화.
- Profile: `command`

## In Scope
- 신규 `src/lib/keyboard/isEditableTarget.ts` (또는 동등 위치): `isEditableTarget(target: EventTarget | null): boolean` — INPUT/TEXTAREA/SELECT/contenteditable 판정.
- `src/App.tsx`: 모든 shortcut useEffect 핸들러를 가드 통과하도록 수정.
  - Cmd+W (line 27-40): 가드 추가.
  - Cmd+T (line 42-59): 가드 추가.
  - Cmd+. (line 61-86): 가드 추가 (단, 실행 중 쿼리 취소는 input 안에서도 useful 할 수 있지만 일관성 우선 — 가드 적용).
  - Cmd+I (line 156-166): 가드 추가.
  - Cmd+Shift+I (line 168-178): 가드 추가.
  - Cmd+Shift+T (line 180-190): 가드 추가.
  - Cmd+Shift+F (line 192-202): 가드 추가.
  - Cmd+Shift+C (line 204-214): 가드 추가.
  - 기존에 inline 가드를 가진 핸들러 (Cmd+N/S/P/comma — line 88-120, Cmd+R/F5 — line 122-154): 공통 헬퍼로 교체.
- `src/components/shared/ShortcutCheatsheet.tsx`: 이미 sprint-103 에서 inline 가드 보유 — 공통 헬퍼로 교체.
- 신규 `src/lib/keyboard/__tests__/isEditableTarget.test.ts`: input/textarea/select/contenteditable/regular div 케이스.

## Out of Scope
- 단축키 라우터를 hook 으로 추상화 (e.g. `useGlobalShortcut`). 이건 더 큰 리팩터 — 해당 sprint 에서는 헬퍼 함수만.
- 새 단축키 추가.
- macOS-vs-Windows 분기.

## Invariants
- 회귀 0 (1757 통과 유지).
- 기존 단축키 동작 (트리거 상황) 변경 금지 — 단지 input focus 시 발화 차단만 추가.
- Cmd+R/F5, Cmd+N/S/P/comma, Cmd+W 의 useTabStore 호출 동작 변경 금지.

## Acceptance Criteria
- AC-01: INPUT focus + Cmd+W → useTabStore.removeTab 호출 안 됨 (이전엔 호출됨).
- AC-02: INPUT focus + Cmd+T → addQueryTab 호출 안 됨.
- AC-03: INPUT focus + Cmd+I → format-sql custom event 미디스패치.
- AC-04: contenteditable focus + Cmd+W → 미발화.
- AC-05: 비-편집 영역 (body) focus + Cmd+W → 정상 발화 (회귀 가드).
- AC-06: `isEditableTarget(input)` true / `isEditableTarget(div)` false / `isEditableTarget(div with contenteditable)` true / `isEditableTarget(null)` false.
- AC-07: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..07 evidence in handoff.md.
