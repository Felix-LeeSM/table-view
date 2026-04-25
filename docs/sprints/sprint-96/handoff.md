# Sprint 96 → next Handoff

## Sprint 96 Result
- **PASS** (8.5/10, 1 attempt)
- 7 AC 모두 PASS, 회귀 0 (1713 / 1713 tests).

## 산출물
- `src/components/ui/dialog/ConfirmDialog.tsx`, `FormDialog.tsx`, `PreviewDialog.tsx`, `TabsDialog.tsx` 신규 (Layer 2).
- `src/components/ui/dialog/__tests__/*.test.tsx` 4 파일 (21 케이스).
- 7 dialog 마이그레이션:
  - GroupDialog → FormDialog
  - ImportExportDialog → TabsDialog
  - BlobViewerDialog → TabsDialog
  - CellDetailDialog → PreviewDialog
  - SqlPreviewDialog → PreviewDialog (sprint-93 commitError 보존)
  - MqlPreviewModal → PreviewDialog
  - AddDocumentModal → FormDialog
- `ConnectionDialog`: 본체 변경 X — escape hatch 주석만 (line 1-22).
- `docs/dialog-conventions.md` 작성 (preset 선택표, escape hatch 정책, invariant 체크리스트).

## 인계
- 인라인 `<DialogContent>` 사용 사이트 (`SchemaTree`×2, `IndexesEditor`, `ConstraintsEditor`, `EditableQueryResultGrid`, `DataGrid`, `ConnectionItem`, `QuickOpen`) 8 곳 — preset 마이그레이션 후속 sprint 후보. conventions 는 신규 코드 금지 정책 명시.
- `PreviewDialogCommitError.statementIndex` 의 0-indexed 계약 — JSDoc 추가 필요.
- `BlobViewerDialog` 바이트 카운트 footer 가 탭마다 중복 — cosmetic.
