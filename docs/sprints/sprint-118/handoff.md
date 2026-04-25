# Sprint 118 → next Handoff

## Sprint 118 Result

- **PASS** (Generator 직접 적용, 1 attempt) — 1834/1834 tests, tsc 0, lint 0. RDB DataGridToolbar 의 default props 가 RDB wording 을 유지해 RDB 100 케이스 무회귀.

## 산출물

- **NEW** `src/lib/strings/document.ts` — `DOCUMENT_LABELS` 상수 추가:
  ```ts
  { rowCountLabel: "documents", addRowLabel: "Add document",
    deleteRowLabel: "Delete document", duplicateRowLabel: "Duplicate document" }
  ```
- **MODIFIED** `src/components/datagrid/DataGridToolbar.tsx`:
  - 4 개 optional override props 추가 (`rowCountLabel`, `addRowLabel`, `deleteRowLabel`, `duplicateRowLabel`).
  - default = RDB wording (`"rows"`, `"Add row"`, `"Delete row"`, `"Duplicate row"`).
  - `data.total_count.toLocaleString()} rows` → `} {rowCountLabel}` (line 95).
  - 3 개 button 의 `aria-label` / `title` → 해당 prop 으로 치환 (line 171-194).
- **MODIFIED** `src/components/DocumentDataGrid.tsx`:
  - `DOCUMENT_LABELS` import + `<DataGridToolbar>` 에 4 개 override 전달.
  - mqlErrors 변환:
    - `cannot edit ${err.column} in a patch` → `cannot edit field ${err.column} in a patch` (line 214).
    - `nested ${err.column} is not editable` → `nested field ${err.column} is not editable` (line 220).
- **MODIFIED** `src/components/document/MqlPreviewModal.tsx`:
  - `{N} row{s} skipped:` → `{N} document{s} skipped:` (line 95).
  - `row {err.row}: {err.message}` → `document {err.row}: {err.message}` (line 100).
- **MODIFIED** `src/components/DocumentDataGrid.test.tsx`:
  - line 142: `getByText(/2 rows/)` → `getByText(/2 documents/)`.
  - line 385: `getByRole("button", { name: "Add row" })` → `... { name: "Add document" }`.
- **MODIFIED** `src/components/document/MqlPreviewModal.test.tsx`:
  - line 43: `"row 3: missing or unsupported _id"` → `"document 3: missing or unsupported _id"`.
  - line 44: `"row 5: nested meta is not editable"` → `"document 5: nested meta is not editable"`.
  - line 46: `"2 rows skipped"` → `"2 documents skipped"`.
- `docs/sprints/sprint-118/{contract.md, execution-brief.md, handoff.md}`.

## AC Coverage

- AC-01 ✅ — DocumentDataGrid 의 toolbar 에서 `Add document` / `Delete document` / `Duplicate document` aria-label 노출 + `2 documents` row count 단언 (`DocumentDataGrid.test.tsx:142,385`). RDB 는 default `Add row` 등 wording 으로 무회귀 (`DataGrid.test.tsx`, `DataGridToolbar.test.tsx`, `QueryResultGrid.test.tsx`).
- AC-02 ✅ — MqlPreviewModal 의 errors 섹션 헤더가 `"N documents skipped:"`, 라인 prefix 가 `"document N: ..."` 형태 (`MqlPreviewModal.test.tsx:43-46`).
- AC-03 ✅ — DocumentDataGrid 의 mqlErrors 변환에서 `${col}` → `field ${col}` 적용 (`DocumentDataGrid.tsx:214,220`).
- AC-04 ✅ — RDB DataGrid + DataGridToolbar + QueryResultGrid 의 100 개 테스트 무회귀. DataGridToolbar 의 default props 가 RDB wording 보존하므로 호출부 변경 0.
- AC-05 ✅ — `pnpm vitest run` 1834/1834. `pnpm tsc --noEmit` 0. `pnpm lint` 0.

## 검증 명령 결과

- `pnpm vitest run src/components/DocumentDataGrid.test.tsx src/components/DocumentDataGrid.pagination.test.tsx src/components/document/MqlPreviewModal.test.tsx` → 27/27 pass.
- `pnpm vitest run src/components/DataGrid.test.tsx src/components/datagrid/DataGridToolbar.test.tsx src/components/query/QueryResultGrid.test.tsx src/components/query/QueryResultGrid.multi-statement.test.tsx` → 100/100 pass (RDB 무회귀).
- `pnpm vitest run` → 108 files / **1834/1834** pass.
- `pnpm tsc --noEmit` → 0.
- `pnpm lint` → 0.

## 구현 노트

- 라벨 분기는 default = RDB 패턴 채택. paradigm prop 한 개로 분기하는 대안은 toolbar 가 paradigm 로직을 알게 되어 결합도가 높아져 기각.
- `MqlGenerationError.column` 필드 자체는 코드 식별자 (RDB / 도큐먼트 양쪽 paradigm 호환). 노출 텍스트만 `field ${col}` 로 변환 — API 시그니처 변경 0.
- `MqlPreviewModal.tsx:95` 의 `document{...}` 다음 공백 처리는 JSX `{" "}` 로 수동 삽입 — prettier 가 줄바꿈을 넣어 공백이 사라지는 케이스 회피.
- DocumentDataGrid 의 row count `documents` 라벨은 sprint 117 의 페이지네이션 테스트에서 사용한 `User 0` `User 1` 기반 mock 과 충돌하지 않음 (sprint 117 은 toolbar 의 다른 부분만 단언).

## 가정 / 리스크

- 가정: 향후 paradigm 별 wording 이 더 늘어나면 (e.g., `Discard documents`, `Commit changes`) `DataGridToolbar` 의 prop 시그니처를 동일 패턴으로 확장 — Commit/Discard 는 본 sprint 범위 외.
- 리스크 (낮음): `DOCUMENT_LABELS` 상수가 inline literal 로 fall back 되면 향후 i18n catalog 로 swap 시 한 군데 (`@/lib/strings/document`) 만 갱신하면 되도록 단일 source-of-truth 보존 — 호출부에서 inline literal 을 다시 쓰지 않도록 주의.

## 회귀 0

- RDB DataGrid + DataGridToolbar + QueryResultGrid 100 케이스 무회귀.
- 1834 baseline 전체 PASS (sprint 117 의 5 케이스 포함, 변경된 wording 단언이 6 케이스).
