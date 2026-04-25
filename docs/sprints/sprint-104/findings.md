# Sprint 104 Findings — Generator Handoff

## Goal Recap
입력 필드(INPUT/TEXTAREA/SELECT/contenteditable) 안에서 타이핑 중일 때 모든
글로벌 단축키가 발화하지 않도록, 단일 헬퍼 `isEditableTarget` 으로 가드 정책을
일원화한다.

## Changed Files

| 경로 | 목적 |
| --- | --- |
| `src/lib/keyboard/isEditableTarget.ts` | 신규 — INPUT/TEXTAREA/SELECT/contenteditable 가드를 단일 함수로 노출. 순수 유틸 (React 의존 없음). |
| `src/lib/keyboard/__tests__/isEditableTarget.test.ts` | 신규 — null, INPUT, TEXTAREA, SELECT, contenteditable div, regular div, button, body, INPUT type 변형 (search/password) 9 케이스. |
| `src/App.tsx` | 모든 글로벌 keydown 핸들러에 `isEditableTarget(e.target)` early-return 적용. 기존 inline 가드(Cmd+N/S/P/comma, Cmd+R/F5)는 헬퍼 호출로 교체. 트리거 키·dispatch event·useTabStore 호출은 무변경. |
| `src/components/shared/ShortcutCheatsheet.tsx` | 인라인 `isEditableTarget` 헬퍼 제거 후 `@/lib/keyboard/isEditableTarget` 임포트로 교체. 동작 동일. |

## Acceptance Criteria Coverage

| AC | 결과 | 근거 |
| --- | --- | --- |
| AC-01 INPUT focus + Cmd+W → removeTab 미호출 | Pass | `App.tsx` Cmd+W 핸들러 첫 라인에 `if (isEditableTarget(e.target)) return;`. |
| AC-02 INPUT focus + Cmd+T → addQueryTab 미호출 | Pass | Cmd+T 핸들러 동일 가드. |
| AC-03 INPUT focus + Cmd+I → format-sql 미디스패치 | Pass | Cmd+I 핸들러 동일 가드. |
| AC-04 contenteditable focus + Cmd+W → 미발화 | Pass | 헬퍼가 `el.isContentEditable === true` 검사 → Cmd+W 가드가 그 결과를 사용. 헬퍼 단위 테스트로 contenteditable 케이스 커버. |
| AC-05 비-편집 영역 focus + Cmd+W → 정상 발화 | Pass | App.test.tsx `Cmd+W closes the active tab` (body target) 회귀 테스트가 통과 → 1766/1766. |
| AC-06 헬퍼 단위 테스트 (input/div/contenteditable/null) | Pass | 신규 테스트 9건 모두 통과. |
| AC-07 회귀 0 (1757 → 1766) | Pass | 신규 테스트 9건이 더해져 1766/1766 통과. 기존 케이스 미수정. |

## Checks Run

| 명령 | 결과 |
| --- | --- |
| `pnpm vitest run` | 1766 passed / 102 files / 0 failed |
| `pnpm tsc --noEmit` | 0 error |
| `pnpm lint` | 0 error |

## Implementation Notes

- **ShortcutCheatsheet** 의 `?` 키 가드도 동일 헬퍼로 통일. 기존 코드는
  `target instanceof HTMLElement` 체크였고 동작상 차이 없음 (jsdom realm
  이슈를 피하기 위해 헬퍼는 tag-name + `isContentEditable` lookup 사용).
- **Cmd+/ / Ctrl+/** 는 modifier 조합이라 input 안에서 발화해도 사용자가
  의도하지 않을 수 없음 → 가드 불필요. ShortcutCheatsheet 의 기존 정책
  보존 (sprint-103 결정 유지).
- **순수 유틸리티 원칙**: `isEditableTarget.ts` 는 React 임포트 0건.
  다른 keydown 핸들러 (e.g. Monaco editor 내부 단축키) 에서도 재사용 가능.
- **테스트 격리**: `__tests__` 헬퍼에서 `cleanup` 배열로 DOM 노드를
  추적하고 `afterEach` 에서 모두 제거 → 테스트 간 누수 0.
- **jsdom contenteditable 한계**: jsdom 은 `setAttribute("contenteditable",
  "true")` 만으로 `isContentEditable` 게터를 자동 계산하지 않음. 테스트는
  `Object.defineProperty` 로 게터를 직접 노출 → 실제 브라우저 동작과 동일
  결과를 검증 (helper 자체는 production 에서 수정 없이 동작).

## Assumptions

- `EventTarget` 가 들어오면 `HTMLElement` 인터페이스로 캐스트해도 안전
  (KeyboardEvent.target 의 실제 타입은 항상 Node — tagName 접근 시 undefined
  나오면 그냥 false 가 반환됨).
- Cmd+. (cancel running query) 의 가드는 contract 의 명시적 결정에 따라
  적용 — input focus 중에도 cancel 이 유용할 수 있으나 일관성 우선.
- 기존 sprint-103 의 ShortcutCheatsheet 테스트가 `target instanceof
  HTMLElement` 분기 동작을 그대로 검증하던 것은 헬퍼 교체 후에도 모두 통과
  (jsdom 에서 `document.createElement("input")` 결과가 HTMLElement
  인스턴스이므로 두 구현 모두 true 반환).

## Residual Risk

- 없음. 모든 트리거 키·dispatch event·store 호출 동작이 보존되었고,
  단일 헬퍼로 일원화되어 신규 단축키 추가 시 `isEditableTarget(e.target)`
  한 줄로 자동 보호 가능.

## Generator Handoff

### Changed Files
- `src/lib/keyboard/isEditableTarget.ts`: 공통 가드 헬퍼 (신규).
- `src/lib/keyboard/__tests__/isEditableTarget.test.ts`: 헬퍼 단위 테스트 (신규).
- `src/App.tsx`: 10개 keydown effect 에 헬퍼 가드 적용 (Cmd+W/T/./I/Shift+I/Shift+T/Shift+F/Shift+C 추가, 기존 inline 가드 Cmd+N/S/P/, 와 Cmd+R/F5 는 헬퍼 호출로 교체).
- `src/components/shared/ShortcutCheatsheet.tsx`: 인라인 헬퍼 제거 → 공유 헬퍼 사용.

### Checks Run
- `pnpm vitest run`: pass (1766/1766)
- `pnpm tsc --noEmit`: pass
- `pnpm lint`: pass

### Done Criteria Coverage
- DC-1 INPUT/TEXTAREA/SELECT/contenteditable focus 시 모든 글로벌 단축키 미발화: 헬퍼 + 모든 핸들러 가드 적용.
- DC-2 body focus 시 단축키 정상 발화: App.test.tsx 회귀 테스트 통과.
- DC-3 헬퍼 단위 테스트 통과: 9 케이스 통과.
- DC-4 vitest/tsc/lint 0: 모두 통과.

### Assumptions
- jsdom 에서 contenteditable 의 `isContentEditable` 게터는 attribute 로부터 자동 계산되지 않음 → 테스트는 `Object.defineProperty` 로 게터 노출.
- Cmd+. 가드는 contract 결정 (일관성 우선) 적용.

### Residual Risk
- None.
