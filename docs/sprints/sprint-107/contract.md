# Sprint Contract: sprint-107

## Summary
- Goal: SchemaTree 의 table 노드 (button) 가 포커스인 상태에서 F2 키 입력 → 기존 rename Dialog 진입. 입력 필드는 자동 포커스 + 기존 이름 텍스트 전체 선택. Enter commit / Esc cancel 은 기존 Dialog 동작 유지.
- Profile: `command`

## In Scope
- `src/components/schema/SchemaTree.tsx`:
  - 라인 ~736 button `onKeyDown` 에 F2 분기 추가 — `isTableView && !isView && !isFunc` (즉, 진짜 table) 인 경우에만 `handleStartRename(item.name, schema.name)` 호출 후 `e.preventDefault()`. View/function 은 rename 미지원이므로 F2 무시.
  - rename input (라인 936-953): `autoFocus` 옆에 `onFocus={(e) => e.currentTarget.select()}` 추가 — 기존 이름 텍스트를 전체 선택해 곧바로 덮어쓰기 가능.
- 테스트:
  - F2 on table button → Rename Dialog 열림 (Dialog 의 input role + DialogTitle 등 확인).
  - F2 on view button → Dialog 안 열림.
  - F2 on function button → Dialog 안 열림.
  - Dialog 열린 직후 input 의 selectionStart=0, selectionEnd=name.length (또는 document.activeElement === input + selection range).
  - Enter on input → confirm.
  - Esc → close (이미 Radix Dialog 가 보장 — 기존 회귀 가드만).

## Out of Scope
- 인라인 rename (button 자체에 input 변경) — 기존 Dialog 패턴 유지.
- View/function rename 기능 추가.
- F2 가 schema 노드 등 다른 노드에서 발화하는 동작.

## Invariants
- 회귀 0 (1782 통과 유지).
- 기존 ContextMenu Rename 메뉴 동작 변경 금지.
- handleStartRename / handleConfirmRename 시그니처 동일.

## Acceptance Criteria
- AC-01: table button focus 상태에서 F2 → Rename Dialog 열림.
- AC-02: Dialog input 이 즉시 focus + 기존 이름 전체 선택.
- AC-03: Enter 시 commit, Esc 시 close.
- AC-04: view/function button 의 F2 → 무동작.
- AC-05: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..05 evidence in handoff.md.
