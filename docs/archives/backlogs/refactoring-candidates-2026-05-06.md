# Refactoring Candidates — Table View

> **Status: RETIRED (2026-05-06)** — 본 문서가 정의한 P1–P11 11개 후보의
> sequencing (Sprint 210–224) 은 16 row 중 15 ✓ + 1 deferred (P10 step
> 3b/4) 로 종료. retire 사유 = 이전 cycle 의 `CODE_SMELLS.md` retire 패턴
> 답습 (commit `0c64a1b`). 본 문서는 history 보존용이며 다음 wide-net 스캔
> 결과는 새 시한부 candidate 문서로 작성. P10 step 3b/4 의 deferred 사유는
> [`docs/PLAN.md`](../../PLAN.md) row 16 + lesson
> [`broadcast/persist 비대칭`](../../../memory/lessons/boot-windows/2026-05-06-broadcast-persist-asymmetry-store-extraction-limit/memory.md)
> 참조. 본문은 history 보존.

Last updated: 2026-05-05 (retired 2026-05-06)

현재 코드 기준으로 다시 스캔한 후속 리팩토링 후보. 이전 refactor sequencing
문서나 sprint 계약을 대체하지 않고, 다음 작업 단위를 고를 때 참고하는 backlog
성격의 문서다.

## Inspection Method

- 프로덕션 TS/TSX/Rust 파일의 line count 상위권을 확인했다.
- React component/hook의 `useState` / `useEffect` / `useCallback` 밀집도를 확인했다.
- `eslint-disable`, `TODO`, `catch {}`, direct `getState()`, direct `invoke()` 패턴을 확인했다.
- 기존 sprint에서 이미 분해된 파일은 “완료된 분해”가 아니라 “남은 결합” 기준으로 재평가했다.

## Summary

| Priority | Candidate | Primary Concern |
|----------|-----------|-----------------|
| P1 | `DocumentDataGrid.tsx` | document grid orchestration 과 bulk mutation UI 과다 결합 |
| P2 | `QuickLookPanel.tsx` | RDB/document 모드, resize, edit UI 가 단일 파일에 공존 |
| P3 | `tabStore.ts` | store action 안의 cross-store 직접 의존 |
| ~~P4~~ | ~~`tauri.ts`~~ | ~~모든 Tauri invoke wrapper 가 단일 module 에 집중~~ — 완료 (2026-05-05, commit 879b003) |
| P5 | Rust DB/export modules | trait/DTO/test/export writer 책임이 큰 파일에 공존 |
| P6 | `ConnectionDialog.tsx` | URL parsing, credential policy, DBMS form, save/test flow 결합 |
| P7 | Structure editors | Columns/Indexes/Constraints DDL preview/execute flow 중복 |
| P8 | Raw-query edit grid | table grid edit flow 와 유사한 pending/preview/execute 책임 반복 |
| P9 | `DocumentDatabaseTree.tsx` | Mongo tree UI, search auto-expand, drop mutation flow 과다 결합 |
| P10 | stores with side effects | store가 persistence/toast/session/ipc/API orchestration을 직접 보유 |
| P11 | mega tests | 수천 라인 단일 test file로 fixture/intent 탐색 비용 증가 |

## P1 — `src/components/document/DocumentDataGrid.tsx`

### Problem

`DocumentDataGrid`가 data fetch, cancellation, pagination, edit-state adapter,
Mongo bulk delete/update, Add Document flow, MQL preview, dialog rendering을 모두
직접 소유한다. 상태도 grid state, modal state, async mutation state가 한 component
scope에 섞여 있다.

### Why It Matters

- Mongo bulk-write 정책이나 dialog copy를 바꾸는 변경이 grid fetch/edit 흐름과
  같은 파일에서 충돌한다.
- `fetchIdRef` stale guard, Safe Mode gate, query history recording 같은
  load-bearing logic이 JSX dialog와 가까이 붙어 있어 회귀 위험이 높다.
- RDB `DataGrid`와 공유 가능한 keyboard/refresh/cancel 패턴이 재사용되지 않는다.

### Suggested Refactor

- `useDocumentGridData`로 `runFind`, pagination, stale response guard, cancel handler를
  추출한다.
- `useMongoBulkOps`로 deleteMany/updateMany safe-mode decision, JSON patch validation,
  toast/history recording, refetch를 추출한다.
- bulk delete/update dialogs는 `DocumentBulkDeleteDialog`와
  `DocumentBulkUpdateDialog` 같은 presentational component로 분리한다.
- entry component는 toolbar/grid/modal wiring만 남기고 behavior 변경은 하지 않는다.

### Risk

중간 위험. 사용자-visible bulk mutation flow와 query history side effect가 있어서
분해 중 dependency 누락이 생기기 쉽다. hook extraction은 기존 테스트를 유지한 상태에서
작게 진행해야 한다.

### Validation

- `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx`
- bulk mutation 관련 테스트가 별도 파일에 있다면 함께 실행한다.
- 수동 확인: filter 적용 후 delete/update matching dialog copy, safe-mode block,
  성공 후 refetch, history entry 기록.

## P2 — `src/components/shared/QuickLookPanel.tsx`

### Problem

Quick Look panel이 value formatting, edit field rendering, resize shell,
RDB body, document body, BLOB viewer wiring을 한 파일에서 처리한다. RDB body와
document body는 header, resize handle, edit toggle, dirty state 계산 구조가 유사하지만
각 mode 안에 반복되어 있다.

### Why It Matters

- Quick Look의 resize/accessibility 변경이 두 body에 중복 적용되어야 한다.
- edit mode와 read-only BSON tree mode가 같은 파일에 섞여 있어 document 편집 확장 시
  영향 범위가 넓다.
- helper 함수가 component-local이라 다른 grid/detail surface에서 재사용하기 어렵다.

### Suggested Refactor

- `QuickLookShell`을 만들어 height, resize handle, common header controls를 담당하게 한다.
- `RdbQuickLookBody`와 `DocumentQuickLookBody`를 분리하고 shell에 body만 주입한다.
- value formatting/edit helpers는 `quickLookFormat.ts` 또는 `QuickLookPanel/helpers.ts`
  로 이동한다.
- public props는 유지해서 `DataGrid`와 `DocumentDataGrid` call site 변경을 최소화한다.

### Risk

중간 위험. UI 구조와 accessibility role/label이 테스트 대상일 가능성이 높다. 먼저 shell
추출만 하고, helper 이동은 후속 단계로 나누는 편이 안전하다.

### Validation

- `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx`
- 관련 grid integration 테스트 중 Quick Look을 여는 케이스를 함께 실행한다.
- 수동 확인: Cmd/Ctrl+L toggle, panel resize mouse/keyboard, edit toggle, BLOB viewer.

## P3 — `src/stores/tabStore.ts`

### Problem

`tabStore`는 이미 entry-pattern으로 분해되었지만, entry file에
`useMruStore`와 `useQueryHistoryStore` 직접 import가 남아 있다. 코드 주석도 별도
sprint에서 cross-store 의존을 제거해야 한다고 명시한다.

### Why It Matters

- store action이 다른 store의 action을 호출하면 state ownership이 흐려진다.
- 테스트에서 tab action 하나를 검증할 때 MRU/history side effect까지 고려해야 한다.
- store 간 import 금지 규칙의 예외가 장기화되면 새 store coupling이 추가될 가능성이 높다.

### Suggested Refactor

- `addTab`의 MRU marking은 caller layer 또는 `useOpenTableTab` 같은 use-case hook으로
  이동한다.
- query history recording은 query execution/DDL action hook에서 명시적으로 호출하고,
  tab store는 tab-local history만 관리하게 한다.
- 기존 external import path `@stores/tabStore`는 유지한다.
- 변경 전후로 `no-restricted-imports` 예외가 entry file에서 제거되는 것을 목표로 한다.

### Risk

높음. tab open, query execution, DDL history, cross-window sync가 얽혀 있다. 단일 PR에서
모두 제거하기보다 MRU와 history를 별도 단계로 나누는 것이 안전하다.

### Validation

- `pnpm vitest run src/stores/tabStore.test.ts src/stores/mruStore.test.ts src/stores/queryHistoryStore.test.ts`
- `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx src/__tests__/cross-window-connection-sync.test.tsx`
- 수동 확인: table preview/persistent tab open, MRU default target, query history panel.

## P4 — `src/lib/tauri.ts` ✅ 완료 (2026-05-05, commit 879b003)

> 688-line god file이 `src/lib/tauri/{connection,schema,ddl,query,document,export}.ts`
> 6개 도메인 파일 + 15-line barrel `index.ts`로 분해됨. `@lib/tauri` import surface는
> 변경 없음. 아래 원문은 history 보존용으로 남겨둔다.

### Problem

connection, groups, schema, query execution, document browse/mutate, export wrapper가
하나의 `tauri.ts`에 집중되어 있다. 대부분 단순 `invoke` wrapper지만 domain별 변경이
같은 파일에서 충돌한다.

### Why It Matters

- 새 Tauri command를 추가할 때 unrelated import/type block까지 수정하게 된다.
- frontend domain에서 필요한 API 경계가 파일 구조에 드러나지 않는다.
- 문서/테스트에서 command group을 찾기 어렵다.

### Suggested Refactor

- `src/lib/tauri/connection.ts`, `schema.ts`, `query.ts`, `document.ts`, `export.ts`로
  domain별 wrapper를 이동한다.
- `src/lib/tauri.ts`는 기존 import 호환을 위한 barrel export로 유지한다.
- type exports도 domain 파일 근처에 배치하되, public type name은 변경하지 않는다.
- 첫 단계는 pure move로 제한하고 wrapper signature 변경은 하지 않는다.

### Risk

낮음-중간. 동작 변경 없이 move-only로 가능하지만 import alias와 test mock path가 깨질 수 있다.
기존 `@lib/tauri` barrel을 유지하면 위험을 낮출 수 있다.

### Validation

- `pnpm vitest run src/lib/api src/lib/tauri.test.ts`
- `rg '@lib/tauri' src --glob '*.{ts,tsx}'`로 import 호환 확인.
- `pnpm build` 또는 최소 `pnpm lint`로 barrel/export 누락 확인.

## P5 — Rust DB/export modules

### Problem

`src-tauri/src/db/mod.rs`는 adapter trait, DTO, default impl, test fake가 함께 있고,
`src-tauri/src/commands/export.rs`는 command handler, format writer, schema dump helper,
대량 unit test가 한 파일에 집중되어 있다.

### Why It Matters

- DB adapter trait 변경 시 DTO/test scaffolding과 같은 파일에서 충돌한다.
- export format 하나를 수정해도 schema dump나 command handler 영역까지 탐색해야 한다.
- Rust unit tests가 prod module 하단에 매우 길게 붙어 있어 실제 production surface가
  흐려진다.

### Suggested Refactor

- `db/mod.rs`는 public module entry로 유지하고 DTO는 `db/types.rs`, trait은
  `db/traits.rs`, test fakes는 `#[cfg(test)] db/test_support.rs`로 이동한다.
- `commands/export.rs`는 command entry를 유지하고 writer 로직은
  `commands/export/{grid,sql_dump,format}.rs`로 분리한다.
- Tauri `#[command]` macro 제약이 있는 exported command function의 path는 기존
  invoke handler와 호환되게 보존한다.

### Risk

중간-높음. Rust module path와 command macro path가 민감하다. 먼저 tests-only 분리 또는
pure helper 분리부터 진행하는 편이 안전하다.

### Validation

- `cargo test --manifest-path src-tauri/Cargo.toml`
- export만 좁히려면 `cargo test --manifest-path src-tauri/Cargo.toml commands::export`
- `pnpm build`로 Tauri command type/import 영향 확인.

## P6 — `src/components/connection/ConnectionDialog.tsx`

### Problem

Connection dialog가 URL mode, form mode, host-paste URL detection, host:port blur split,
DBMS type 변경 confirmation, password keep/clear/set 정책, save/test dispatch, error
sanitization, full dialog layout을 한 component에서 처리한다.

### Why It Matters

- credential policy와 UI layout이 같은 scope에 있어 password leak 방어 로직을 수정할 때
  unrelated JSX까지 함께 읽어야 한다.
- form-mode paste detection과 URL-mode parse flow가 서로 비슷하지만 별도 handler에 있다.
- DBMS-specific field component는 이미 분리됐지만, dialog-level form state machine은 여전히
  central component에 집중되어 있다.

### Suggested Refactor

- `useConnectionDraftForm`으로 draft mutation, DB type change confirmation,
  password resolution, trim policy를 이동한다.
- `useConnectionUrlImport`로 URL-mode parse와 host-paste detection을 통합한다.
- `ConnectionDialogBody`/`ConnectionDialogFooter`를 presentational component로 분리하되,
  `sanitizeMessage`와 public dialog props는 유지한다.

### Risk

높음. password masking, URL parsing, SQLite file path, DBMS default replacement가 모두
사용자-facing 정책이다. behavior-preserving extraction으로만 시작해야 한다.

### Validation

- `pnpm vitest run src/components/connection/ConnectionDialog.test.tsx src/components/connection/ConnectionDialog.urlInput.test.tsx`
- 수동 확인: 새 연결, 기존 연결 수정, password keep/clear/set, host field URL paste,
  URL mode parse, custom port DBMS change confirmation.

## P7 — Structure editors

### Problem

`ColumnsEditor`, `IndexesEditor`, `ConstraintsEditor`가 각각 DDL preview, Safe Mode gate,
warn-tier confirmation, execute, refresh, query history recording을 자체 구현한다. UI와
domain payload는 다르지만 commit lifecycle은 거의 같은 구조다.

### Why It Matters

- Safe Mode wording이나 history source 정책을 바꾸면 3개 editor를 모두 수정해야 한다.
- `pendingExecuteRef`, `previewSql`, `previewError`, `runPendingExecute` 같은 state machine이
  editor별로 반복된다.
- future DDL editor가 추가되면 같은 lifecycle을 다시 복사할 가능성이 높다.

### Suggested Refactor

- `useDdlPreviewExecution` hook을 만들어 preview SQL, pending executor, Safe Mode gate,
  history recording, confirm/cancel을 공통화한다.
- 각 editor는 “preview request 만들기”와 “execute request 만들기”만 hook에 전달한다.
- table rendering과 add/create modal은 각 editor에 남긴다.

### Risk

중간. DDL별 Tauri payload는 서로 다르므로 hook이 너무 generic해지면 오히려 복잡해진다.
최소 공통 lifecycle만 추출하고 domain request builder는 각 editor에 남겨야 한다.

### Validation

- `pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx`
- 수동 확인: add/modify/drop column, create/drop index, add/drop constraint,
  Safe Mode block/warn/allow, query history entry.

## P8 — `src/components/query/EditableQueryResultGrid.tsx`

### Problem

Raw-query result editing이 table grid edit flow와 별도로 pending edits, deleted rows,
SQL preview, Safe Mode gate, execute batch, query history, context menu, cell detail dialog를
직접 구현한다. `useDataGridEdit` / `useDataGridPreviewCommit`와 개념적으로 겹치지만
공유되는 부분이 제한적이다.

### Why It Matters

- table grid와 raw-query edit grid의 commit UX가 drift될 수 있다.
- pending edit merge, unchanged-skip, preview modal, warn-tier confirm 같은 정책이
  두 계열에 따로 존재한다.
- raw-query edit는 primary-key plan이라는 특수성이 있지만, lifecycle 전체를 별도 구현할
  필요는 없다.

### Suggested Refactor

- raw-query 전용 hook `useRawQueryGridEdit`를 먼저 추출해 component에서 state machine을
  분리한다.
- 이후 `useDataGridPreviewCommit`과 공유 가능한 commit runner/history writer만 좁게
  공통화한다.
- SQL preview modal은 기존 `SqlPreviewDialog` 또는 structure editor 공통 preview shell과
  맞출 수 있는지 별도 검토한다.

### Risk

중간. raw-query editability plan과 structured table edit는 source row model이 달라서
성급한 통합은 위험하다. 먼저 hook extraction, 그 다음 shared lifecycle 추출이 안전하다.

### Validation

- `pnpm vitest run src/components/query/EditableQueryResultGrid.test.tsx src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`
- raw query single-table PK result에서 edit/delete/preview/execute/revert/discard 확인.

## P9 — `src/components/schema/DocumentDatabaseTree.tsx`

### Problem

Document tree가 database/collection load, active DB auto-reload, search filtering,
auto-expand bookkeeping, preview/persistent tab open, drop collection Safe Mode/history,
confirm dialog rendering을 모두 보유한다. RDB `SchemaTree`는 이미 entry/submodule pattern으로
분해됐지만 document tree는 아직 단일 component에 가깝다.

### Why It Matters

- tree search/expand behavior와 destructive collection operation이 같은 component에 있다.
- RDB tree와 document tree의 click semantics, preview tab semantics, destructive confirm
  UX가 병렬로 유지되어야 하지만 공통 abstraction이 없다.
- `react-hooks/exhaustive-deps` 예외가 search auto-expand effect에 남아 있어 future edit 시
  stale closure 위험을 다시 검토해야 한다.

### Suggested Refactor

- `useDocumentTreeData`로 loadDatabases/loadCollections/loading state/active DB reload guard를
  추출한다.
- `useDocumentTreeActions`로 open tab/drop collection/history/Safe Mode flow를 추출한다.
- `DocumentTreeRows`를 presentational renderer로 분리하고, RDB tree의 row conventions와
  맞출 수 있는 부분만 공유한다.

### Risk

중간. sidebar navigation은 회귀가 눈에 잘 띄지만, auto-expand/search state는 테스트 없이
깨지기 쉽다. existing tests를 먼저 고정하고 move-only로 진행해야 한다.

### Validation

- `pnpm vitest run src/components/schema/DocumentDatabaseTree.test.tsx src/components/schema/SchemaTree.preview.test.tsx`
- 수동 확인: DB expand/collapse, collection search match auto-expand, single-click preview tab,
  double-click persistent tab, drop collection refresh.

## P10 — stores with side effects

### Problem

`connectionStore`와 `schemaStore`는 Zustand state뿐 아니라 Tauri calls, toast,
session persistence, IPC bridge attach, optimistic cache refresh fallback까지 직접 소유한다.
일부 hooks는 이를 보완하려고 `useConnectionLifecycle`, `useSchemaCache`,
`useMigrationExport` 같은 orchestration layer를 따로 두지만 경계가 일관적이지 않다.

### Why It Matters

- store unit test가 API orchestration과 UI notification policy를 같이 검증하게 된다.
- cache mutation helper와 user-facing side effect(toast/session)가 섞여 있어 재사용성이 낮다.
- direct `getState()` 기반 orchestration이 hook/store 사이에 분산되어 dependency 방향을
  추적하기 어렵다.

### Suggested Refactor

- store는 state transition과 cache mutation을 중심으로 축소한다.
- user-facing toast/session persistence/API sequences는 use-case hook으로 점진 이동한다.
- 기존 sync bridge attach는 entry module에 유지하되, bridge setup과 store actions를
  파일상 분리한다.

### Risk

높음. lifecycle, multi-window sync, session hydration이 얽혀 있어 큰 폭의 재배치는 위험하다.
한 번에 전체 store architecture를 바꾸지 말고 connection lifecycle 한 흐름씩 이동한다.

### Validation

- `pnpm vitest run src/stores/connectionStore.test.ts src/stores/schemaStore.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useSchemaCache.test.ts`
- `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx`

## P11 — mega tests

### Problem

`SchemaTree.test.tsx`, `tabStore.test.ts`, `QueryTab.test.tsx`,
`StructurePanel.test.tsx`, `DataGrid.test.tsx` 같은 test files가 1,900~2,900라인 규모다.
테스트 커버리지는 많지만 fixture/setup/helper가 한 파일에 누적되어 의도 탐색 비용이 크다.

### Why It Matters

- 리팩토링 중 어떤 regression guard가 어느 behavior를 보호하는지 찾기 어렵다.
- 큰 test file은 작은 feature 변경에도 merge conflict가 나기 쉽다.
- 공통 fixture가 암묵적으로 공유되면 테스트 간 coupling이 강해진다.

### Suggested Refactor

- behavior axis 기준으로 split한다. 예: `SchemaTree.opening.test.tsx`,
  `SchemaTree.ddl-actions.test.tsx`, `SchemaTree.search.test.tsx`.
- shared setup은 `__tests__/helpers` 또는 component-local `test-utils.ts`로 이동한다.
- 테스트 이름과 파일명이 feature intent를 드러내게 하고, 단순 line-count split은 피한다.

### Risk

낮음-중간. 동작 변경은 없지만 test ordering/hoisting/mock lifecycle이 깨질 수 있다.
한 파일씩 split하고 동일 subset test를 즉시 실행해야 한다.

### Validation

- split 대상 파일별 기존 test command를 동일하게 실행한다.
- `pnpm vitest run`까지 확장해 mock leakage가 없는지 확인한다.

## General Refactoring Rules

- 먼저 move-only/refactor-only commit으로 시작하고 behavior 변경을 섞지 않는다.
- 기존 public import path와 component props는 가능한 한 유지한다.
- 큰 파일 분해는 entry file을 남기는 pattern을 따른다.
- 각 후보는 관련 test subset을 먼저 실행하고, 통과 후 broader test로 확장한다.
