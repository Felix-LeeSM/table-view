---
title: Frontend guidance
type: convention
updated: 2026-05-26
surface: src/**/*.ts, src/**/*.tsx, src/**/*.css
task: frontend, ui, react-impl
trigger:
  signal: src frontend/UI 편집 시
  layer: agent-prompt
---

# Frontend Guidance

## Philosophy — Contract-first workbench

Frontend 는 TablePlus-like 작업 도구의 operator flow 를 책임진다. 창 shell,
workspace/tab/grid/editor/dialog orchestration, preview/confirm/retry UX 는
frontend 소유다. 단, DB truth / storage truth / secret / durable side effect 는
backend contract 를 통해서만 다룬다.

앱 첫 화면은 작업 도구다. marketing hero / 과장된 장식보다 반복 사용자가
빠르게 스캔하고 조작하는 밀도 높은 UI 를 우선한다.

## Source Order

1. 기존 컴포넌트 / token / interaction pattern
2. [react](../react/memory.md)
3. [testing-scenarios](../testing-scenarios/memory.md)
4. 본 문서

## UI 원칙

- 카드 중첩 금지. 반복 item / modal / tool frame 에만 card 사용.
- 버튼은 가능한 lucide icon + tooltip. 텍스트 버튼은 명확한 command 에만.
- 고정 형식 UI(board, grid, toolbar, tile)는 `aspect-ratio`, `grid`, `min/max`
  등으로 stable dimension 확보.
- viewport 기반 font scaling 금지. compact surface 안의 heading 은 작고 조밀하게.
- palette 는 단일 hue 로 밀지 않음. 기존 token 우선, 새 색은 contrast 검증.
- 텍스트가 버튼/칩/카드 안에서 넘치거나 겹치면 layout bug 로 본다.

## Contract 경계

- Tauri IPC 는 domain wrapper (`src/lib/tauri/**`, 필요 시 `src/lib/api/**`) 로
  감싼다. component 가 raw `invoke()` 를 직접 소유하지 않는다.
- Request-shaped command 를 우선한다. DDL/destructive wrapper 는
  `previewOnly` + `expectedDatabase` 를 보존하고 `SchemaChangeResult { sql }`
  preview 와 commit path 를 같은 request shape 로 묶는다.
- DB mismatch 는 `expectedDatabase` 를 workspace `(connId, db)` 에서 thread 해
  backend `AppError::DbMismatch` 로 감지한다. 문자열 비교로 자체 판정하지 않는다.
- Query/table result 는 wrapper 에서 numeric post-processing 을 끝낸 뒤 UI 로
  넘긴다. cell-domain stringify 는 `safeStringifyCell` 을 사용한다.
- Frontend canonical IPC/store-facing types use camelCase. Legacy snake_case
  payloads are normalized only at boundaries such as `src/lib/tauri/**`,
  snapshot/session hydration, import/restore, and `src/lib/wireCamelCase.ts`.
- Do not pass legacy snake_case query/document/connection payloads into stores
  or UI renderers. Normalize first, then keep the store/UI surface camelCase.
- Explicit legacy exceptions stay snake_case until their own contract changes:
  `QueryType.dml.rows_affected`, `BulkWriteResult` counters,
  `ColumnInfo.data_type`, `TableData.total_count`, and
  `CollectionInfo.document_count`.

## State 경계

- `workspaceStore` 는 `(connId, db)` keyed workspace state 의 SOT 다. workspace
  path 에서 `connectionStore.focusedConnId` 를 작업 identity 로 재도입하지 않는다.
- store 끼리 runtime import / action 호출을 늘리지 않는다. 두 store 를 묶는
  orchestration 은 `src/hooks/*` 또는 caller component 로 둔다.
- cross-window sync 는 각 store 의 `SYNCED_KEYS` allowlist 를 audit point 로 본다.
  loading/error/session-only flag 를 durable/broadcast state 로 승격하지 않는다.
- 새 persistent UI state 는 reset affordance 를 같은 PR 에 포함한다
  ([ux](../../ux/memory.md)).

## Interaction edge rules

- 비-form focus target (`div[role="textbox"]`, custom cell, chip 등) 은 `autoFocus`
  에 기대지 않는다. ref + `useEffect` 로 active target 전이를 명시 focus 한다.
- Tauri 2 + HTML5 drag/drop 은 window config/builder 의 OS drag-drop handler 를
  명시 결정한다. 중첩 drop target 은 child 에서 `stopPropagation()` 하고 visual
  drop extent 와 handler extent 를 맞춘다.
- Toolbar / switcher 는 같은 의미의 active connection/db 에 대해 하나의 SoT 를
  contract 에 적는다. active tab 이 없으면 workspace/sidebar 와 같은 fallback
  순서 (`activeTab` -> focused connection/db) 를 쓴다.
- Document/paradigm tree auto-load guard 는 `(connectionId, activeDb)` composite
  key 로 둔다. DB switch 로 cache 를 비운 뒤 connectionId 만 보면 stale/empty
  tree 를 다시 fetch 하지 못한다.

## Workflow

- UI 변경은 `npm run lint`, `npx tsc --noEmit`, 관련 Vitest 를 통과시킨다.
- 접근성은 role/text 쿼리로 검증한다. `data-testid` 는 역할/텍스트가 없을 때만.
- 시각 회귀 위험이 있으면 Playwright/browser screenshot 으로 실제 viewport 확인.

## 관련

- [react](../react/memory.md)
- [testing-scenarios](../testing-scenarios/memory.md)
- [refactoring](../refactoring/memory.md)
