# Handoff: sprint-105

## Outcome

- Status: PASS
- Summary: Quick Look 패널 리사이저에 키보드 접근성(`Shift+ArrowUp/Down` 8px,
  clamp to MIN_HEIGHT 120 / MAX_HEIGHT 600)과 ARIA(`role="separator"` +
  `aria-orientation="horizontal"` + `aria-label` + `aria-valuemin/max/now`)를
  RDB / Document 양쪽 body 에 동일하게 적용했다. 마우스 드래그 동작과 외부
  Props 시그니처는 보존했다.

## Verification Profile

- Profile: command
- Overall score: 9.0 / 10
- Final evaluator verdict: PASS

## Sprint 105 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| AC coverage | 9/10 | 7 acceptance criteria → 9 신규 테스트 (RDB describe 8건 + document mode 1건). AC-01 (handle ARIA), AC-02 (Shift+ArrowUp +8 / clamp MAX), AC-03 (Shift+ArrowDown -8 / clamp MIN), AC-04 (non-Shift no-op + Shift+Enter no-op), AC-05 (`aria-valuenow` 동기화 — 모든 키 테스트가 직접 단언), AC-06 (Document mode separator 단언), AC-07 (1775 통과 = baseline 1766 + 9). 명시적 매핑이 findings.md 에도 기재. |
| Verification quality | 9/10 | `pnpm vitest run` → 1775 / 1775 통과 (102 파일). `pnpm tsc --noEmit` → 0 에러 (silent). `pnpm lint` → 0 에러 (silent). 평가 시 동일 명령 재실행하여 모두 직접 확인. |
| Code quality | 9/10 | `KEYBOARD_RESIZE_STEP = 8` 모듈 상수 + `clampHeight` 헬퍼 도입으로 매직 넘버/중복 제거. `handleMouseDown` 의 `Math.max/Math.min` 두 줄을 동일 헬퍼로 교체 — 기능적으로 동치. `useCallback` 의존성 배열 정확 (`handleResizeKeyDown` 은 setHeight functional updater 만 호출하므로 빈 배열). 두 body 의 resize handle div 가 동일한 ARIA 속성 집합을 가지며 `onKeyDown={onResizeKeyDown}` prop 으로 분기. 외부 `QuickLookPanelProps` 변경 없음 (불변 조건 충족). |
| Regression risk | 9/10 | 외부 props 시그니처 (`QuickLookPanelRdbProps` / `QuickLookPanelDocumentProps`) 변경 없음. 마우스 드래그(`handleMouseDown`) 의 동작/시그니처 동일 — `clampHeight` 로 교체된 클램핑 식이 수학적으로 동치 (`Math.max(MIN, Math.min(MAX, x))`). `aria-hidden="true"` 제거가 보조 기술 노출을 늘리지만 이는 의도된 변경 (separator 로 노출). baseline 1766 모든 테스트 유지 + 9 신규 테스트 추가. |
| Documentation | 9/10 | findings.md 에 구현 변경/검증 결과/AC 매핑/결정·가정/잔여 위험 모두 기재. Implementation 섹션에서 Step 상수 도입 사유, focus-visible 패턴 채택 사유, 마우스 드래그 헬퍼 통합 동치성 모두 명시. 코드 내 주석(`// Keyboard resize: ... 동일 헬퍼` 블록 + 마우스 드래그 인라인 주석) 도 의도를 충분히 설명. |
| **Overall** | **9/10** | |

## Evidence Packet

### Checks Run

- `pnpm vitest run`: pass — 1775 / 1775 (102 files), Duration 16.56s.
- `pnpm tsc --noEmit`: pass — 0 errors (silent exit).
- `pnpm lint`: pass — 0 errors (silent exit).

### Acceptance Criteria Coverage

- `AC-01` (handle has tabIndex=0 + role=separator + aria-orientation=horizontal
  + aria-label="Resize Quick Look panel"): PASS. RDB handle (QuickLookPanel.tsx:325-336)
  + Document handle (QuickLookPanel.tsx:442-453) 모두 단언. 테스트 "renders the
  resize handle with role=separator, tabIndex=0 and ARIA attributes" + "exposes
  the resize handle as a focusable separator with ARIA in document mode".
- `AC-02` (Shift+ArrowUp +8, clamp MAX): PASS. 테스트 "Shift+ArrowUp grows the
  panel by 8px and updates aria-valuenow" (280→288) + "Shift+ArrowUp clamps to
  MAX_HEIGHT (600)" (50회 반복 후 600).
- `AC-03` (Shift+ArrowDown -8, clamp MIN): PASS. 테스트 "Shift+ArrowDown shrinks
  the panel by 8px and updates aria-valuenow" (280→272) + "Shift+ArrowDown
  clamps to MIN_HEIGHT (120)" (30회 반복 후 120).
- `AC-04` (non-Shift ArrowUp/Down no-op): PASS. 테스트 "ignores plain ArrowUp
  without Shift (no-op)" + "ignores plain ArrowDown without Shift (no-op)" +
  "ignores other keys with Shift (e.g. Shift+Enter)".
- `AC-05` (`aria-valuenow` ↔ height 동기화): PASS. 모든 키보드 테스트가
  `toHaveAttribute("aria-valuenow", ...)` 로 단언; 핸들러가 동일 `setHeight`
  를 사용하므로 `aria-valuenow={height}` 가 자동으로 갱신됨.
- `AC-06` (RDB / Document 양쪽 동일): PASS. RDB describe + Document describe
  의 "exposes the resize handle as a focusable separator with ARIA in document
  mode" 가 동일 ARIA 노출 단언. 코드 상으로도 동일 prop `onResizeKeyDown` 으로
  같은 핸들러 주입.
- `AC-07` (회귀 0): PASS. baseline 1766 → 1775 (정확히 +9 신규). 102 파일 모두
  통과. tsc/lint 모두 0 에러.

### Screenshots / Links / Artifacts

- Verification commands re-run by evaluator: see "Checks Run" above.
- Findings document: `docs/sprints/sprint-105/findings.md`.
- Contract: `docs/sprints/sprint-105/contract.md`.

## Changed Areas

- `src/components/shared/QuickLookPanel.tsx`: 모듈 상수 `KEYBOARD_RESIZE_STEP`
  + `clampHeight` 헬퍼 도입; `handleMouseDown` 의 클램핑을 헬퍼로 교체 (동치);
  `handleResizeKeyDown` 신규; `RdbBodyProps` / `DocumentBodyProps` 에
  `onResizeKeyDown` 추가; 두 body 의 resize handle div 에 `tabIndex=0` +
  `role="separator"` + `aria-orientation` + `aria-label` + `aria-valuemin/max/now`
  + `onKeyDown` 추가 + `focus-visible` outline 클래스 추가 + 기존 `aria-hidden`
  제거.
- `src/components/shared/QuickLookPanel.test.tsx`: 신규 describe `keyboard
  resizer (sprint-105 #QL-1)` 8건 + Document mode separator 1건 = 9 신규 케이스.

## Assumptions

- Step 8px 는 RDB / Document 통일 (Out of Scope: 양 패널 다른 step).
- focus-visible outline 은 다이얼로그 close 버튼에서 사용하는 `focus-visible:outline-1
  focus-visible:outline-ring` 패턴을 그대로 채택 (디자인 시스템 변경 회피).
- 마우스 드래그 의 `Math.max/Math.min` 두 줄을 `clampHeight` 헬퍼로 통합하는
  것은 외부 동작 동치이므로 invariant ("마우스 드래그 동작 동일 유지") 위반이
  아니라고 판단. functional 동치성 + 검증 1775 통과 로 입증.

## Residual Risk

- None. 외부 props 와 마우스 드래그 동작 모두 보존했고, 모든 검증이 통과했다.
  키보드 단축키가 다른 글로벌 단축키와 충돌하지 않도록 `Shift` 요구 + 핸들
  포커스 시점에만 동작하도록 제한했다.

## Next Sprint Candidates

- 다른 패널/다이얼로그의 리사이즈 핸들에도 동일 키보드 + ARIA 패턴 일반화
  (예: ConnectionPanel, SchemaPanel sidebar resizer).
- `aria-valuetext` 추가로 스크린리더에 "280 pixels" 처럼 단위 명시 (현재는
  숫자만 노출).
- E2E (Playwright) 에서 실제 키보드 포커스 → Shift+Arrow 시퀀스로 panel 높이
  변화 시각 회귀 테스트.
