# Sprint 200 — Handoff

Sprint: `sprint-200` (refactor — `DataGridTable.tsx` 1071-line god file
분해).
Date: 2026-05-02.
Status: closed.
Type: refactor (행동 변경 0; 컴포넌트 재구성).

## 어디까지 했나

`DataGridTable.tsx` (1071 lines, frontend god file #2) 를 entry shell
(501) + 6 sub-file 로 분해 — `columnUtils` (76, pure) + 3 hook
(`useCellNavigation` 114 / `useColumnResize` 140 / `useContextMenu` +
`buildContextMenuItems` 207) + 2 component (`HeaderRow` 136 /
`DataRow` 399). 외부 사용 (`<DataGridTable>` props / `parseFkReference`
named export) 무변화, DOM byte-for-byte 동등, 12 spec / 112 case 무수정
통과.

본 sprint 가 `docs/PLAN.md` 의 "리팩토링 sequencing (Sprint 199–...,
post-198 cycle)" **두 번째 항목** (Sprint 199 SchemaTree 분해 다음).
다음 god file 후보 (`QueryTab.tsx` 1040, `tabStore.ts` 1002) 가 후속
sprint 에서 같은 entry-pattern 으로 분해 예정.

## Files changed

### Frontend (TS / React)

| 파일 | Purpose |
|------|---------|
| **MOD** `src/components/datagrid/DataGridTable.tsx` | 1071 → 501 (-570, -53%). entry shell — imports + `DataGridTableProps` interface (96, 무변화) + state/refs (tableRef / editorFocusRef / blobViewer / cellDetail) + 파생값 (visualCount / order / totalBodyRowCount / shouldVirtualize) + 3 hook 호출 (cell-navigation / column-resize / context-menu) + virtualizer wiring + scroll-to-top effect + useDelayedFlag + rowCtx useMemo (deps 17) + return JSX (HeaderRow / virtualized·eager DataRow / empty branch / pendingNewRows / 3 dialog). **`parseFkReference` re-export 보존**. |
| **NEW** `src/components/datagrid/DataGridTable/columnUtils.ts` | pure helper module. `parseFkReference` (Rust `format_fk_reference` 와 lock-step) + `isBlobColumn` / `calcDefaultColWidth` + `MIN_COL_WIDTH` / `VIRTUALIZE_THRESHOLD` / `ROW_HEIGHT_ESTIMATE` 상수. React import 0, store import 0. |
| **NEW** `src/components/datagrid/DataGridTable/useCellNavigation.ts` | hook — `useCellNavigation({ data, order, pendingEdits, onSaveCurrentEdit, onStartEdit })` → `{ moveEditCursor }`. Tab/Enter 4-direction wrap-around. boundary 도달 시 `onSaveCurrentEdit` 으로 commit + 멈춤 (wrap 안 함). |
| **NEW** `src/components/datagrid/DataGridTable/useColumnResize.ts` | hook — `useColumnResize({ tableRef, columnWidths, onColumnWidthsChange })` → `{ handleResizeStart }`. resizing ref 내부 보유. drag 중 직접 DOM mutation, drag 끝에 store push. document-level mousemove/mouseup cleanup invariant 유지. |
| **NEW** `src/components/datagrid/DataGridTable/contextMenu.tsx` | `useContextMenu` hook (`{ contextMenu, setContextMenu, handleContextMenu }`) + `buildContextMenuItems` pure builder (10 items: Show Cell Details · Edit Cell · Set to NULL · Delete Row · Duplicate Row · separator · Copy Plain Text · JSON · CSV · SQL Insert). 빈 그리드에서는 `handleContextMenu` 가 메뉴 무시. |
| **NEW** `src/components/datagrid/DataGridTable/HeaderRow.tsx` | `<HeaderRow>` 컴포넌트 — `<thead>` sticky bg-secondary + 각 column `<th>` (정렬 click 4px-drag 억제 + Primary Key 아이콘 + sort rank+arrow + data_type subtitle + resize handle). sortMouseStartRef 내부 useRef. |
| **NEW** `src/components/datagrid/DataGridTable/DataRow.tsx` | `<DataRow rowIdx ctx />` 컴포넌트 + `DataGridRowContext` interface. cell render 5 mode 분기 (editing-null / editing-typed / hasPendingEdit / blob / FK link / plain) 통째 흡수. row key `row-${page}-${rowIdx}` 동결 (Sprint 75 invariant). |
| **NEW** `docs/sprints/sprint-200/contract.md` | sprint contract — 6 AC 동결. |
| **NEW** `docs/sprints/sprint-200/findings.md` | 분해 전략 / D1~D7 결정 결과 / 회귀 risk 분석 / out-of-scope 확인. AC-200-01 entry 350 lines 미달 사유 §0. |
| **NEW** `docs/sprints/sprint-200/handoff.md` | 본 파일. |

총 코드: 1 modified + 6 created (frontend). docs 3 신설.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-200-01 | `wc -l src/components/datagrid/DataGridTable.tsx src/components/datagrid/DataGridTable/*` | entry 501 + columnUtils 76 + useCellNavigation 114 + useColumnResize 140 + contextMenu 207 + HeaderRow 136 + DataRow 399. **entry 350 줄 미달** (501) — findings §0 참조 (Sprint 199 의 "3~4 → 5" 처리 답습). 분해 -570 lines (-53%) / 6 sub-file 신규로 god-file 해체 목적 달성. 모든 sub-file 700 한계 충족. |
| AC-200-02 | `git status` modified 파일 / `import DataGridTable` 외부 caller | `DataGridTable.tsx` 1개만 modified. `src/components/rdb/DataGrid.tsx:24` import 무수정. `DataGridTableProps` interface byte-for-byte 동결 (96 lines, 96 lines). |
| AC-200-03 | entry 49 line | `export { parseFkReference } from "./DataGridTable/columnUtils"` re-export 위치 보존. `DataGridTable.parseFkReference.test.ts:24` import 무수정 / 통과. `tests/fixtures/fk_reference_samples.json` 무수정. |
| AC-200-04 | 각 sub-file 최상단 JSDoc | 6 sub-file 모두 책임 / dependency / 외부 invariant 명시. `columnUtils` (pure / Rust lock-step), `useCellNavigation` (boundary 동작 + wrap 정책), `useColumnResize` (cleanup invariant + DOM mutation 의도), `contextMenu` (빈 그리드 무시 / Set-to-NULL 호출 순서), `HeaderRow` (4px drag-suppression / sort-edit save 순서), `DataRow` (5 mode + row key 형식 + aria contract). |
| AC-200-05 | `pnpm vitest run` 12 spec | aria-grid · blob-viewer · cell-navigation · column-resize · column-sort · context-menu · editing-visual · fk-navigation · parseFkReference · refetch-overlay · validation-hint · virtualization 12 spec / 112 case 무수정 통과. DOM byte-for-byte 동등 (row key / aria-rowindex / spacer rows / refetch overlay defaultPrevented invariant 보존). |
| AC-200-06 | full vitest / tsc / lint | 187 files / 2724 tests passed. tsc 0 / lint 0. baseline 무가산 (분해 only). cargo 영역 미수정. |

## Required checks (재현)

```sh
pnpm vitest run src/components/datagrid/DataGridTable.aria-grid.test.tsx \
  src/components/datagrid/DataGridTable.blob-viewer.test.tsx \
  src/components/datagrid/DataGridTable.cell-navigation.test.tsx \
  src/components/datagrid/DataGridTable.column-resize.test.tsx \
  src/components/datagrid/DataGridTable.column-sort.test.tsx \
  src/components/datagrid/DataGridTable.context-menu.test.tsx \
  src/components/datagrid/DataGridTable.editing-visual.test.tsx \
  src/components/datagrid/DataGridTable.fk-navigation.test.tsx \
  src/components/datagrid/DataGridTable.parseFkReference.test.ts \
  src/components/datagrid/DataGridTable.refetch-overlay.test.tsx \
  src/components/datagrid/DataGridTable.validation-hint.test.tsx \
  src/components/datagrid/DataGridTable.virtualization.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모두 zero error. baseline 무가산.

## 다음 sprint 가 알아야 할 것

### entry-pattern 답습 (3rd 적용)

본 sprint 가 Sprint 197 `mongodb.rs` 4분할 → Sprint 199 `SchemaTree.tsx`
5분할 에 이어 entry-pattern 의 **3 번째 적용** 사례. 다음 god file 분해
(`QueryTab.tsx` 1040, `tabStore.ts` 1002) 도 같은 패턴:

1. entry 파일 path 유지 — `git log --follow` 추적 가능.
2. sub-file 은 entry 와 같은 이름의 하위 디렉토리에 둠 (`DataGridTable/` 등).
3. 각 sub-file 책임 분리: pure helpers / hooks / renderers / components.
4. 외부 caller import 무변화 — 시그니처 / export 위치 보존.
5. named export (예: `parseFkReference`) 는 entry 가 sub-file 에서 re-export.

### ctx 객체 패턴 (D6 결정)

DataRow 가 prop 17 항목을 받아야 하는 상황에서 `DataGridRowContext`
객체 한 개로 묶고 `<DataRow rowIdx ctx />` 형태로 호출 — Sprint 199 의
`SchemaTreeRowsContext` 답습. 이 패턴이 prop drilling 압축 표준으로
굳어짐. Sprint 201 (QueryTab) / 후속 god file 분해에서도 유사 ctx
등장 예상.

ctx useMemo deps 가중량은 entry 가 책임 (deps 17 항목 명시 — props /
hook 결과 / setState 모두 포함). 매 렌더 새 reference 일 가능성 있어
DataRow 는 `React.memo` 안 씀 — 향후 perf 최적화 필요시 ctx 안정화
선결.

### 회귀 가드

- **DataRow 컴포넌트 boundary** — `renderDataRow` 함수에서
  `<DataRow>` 컴포넌트로 전환되어 reconciliation boundary 추가됨.
  cell-navigation / editing-visual / validation-hint 3 spec 이
  이론상 영향받을 risk 였으나 실측 무수정 통과 (findings §4 참조).
  향후 DataRow 내부 추가 분해 (CellEditor / CellDisplay) 시 동일
  검증 필수.
- **document-level mouse listener cleanup** — `useColumnResize` 가
  drag 끝에 mousemove/mouseup listener 제거 + body cursor /
  userSelect 복원. drag 중 컴포넌트 unmount 시 listener leak risk
  — hook 의 useEffect cleanup 추가 검토 (현재는 mouseup 핸들러
  내부에서만 cleanup, 컴포넌트 unmount 가 drag 중 일어나면 listener
  leak 가능성). Sprint 201+ 에서 hardening 검토.
- **contextMenu state 가 hook 안으로 이동** — entry 의 useState 였던
  contextMenu 가 `useContextMenu` 안. spec 에서 `setContextMenu` 직접
  호출하는 case 0 — 모두 `handleContextMenu` 트리거 경로로 검증 →
  이동 무영향.

### 외부 도구 의존성

없음. 추가 crate 0, 추가 npm 0. 기존
`@tanstack/react-virtual` / `lucide-react` / `@/components/ui/*` /
`@components/feedback/AsyncProgressOverlay` /
`@components/shared/ContextMenu` / `@/hooks/useDelayedFlag` /
`@lib/format` 만 사용.

### 폐기된 surface

없음. `<DataGridTable>` 외부 인터페이스 / DOM / aria-* / `parseFkReference`
named export 위치 모두 동일.

## 시퀀싱 메모

- Sprint 199 (`SchemaTree.tsx` 2105 → 419 + 5 sub-file) → **Sprint 200**
  (`DataGridTable.tsx` 1071 → 501 + 6 sub-file).
- 본 sprint 가 `docs/PLAN.md` "리팩토링 sequencing (Sprint 199–...,
  post-198 cycle)" 두 번째 항목.
- 다음 후보 (god file order, `CODE_SMELLS.md` §1-1 입력):
  - **Sprint 201** — `QueryTab.tsx` (1040) 분해 (PLAN sequencing).
  - **Sprint 203** — `db/postgres.rs` (3803) 4분할 (Sprint 197 답습).
  - **Sprint 205** — `tabStore.ts` (1002) 분해.
- 영속 표준은 `memory/conventions/refactoring/` 4 카테고리 (B / D / C / A).
- `docs/PLAN.md` 의 sequencing 표 갱신 시점 — cycle 종료 후 (Sprint
  208) 일괄 갱신 권장. 현 시점 해당 표는 candidate sequencing 으로
  유지.

## Refs

- `docs/sprints/sprint-200/contract.md` — sprint contract.
- `docs/sprints/sprint-200/findings.md` — 결정 / 결과 / 트레이드오프 /
  회귀 risk 분석.
- `docs/sprints/sprint-199/handoff.md` — entry-pattern 도입 reference (frontend 측 첫 사례).
- `docs/sprints/sprint-197/handoff.md` — entry-pattern 도입 reference (Rust 측).
- `CODE_SMELLS.md` §1-1 frontend god file table.
- `docs/PLAN.md` 의 "리팩토링 sequencing (Sprint 199–..., post-198 cycle)".
