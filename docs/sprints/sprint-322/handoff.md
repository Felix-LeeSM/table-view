# Sprint 322 Handoff — Slice F.2 (Dot-notation $set inline edit)

날짜: 2026-05-15
스프린트 번호: 322
스코프 origin: `docs/sprints/sprint-322/contract.md`

## 결과

- 신규 unit: 5 (mqlGenerator dot-notation 경로)
- 신규 RTL: 5 (NestedExpandPopover edit 모드) + 2 (DocumentDataGrid integration)
- 회귀: 0 — `pnpm vitest run --no-coverage` 3708 통과 / 10 skipped (sprint-321
  기준 3706 → +2). 6 file unit/RTL 케이스는 기존 파일에 누적된 형태로 통합.
- 정적 체크: `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0.

## 변경 파일

- `src/lib/mongo/mqlGenerator.ts`
  - `parseEditKey` 가 `"row-col:dot.path"` 형식 수용. path 없으면 top-level edit
    (기존 호환). path 있으면 `[rowIdx, colIdx, path]` 반환.
  - `editsByRow` entry 가 `path: string | null` 가짐. nested entry 는
    sentinel-edit guard 비대상.
  - `_id`-in-patch guard 가 `_id`, `_id.foo` 둘 다 차단.
  - `formatMqlObjectKey()` — dot 포함 key 는 `"meta.role"` 같이 쿼팅.
- `src/lib/mongo/mqlGenerator.test.ts` — 5 신규 케이스 (19 총).
- `src/components/document/NestedExpandPopover.tsx` — `onCommitEdit?`,
  `pendingByPath?` props 추가. scalar entry 옆 Pencil button. Enter commit /
  Esc cancel / blur commit. `data-testid="nested-pending"` highlight chip.
- `src/components/document/NestedExpandPopover.test.tsx` — 5 신규 케이스.
- `src/components/datagrid/useDataGridEdit.ts` — `DataGridEditState` 가
  `setPendingEdits: (next: Map<string, string | null>) => void` 노출. 기존
  setter 를 그대로 surface (별도 saveCurrentEdit 흐름 우회용).
- `src/components/document/DocumentDataGrid.tsx` — sentinel cell 의
  `NestedExpandPopover` 호출이 `pendingByPath` / `onCommitEdit` 를 wire-up.
  `buildNestedPendingByPath()` helper 가 `pendingEdits` 에서 `"r-c:"` prefix
  필터링.
- `src/components/document/DocumentDataGrid.nested.test.tsx` — F.2 integration
  2 케이스 추가 (pending highlight, MQL preview dot-path).
- `src/components/shared/QuickLookPanel.test.tsx` — `makeEditState` mock 에
  `setPendingEdits: vi.fn()` 추가 (타입 호환).

## 의사결정 (D-55..D-58)

- **D-55**: nested edit key shape — `"row-col:path"` (콜론 + dot-path).
  `path` 가 dot 포함하더라도 `String.split(":", 2)` 가 아닌 첫 콜론만
  분리하면 안전 (`parseEditKey` 가 `rest.join(":")` 로 재조립).
- **D-56**: nested-of-nested entry 는 inline edit 미허용. 사용자는 popover
  내에서 sentinel 만 보고 깊은 inspect 는 Quick Look 패널로. F.2 범위 외.
- **D-57**: `_id.foo` patch 차단 — `_id` 가 immutable 인 mongo invariant 그대로
  유지 (sub-field 변경도 사실상 `_id` 변경). guard 메시지: "Cannot $set on _id".
- **D-58**: `setPendingEdits` interface 직접 노출 — popover 안 nested edit 는
  별도 `editingCell` 없이 dot-key 만 갱신해야 하므로 setter 직접 호출이
  단순. 기존 saveCurrentEdit 경로 회귀 0.

## 다음

Slice G (Sprint 323) — BSON type editor: ObjectId / ISODate / Decimal128 /
BinData. NestedExpandPopover 의 Pencil input 을 type-aware 로 확장.
