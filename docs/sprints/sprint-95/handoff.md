# Sprint 95 → next Handoff

## Sprint 95 Result
- **Generator hand-off** (1 attempt)
- 7 AC 전부 충족, 회귀 0 (1692 / 1692 tests, sprint-94 대비 +13 신규).
- Verification Profile: `command` — `pnpm vitest run` PASS / `pnpm tsc --noEmit` PASS / `pnpm lint` PASS.

## 산출물
- `src/components/ui/dialog.tsx`: Layer-1 primitive 확장.
  - `DialogContent` 에 `tone?: "default" | "destructive" | "warning"` 추가 — `data-tone` attribute + `border-{token}` 매핑.
  - `DialogHeader` 에 `layout?: "row" | "column"` 추가 — `data-layout` attribute + `flex-row|flex-col` 매핑. sprint-91 row default 보존.
  - `DialogFeedback` 신규 — props: `state` (4-state idle/loading/success/error), `message?`, `loadingText?`, `slotName?`. 항시 마운트되는 외부 wrapper + min-h reservation, role=status/alert + aria-live=polite, success/destructive 토큰. `data-slot={slotName}` 기본 `"dialog-feedback"`.
- `src/components/ui/alert-dialog.tsx`: `AlertDialogContent` 도 `tone?: DialogTone` 받도록 동기화 (ConfirmDialog 가 AlertDialog primitive 위에 있음).
- `src/components/ui/dialog.test.tsx`: 13 신규 테스트 (AC-01 tone × 3, AC-02 layout × 2, AC-03 DialogFeedback × 6, AC-05 ConfirmDialog tone × 2). sprint-91 close-button matrix 그대로 통과.
- `src/components/connection/ConnectionDialog.tsx`: 기존 inline test-feedback 슬롯을 `<DialogFeedback slotName="test-feedback" loadingText="Testing..." />` 로 마이그레이션. local `pending` → primitive `loading` 매핑. 미사용 CheckCircle/AlertCircle import 제거.
- `src/components/connection/ConnectionDialog.test.tsx`: sprint-92 idle-state assertion 의 testid 만 `dialog-feedback-idle` 로 갱신 (selector identity / `expectNodeStable` / 4-state 동작 모두 그대로).
- `src/components/shared/ConfirmDialog.tsx`: `tone={danger ? "destructive" : "default"}` 를 `AlertDialogContent` 에 전달. Button `variant` 는 그대로 — frame tone 과 action variant 가 서로 강화.

## 인계
- **Layer-2 컴포지트 (sprint-96+)**: 다른 다이얼로그 (`GroupDialog`, `ImportExportDialog`, `BlobViewerDialog`, `CellDetailDialog`, `SqlPreviewDialog`, `MqlPreviewModal`, `AddDocumentModal`) 가 아직 inline 헤더/피드백을 쓴다면, Layer-2 단계에서 `DialogFeedback` 으로 교체하면 됨. 현재는 모두 feedback 슬롯이 없거나 이미 base primitive 만 사용 — 이번 스프린트 범위 외라 손대지 않음.
- **`pending` alias 후보**: ConnectionDialog 에서 `pending → loading` 두 줄 projection 이 살짝 어색. 이후 사용 사이트가 늘어나면 `DialogFeedbackState` 에 `pending` alias 추가하거나 ConnectionDialog 의 local 타입을 `loading` 으로 통일하는 것이 깔끔.
- **slotName 옵션의 사용 빈도**: sprint-92 호환 한정으로 도입. 신규 호출 사이트는 default `"dialog-feedback"` 를 그대로 쓰는 것이 권장. 새 호출 사이트가 또 override 를 요구하면, 기본 selector 가 너무 약하다는 신호로 보고 selector 정책 재검토.
- **`border-warning` 의존**: warning tone 은 `--color-warning: var(--tv-status-connecting)` (`src/index.css:27`) 에 의존. 토큰 리네이밍/제거 시 silent 폴백되므로, design system 토큰 정리 시 grep 으로 함께 점검.
- **toast hookup (sprint-94) 회귀 0** — Toaster 는 modal portal 외부에 있고, 이번 변경은 dialog 내부 슬롯에 한정되므로 무관. 명시적 회귀 테스트는 추가하지 않음 (기존 toast.test.ts / toaster.test.tsx 그대로 통과).
- **AlertDialog tone 확장의 의도**: `dialog.tsx` 의 `DialogTone` 타입을 import 하여 단일 source-of-truth 유지. 다른 alert 다이얼로그가 destructive 를 원하면 같은 prop 으로 즉시 사용 가능.
