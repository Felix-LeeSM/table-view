# Sprint 105 Findings — Quick Look 리사이저 키보드 + ARIA

## Summary
Quick Look 패널 리사이저에 키보드 접근성을 추가했다. `Shift+ArrowUp/Down`
으로 8px 단위로 높이를 조정할 수 있고, 핸들은 `role="separator"` +
`aria-orientation="horizontal"` + `aria-label` + `aria-valuemin/max/now`
ARIA 속성을 노출한다. RDB / Document 모드 양쪽 body 에서 동일하게 동작한다.

## Implementation

### `src/components/shared/QuickLookPanel.tsx`
- 상수 `KEYBOARD_RESIZE_STEP = 8` 와 헬퍼 `clampHeight(value)` 도입.
  마우스 드래그 핸들러도 동일 헬퍼로 교체 (행동 동치, 회귀 0).
- `QuickLookPanel` 부모에 `handleResizeKeyDown(e: React.KeyboardEvent)`
  추가. `e.shiftKey` 가 false 면 즉시 무시, `ArrowUp/Down` 만 `preventDefault`
  + `setHeight((h) => clampHeight(h ± 8))` 로 동작. 다른 키(Enter 등)와 비-Shift
  화살표는 모두 no-op.
- `RdbBodyProps` / `DocumentBodyProps` 에 `onResizeKeyDown` prop 추가.
  외부 `QuickLookPanelProps` 는 변경하지 않음 (불변 조건 충족).
- 양 body 의 resize handle div 에:
  - `tabIndex={0}` 추가.
  - `role="separator"` + `aria-orientation="horizontal"` +
    `aria-label="Resize Quick Look panel"` + `aria-valuemin={MIN_HEIGHT}` +
    `aria-valuemax={MAX_HEIGHT}` + `aria-valuenow={height}` 추가.
  - `aria-hidden="true"` 제거.
  - `onKeyDown={onResizeKeyDown}` 추가.
  - `focus-visible:outline-1 focus-visible:outline-ring` 클래스 추가
    (다이얼로그 close 버튼 등에서 사용 중인 `focus-visible` 패턴과 일관).

### `src/components/shared/QuickLookPanel.test.tsx`
신규 describe `keyboard resizer (sprint-105 #QL-1)` 추가:
- 핸들이 `role="separator"` + `tabIndex=0` + 모든 ARIA 속성 보유 확인.
- `aria-hidden` 미존재 확인.
- `Shift+ArrowUp` → `aria-valuenow` 가 8 증가 (280 → 288).
- `Shift+ArrowDown` → `aria-valuenow` 가 8 감소 (280 → 272).
- `Shift+ArrowUp` 50회 반복 → `aria-valuenow=600` 으로 clamp.
- `Shift+ArrowDown` 30회 반복 → `aria-valuenow=120` 으로 clamp.
- `ArrowUp`/`ArrowDown` (Shift 없음) → `aria-valuenow` 불변 (280).
- `Shift+Enter` → no-op.

Document 모드에도 핸들이 동일한 ARIA 속성을 노출하는지 1건 추가 (mode toggle).

## Verification
- `pnpm vitest run` → 1775 / 1775 통과 (baseline 1766 + 신규 9건).
- `pnpm tsc --noEmit` → 0 에러.
- `pnpm lint` → 0 에러.

## Acceptance Criteria Mapping
- AC-01 (tabIndex/role/orientation/label) → 신규 테스트 "renders the resize
  handle with role=separator, tabIndex=0 and ARIA attributes".
- AC-02 (Shift+ArrowUp +8 / clamp MAX) → "Shift+ArrowUp grows the panel by
  8px ..." + "Shift+ArrowUp clamps to MAX_HEIGHT (600)".
- AC-03 (Shift+ArrowDown -8 / clamp MIN) → "Shift+ArrowDown shrinks the
  panel by 8px ..." + "Shift+ArrowDown clamps to MIN_HEIGHT (120)".
- AC-04 (non-Shift ArrowUp/Down no-op) → "ignores plain ArrowUp without
  Shift" + "ignores plain ArrowDown without Shift" + "ignores other keys
  with Shift".
- AC-05 (`aria-valuenow` ↔ height 동기화) → 모든 키 테스트가
  `toHaveAttribute("aria-valuenow", ...)` 로 확인.
- AC-06 (RDB / Document 양쪽 동일) → "exposes the resize handle as a
  focusable separator with ARIA in document mode" + RDB describe 전체.
- AC-07 (회귀 0) → 1775 통과, baseline 1766 모두 유지.

## Decisions / Assumptions
- Step 은 inline 상수가 아닌 모듈 상수 `KEYBOARD_RESIZE_STEP = 8` 로 도입.
  테스트에서도 동일한 의미적 상수 사용을 위해 가독성 우선.
- 마우스 드래그 코드의 `Math.max/Math.min` 두 줄을 `clampHeight` 헬퍼로
  통합 — 외부 동작 동치, props 변경 없음, 신규 키보드 핸들러와 동일 함수
  공유.
- focus ring: 코드베이스에 동일 위치(`bg-muted/30 hover:bg-muted`)에서
  쓰는 기존 focusable resize handle 이 없어서 dialog close 버튼에서 쓰는
  `focus-visible:outline-*` 패턴을 채택. 디자인 시스템 변경 없이 키보드
  포커스 가시성만 확보.
- 마우스 드래그 (`handleMouseDown`) 의 동작/시그니처는 변경하지 않음.

## Residual Risk
- None. 외부 props 와 마우스 드래그 동작 모두 보존했고, 모든 검증이 통과
  했다. 키보드 단축키가 다른 글로벌 단축키와 충돌하지 않도록 `Shift`
  요구 + 핸들 포커스 시점에만 동작하도록 제한했다.
