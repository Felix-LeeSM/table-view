# Sprint 325 Handoff — Slice H (Field projection dialog)

날짜: 2026-05-15
스코프 origin: `docs/sprints/sprint-325/contract.md`

## 결과

- 신규 RTL: 7 (ProjectionDialog) + 3 (DocumentDataGrid 통합)
- 회귀: 0 — `pnpm vitest run --no-coverage` 3751 통과 / 10 skipped
  (sprint-324 기준 3741 → +10).
- tsc / lint exit 0.

## 변경 파일

- `src/components/document/ProjectionDialog.tsx` (NEW) — include/exclude
  토글 + per-column checkbox + Apply / Clear / Cancel.
- `src/components/document/ProjectionDialog.test.tsx` (NEW) — 7 RTL.
- `src/components/document/DocumentDataGrid/useDocumentGridData.ts` —
  `projection?: Record<string, 0 | 1>` param + body wire-up.
- `src/components/document/DocumentDataGrid.tsx`:
  - `projection` / `projectionOpen` state
  - toolbar 의 bulkOpsSlot 에 Filter icon trigger
  - ProjectionDialog mount.
- `src/components/document/DocumentDataGrid.projection.test.tsx` (NEW) —
  3 통합 RTL.

## 의사결정 (D-65..D-67)

- **D-65**: include vs exclude 라디오 분리 — mixed mode 는 Mongo backend
  가 reject 하므로 UI 도 한 번에 한 mode 만 허용. v0 nested-path 미지원.
- **D-66**: per-collection persist 미도입 — projection 은 사용자가 한
  세션 안에서 자주 바꿀 수 있는 ad-hoc 선택. localStorage 보관 시 다음
  세션의 stale projection 이 사용자 surprise → 후속 sprint 의 explicit
  "save preset" 형식 권장.
- **D-67**: dialog 자체 동작은 ProjectionDialog.test.tsx 가 단독 가드,
  통합 (state → fetch body) 는 DocumentDataGrid.projection.test.tsx 가
  가드. 두 layer 분리는 슬라이스 F/G 동일.

## 다음

Slice I — bulkWrite + transaction toggle + advanced operators.
