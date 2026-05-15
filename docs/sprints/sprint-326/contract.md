# Sprint 326 Contract — Slice I.1 (bulkWrite commit path)

## Scope

DocumentDataGrid commit path 가 N 개의 insertOne / updateOne / deleteOne
을 N 번 IPC 로 dispatch 하는 대신 단일 `bulk_write_documents` 호출로
묶는다.

## Done Criteria

1. `src/lib/mongo/mqlToBulk.ts` — `mqlCommandsToBulkOps(commands)` helper.
   각 `MqlCommand` 의 `kind` 를 `BulkWriteOp.op` 로 매핑:
   - insertOne → `{ op: "insertOne", document }`
   - updateOne → `{ op: "updateOne", filter: { _id: ... }, update: { $set: patch } }`
   - deleteOne → `{ op: "deleteOne", filter: { _id: ... } }`
2. `paradigmEditAdapter.documentEditAdapter` 의 execute 가
   `bulkWriteDocuments` 단일 호출로 변경. counter 메시지 갱신.
3. 빈 commands → no-op (현재와 동일).
4. ≥ 4 unit (mqlToBulk 매핑) + ≥ 1 통합 (commit → bulkWrite 호출 확인).
5. tsc / lint / vitest exit 0.

## Out of Scope

- transaction toggle (Sprint 327, I.2).
- advanced operator ($inc / $unset / $push 등) (v2 후속).
- bulkWrite ordered=false / continueOnError.

## Invariants

- MQL preview line / commands 출력 회귀 0.
- 기존 dispatch 경로 가 호출하던 commit-success toast / history record
  가 동일하게 동작.

## Verification Plan

- Profile: `command`
- Required checks: scoped vitest + 전체 sweep + tsc + lint
