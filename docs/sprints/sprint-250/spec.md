# Feature Spec: DataGrid 편집 UX 종합 polish + Preview SQL dialog polish (Sprints 250–252)

## Description

다섯 개의 합의된 polish 항목 (R1–R5) 을 세 sprint 으로 나눠 점진적으로 출시한다 — Sprint 250 은 DataGrid 의 cell-edit 종료 흐름을 손가락 모델 (빈 공간 클릭 = 저장, Esc = 모두 버림) 에 맞춰 정리하고, Sprint 251 은 pending edit / undo state 를 zustand store 로 끌어올려 탭 전환에도 살아남게 만들며, Sprint 252 는 SQL/MQL Preview dialog 에 클립보드 copy 버튼과 CodeMirror 기반 read-only syntax highlight 를 도입해 commit 직전 가독성과 외부 공유성을 동시에 개선한다. 다섯 개를 한 번에 묶지 않는 이유는 Sprint 250 / 252 가 사용자 가시 변경 위주인 반면 Sprint 251 은 store lifecycle 결정 (purge timing, persistence) 이라는 별도의 설계 모멘트를 가지기 때문이며, 이 분할 자체는 사전 합의됐고 본 spec 에서 변경하지 않는다.

## Sprint Breakdown

### Sprint 250: DataGrid 편집 UX — onBlur commit + modal-aware Esc discard

**Goal**: cell 편집의 종료가 두 가지 자연스러운 손가락 동작 — (a) 그리드 외부 클릭 → 그 cell 의 변경 commit (현 Tab/Enter 와 동일 의미), (b) Esc → 모든 pending 수정사항 폐기 (현 Discard 버튼과 동일 의미) — 으로 통일된다. 단 Esc 동작은 modal/dialog 가 열려있는 동안에는 작동하지 않아야 한다 (modal 의 Esc-닫기 가 우선).

**Verification Profile**: `command` (vitest + lint + typecheck)

**Acceptance Criteria**:

1. `AC-250-01` 활성 cell editor 의 input/textbox 가 focus 를 잃을 때 (다른 cell 클릭, toolbar 영역 클릭, grid 바깥 영역 클릭 등 모든 blur 경로 포함), `saveCurrentEdit` 와 동일한 결과가 발생한다 — 값이 변경됐으면 pendingEdits 에 반영, 변경 없으면 no-op, 탭/엔터 commit 과 동일한 LIFO undo snapshot 정책. Vitest 로 input 에 `focus()` → 값 변경 → input 외부 element 에 클릭/`focus()` 를 트리거하면 onBlur path 가 commit 을 발동함을 검증한다.
2. `AC-250-02` Esc 키를 grid 영역 (또는 document body) 에서 누르고 — 그리고 dialog/modal 이 하나도 열려있지 않을 때 — `handleDiscard` 와 동일하게 모든 pending state (pendingEdits, pendingNewRows, pendingDeletedRowKeys, undoStack) 가 비워진다. Vitest 로 pending 변경을 만들고 → Esc keydown dispatch → state 가 baseline 으로 돌아오는지 확인한다.
3. `AC-250-03` Esc keydown 시 document 어딘가에 modal 또는 dialog (Radix Dialog, Confirm dialog, Preview dialog, Cell detail dialog, BLOB viewer 등 — `[role="dialog"]` 또는 동등한 신호) 가 열려 있다면 grid 의 discard handler 는 발동하지 않고 modal 의 Esc-close 가 우선된다. Vitest 로 dialog open 상태를 mount 하고 Esc dispatch → 그리드 pending state 는 보존, dialog 만 닫히는지 확인한다.
4. `AC-250-04` 활성 cell 의 input 안에서 Esc 를 누르면 기존 cell-cancel 동작 (해당 cell 의 미저장 입력 폐기 + editor 닫음) 만 발동하고 grid-wide discard 는 발동하지 않는다 — 즉 editor-local Esc 가 grid-wide Esc 보다 우선한다. Vitest 로 cell 진입 → 값 변경 → Esc → 해당 cell 만 cancel, 다른 pending 행/편집은 보존됨을 확인한다.
5. `AC-250-05` onBlur commit 흐름이 race / loop 를 만들지 않는다: input 의 onBlur 가 발동시킨 commit 으로 인한 re-render 가 다시 onBlur → commit 을 재귀 발동하지 않으며, 진행 중인 input 값 setState 가 commit 결과에 의해 덮어써지지 않는다. Vitest 로 onBlur 를 두 번 연속 트리거해 commit handler 가 expected 횟수만 호출됨을 검증한다.
6. `AC-250-06` Mongo (read-only) DocumentDataGrid / DDL editor / raw query grid 는 본 sprint 의 변경 영향 외이며, 기존 behaviour 가 회귀하지 않는다 — 관련 vitest suite 가 모두 그대로 통과해야 한다.

**Components to Create/Modify**:
- `src/components/datagrid/useDataGridEdit.ts`: onBlur commit 진입점이 호출 가능한 형태로 노출돼 있어야 한다 (이미 존재하는 `saveCurrentEdit` 의 활용 또는 보강).
- `src/components/datagrid/DataGridTable.tsx` / `src/components/datagrid/DataGridTable/DataRow.tsx`: 활성 cell input 및 NULL chip editor 의 blur 신호가 commit 으로 라우팅되도록 wire-up.
- `src/components/rdb/DataGrid.tsx`: 전역 keydown listener 가 Esc 를 받아 (modal 이 열려있지 않을 때만) discard 와 동일 효과를 발동하도록 wire-up.
- `src/components/datagrid/DataGridToolbar.tsx`: 변경 없음 — Discard 버튼은 여전히 동일 동작의 마우스 진입점.

---

### Sprint 251: DataGrid pending edits — 탭 전환 후 유지

**Goal**: 사용자가 (connectionId, schema, table) 한 grid 에서 pending edit / new row / delete / undo stack 을 만들어 두고 다른 탭으로 이동한 뒤 돌아왔을 때, 모든 pending state 와 undo history 가 그대로 보존된다. 탭의 unmount/remount 가 더 이상 사용자의 작업물을 잃지 않도록 zustand store 로 lift 한다.

**Verification Profile**: `command` (vitest + lint + typecheck)

**Acceptance Criteria**:

1. `AC-251-01` `pendingEdits`, `pendingNewRows`, `pendingDeletedRowKeys`, `undoStack` 네 슬라이스가 (connectionId, schema, table) 키 단위로 zustand store 에 저장된다. Vitest 로 두 다른 (connectionId, schema, table) 키에 대해 동시에 pending state 를 세팅하고 서로 간섭이 없는지 확인한다.
2. `AC-251-02` 사용자가 탭 A 에서 cell 편집 / Add / Delete / Duplicate 를 한 뒤 탭 B 로 전환했다가 탭 A 로 돌아오면 — useDataGridEdit 가 unmount/remount 되더라도 — pending state 4 슬라이스 + canUndo 가 직전 상태와 동일하게 복원된다. Vitest 로 hook 을 unmount → remount 시 store 에서 read 하는 흐름을 검증한다.
3. `AC-251-03` `clearAllPending` (commit 성공 / 명시적 discard) 는 store 에서도 해당 키 entry 의 모든 슬라이스 (pendingEdits / pendingNewRows / pendingDeletedRowKeys / undoStack) 를 비운다. Vitest 로 commit-성공 path 와 discard path 양쪽에서 store entry 가 baseline 으로 돌아오는지 확인한다.
4. `AC-251-04` 탭이 닫힐 때 (`tabStore.removeTab` / `clearTabsForConnection`) 또는 connection 자체가 사라질 때, 해당 키의 store entry 가 명시적으로 purge 된다 (메모리 누수 방지). Vitest 로 tab close → store getState 에서 해당 entry 가 사라지는지 확인.
5. `AC-251-05` `tabStore.dirtyTabIds` 의 publish 동작 (Sprint 0–249 가 의존) 은 회귀하지 않는다 — store-lifted pending state 변화가 여전히 active 탭의 dirty dot 을 발동시킨다. Vitest 로 store update → setTabDirty 동작 확인.
6. `AC-251-06` Sprint 249 의 9 개 undo AC + Sprint 250 의 onBlur/Esc AC 가 회귀 없이 store-backed 환경에서도 동일하게 통과한다. 회귀 테스트로 `useDataGridEdit.undo.test.ts` + `DataGrid.undo.test.tsx` + Sprint 250 신규 테스트 모두 그대로 pass.
7. `AC-251-07` (out-of-scope 명시) 본 sprint 는 store entry 의 cross-window 동기화 / localStorage persistence / cross-tab 동시 commit 정책을 도입하지 않는다 — store entry 는 in-memory only. ADR 또는 spec footnote 로 명시.

**Components to Create/Modify**:
- 신규 store: pending edit state 4 슬라이스 + 키 단위 entry lifecycle (set/get/clear/purge) 만 책임지는 zustand store. 이름과 위치는 Generator 가 결정 (가이드만: `src/stores/` 하위, naming convention 은 `*Store.ts`, persist 안 함).
- `src/components/datagrid/useDataGridEdit.ts`: 4 슬라이스의 source-of-truth 가 useState 에서 store selector + setter 로 이동. 외부 returned shape 는 보존.
- `src/stores/tabStore.ts` / `src/stores/tabStore/types.ts`: `removeTab` / `clearTabsForConnection` 가 신규 store 의 purge action 을 호출하도록 wire-up (또는 신규 store 가 tabStore subscribe).
- 기존 useDataGridEdit 테스트: store-mocking 으로 update — public hook 동작은 동일하게 유지.

---

### Sprint 252: Preview SQL dialog polish — Copy + Syntax Highlight

**Goal**: SQL/MQL Preview dialog 에 (a) 본문을 클립보드로 복사할 수 있는 버튼과 (b) read-only syntax highlight 를 추가한다. Highlight 는 프로젝트에 이미 들어와 있는 CodeMirror 에디터의 read-only mount 로 통일해, 향후 dialect 추가 시 동일 통합 지점에서 확장 가능하게 한다.

**Verification Profile**: `command` (vitest + lint + typecheck — 시각 polish 이지만 testid + 클립보드 carrier mocking 으로 검증)

**Acceptance Criteria**:

1. `AC-252-01` `PreviewDialog` 가 본문 (preview/children) 영역 근처에 안정적인 testid (예: `preview-dialog-copy`) 와 명시적 `aria-label` 을 가진 Copy 버튼을 렌더한다. Vitest 로 dialog mount → 버튼이 by role 로 발견됨을 확인한다.
2. `AC-252-02` Copy 버튼 클릭 시 본문에 표시된 SQL/MQL 전체가 클립보드 carrier (`navigator.clipboard.writeText` 또는 동등한 fallback) 로 전달된다. Vitest 로 carrier mocking → 정확한 텍스트가 한 번 전달됨을 검증한다.
3. `AC-252-03` Copy 동작 성공 시 사용자에게 가시 피드백 (예: 버튼 라벨/icon transient 변화 또는 toast) 이 발생하고, 실패 시 (carrier reject) 무음 실패가 아닌 재시도 가능한 피드백 (toast 또는 inline 메시지) 이 발생한다. Vitest 로 양쪽 path 가 분기됨을 검증.
4. `AC-252-04` Preview body 가 빈 문자열일 때 (예: pendingEdits 가 비어 있는 상태에서 dialog 가 열린 경우) Copy 버튼은 disabled 또는 호출 시 no-op + 사용자 피드백을 통해 빈 클립보드로 덮어쓰지 않음을 보장한다. Vitest 로 빈 body 케이스 검증.
5. `AC-252-05` Preview body 의 텍스트가 SQL syntax highlighting 을 적용받는다 — 키워드/문자열/숫자/주석 등이 시각적으로 구분되는 마커 (예: CodeMirror 의 `.cm-keyword` 또는 동등한 className 신호) 가 DOM 에 존재한다. Vitest 로 dialog mount → highlight marker 의 존재를 by querySelector 로 확인한다.
6. `AC-252-06` Highlight 컴포넌트는 read-only (편집 불가, copy 만 가능) 이며 사용자의 키보드 dispatch 가 본문을 변경하지 못한다. Vitest 로 keydown 입력 시 본문 텍스트가 보존됨을 확인한다.
7. `AC-252-07` MQL preview (`MqlPreviewModal`) 는 SQL 과 다른 dialect — Mongo 명령 문자열에는 SQL 키워드 색이 잘못 칠해지지 않는다. Vitest 로 Mongo 본문에서는 SQL 키워드 마커가 출현하지 않거나, MQL-적합 강조 (또는 plain) 로 fall back 함을 확인한다.
8. `AC-252-08` 모든 `PreviewDialog` 호출자 (`SqlPreviewDialog`, `MqlPreviewModal`, `CellDetailDialog`, `DataGrid` inline preview, `CreateTableDialog`, structure editors `IndexesEditor`/`ColumnsEditor`/`ConstraintsEditor` 등) 가 본 변경 이후에도 회귀 없이 렌더된다 — 기존 vitest suite 가 그대로 통과한다.
9. `AC-252-09` Commit error / generation error / loading / 환경 stripe 등 기존 PreviewDialog 의 부수 props 는 변경 없이 동작한다 (회귀).

**Components to Create/Modify**:
- `src/components/ui/dialog/PreviewDialog.tsx`: Copy 버튼 + syntax-highlighted body carrier 를 props 또는 default 로 도입. 호출자가 highlight dialect 를 지정할 수 있는 좁은 enum (예: `"sql" | "mql" | "plain"`) 노출.
- `src/components/structure/SqlPreviewDialog.tsx`: 새 dialect prop 으로 SQL highlighting 을 활성화.
- `src/components/document/MqlPreviewModal.tsx`: 새 dialect prop 으로 MQL (또는 plain) highlighting 을 활성화.
- `src/components/rdb/DataGrid.tsx`: inline `<Dialog>` 기반 SQL Preview 를 PreviewDialog 의 SQL 모드로 통일하거나, 동일한 Copy + highlight 어포던스를 동일 testid 로 노출.
- 호출자: `CellDetailDialog`, `CreateTableDialog`, `IndexesEditor`, `ColumnsEditor`, `ConstraintsEditor` 는 자동으로 polish 를 받아야 하며 회귀 없음.

---

## Global Acceptance Criteria

1. `AC-GLOBAL-01` 모든 sprint 의 변경은 `pnpm tsc --noEmit` 0 errors, `pnpm lint` 0 errors / 0 warnings, `pnpm vitest run` 모두 통과해야 한다.
2. `AC-GLOBAL-02` Rust 미변경 — `cargo test --lib --manifest-path src-tauri/Cargo.toml` 와 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` 가 회귀 없이 통과 (sprint 250–252 모두 frontend-only).
3. `AC-GLOBAL-03` 신규 / 변경 파일은 라인 70% 이상 coverage. 각 sprint handoff 가 결과를 인용한다.
4. `AC-GLOBAL-04` `it.skip` / `it.todo` / `xit` 도입 금지 (skip-zero gate).
5. `AC-GLOBAL-05` Sprint 249 의 9 개 undo AC, Sprint 248 의 dry-run AC, Safe Mode 매트릭스 (ADR 0022 Phase 1–5), Mongo grid read-only invariant 모두 회귀 없음.
6. `AC-GLOBAL-06` Per-tab vs all-tabs commit 정책은 본 spec 범위 외 (Sprint 252 의 Copy 버튼이 per-tab path 를 OK 한다는 가정만 인정).

## Data Flow

- **Sprint 250**: 순수 UI/이벤트 흐름 — input 의 onBlur 가 hook 의 commit 진입점을 호출, 전역 Esc keydown 이 (modal-aware) discard 진입점을 호출. IPC / store 변경 없음.
- **Sprint 251**: useDataGridEdit 의 4 슬라이스가 useState → zustand selector + setter 로 이동. tabStore.removeTab / clearTabsForConnection 이 신규 store 의 purge action 을 발동. Cross-window 동기화 / localStorage persistence 없음.
- **Sprint 252**: PreviewDialog 가 클립보드 carrier (`navigator.clipboard.writeText`) 와 CodeMirror read-only mount 를 추가 dependency 로 사용. IPC 변경 없음.

## UI States

- **Sprint 250**:
  - **Idle**: 활성 cell 없음 — onBlur path 비활성, Esc path 는 dialog 무존재 시 discard 후보.
  - **Editing**: cell 진입 후 — input blur → commit (값 변경 시), Esc-in-input → cell-local cancel.
  - **Has pending changes**: Esc → 모든 pending 폐기 (modal 무존재 시).
  - **Modal open**: Esc → modal close 우선, grid discard 무발동.
  - **Error**: commit 실패 (coercion error 등) — 기존 inline hint 흐름 유지.

- **Sprint 251**:
  - **First mount of (cid,schema,table)**: store entry 비어 있음 → empty pending state.
  - **Re-mount after tab switch**: store entry 존재 → pending state + undoStack 그대로 복원.
  - **After commit success / discard**: store entry 비워짐 → 다음 mount 시 empty.
  - **Tab close**: store entry purge → 다음 mount (같은 키 재오픈) 시 empty.

- **Sprint 252**:
  - **Empty preview**: Copy 버튼 disabled / no-op + 사용자 피드백.
  - **Populated preview**: highlight 적용된 본문 + Copy 버튼 enabled.
  - **Copy success**: 가시 피드백 (transient).
  - **Copy failure**: 사용자 피드백 (toast 또는 inline).
  - **Commit error overlay**: 기존 destructive banner 와 새 polish 는 공존.

## Edge Cases

- **Sprint 250**:
  - input value 가 setState in-flight 인 동안 onBlur 가 발동 — commit 은 가장 최근 사용자 입력값을 누락하지 않아야 함 (race).
  - 같은 cell 의 onBlur → 이어서 같은 cell 의 click → re-edit 진입: 무한 commit/edit 사이클 금지.
  - Esc 가 발동되는 시점에 cell input 이 focus — editor-local Esc 가 우선, grid-wide discard 발동 안 됨.
  - 다양한 modal (Radix Dialog, BLOB viewer, CellDetailDialog, ConfirmDestructiveDialog, SQL Preview, FilterBar 의 일부 popover) 가 열린 모든 케이스에서 Esc 우선순위가 일관됨.
  - context menu / popover open 상태에서 onBlur — 일관된 commit 동작.

- **Sprint 251**:
  - 같은 (connectionId, schema, table) 키의 grid 가 두 윈도우에서 동시에 mount 된 경우 — in-memory store 는 본 sprint 범위에서 마지막-쓰기-우승 (cross-window 동기화 없음, 명시).
  - undoStack 50 한도가 store 로 lift 된 후에도 동일 보존.
  - Connection 삭제 시 모든 키 entry purge (대량 entry 가 leak 되지 않도록 bulk purge action 명시 필요).
  - Hot reload / fast refresh 중 store identity 유지 — pending 작업물이 dev 환경에서 사라지지 않음.
  - 동일 (cid,schema,table) 키의 두 탭 (preview + persistent) 이 동시 존재할 경우 동일 entry 를 공유하는 게 의도 — 사용자가 어느 탭에서든 같은 pending 을 본다.

- **Sprint 252**:
  - 클립보드 API 가 비활성화/거부된 환경 (file://, secure context 미충족, 권한 거부) — 무음 실패 금지, 사용자 피드백 발동.
  - 매우 긴 SQL (수천 줄) 의 Copy — 단일 carrier 호출로 처리, UI 멈춤 없음.
  - SQL 본문이 empty / whitespace-only — Copy disabled 또는 no-op.
  - Highlight 가 비-표준 dialect (PG `"identifier"` 등) 를 안전하게 처리 (회귀 가드).
  - Dialog 가 빠르게 open/close 반복될 때 CodeMirror mount/unmount 의 메모리/이벤트 누수 없음.
  - CellDetailDialog / BLOB viewer 등 SQL 이 아닌 본문에서 SQL highlighting 이 적용되지 않도록 dialect prop 으로 격리.

## Visual Direction (Sprint 252 only)

- Copy 버튼은 Preview body 의 우측-상단 또는 footer 좌측에 위치하는 작은 secondary action — destructive 가 아닌 neutral tone. Icon + 짧은 라벨 ("Copy") 또는 icon-only with `aria-label`.
- Highlight color 는 기존 `text-syntax-keyword` 등 기존 SqlSyntax 토큰 색과 시각적으로 일관 — CodeMirror 의 read-only 모드여도 톤이 튀지 않게.
- 변경 후에도 dialog 의 폭/높이/여백이 기존 호출자 모두에서 안정 (visual regression 가드).

## Verification Hints

- **Sprint 250**:
  - `pnpm vitest run src/components/datagrid/useDataGridEdit.*.test.ts src/components/datagrid/DataGridTable.editing-visual.test.tsx src/components/rdb/DataGrid.editing.test.tsx`
  - 신규 테스트 파일에서 `[AC-250-*]` 매핑 명시.
  - 브라우저 수동 스모크: cell 진입 → 다른 영역 클릭 → commit 확인 / pending 만든 뒤 Esc → 모두 폐기 / dialog 열어둔 채 Esc → dialog 만 닫힘.

- **Sprint 251**:
  - `pnpm vitest run src/stores/<신규>.test.ts src/components/datagrid/useDataGridEdit.*.test.ts src/components/rdb/DataGrid.undo.test.tsx`
  - tab switch 시뮬레이션 (hook unmount → remount) 케이스 명시.
  - 브라우저 수동 스모크: 탭 A 에서 cell 편집 → 탭 B 전환 → 탭 A 복귀 → 편집 보존 확인.

- **Sprint 252**:
  - `pnpm vitest run src/components/ui/dialog/__tests__/PreviewDialog.test.tsx src/components/structure/SqlPreviewDialog.test.tsx src/components/document/MqlPreviewModal*.test.tsx`
  - `navigator.clipboard.writeText` mocking 으로 Copy carrier 검증.
  - DOM 검증: `[data-testid="preview-dialog-copy"]` 존재, syntax-highlight marker (예: `.cm-keyword` 또는 동등) 존재.
  - 브라우저 수동 스모크: SQL Preview 열기 → highlight 시각 확인 → Copy 클릭 → 클립보드 paste 확인.

## Out of Scope (모든 sprint 공통)

- Per-tab vs all-tabs commit 정책 결정.
- Mongo grid 의 편집 (read-only 유지).
- DDL editor / raw query grid 의 onBlur commit / Esc discard / store-lift (Sprint 252 의 PreviewDialog polish 가 이들 호출자에 자동 적용되는 것은 예외이며 회귀만 보장).
- Cross-window pending state 동기화 / localStorage persistence (Sprint 251).
- Redo (Cmd+Shift+Z) — Sprint 249 의 out-of-scope 가 본 spec 에서도 유지.
- Commit-after DML reverse (ADR 0022).
- 새 ADR 작성 — 본 spec 은 Sprint 249 contract + ADR 0022 Phase 5 의 약속 위에서 동작.
