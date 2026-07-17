---
title: Frontend guidance
type: convention
updated: 2026-07-03
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
- 로딩 표현 규약 (#1058): **skeleton** = 구조를 미리 아는 목록/그리드/앱 chrome
  의 초기 로드(데이터 아직 없음) — 채워질 shape 를 미리 보여 flicker 를 줄인다
  (`Skeleton` 프리미티브, 그리드는 공유 `DataGridSkeleton`). **spinner** = 소요
  불확정 작업(쿼리 실행 `QueryRunningState`), 컨트롤/버튼 busy(`DbSwitcher`,
  `DataGridToolbar` 저장), 이미 렌더된 데이터 위 refetch 오버레이
  (`AsyncProgressOverlay`) — shape 이 없거나 기존 데이터를 지우면 안 될 때
  (`Loader2 animate-spin`). RDB/Document/View 그리드·목록 초기 로드는 공유
  `DataGridSkeleton`, 트리/사이드바 초기 로드(`DocumentDatabaseTree`, `KvSidebar`)는
  공유 `TreeSkeleton` (`@components/shared/tree`) 으로 동일하게 로드된다 (#1586).
  refetch/부분 로드(pagination "load more", on-expand fetch)·control-busy(refresh)
  는 스피너 유지.
- Dialog 수정은 기존 component contract/test 를 먼저 보며 close button,
  feedback slot, alert role, toast hookup 같은 테스트된 invariant 를 깨지 않는다.
  preset/layout source-order 강제 규칙은 retired 상태다.
- 파괴적 confirm (DROP/TRUNCATE/삭제 등) 은 `ConfirmDestructiveDialog` 또는
  `AlertDialog` 프리셋 (`role="alertdialog"`) 로 통일한다. 150ms arm 은
  `ConfirmDestructiveDialog` 와 RDB `SqlPreviewDialog` 2곳에만 적용:
  primary(Confirm/Execute) 를 open 후 150ms `disabled` 로 arm (`useDelayedFlag`)
  해 반사적 Enter 를 흡수하고, arm 완료 시 primary 로 `ref` focus 를 옮긴다.
  Enter=confirm 은 **focus 된 버튼의 native activation 에만** 맡기고 dialog 전역
  `onKeyDown` 으로 잡지 않는다 (전역 핸들러는 Cancel focus 에서도 파괴를 실행함).
  Cancel/Esc 는 항상 즉시. 실행 중엔 loading/disabled+aria-busy 로 이중 실행을
  막는다. `ConnectionItem` 삭제 / `DbLifecycleDialog` DROP 은 role/focus 통일만
  (arm 미적용). (#1111 결정 / #1141 안전)

## Contract 경계

- Tauri IPC 는 domain wrapper (`src/lib/tauri/**`, 필요 시 `src/lib/api/**`) 로
  감싼다. component 가 raw `invoke()` 를 직접 소유하지 않는다. `eslint.config.js`
  의 `no-restricted-imports` 가 `src/components|pages|hooks/**` 의 `@tauri-apps/api`
  직접 import 를 차단 (type-only 는 `allowTypeImports` 로 허용, #1365).
- Frontend import boundary 는 domain-first 다. 새 consumer 는 file-kind root
  (`src/components/**`, `src/hooks/**`, `src/stores/**`, `src/pages/**`) 내부 구현을
  직접 당겨 쓰지 않고 `src/features/<domain>/index.ts` public API 를 통한다.
- Current feature domains: `connection`, `completion`, `query`, `catalog`,
  `workspace`. Result-grid/datagrid 는 현재 `src/components/datagrid/index.ts`
  public boundary 를 통해 소비한다.
- Refactor 02 migration order 는 `connection` -> `completion` -> `query` ->
  `catalog/schema` -> `result-grid/datagrid` -> `workspace` 였다. 이 순서는 향후
  회귀 분석과 compatibility evidence 를 읽을 때 기준 순서다.
- Cross-feature production import 는 상대 feature 내부 path 가 아니라
  `@features/<domain>` 또는 `src/features/<domain>/index.ts` 로 간다. 명시된
  shared contract SOT 가 있을 때만 shared contract layer 로 승격하고, 없으면
  feature public API 를 확장한다.
- `src/features/**` production code 는 feature-local code, `@lib`, `@/types`,
  `@components/ui`, 그리고 허용된 public facade 만 의존한다. 다른 feature 내부나
  legacy app shell/root 를 직접 import 하지 않는다.
- Request-shaped command 를 우선한다. DDL/destructive wrapper 는
  `previewOnly` + `expectedDatabase` 를 보존하고 `SchemaChangeResult { sql }`
  preview 와 commit path 를 같은 request shape 로 묶는다.
- DB mismatch 는 `expectedDatabase` 를 workspace `(connId, db)` 에서 thread 해
  backend typed `AppError::DbMismatch` envelope 로 감지한다. Frontend 분기는
  `src/lib/tauri/error.ts` normalizer 를 통하고, legacy Display string 파싱은
  boundary fallback 으로만 둔다.
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
- store 내부에서 다른 store 를 직접 import/read 하지 않는다. 두 store 이상과 side
  effect 를 묶는 새 orchestration 은 `src/lib/runtime/**` use-case 로 둔다.
  남아 있는 hook/lib direct `setState` debt 는
  [store-coupling](../refactoring/store-coupling/memory.md) 기준으로 줄인다.
- cross-window sync 는 각 store 의 `SYNCED_KEYS` allowlist 를 audit point 로 본다.
  loading/error/session-only flag 를 durable/broadcast state 로 승격하지 않는다.
- 새 persistent UI state 는 reset affordance 를 같은 PR 에 포함한다
  ([product](../../../product/memory.md)).

## Workflow

- UI 변경은 `npm run lint`, `npx tsc --noEmit`, 관련 Vitest 를 통과시킨다.
- 접근성은 role/text 쿼리로 검증한다. `data-testid` 는 역할/텍스트가 없을 때만.
- 시각 회귀 위험이 있으면 Playwright/browser screenshot 으로 실제 viewport 확인.
- Frontend tests 는 증명하는 domain 근처에 둔다:
  `src/features/<domain>/**/*.test.{ts,tsx}` 가 기본이다. Cross-runtime,
  fixture, smoke, script 정책 테스트는 runner 소유 root 에 남긴다.
- Compatibility row 는 `migration-only`, `permanent-wire-compatibility`,
  `removable-debt` 중 하나로 분류한다. `migration-only` compatibility export/import
  는 같은 milestone 안에서 제거하거나 owner issue 를 남긴다. Refactor 02 이후 새
  compatibility path 는 removal evidence 없이 추가하지 않는다.

## 관련

- [react](../react/memory.md)
- [testing-scenarios](../testing-scenarios/memory.md)
- [refactoring](../refactoring/memory.md)
