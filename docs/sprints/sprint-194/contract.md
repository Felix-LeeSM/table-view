# Sprint 194 — Contract

Sprint: `sprint-194` (FB-4 — Quick Look 편집 모드).
Date: 2026-05-02.
Type: feature.

`docs/refactoring-plan.md` FB-4 — Quick Look 편집 합류. 현재 read-only
인 `QuickLookPanel` 에 편집 모드를 추가하여, 한 row 의 모든 컬럼을
수직으로 펼쳐 놓은 상태에서 직접 편집/Set NULL 이 가능하도록 한다.
편집 결과는 `useDataGridEdit` 의 기존 `pendingEdits` 파이프에 합류 —
PendingChangesTray + Cmd+S Commit + Discard 가 이미 처리하므로 **신규
commit 경로 추가 없음**.

## Sprint 안에서 끝낼 단위

- `QuickLookPanel` 의 두 paradigm 별 body 에 **Edit 모드 토글**:
    - RDB: `RdbModeBody` — `FieldRow` 가 편집 모드일 때 input/textarea
      로 swap, save on blur+Enter, Esc 로 cancel, Set NULL 명시 액션.
    - Document: `DocumentModeBody` — BSON tree 옆에 JSON textarea 모드
      추가. whole-document JSON 편집 → parse 검증 → pending update.
- 편집 결과 dispatch:
    - RDB → `editState.handleStartEdit` + `setEditValue` + `saveCurrentEdit()`
      (기존 hook API).
    - Document → `editState.handleStartEdit(rowIdx, /*colIdx=*/0, ...)`
      + setEditValue with raw JSON string + saveCurrentEdit (Mongo 의 dual-
      paradigm cell-edit 경로 그대로).
- read-only 가드:
    - RDB: PK 컬럼 / computed (generated) / BLOB 은 편집 비활성. 기존
      `getInputTypeForColumn` 의 매핑은 그대로 사용.
    - Document: 편집 모드는 valid JSON 만 허용. parse 실패 시 hint
      banner + save 불가.
- Drive-by:
    - QuickLook 헤더에 **dirty indicator** — 본 row 가 `pendingEdits` /
      `pendingDeletedRowKeys` / `pendingNewRows` 중 하나라도 걸쳐 있으면
      "● Modified" pill (PendingChangesTray 의 색깔 일관).
    - QuickLook 내부에서 row 변경 (Add Row / Delete Row 액션) 은 sprint
      범위 밖 — 본 sprint 는 cell-level 편집만.

## Acceptance Criteria

### AC-194-01 — RDB Quick Look 편집 토글

`QuickLookPanel mode="rdb"` 에 Edit 모드 진입/이탈이 가능해야 한다.

- 헤더의 Pencil icon 토글 버튼 (aria-label `Toggle edit mode`).
- 편집 모드일 때 `FieldRow` 가 다음 input affordance 를 노출:
    - bool → `<select>` (true/false/NULL)
    - JSON / 200자 이상 text → `<textarea>` (rows=4)
    - 그 외 string/number/date → `<input type=...>` (`getInputTypeForColumn`
      매핑)
    - BLOB / PK / generated → 편집 input 미렌더 (read-only 마크 +
      `aria-disabled`).
- save: blur 또는 Enter (textarea 는 Cmd/Ctrl+Enter).
- cancel: Esc.
- "Set NULL" inline 버튼 → 셀에 `null` 적용 후 saveCurrentEdit.

테스트: `QuickLookPanel.test.tsx` 의 신규 `[AC-194-01-1..6]` —
- 토글 노출 / 편집 진입 / Enter 저장 / Esc 취소 / Set NULL / read-only
  컬럼 미렌더 6 case.

### AC-194-02 — RDB pending edits 합류

QuickLook 에서 발생한 cell 편집이 `editState.pendingEdits` 에 정확히
같은 `editKey(row, col)` 형태로 등재되어야 하며, PendingChangesTray
와 SQL Preview 가 본 변경을 그대로 받아낸다.

- 신규 prop `editState: DataGridEditState` 를 RDB body 가 받는다.
- pendingEdits Map 에 `${selectedRowIdx}-${colIdx}` key 등재 단언.
- Cmd+S 시 SQL Preview 에 본 row 의 UPDATE statement 가 한 번 등장.

테스트: `DataGrid.test.tsx` 통합 (또는 QuickLookPanel.test.tsx 안의
mock editState) `[AC-194-02-1..2]` — pendingEdits 등재 + SQL preview
포함 verbatim.

### AC-194-03 — Document Quick Look 편집 (whole-doc JSON)

`mode="document"` 일 때 헤더 토글로 JSON textarea 모드 진입.

- BsonTreeViewer 자리에 `<textarea>` 가 raw JSON 으로 채워진다 (현재
  document 의 `JSON.stringify(doc, null, 2)`).
- save: 헤더 Save 버튼 (또는 Cmd/Ctrl+Enter). textarea 의 값을 parse —
  실패 시 hint banner ("Invalid JSON") + save 비활성.
- 성공 시 dispatch: `editState.handleStartEdit(rowIdx, 0, currentJson)` →
  `setEditValue(parsedJsonString)` → `saveCurrentEdit()`. (Mongo paradigm
  의 cell-edit 단일 셀 경로를 whole-doc 으로 재사용 — column index 0 은
  Mongo 의 raw document column.)
- cancel: 헤더 Cancel 버튼 → 편집 모드 이탈, textarea 폐기, BSON tree
  복귀.

테스트: `QuickLookPanel.test.tsx` `[AC-194-03-1..4]` — 진입 / parse 실패
hint / parse 성공 dispatch / cancel 복귀.

### AC-194-04 — dirty indicator

QuickLook 헤더에 본 row 의 dirty 상태가 표시된다.

- selected row 가 `pendingEdits` 의 row idx 와 일치하는 entry 를 1개
  이상 갖거나, `pendingDeletedRowKeys` 에 `rowKey` 가 들어 있거나,
  `pendingNewRows` 의 idx 가 가리키는 위치이면 헤더에 `● Modified` pill
  렌더.

테스트: `QuickLookPanel.test.tsx` `[AC-194-04-1..3]` — clean / pending
edit / pending delete 3 case.

### AC-194-05 — 회귀 0 (read-only 표면 보존)

기존 Quick Look read-only call-site 호출 (Edit 모드 미진입) 의 모든
출력이 픽셀-레벨 동일해야 한다.

- 신규 `editState` prop 은 optional. 미전달 시 Edit 토글 자체가 미렌더.
- 기존 `QuickLookPanel.test.tsx` cases (선언된 모든 read-only assertion)
  무수정 통과.

검증: `pnpm vitest run src/components/shared/QuickLookPanel` — 기존
case 모두 green + 신규 AC-194-01..05 모두 green.

## Out of scope

- 새 row 추가 / row 삭제 (이미 PendingChangesTray + DataGrid toolbar 에
  존재; QuickLook 안으로 끌어들이지 않는다).
- BSON tree 의 leaf-level 편집 (granular path-based update — 별 sprint
  후보. whole-doc JSON 으로 충분히 cover).
- Mongo `_id` 편집 차단 — Mongo 자체 contract 이 이미 거부하므로 UI
  guard 추가 불필요.
- BLOB 편집 — BlobViewerDialog 가 read-only viewer. write path 는 별
  sprint.
- AC-194-01 의 input type 들에 대한 Sprint 75 column-type validation
  재도입 — 기존 validation 은 commit 시점에 동작하므로 QuickLook 에서
  새로 추가하지 않는다.

## 검증 명령

```sh
pnpm vitest run src/components/shared/QuickLookPanel \
  src/components/rdb/DataGrid \
  src/components/document/DocumentDataGrid
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모든 테스트 green. tsc 0 / lint 0. Rust 변경 없음 (`git diff
--stat src-tauri/` empty).
