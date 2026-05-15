# Sprint 326 Handoff — Slice I.1 (bulkWrite commit path)

날짜: 2026-05-15

## 결과

- 신규 unit: 5 (`mqlCommandsToBulkOps`)
- 회귀: 0 — `pnpm vitest run --no-coverage` 3756 통과 / 10 skipped
  (sprint-325 기준 3751 → +5).
- tsc / lint exit 0.

## 변경 파일

- `src/lib/mongo/mqlToBulk.ts` (NEW) — `MqlCommand[]` → `BulkWriteOp[]`.
- `src/lib/mongo/mqlToBulk.test.ts` (NEW) — 5 unit.
- `src/lib/datagrid/paradigmEditAdapter.ts` — `dispatchMqlCommand` 의
  per-command iteration 을 `dispatchMqlBatch` (단일 `bulkWriteDocuments`
  호출) 로 교체.
- 영향받은 기존 테스트 mock 업데이트:
  - `src/lib/datagrid/paradigmEditAdapter.test.ts` (assertion 2건 →
    bulkWriteDocuments 호출 검증).
  - `src/components/datagrid/useDataGridEdit.document.test.ts` (mock 추가
    + assertion 갱신).
  - `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts` (3
    종 ops 가 같은 IPC 호출의 ops 배열에 포함됨을 가드).
  - `src/components/document/DocumentDataGrid.test.tsx` (mock 추가 +
    assertion 갱신).

## 의사결정

- **D-68**: per-command IPC 제거 — 한 commit cycle 의 모든 op 가 같은
  collection 이므로 단일 batch 가 항상 가능. 더 큰 단위인 cross-collection
  batch 는 v0 범위 외.
- **D-69**: transaction toggle 은 v0 미도입 — Mongo driver 측 transaction
  context 가 wrapper 에 노출되어 있지 않다. backend session API 가 노출
  되면 UI toggle 추가 (Sprint 327, I.2 후속).
- **D-70**: advanced operator ($inc / $unset / $push / $pull / $rename 등)
  미도입 — 사용자가 raw operator string 입력하는 path 가 BSON editor
  와 충돌. v1 은 `$set` only; v2 에서 operator picker UI 도입.

## 다음

Slice J — Indexes 탭 + `$indexStats` (Mongo).
