# Phase 14: Workspace Theme Toggle

> **상태: 계획**

## 배경

Sprint 153에서 `themeStore`가 cross-window IPC sync에 부착됐지만, theme 토글 UI는 launcher에만 노출돼 있다. 사용자가 workspace에서 작업 중 다크/라이트 전환을 하려면 launcher로 돌아가야 하는 워크플로우 단절. TablePlus는 모든 창에서 theme 토글 접근이 가능하다.

판단 기준: "사용자가 workspace에서 SQL 편집 또는 데이터 탐색 중 thumb 키 한 번에 다크/라이트 전환을 할 수 있는가."

## 구현 항목

| Feature | ID | 우선순위 |
|---|---|---|
| Workspace 헤더/툴바에 ThemeToggle 컴포넌트 노출 | F14.1 | P0 |
| Cross-window propagation 검증 (launcher 토글 → workspace 즉시 반영) | F14.2 | P0 |
| 키보드 단축키 (`Cmd+Shift+L` 또는 동치) | F14.3 | P1 |
| `prefers-color-scheme` system 추적 자동 모드 | F14.4 | P2 |
| E2E — workspace에서 토글 → launcher 즉시 반영 | F14.5 | P1 |

## Sprint 분해

| Sprint | 목적 |
|---|---|
| **161** | Workspace 헤더에 `ThemeToggle` 마운트. 단위 테스트 — workspace에서 토글 시 `themeStore.setMode` 호출 + bridge emit 단언. |
| **162** | E2E + 키보드 단축키. CI에서 e2e job 분리 운영(Phase 13 closure 결과에 따라). |

## Acceptance Criteria

- **AC-14-01** Workspace 페이지에 visible `ThemeToggle` (라이트/다크/시스템 옵션). `aria-label` + 키보드 접근성.
- **AC-14-02** Workspace에서 토글 → `data-theme`/`data-mode` 속성 즉시 갱신, launcher에도 IPC 통해 propagate (Sprint 153 sync 활용).
- **AC-14-03** Launcher → workspace 방향 동치 (이미 sync 부착).
- **AC-14-04** 키보드 단축키 동작 + `App.tsx` shortcut 등록기에 추가.
- **AC-14-05** E2E — 두 창 모두 visible 상태에서 한쪽 토글 → 양쪽 즉시 반영.

## TDD 정책

- Sprint 161: ThemeToggle 마운트 직전에 단위 테스트 RED 캡처.
- Sprint 162: E2E suite 추가 시 처음부터 wired 상태 (Phase 13에서 e2e 운영 결정 승계).

## E2E 시나리오

| ID | 시나리오 |
|---|---|
| E14-01 | Workspace에서 ThemeToggle 클릭 → CSS data-theme 변경 + launcher window 열어서 같은 값 확인 |
| E14-02 | Launcher에서 ThemeToggle 클릭 → workspace에서 동치 |
| E14-03 | 키보드 단축키 — workspace focus 상태에서 Cmd+Shift+L 동작 |

## Phase Exit Gate

1. Skip-zero.
2. AC-14-01..05 잠금.
3. e2e green (Phase 13 운영 정책 승계).
