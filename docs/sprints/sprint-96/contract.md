# Sprint Contract: sprint-96

## Summary

- Goal: Dialog 2-Layer Layer 2 preset wrapper 4종 도입 (`ConfirmDialog`/`FormDialog`/`PreviewDialog`/`TabsDialog`) + 7~8 dialog 마이그레이션. ConnectionDialog 는 Layer 1 escape hatch.
- Audience: Generator + Evaluator
- Owner: Generator
- Verification Profile: `command`

## In Scope

- `src/components/ui/dialog/ConfirmDialog.tsx`: 기존 `src/components/shared/ConfirmDialog.tsx` 를 preset 위치로 이동(또는 re-export). API 안정성 유지 — 호출 사이트 변경 최소화.
- `src/components/ui/dialog/FormDialog.tsx` (신규): props 권장 — `{ title; description?; tone?; onSubmit; onCancel; submitLabel?; cancelLabel?; isSubmitting?; submitDisabled?; feedback?; children }`. footer 자동 렌더.
- `src/components/ui/dialog/PreviewDialog.tsx` (신규): props 권장 — `{ title; description?; preview: ReactNode; loading?: boolean; error?: string | null; commitError?; onConfirm; onCancel; confirmLabel?; }`. SQL/MQL/Cell/Blob preview 패턴 일반화.
- `src/components/ui/dialog/TabsDialog.tsx` (신규): props 권장 — `{ title; tabs: { value; label; content }[]; defaultTab?; onClose }`.
- `docs/dialog-conventions.md` (신규): preset 별 사용 케이스 + escape hatch 정책.
- 마이그레이션 (다이얼로그별):
  - `GroupDialog` → `FormDialog` (또는 ConfirmDialog 추가 변형 가능)
  - `ImportExportDialog` → `TabsDialog`
  - `BlobViewerDialog` → `TabsDialog` (hex/text tabs) 또는 `PreviewDialog`
  - `CellDetailDialog` → `PreviewDialog`
  - `SqlPreviewDialog` → `PreviewDialog` (sprint-93 commitError 호환 보존)
  - `MqlPreviewModal` → `PreviewDialog`
  - `AddDocumentModal` → `FormDialog`
  - 기존 `ConfirmDialog` 호출처는 그대로 (re-export 호환).
- 단위 테스트: `src/components/ui/dialog/__tests__/ConfirmDialog.test.tsx` 등 preset 별 ≥ 1 테스트.

## Out of Scope

- ConnectionDialog 마이그레이션 — Layer 1 escape hatch, 주석으로 사유 명시.
- 다이얼로그 콘텐츠/디자인 변경.
- sprint-88~95 산출물 추가 변경 (마이그레이션 외).
- `CLAUDE.md`, `memory/`.

## Invariants

- sprint-91 9-dialog close 매트릭스 통과
- sprint-92 ConnectionDialog `expectNodeStable` 통과
- sprint-93 commitError destructive banner + "executed: N, failed at: K" 유지
- sprint-94 toast hookup 회귀 0
- sprint-95 tone/layout/DialogFeedback 사용 보존
- 기존 dialog 별 happy-path 테스트 회귀 0

## Acceptance Criteria

- `AC-01` 4 preset wrapper 가 `src/components/ui/dialog/` 하위 존재 + Layer 1 primitive 만 사용 (직접 `<DialogContent>`/`<DialogHeader>` 사용 금지 - preset 내부에서만 사용).
- `AC-02` 7~8 dialog 가 preset 으로 마이그레이션. (Generator 가 마이그레이션 매트릭스를 findings.md 에 기록.)
- `AC-03` ConnectionDialog 가 Layer 1 escape hatch 임을 코드 상단 주석으로 명시.
- `AC-04` `docs/dialog-conventions.md` 가 preset 별 사용 케이스 + escape hatch 정책 문서화.
- `AC-05` preset 별 단위 테스트 ≥ 1 (총 ≥ 4).
- `AC-06` sprint-91~95 invariant 회귀 0.
- `AC-07` 시각/동작 회귀 0.

## Design Bar / Quality Bar

- preset wrapper 는 props 가 단순해야 함 — children 으로 모든 변형을 받지 말고, 자주 쓰는 패턴은 props 로 분리.
- 마이그레이션 시 다이얼로그별 happy-path 테스트가 새 preset 사용 후에도 그대로 통과해야 함 (필요 시 selector 만 미세 조정).
- `SqlPreviewDialog` 마이그레이션은 sprint-93 commitError prop 을 PreviewDialog 가 그대로 받아야 함.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 0 failures.
2. `pnpm tsc --noEmit` — exit 0.
3. `pnpm lint` — exit 0.
4. `grep -rn "ConfirmDialog\|FormDialog\|PreviewDialog\|TabsDialog" src/components/ui/dialog` — 4개 preset 검출.
5. `grep -rn "from \"@/components/ui/dialog/\"" src/components` — 마이그레이션 사이트 검출.
6. `ls docs/dialog-conventions.md` — 존재 확인.

### Required Evidence

- Generator: 변경 파일 + 명령 출력 + AC 별 라인 인용 + 마이그레이션 매트릭스 (어떤 dialog → 어떤 preset) + escape hatch 주석.
- Evaluator: AC 별 라인 인용 + sprint-91~95 invariant 회귀 0 검증.

## Test Requirements

### Unit Tests (필수)
- preset 별 1+ 테스트 (총 ≥ 4).
- 마이그레이션된 다이얼로그 별 기존 happy-path 통과.
- ConnectionDialog 기존 sprint-92 단언 통과.

### Coverage Target
- 신규 preset 라인 70%+.

## Test Script / Repro Script

1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Ownership

- Generator: 단일 agent.
- Write scope: contract In Scope 만.
- Merge order: 단일 PR.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `findings.md`
