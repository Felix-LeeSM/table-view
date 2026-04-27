# Phase 15: Connection Group DnD + Nested Indent

> **상태: 계획**

## 배경

현재 launcher의 connection 목록은 그룹 + connection의 두 단계 트리 구조이지만, connection을 group으로 옮기는 사용자 액션이 없다(생성 시 group 지정만 가능). DnD가 없어 워크플로우상 그룹 재편성이 어렵다. 또한 group 내 connection이 들여쓰기 없이 평면적으로 보여서 시각적 hierarchy가 약하다.

판단 기준: "사용자가 launcher에서 connection을 마우스로 group에 끌어다 놓으면 즉시 분류되고, 시각적으로 어느 group에 속하는지 한 눈에 보이는가."

## 구현 항목

| Feature | ID | 우선순위 |
|---|---|---|
| Connection drag handle + DnD 라이브러리 도입 (`@dnd-kit/core` 우선) | F15.1 | P0 |
| Drop target — group row + group 내부 + ungrouped 영역 | F15.2 | P0 |
| Drop 시 `connectionStore.moveConnectionToGroup` 액션 | F15.3 | P0 |
| Group 내 connection nested indent (level 1 들여쓰기) | F15.4 | P0 |
| Group collapse/expand 상태 보존 | F15.5 | P1 |
| Group 간 connection 이동 다중 선택 (Shift/Cmd) | F15.6 | P2 |
| Drop placeholder 시각 단서 (drop indicator line) | F15.7 | P1 |
| 키보드 접근성 — DnD를 키보드로도 가능하게 (`@dnd-kit` 표준) | F15.8 | P1 |

## Sprint 분해

| Sprint | 목적 |
|---|---|
| **163** | DnD 라이브러리 평가/도입 ADR. `@dnd-kit/core` 권장 (이미 React 19 호환, a11y 우수). 의존성 추가 + 최소 dnd context 마운트. |
| **164** | Drag source(connection row) + drop target(group row, ungrouped 영역) wiring. `connectionStore.moveConnectionToGroup(connId, groupId | null)` 액션 신설. 단위 테스트 RED → wiring → green. |
| **165** | Nested indent 시각 + group collapse 상태 보존 + drop indicator. 컴포넌트 시각 단언 (`render` + className/aria 검증). |
| **166** | 키보드 접근성 + 다중 선택 + e2e 시나리오. Phase 15 closure. |

## Acceptance Criteria

- **AC-15-01** Connection row에 drag handle 시각 단서. 마우스로 잡고 group row 위로 끌면 highlight.
- **AC-15-02** Drop 시 `connectionStore.connections[i].groupId` 갱신 + persisted state로 영구 저장.
- **AC-15-03** Connection row의 `padding-left`(또는 들여쓰기)는 `groupId === null`이면 0, group 소속이면 `level * 16px` (또는 동치). 시각적 hierarchy 명확.
- **AC-15-04** Group collapse 상태(예: `groupCollapsed: Set<string>`)가 launcher 재진입 후에도 보존.
- **AC-15-05** Drop indicator — 사용자가 정확히 어느 group에 떨어뜨리는지 시각화 (placeholder line).
- **AC-15-06** 키보드 — connection row focus + Space → drag 모드, 화살표 키로 이동, Enter로 drop. (`@dnd-kit/sortable` 표준 키보드 sensor.)
- **AC-15-07** 다중 선택 (Shift+클릭 / Cmd+클릭) + drag → 선택된 모든 connection 일괄 이동.
- **AC-15-08** E2E — drag&drop 기본 시나리오 + 키보드 시나리오.

## TDD 정책

- Sprint 163: ADR + 의존성 추가는 TDD 적용 어려움 → 의존성 보유 검증 단위 테스트(`expect(import(...)).toBeDefined()`).
- Sprint 164: 액션 + DnD wiring 모두 RED → green TDD.
- Sprint 165: 시각/aria 단언은 RTL `screen.getByRole` + className 단언으로 RED → green.
- Sprint 166: 키보드 시나리오는 단위에서 (`fireEvent.keyDown`), e2e는 Playwright drag/drop API.

## E2E 시나리오

| ID | 시나리오 |
|---|---|
| E15-01 | Connection을 group row 위로 drag → connection이 group 내부로 이동, indent 시각 변화 |
| E15-02 | Group 내 connection을 다른 group으로 drag → groupId 갱신 |
| E15-03 | Connection을 ungrouped 영역으로 drag → groupId null |
| E15-04 | 키보드 — connection focus + Space → 화살표 + Enter로 drop |
| E15-05 | 다중 선택 (Shift+클릭 3개) → 한 번의 drag로 모두 이동 |
| E15-06 | Group collapse → launcher 재실행 → collapsed 상태 보존 |

## 위험 / 미정 사항

- **R15.1** `@dnd-kit/core`가 React 19 호환 확인 필요 (package.json `react@19`).
- **R15.2** Multi-select + drag UX 디자인 미정. Phase 15 진입 시 UX 시안 필요.
- **R15.3** 키보드 DnD는 `@dnd-kit/sortable`의 KeyboardSensor 의존 — 표준 패턴 확인.

## Phase Exit Gate

Skip-zero, AC-15-01..08 잠금, e2e green, ADR (DnD 라이브러리 결정) 동결.
