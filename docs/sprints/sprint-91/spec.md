# Sprint 91: Dialog 헤더/X-버튼 정규화 (#DIALOG-1)

**Source**: `docs/ui-evaluation-results.md` #DIALOG-1
**Depends on**: sprint-88
**Verification Profile**: mixed

## Goal

`DialogHeader` 의 기본 레이아웃을 row 기반(`flex flex-row items-center justify-between`) 으로 교정하고, 모든 다이얼로그가 X 닫기 버튼을 정확히 1개만 노출하도록 통일한다. 수동으로 X 버튼을 삽입한 다이얼로그는 `showCloseButton={false}` 로 명시하거나 수동 X 를 제거한다.

## Acceptance Criteria

1. `DialogHeader` 의 기본 레이아웃이 row 방향이다. 긴 title 입력 시 title 영역이 truncate(`min-w-0 truncate`) 되며 X 버튼은 같은 row 에 유지된다 (top 좌표 동일).
2. 코드베이스의 모든 다이얼로그 컴포넌트(`ConnectionDialog`, `GroupDialog`, `ImportExportDialog`, `BlobViewerDialog`, `CellDetailDialog`, `SqlPreviewDialog`, `MqlPreviewModal`, `AddDocumentModal`, `ConfirmDialog`) 렌더 시 close 버튼 (`getAllByRole("button", { name: /close/i })`) 이 정확히 0개 또는 1개 — 결코 2개 이상이 아니다.
3. `showCloseButton={false}` 명시 시 absolute X 버튼이 부재한다 (단언 테스트).
4. 기존 다이얼로그별 happy-path 테스트 회귀 0.

## Components to Create/Modify

- `src/components/ui/dialog.tsx`: `DialogHeader` 기본 클래스를 row 기반으로 교정.
- `src/components/ui/dialog.test.tsx` (신규): 헤더 레이아웃 단언, close 버튼 중복 방지 단언.
- `src/components/connection/ConnectionDialog.tsx`: 수동 삽입 X 버튼 정책 (유지/제거) 명시.
- `src/components/connection/ImportExportDialog.tsx`: 수동 X 패턴 정렬.
- `src/components/structure/SqlPreviewDialog.tsx`: 수동 X 패턴 정렬.
- 그 외 X 를 수동 삽입한 모든 dialog 파일: `showCloseButton={false}` 일관 적용 또는 수동 X 제거.

## Edge Cases

- 매우 긴 dialog title — truncate + tooltip.
