# Sprint Execution Brief: sprint-312 (Phase 28 Slice A6 — write dispatch + panels + E2E)

## Objective

Slice A 의 마지막. 7 write method dispatch 추가, `WriteSummaryPanel` /
`ScalarOrListPanel` 신설, `QueryResultGrid` 가 `resultKind` discriminator
로 분기. Safe Mode classifier 가 write 마다 호출. Playwright E2E
(E28-01) 추가. Global Slice A AC 만족.

## Task Why

A5 까지 read 6 method 가 작동하지만 write 7 method 가 사용자에게 "A6
placeholder" 에러로 surface. 사용자가 실제 mongosh write 표현식
(`db.coll.insertOne(...)`) 을 실행해야 Slice A 가 완성된다.

또한 count/distinct 의 큰 숫자/리스트가 A5 에서는 1×1, 1×N grid 로
렌더되어 시각적으로 어색하다. ScalarOrListPanel 이 paradigm-appropriate
시각화를 제공한다.

Slice A 종료 후 B–M 의 모든 후속 slice 가 "Slice A 가 끝났다" 가정 위에서
동작 — A6 통과가 Slice B 시작의 trigger.

## Scope Boundary

**Touch**:
- `src/components/query/QueryTab/useQueryExecution.ts` — 7 write dispatch
- `src/components/query/WriteSummaryPanel.tsx(.test.tsx)` (NEW)
- `src/components/query/ScalarOrListPanel.tsx(.test.tsx)` (NEW)
- `src/components/query/QueryResultGrid.tsx` (router)
- `src/types/query.ts` — `resultKind: "writeSummary"` + `writeSummary` field
- `src/lib/mongo/mongoSafety.ts` — write classifier 확장
- `e2e/phase-28-slice-A.spec.ts` (NEW)

**DO NOT touch**:
- editor (A3), snippet menu (A4), parser (A1), backend (A2)
- RDB editor (`SqlQueryEditor*`)
- `src-tauri/` 어떤 것도 (A6 는 신규 IPC 도입 금지)

## Invariants

- RDB 회귀 zero
- Safe Mode STOP/WARN/INFO 규약 유지
- pendingMongoConfirm 가 처음 파싱된 write payload 보유
- No `any`, interface for props, function components only
- Sprint 312 header comment
- TDD vertical slice

## Done Criteria

1. `pnpm vitest run` 3563 baseline 대비 회귀 0
2. `pnpm tsc --noEmit` / `lint` / `build` 0
3. `cargo build` / `cargo test --lib` / `clippy -D warnings` / `fmt --check` 0
4. 7 write method dispatch RTL
5. WriteSummaryPanel 4 variant RTL
6. ScalarOrListPanel 3 variant RTL
7. QueryResultGrid routing RTL
8. Safe Mode write classifier (STOP/WARN/INFO) RTL
9. E2E phase-28-slice-A.spec.ts 통과 또는 manual smoke 기록
10. Global Slice A AC grep 모두 0

## Verification Plan

- Profile: `mixed`
- Required checks 위 done criteria 와 1:1

## Evidence To Return

- 변경 파일 + 목적
- 7 dispatch + 4 summary + 3 scalar/list + routing + 3 safe-mode test
  name
- E2E 결과
- 자율 결정 D-16+: updateOne/deleteOne 의 non-`_id` filter 처리 (옵션 a/b/c
  중 선택 + 이유)

## TDD Workflow Reminder

권장 순서 (단순 → 복잡):
1. `WriteSummaryPanel` 4 variant 컴포넌트 — UI 분리 가능, 첫 트레이서
2. `ScalarOrListPanel` 3 variant
3. `QueryResultGrid` routing — resultKind 분기
4. `insertOne` dispatch — 가장 단순한 write
5. `insertMany` dispatch
6. `deleteMany` empty filter → STOP, non-empty → WARN
7. `updateMany` empty/non-empty
8. `deleteOne` (non-`_id` filter 결정 적용)
9. `updateOne` (non-`_id` filter 결정 적용)
10. `bulkWrite` per-op breakdown
11. E2E spec — 마지막

## References

- `docs/sprints/sprint-312/contract.md`
- `docs/sprints/sprint-307/spec.md` (A6 + Global AC 섹션)
- `docs/phases/phase-28-decision-log.md` — D-16+ 부터
- `src/lib/mongo/mongoSafety.ts` — `analyzeMongoOperation` (기존)
- `src/lib/tauri/document.ts` — A2 wrappers (insertManyDocuments,
  bulkWriteDocuments 등)
- `src/components/document/DocumentDataGrid/useMongoBulkOps.ts` — 기존
  write safety 호출 site (패턴 참고)
- `src/hooks/useSafeModeGate.ts`
