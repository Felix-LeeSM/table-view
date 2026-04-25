# Sprint 91 → next Handoff

## Sprint 91 Result
- **PASS** (8.75/10, 1 attempt)
- 5 AC 모두 PASS, 회귀 0 (1648 / 1648 tests).

## 산출물
- `dialog.tsx`: `DialogHeader` 기본 → `flex flex-row items-center justify-between gap-2 min-w-0 text-left`. `DialogTitle` 에 `min-w-0` 추가.
- `dialog.test.tsx` 신규: row 레이아웃 + truncate-friendly + `showCloseButton` 토글 + 9-dialog 매트릭스 close 버튼 ≤ 1 단언.
- `ConnectionDialog`: 사전 수동 `<div>` workaround 환원 → `<DialogHeader>` 사용 (시스템 차원 fix 일관성).
- `GroupDialog`: `flex-col items-start justify-start` override (헤더에 stacked title + description, 인라인 X 없음).
- `ImportExportDialog`, `SqlPreviewDialog`: 중복 `flex items-center justify-between` 제거 (이제 디폴트).

## 인계
- `DialogHeader` 디폴트 row 변경은 모든 사용처에 영향 — 별도 stacked 헤더 (예: `SchemaTree` confirm, `ConnectionItem` delete) 는 `flex-col` override 필요 시 후속 sprint 에서 처리. 현재 회귀 없음.
- `AlertDialogHeader` (radix 별 컴포넌트) 는 sprint-91 범위 외 — 필요 시 별도 sprint.
- 9-dialog 매트릭스 패턴은 후속 dialog 추가 시 그대로 확장 가능.
