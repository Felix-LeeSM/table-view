# Sprint 200 — Findings

Sprint: `sprint-200` (refactor — `DataGridTable.tsx` 1071-line 분해).
Date: 2026-05-02.
Status: closed.

## §0 — entry line target 미달 (AC-200-01)

contract 의 AC-200-01 은 "1071 → 350 줄 미만" 으로 작성됐으나 실측 결과
**501 lines** 로 한계 초과. 단, 분해 자체는 -570 lines (-53%) / 6
sub-file 신규로 god-file 해체 목적 달성.

미달 원인 — entry 에 잔여한 책임 (의도한 결정):

| 영역 | lines | entry 유지 사유 |
|------|-------|-----------------|
| `DataGridTableProps` interface | 96 | 외부 invariant — JSDoc + signature byte-for-byte 동결 (AC-200-02). |
| virtualized branch IIFE | ~45 | `useVirtualizer` 인스턴스 + `paddingTop`/`paddingBottom` spacer rows 가 `data.executed_query` scroll-to-top effect 와 강결합. 분리 시 hook 결과 prop drilling 추가 + reconciliation boundary 변경 risk. Plan 단계 (D1) 에서 entry 유지로 결정. |
| empty / filtered-empty branch | ~30 | 단일 `<tr>` + Clear filter button. 분리 이득 미미. |
| pendingNewRows map | ~30 | 단순 italic/dim 표시 — DataRow 와 mode 다름. 별도 분리 OOS. |
| rowCtx useMemo (deps 17) | ~50 | DataRow 가 ctx 객체로 prop 묶음 받음 (D6=B 결정). entry 가 빌드 책임. |
| imports + state/refs/effect + return JSX shell | ~250 | hook 호출 / scrollContainerRef / dialog state / 최종 return JSX. |

선택지 비교 후 **AC 한계 미달 채택** (Sprint 199 의 "3~4 sub-file → 5"
finding §0 답습). 대안 (`<VirtualizedBody>` / `<EmptyState>` /
`<PendingNewRows>` 추가 분리, 9 sub-file) 은 OOS 확장 + DOM 동등
보장 risk 라 보류 — 후속 sprint 에서 필요시 재검토.

## §1 — 분해 전략 (D1~D7 결정 결과)

interactive planning 에서 7 결정 합의:

| D | 결정 | 선택 | 결과 |
|---|------|------|------|
| D1 | sub-file 개수 | A: entry + 6 | columnUtils / useCellNavigation / useColumnResize / contextMenu / DataRow / HeaderRow |
| D2 | parseFkReference re-export | A | entry 49 line `export { parseFkReference } from "./DataGridTable/columnUtils"` |
| D3 | renderDataRow 분해 입자 | A: 1 컴포넌트 | DataRow 399 lines (5 mode 분기 통째 흡수) |
| D4 | context menu | A: hook + builder | `useContextMenu` (state) + `buildContextMenuItems` (10 items) |
| D5 | column resize | A: hook 캡슐화 | `useColumnResize` 가 ref + drag handler 보유 |
| D6 | DataRow props 폭 | B: ctx 객체 | `DataGridRowContext` interface, useMemo deps 17 |
| D7 | HeaderRow 분리 | A: 별도 sub-file | sortMouseStartRef 내부 useRef |

각 결정의 근거는 `plan-interactively` Decision Map 의 트레이드오프
비교에 동결.

## §2 — Sub-file 의존성 / 외부 contract

```
DataGridTable.tsx (entry, 501)
  ├── columnUtils.ts          (76, pure)
  ├── useCellNavigation.ts    (114) ─→ useDataGridEdit
  ├── useColumnResize.ts      (140) ─→ columnUtils
  ├── contextMenu.tsx         (207) ─→ useDataGridEdit, @lib/format, lucide-react
  ├── HeaderRow.tsx           (136) ─→ columnUtils, lucide-react
  └── DataRow.tsx             (399) ─→ columnUtils, useCellNavigation, useDataGridEdit, @lib/format, lucide-react, Button
```

깊이 1, 순환 없음. 외부 caller / test 무수정:

- `src/components/rdb/DataGrid.tsx:24` — `import DataGridTable from "@components/datagrid/DataGridTable"` 무변화.
- `src/components/datagrid/DataGridTable.parseFkReference.test.ts:24` — `import { parseFkReference } from "@/components/datagrid/DataGridTable"` 무변화.
- 11 component spec — `import DataGridTable from "./DataGridTable"` default export 보존.
- `tests/fixtures/fk_reference_samples.json` 무변화 — Rust `format_fk_reference` 와의 lock-step 유지.

## §3 — 회귀 가드 / 행동 동등

`pnpm vitest run` baseline:

- 12 DataGridTable spec / 112 case (pre-split = post-split).
- 전체 187 files / 2724 tests passed.
- `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0.

DOM byte-for-byte 동등성 — row key 형식 (`row-${page}-${rowIdx}`),
`aria-rowindex` / `aria-colindex`, sticky thead, eager vs virtualized
분기, paddingTop/paddingBottom spacer rows, pendingNewRows tbody 위치,
sortMouseStartRef 4px threshold, context menu 10 items 모두 보존.

특히 `defaultPrevented` invariant (sprint-176 refetch overlay) 보존 —
overlay 의 4 pointer-event handler 가 entry 의 `<AsyncProgressOverlay>`
import 경로 그대로 유지되어 spec 무수정 통과.

## §4 — 트레이드오프 / 회귀 risk

### DataRow 컴포넌트 boundary 추가

`renderDataRow` 함수가 `<DataRow>` 컴포넌트로 전환되면서 React
reconciliation 에 새 boundary 가 생김. 이론상 cell-navigation /
editing-visual / validation-hint 3 spec 이 영향받을 risk 있었으나
실측 결과 **모두 무수정 통과**. 원인:

1. 기존 `renderDataRow` 가 매 부모 렌더마다 새 closure 였음 — DataRow
   컴포넌트화 후에도 매 부모 렌더에서 `<DataRow ctx={rowCtx}>` 의 ctx
   가 새 reference (useMemo deps 가 hook 결과 포함) → DataRow 가 매
   렌더 update. 결과적으로 reconciliation 동작 불변.
2. 12 spec 의 어떤 case 도 specific render count 를 assert 하지 않음
   (mock vi.fn() call count 만 확인) → boundary 추가가 spec 결과에
   영향 안 줌.

### ctx useMemo deps

DataRow ctx 의 useMemo deps 17 항목 — 그 중 9 는 entry 의 props (매
렌더마다 동일 reference 일 가능성 높음), 나머지는 hook 결과
(`getColumnWidth`, `moveEditCursor`, `handleContextMenu`) 와 setState
함수 (`setBlobViewer`). hook 결과는 자체 useCallback 으로 안정적,
setState 는 React 가 stable identity 보장. 따라서 ctx 가 매 렌더 새
객체일 risk 는 props 변경 시점에만 — 의도된 동작.

### sub-file 간 dependency depth 1 유지

DataRow 가 useCellNavigation 의 `CellNavigationDirection` type 만 import
(런타임 의존 0) — 실제 hook 호출은 entry 에서. 향후 sub-file 추가 시
같은 패턴 (entry 가 hook 호출 → 결과를 sub-file 에 전달) 답습 권장.

## §5 — out of scope 확인

contract §"Out of scope" 항목 모두 본 sprint 에서 손대지 않음:

- 다른 god file (`QueryTab.tsx`, `tabStore.ts`, `DocumentDataGrid.tsx`,
  `useDataGridEdit.ts`) 미수정.
- DataGridTable 자체 기능 추가 0.
- `renderDataRow` 내부 추가 분해 (CellEditor / CellDisplay) 보류.
- §2 deps suppression `DataGridTable.tsx:552` 정리 보류 (entry 의
  scroll-to-top effect 안에 그대로 — 같은 줄에서 그대로 유지).
- CODE_SMELLS §3~7 정리 보류.

## §6 — 영속 표준 / 후속 입력

- 본 분해는 `memory/conventions/refactoring/memory.md` 의 4 카테고리
  (B/D/C/A) 중 **B (책임 분할 분해)** 에 해당.
- entry-pattern (entry + same-name subdir, 외부 caller 시그니처 무변화)
  은 Sprint 197 (`mongodb.rs` 4분할) → Sprint 199 (`SchemaTree.tsx` 5
  분할) → Sprint 200 (`DataGridTable.tsx` 6 분할) 로 **3 번째 적용**
  사례. 후속 god file (`QueryTab.tsx` 1040 / `tabStore.ts` 1002) 도
  같은 패턴 답습 예정.
- D6 의 ctx 객체 패턴 (SchemaTreeRowsContext / DataGridRowContext) 이
  prop drilling 압축 표준으로 굳어짐 — Sprint 201 (QueryTab) 에서도
  유사 ctx 등장 예상.
