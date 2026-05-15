# Sprint 317 Handoff — Slice D.1 (Mongo DataGrid Hide Column)

## Status: PASS

## Scope completed

Mongo `DocumentDataGrid` 에 column hide / show / persist 기능을 도입.

- 신규 hook `useHiddenColumns` — `useColumnWidths` 의 patterns 를
  복제 (per-key localStorage persist, silent fall-back on quota /
  disabled, persistenceKey 변경 시 swap).
- `HeaderRow` 컴포넌트의 column 우클릭 ContextMenu 에 "Hide column"
  item 추가 (separator 다음). `onHideColumn` callback 이 optional
  이므로 기존 RDB DataGrid 회귀 0.
- `DocumentDataGrid` 가 hidden column 을 header/row 양쪽에서 drop,
  Toolbar 와 grid 사이 inline "N column(s) hidden / Show all" badge
  를 노출.

## Files changed

| 파일 | 종류 | 변경 |
|------|------|------|
| `src/hooks/useHiddenColumns.ts` | NEW | hide / show / toggle / clear + persist |
| `src/hooks/useHiddenColumns.test.ts` | NEW | 9 case |
| `src/components/datagrid/DataGridTable/HeaderRow.tsx` | edit | `onHideColumn` prop + "Hide column" menu item |
| `src/components/datagrid/DataGridTable/HeaderRow.contextmenu.test.tsx` | edit | Hide column 2 case 추가 |
| `src/components/document/DocumentDataGrid.tsx` | edit | `useHiddenColumns` 호출, `visibleEntries` memo, header `order` + row cell map filter, badge JSX |
| `src/components/document/DocumentDataGrid.hide.test.tsx` | NEW | 5 RTL case |
| `docs/phases/phase-28-decisions.md` | edit | D-35..D-38 append |
| `docs/sprints/sprint-317/handoff.md` | NEW | 본 문서 |

## Per-Done-Criterion evidence

1. **`useHiddenColumns` hook 동작 (load/save/clear)** — `useHiddenColumns.test.ts`
   9/9 통과. STORAGE_PREFIX = `hidden-columns:`. corrupt blob 시
   `new Set()` 반환, empty 시 entry 자동 removeItem.
2. **Context menu "Hide column" item** — `HeaderRow.contextmenu.test.tsx`
   의 "Hide column item dispatches onHideColumn(col) when provided" +
   "Hide column item is absent when onHideColumn is not provided"
   2 case. onSortColumn / onClearColumnSort / onClearAllSorts 와 독립.
3. **DocumentDataGrid hide column 적용** — `DocumentDataGrid.tsx`
   의 `visibleEntries` memo 가 `data.columns` 를 hidden 필터링,
   `HeaderRow` 의 `order` 와 row cell map 양쪽이 동일 entries 를
   소비. `DocumentDataGrid.hide.test.tsx` 의 case 2 ("Hide column
   removes the column from header AND row cells").
4. **상단 배지 + Show all** — `aria-label="Hidden columns badge"`
   strip. `Show all hidden columns` ghost button. `DocumentDataGrid.hide.test.tsx`
   의 case 4 ("Show all clears every hidden column and removes the
   badge") + localStorage null assertion.
5. **≥ 5 RTL/unit** — useHiddenColumns 9 + HeaderRow ContextMenu 추가
   2 + DocumentDataGrid hide 5 = **신규 16 case**.
6. **tsc / lint / build / vitest exit 0** — 아래 "Checks run" 참조.

## Checks run

- `pnpm vitest run src/components/document/DocumentDataGrid.hide.test.tsx`
  → 5/5 pass.
- `pnpm vitest run` → **295 files, 3657 pass / 10 skip / 0 fail**
  (baseline 3641 → +16 case, mismatch 없음).
- `pnpm tsc --noEmit` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm build` → exit 0 (Vite 빌드 성공, 신규 경고 없음).

## Autonomous decisions (recorded in `docs/phases/phase-28-decisions.md`)

- **D-35**: persist 단위 = `document:<db>:<coll>` (column-widths 와
  namespace 공유). localStorage prefix `hidden-columns:`.
- **D-36**: 배지 위치 = Toolbar 와 grid container 사이 inline strip
  (FilterBar 위치 정책과 일관).
- **D-37**: Show all = 전체 clear + localStorage entry wipe. per-column
  show 는 별도 sub-sprint 로 연기.
- **D-38**: 마지막 column hide 가드레일 없음 — 0 column visible 도
  허용 (Show all 안전망 항상 가용).

## Out of scope (deferred)

- **D.2 (Sprint 318)** — RDB DataGrid 에 동일 mechanism. `DataGridTable`
  자체에 visible filter 도입할지, RDB DataGrid 에 wrapper 둘지
  결정 사항 남음.
- per-column show popover.
- column reordering.
- 다른 paradigm (raw query result grid) 의 hide.

## Residual risk

- 0 column visible 상태에서 grid 가 빈 row 를 paint — 빈상태 "No
  documents" 와 시각적으로 구분되지 않을 가능성. 단, badge 가
  지속 visible 하여 사용자가 즉시 복원 가능. UX 보강은 D.2 또는
  Slice H 에서 재검토.
- `useHiddenColumns` 의 useEffect 가 persistenceKey 변경시 mount-load
  를 두 번 호출 (initial useState + useEffect) — Strict Mode 에서
  중복 read 가능. `useColumnWidths` 도 동일 패턴, 회귀 0.
