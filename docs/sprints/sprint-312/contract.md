# Sprint Contract: sprint-312 (Phase 28 Slice A6 — write dispatch + result panels + E2E)

## Summary

- Goal: 7 write method dispatch (`insertOne` / `insertMany` / `updateOne` /
  `updateMany` / `deleteOne` / `deleteMany` / `bulkWrite`) wire +
  `WriteSummaryPanel` + `ScalarOrListPanel` 신설 + `QueryResultGrid`
  `resultKind` 기반 라우팅 + Safe Mode 분류 + Playwright E2E (E28-01).
- Verification Profile: `mixed` (RTL + 회귀 + E2E)

## In Scope

- `src/components/query/QueryTab/useQueryExecution.ts` — 7 write method
  dispatch 추가. parser dispatch table 확장.
- `src/components/query/WriteSummaryPanel.tsx` (NEW) — insert / update /
  delete / bulkWrite 4 variant 렌더링.
- `src/components/query/WriteSummaryPanel.test.tsx` (NEW).
- `src/components/query/ScalarOrListPanel.tsx` (NEW) — count / distinct /
  findOne "No match" 형태 렌더링.
- `src/components/query/ScalarOrListPanel.test.tsx` (NEW).
- `src/components/query/QueryResultGrid.tsx` (MODIFY) — `resultKind`
  discriminator 기반 routing 추가. `"grid"` / undefined 는 기존 DataGrid,
  `"scalar"` / `"list"` 는 `ScalarOrListPanel`, `"writeSummary"` 는
  `WriteSummaryPanel`.
- `src/types/query.ts` (MODIFY) — `resultKind` 에 `"writeSummary"` 추가 +
  `writeSummary?` field 신설.
- `src/lib/mongo/mongoSafety.ts` (MODIFY 또는 NEW helper) — write
  classifier 가 insertOne/insertMany/updateOne/deleteOne/bulkWrite 까지
  cover. (`updateMany` / `deleteMany` / `dropCollection` 은 이미 존재.)
- `e2e/phase-28-slice-A.spec.ts` (NEW) — Playwright E28-01 시나리오.

## Out of Scope

- editor surface (A3 동결), snippet menu (A4 동결), parser (A1 동결),
  backend (A2 동결).
- RDB editor / SqlPreviewDialog.
- `src-tauri/` — 단, `updateOne` 가 `_id` 필터 외 케이스를 처리하는 방식
  결정 시 신규 IPC 추가 금지 (D-NN 으로 round-trip 방식 선택).
- Slice B–M.

## Invariants

- **RDB 회귀 zero**: SQL paradigm Run / Result rendering 비변경.
- **Safe Mode 규약 유지**: STOP (empty filter `*-many`, `drop_collection`,
  `$out`/`$merge`) → `ConfirmDestructiveDialog`. WARN (non-empty filter
  `*-many`) → write-preview modal (Mongo equivalent of `SqlPreviewDialog`
  — A6 가 신설 OR 기존 modal 재사용). INFO (`*-one`) → 직접 실행.
- **`pendingMongoConfirm` 가 parsed write payload 보유** (A5 패턴 동일):
  STOP confirm 시 editor 변경 영향 없음.
- **No `any`** in TS, **`interface` for props**, function components only.
- **Sprint header comment** Sprint 312.
- **TDD vertical slice** — write method 한 번에 하나씩 RED → GREEN.

## Acceptance Criteria

- **AC-01** Write dispatch matrix (각 RTL mocked IPC):
  - `insertOne(doc)` → `insertDocument` → `{insertedIds: [<id>]}` write
    summary.
  - `insertMany([docs])` → `insertManyDocuments` →
    `{insertedIds: [...]}`.
  - `updateOne(filter, update)` → 두 sub-case:
    - filter 가 `{ _id: ... }` 만 포함 → `updateDocument` 호출 (기존 IPC).
    - filter 가 비-`_id` → **자율 결정** (D-NN): A6 는 신규 IPC 도입 금지.
      옵션: (a) `findOneDocument(filter)` 로 `_id` 조회 후
      `updateDocument`, (b) `bulkWrite([{op:"updateOne", filter, update}])`
      로 변환, (c) 사용자에게 에러로 "filter must include `_id` for
      updateOne in this slice" 노출. Generator 가 선택 + 의사결정 로그
      기재.
  - `updateMany(filter, update)` → `updateMany` IPC → `{modifiedCount: N}`.
    empty filter → STOP, non-empty → WARN.
  - `deleteOne(filter)` → 두 sub-case (`_id` only vs 비-`_id`) — `updateOne`
    과 동일 결정 채택.
  - `deleteMany(filter)` → `deleteMany` IPC → `{deletedCount: N}`. empty
    → STOP, non-empty → WARN.
  - `bulkWrite(ops)` → `bulkWriteDocuments` → per-op breakdown summary.
- **AC-02** Safe Mode classifier 가 write method 마다 호출:
  - STOP 조건: `*-many` with empty filter (`{}`), `bulkWrite` 의 첫 op 가
    empty-filter `*-many`, `drop_collection`-equivalent. → `pendingMongoConfirm`.
  - WARN 조건: `*-many` with non-empty filter. → write preview modal.
  - INFO 조건: `*-one`, `insertOne`, `insertMany`. → 직접 실행.
- **AC-03** `WriteSummaryPanel` 가 4 variant 렌더링:
  - insert(s): `"Inserted N document(s)"` + chevron-expand 가능한 id 리스트.
  - update(s): `"Modified N document(s) (matched M)"`.
  - delete(s): `"Deleted N document(s)"`.
  - bulkWrite: 표 — 1 row per op (insertOne / updateOne / ...) + 카운터.
- **AC-04** `ScalarOrListPanel` 가 3 variant:
  - count (`resultKind: "scalar"`) → 큰 숫자 + "Count" 라벨.
  - distinct (`resultKind: "list"`) → 필드명 제목 + value 1줄 per row.
  - findOne empty (`resultKind: "scalar"` + sentinel) → "No matching document".
- **AC-05** `QueryResultGrid` (또는 sibling router) 가 `resultKind` 에 따라
  분기:
  - `undefined` / `"grid"` → 기존 DataGrid.
  - `"scalar"` / `"list"` → `ScalarOrListPanel`.
  - `"writeSummary"` → `WriteSummaryPanel`.
- **AC-06** Query history 가 write 의 raw mongosh expression + parsed
  method name (queryMode) + duration + status 기록. summary count 자체는
  history 에 저장 안 함.
- **AC-07** Playwright `e2e/phase-28-slice-A.spec.ts` 가 E28-01 시나리오
  통과: clean launch → query tab 에 `db.users.find({age:{$gt:30}}).limit(10)`
  입력 → Run → grid 가 ≥1 row 렌더. seeded dataset 가정 (existing e2e
  fixture).
- **AC-08** RDB regression — `pnpm test src/components/query/SqlQueryEditor`
  exit 0 + SQL `SELECT 1` 동작 unchanged smoke.
- **AC-09** `pnpm vitest run` exit 0, sprint-311 baseline 3563 / 10 skipped
  대비 회귀 0 (신규 테스트 증가만 허용).
- **AC-10** `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` 0.
- **AC-11** `cargo build` + `cargo test` + `cargo clippy --all-targets --
  -D warnings` + `cargo fmt --check` 0 (sprint 312 가 backend 미변경이지만
  parser path 가 backend wire 호환 확인).
- **AC-12** Global Slice A AC (spec.md 의 256-265 줄) 통과:
  - `grep -rn "queryMode" src/components/` 가 `QueryTab.tsx`, `Toolbar.tsx`,
    `MongoQueryEditor.tsx` 안에서는 0.
  - `grep -rE "\beval\b|new Function\b" src/lib/mongo/ src/components/query/`
    0 match.
  - `grep -rn "Find mode\|Aggregate mode" src/` 0 match.
  - Persisted legacy `queryMode: "find"` payload 가 load 시 throw 없음 +
    editor 가 정상 렌더 (store unit 으로 lock).

## Verification Plan

### Required Checks

1. `pnpm vitest run` exit 0
2. `pnpm tsc --noEmit` exit 0
3. `pnpm lint` exit 0
4. `pnpm build` exit 0
5. `cargo build -p table-view` exit 0
6. `cargo clippy --all-targets --all-features -- -D warnings` exit 0
7. `cargo fmt --check` exit 0
8. `cargo test -p table-view --lib` exit 0
9. Playwright `e2e/phase-28-slice-A.spec.ts` exit 0 (또는 manual smoke
   기록)
10. Global Slice A AC grep set 모두 0

### Required Evidence

- 변경 파일 + 목적
- 7 write dispatch 각각 test name
- WriteSummaryPanel 4 variant test name
- ScalarOrListPanel 3 variant test name
- QueryResultGrid routing test
- updateOne non-`_id` filter 의 D-NN 자율 결정 (Generator 선택 + 이유)
- E2E 결과
- Global AC grep 결과

## Exit Criteria

- 모든 AC 통과
- Slice A 통합 마감 (A6 가 Slice A 종료)
- Sprint 312 commit ready
