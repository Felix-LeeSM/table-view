# Phase 16: Recent Connections (MRU) 동작 보장

> **상태: 계획**

## 배경

`mruStore`는 Sprint 153에서 IPC sync까지 부착된 상태로 launcher에 "Recent Connections" 섹션이 노출된다. 사용자 보고: "전혀 동작하지 않는다." 사용자가 connection에 연결할 때 MRU 목록이 갱신되지 않거나, 갱신되더라도 launcher 재실행 시 사라지거나, 클릭 시 활성화 동작이 없는 등 다단계 회귀 가능.

판단 기준: "TablePlus 사용자가 launcher 첫 화면에서 최근 사용한 connection 5개를 한 번에 보고, 더블클릭하면 즉시 workspace로 진입할 수 있는가."

## 구현 항목

| Feature | ID | 우선순위 |
|---|---|---|
| MRU 진단 — 갱신/저장/표시/활성화 4단계 회귀 테스트 | F16.1 | P0 |
| `mruStore` 갱신 trigger 확인 (`connectToDatabase` 성공 시) | F16.2 | P0 |
| Persistence — `localStorage` 또는 Tauri store 영구 저장 | F16.3 | P0 |
| Recent Connections UI 클릭 → connection 활성화 (Phase 12 multi-window 통합) | F16.4 | P0 |
| 최대 N개 (5 또는 10) 제한 + 오래된 항목 자동 제거 | F16.5 | P1 |
| Recent에 표시할 메타 — connection 이름 + 마지막 사용 시각 + paradigm 아이콘 | F16.6 | P1 |
| MRU 목록에서 직접 group 정보, 색상 라벨 등 시각적 단서 | F16.7 | P2 |
| E2E — connection 활성화 후 launcher 재진입 → MRU 상위에 노출 | F16.8 | P0 |

## Sprint 분해

| Sprint | 목적 |
|---|---|
| **167** | MRU 4단계(trigger / persist / render / activate) 진단 TDD 테스트. 어디서 끊기는지 식별. |
| **168** | 진단 결과에 따른 fix sprint(s). 통상 trigger 누락 또는 persistence 누락 가능성 높음. |
| **169** | UI 보강 — paradigm 아이콘 / 마지막 사용 시각 / 활성 상태 단서. |
| **170** | E2E + Phase 16 closure. |

## Acceptance Criteria

- **AC-16-01** Connection 성공 (`connectToDatabase` resolved) 시점에 `mruStore.recordUsage(connId)` 호출. activeStatuses 변경에 trigger 등록 또는 explicit hook.
- **AC-16-02** MRU 목록은 `localStorage` (또는 Tauri store)에 persist. App 재시작 후에도 보존.
- **AC-16-03** Launcher 첫 화면에 "Recent Connections" 섹션 표시. 비어있으면 hint("아직 사용한 연결이 없습니다") 표시.
- **AC-16-04** MRU 항목 더블클릭 → Phase 12 activation 흐름 (workspace 창 활성화).
- **AC-16-05** 최대 5개 (config-able). 6번째 사용 시 가장 오래된 항목 제거.
- **AC-16-06** 각 항목에 paradigm 아이콘 + 연결 이름 + 마지막 사용 시각(상대시간 — "5분 전") 표시.
- **AC-16-07** Workspace에서 Back → launcher 진입 시 방금 사용한 connection이 MRU 1번째. (cross-window sync 필요.)
- **AC-16-08** E2E — 두 connection 사용 → launcher 재진입 → MRU 순서 검증.

## TDD 정책

- Sprint 167 진단 — 4 trigger 단계마다 RED 테스트. 어떤 단계가 RED인지에 따라 168 fix scope 결정.
- 각 sprint 표준 TDD red→green 패턴.

## E2E 시나리오

| ID | 시나리오 |
|---|---|
| E16-01 | Connection 첫 사용 → launcher 재진입 → MRU 상단 표시 |
| E16-02 | 두 connection 순서대로 사용 → 가장 최근이 MRU 1위 |
| E16-03 | MRU 항목 더블클릭 → workspace 활성화 |
| E16-04 | 6개 connection 사용 → 가장 오래된 1개 제거됨 |
| E16-05 | App 재시작 → MRU 보존 |

## 위험 / 미정 사항

- **R16.1** Persistence backend 결정 (localStorage vs Tauri secure store). Sprint 167 진단 결과에 따라 ADR 가능성.
- **R16.2** "마지막 사용 시각" 갱신은 `Date.now()` 사용 — timezone 이슈 없음 (상대시간 표시).

## Phase Exit Gate

Skip-zero, AC-16-01..08 잠금, e2e green.
