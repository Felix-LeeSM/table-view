# Sprint Execution Brief: sprint-96

## Objective

Layer 2 preset wrapper 4 종 (`ConfirmDialog`/`FormDialog`/`PreviewDialog`/`TabsDialog`) 도입 + 7~8 dialog 마이그레이션 + conventions 문서. ConnectionDialog 는 escape hatch.

## Task Why

ui-evaluation §6.6 part 2. sprint-95 의 Layer 1 primitive 위에 preset 을 올려 다이얼로그별 boilerplate (header/footer/feedback) 를 제거. 9 dialog 의 일관된 시각/동작 보장.

## Scope Boundary

**쓰기 허용**:
- `src/components/ui/dialog/` (신규 디렉터리) — `ConfirmDialog.tsx`, `FormDialog.tsx`, `PreviewDialog.tsx`, `TabsDialog.tsx` + 각 `__tests__/`
- `src/components/shared/ConfirmDialog.tsx` (re-export 또는 이동)
- 마이그레이션 대상:
  - `src/components/connection/GroupDialog.tsx`
  - `src/components/connection/ImportExportDialog.tsx`
  - `src/components/datagrid/BlobViewerDialog.tsx`
  - `src/components/datagrid/CellDetailDialog.tsx`
  - `src/components/structure/SqlPreviewDialog.tsx`
  - `src/components/document/MqlPreviewModal.tsx`
  - `src/components/document/AddDocumentModal.tsx`
- 마이그레이션 대상 test 파일들
- `docs/dialog-conventions.md` (신규)
- 호출 사이트 (preset import 경로 변경 전파)

**쓰기 금지**:
- `src/components/connection/ConnectionDialog.tsx` 본체 변경 (escape hatch 주석만 추가)
- 다이얼로그 콘텐츠/디자인 변경
- sprint-88~95 산출물 추가 변경
- `CLAUDE.md`, `memory/`

## Invariants

- sprint-91 close 카운트 매트릭스 통과
- sprint-92 ConnectionDialog `expectNodeStable` 통과
- sprint-93 SqlPreviewDialog commitError 표면화 + "executed: N, failed at: K" 유지 — `PreviewDialog.commitError` prop 으로 보존
- sprint-94 toast hookup 회귀 0
- sprint-95 tone/layout/DialogFeedback 사용

## Done Criteria

1. 4 preset wrapper 존재 + Layer 1 만 사용.
2. 7~8 dialog 가 preset 으로 마이그레이션.
3. ConnectionDialog 코드 상단 escape hatch 주석.
4. dialog-conventions.md 작성.
5. preset 별 단위 테스트 ≥ 1 (총 ≥ 4).
6. 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. preset 4 종 grep
  5. 마이그레이션 사이트 grep
  6. `docs/dialog-conventions.md` 존재 확인

## Evidence To Return

`docs/sprints/sprint-96/findings.md`:
- 변경 파일 + 목적
- 명령 출력 + AC 별 라인 인용
- 마이그레이션 매트릭스 (dialog → preset)
- escape hatch 주석 위치
- 가정/위험

## References

- Contract: `docs/sprints/sprint-96/contract.md`
- Spec: `docs/sprints/sprint-96/spec.md`
- sprint-95 primitive: `src/components/ui/dialog.tsx`
