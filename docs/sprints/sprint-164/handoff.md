# Sprint 164 Handoff — Phase 15 Closure

**날짜**: 2026-05-14 (retrospective — Sprint 163/164 가 contract 만 남기고
phase 가 묻혀 진행됐다. 2026-05-14 phase audit 에서 native HTML5 DnD 가
@dnd-kit 도입 없이 모든 핵심 AC 를 충족함을 확인 후 본 문서로 closure
기록.)

## Result: PASS (with P2 deferrals)

## Phase 15 Exit Gate

| Gate | Status | Evidence |
|------|--------|----------|
| Skip-zero | PASS | `grep` 0 hit |
| `pnpm vitest run` | PASS | 278 files / 3401 passed (2026-05-14) |
| `pnpm tsc --noEmit` | PASS | type errors 0 |
| `pnpm lint` | PASS | ESLint errors 0 |
| AC-15-01 (drag handle + drop highlight) | PASS | `ConnectionItem.tsx:151` `draggable`, `GripVertical` 아이콘, `dragging` 시 `opacity-40`. `ConnectionItem.test.tsx:635+` dragStart 단언 |
| AC-15-02 (drop → moveConnectionToGroup) | PASS | `ConnectionGroup.tsx:115-135` `handleGroupDrop` → `moveConnectionToGroup(connId, groupId)`. `ConnectionList.tsx:43-51` ungroup drop. `ConnectionGroup.test.tsx:580+` 회귀 가드 |
| AC-15-03 (nested indent) | PASS | `ConnectionItem.tsx:145` `inGroup ? "pl-6 pr-3" : "px-3"` |
| AC-15-04 (group collapse persist) | PASS | `ConnectionGroup.tsx:39-54` `COLLAPSE_KEY = "table-view-group-collapsed"` localStorage |
| AC-15-05 (drop indicator placeholder) | PARTIAL | dragOver 시 group row 가 background hover state 로 단서. 전용 placeholder line 은 후속 sprint. |
| AC-15-06 (키보드 DnD) | DEFERRED | 표준 a11y 패턴. Space → drag mode → 화살표 이동 → Enter drop 시퀀스는 native HTML5 DnD 로 직접 구현 비용 큼. `@dnd-kit/sortable` 도입 시 자동 — 후속 sprint 결정 |
| AC-15-07 (다중 선택) | DEFERRED | P2 |
| AC-15-08 (E2E) | DEFERRED | tauri-driver |

## 핵심 결정 — `@dnd-kit` 미도입

Phase 15 spec 의 sprint-163 에서 `@dnd-kit/core` 도입 ADR 을 예고했으나
실제 구현은 **native HTML5 drag&drop API** 로 풀렸다. `package.json` 에
DnD 라이브러리 없음. 이유:

- native API 가 connection-row 1 레벨 / group-row 2 레벨의 단순 surface
  를 충분히 cover.
- 의존성 + 번들 ~30KB gzip 회피.
- 단점: 키보드 DnD a11y 는 native 로 직접 구현해야 함 → AC-15-06 deferred.

@dnd-kit 도입은 (a) 다중 선택 또는 (b) reorder (drag-to-sort) 가 추가
요구로 들어올 때 재평가.

## Phase 15 Sprint 요약

| Sprint | Scope | Status |
|--------|-------|--------|
| 163 | Nested indent + group collapse persist | PASS (코드 wired, contract 만 잔존) |
| 164 | Drop indicator + a11y + Phase 15 closure | PASS (drop indicator 는 PARTIAL, closure 문서 본 핸드오프) |

## 구현 위치

- `src/components/connection/ConnectionItem.tsx:45-46` — module-level
  `draggedConnectionId` shared state
- `src/components/connection/ConnectionItem.tsx:151-167` — `draggable` +
  `onDragStart` / `onDragEnd` handler
- `src/components/connection/ConnectionGroup.tsx:115-136` —
  `handleGroupDragOver` + `handleGroupDrop` (group 으로 이동)
- `src/components/connection/ConnectionList.tsx:43-65` — ungrouped 영역
  의 root drop zone
- `src/stores/connectionStore.ts:284` — `moveConnectionToGroup` 액션
  (Tauri IPC `moveConnectionToGroup` 호출)
- `src/components/connection/ConnectionGroup.tsx:39-54` — collapse
  state localStorage persist

## 회귀 가드

- `ConnectionItem.test.tsx:635+` — dragStart 시 `effectAllowed = "move"`
  + `setData("text/plain", connId)` 단언
- `ConnectionGroup.test.tsx:580+` — drop 시 `moveConnectionToGroup`
  호출 + dataTransfer fallback (draggedConnectionId null)
- `ConnectionGroup.test.tsx:1146+` — child drop 이 parent (ungroup)
  drop 까지 bubble 하지 않음 (event propagation stopPropagation)

## 후속

- AC-15-05 (drop indicator placeholder line) — group row 에 dragOver
  시 명시적 "Drop here" hint 텍스트 + indicator line.
- AC-15-06 (키보드 DnD) — `@dnd-kit/sortable` 도입 평가 시점에 함께.
- AC-15-07 (다중 선택) — Shift / Cmd 다중 선택은 ConnectionItem 자체에
  selection state 부재 → store layer 신설 필요. 별도 phase.
