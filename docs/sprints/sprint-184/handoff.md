# Sprint 184 — Handoff

| AC | Subject | Evidence |
|----|---------|----------|
| AC-184-01 | RDB UPDATE+INSERT+DELETE single-batch | `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts` `[AC-184-01]`. `pnpm vitest run src/components/datagrid/useDataGridEdit.mixed-batch.test.ts` → 5 passed. 단언: `mockExecuteQueryBatch` 1회 + statements 길이 3 + UPDATE/INSERT/DELETE 각 1건 + `mockExecuteQuery` 0회 + post-commit cleanup. |
| AC-184-02 | Mongo insertOne+updateOne+deleteOne 순차 | 같은 파일 `[AC-184-02]`. 단언: `mockInsertDocument` / `mockUpdateDocument` / `mockDeleteDocument` 각 1회 + `mockExecuteQueryBatch` 0회 + `mockExecuteQuery` 0회. paradigm 분기 누수 가드. |
| AC-184-03 | RDB 100 UPDATE perf smoke | 같은 파일 `[AC-184-03]`. `handleCommit` < 1000ms + `sqlPreview.length === 100` + 모든 entry `^UPDATE `. 실측 ~10–30ms (M-series 로컬). |
| AC-184-04 | RDB 100 DELETE perf smoke | 같은 파일 `[AC-184-04]`. budget < 1000ms + 길이 100 + 모두 `^DELETE FROM `. 실측 ~5–20ms. |
| AC-184-05 | RDB 100 INSERT perf smoke (duplicate-based) | 같은 파일 `[AC-184-05]`. budget < 1000ms + 길이 100 + 모두 `^INSERT INTO `. setup 비용 회피 위해 `handleDuplicateRow` × 100. 실측 ~15–40ms. |
| AC-184-06 | Phase 22 종료 마킹 | `docs/phases/phase-22.md`: status `계획 → 완료 (2026-05-01, Sprint 181~184)`, 작업 단위 표에 sprint 별 실측 + commit `51d6406` 인용, Exit Criteria 4 항목에 evidence 매핑. |
| AC-184-07 | 회귀 (코드 무수정) | `git diff src-tauri/` → empty. `git diff src/components/datagrid/useDataGridEdit.ts` → empty. `git diff src/components/query/PendingChangesTray.tsx src/components/query/EditableQueryResultGrid.tsx src/components/datagrid/sqlGenerator.ts src/components/datagrid/mqlGenerator.ts src/lib/tauri.ts` → empty. 본 sprint 는 *production 코드 0줄* 변경. |

## Check matrix

| Check | Result |
|-------|--------|
| `cd src-tauri && cargo test --lib` | `326 passed; 0 failed; 2 ignored` |
| `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` | clean |
| `cd src-tauri && cargo fmt --check` | clean (no diff) |
| `pnpm vitest run src/components/datagrid/useDataGridEdit.mixed-batch.test.ts` | `5 passed` |
| `pnpm vitest run` | `171 files, 2546 tests passed` |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| skip-zero (`it.skip` / `it.todo` / `xit`) in mixed-batch | 0 |
| `#[ignore]` net new | 0 |
| Production 코드 git diff | 0 (의도) |

## Files changed (purpose, one line each)

- `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts` (new) —
  AC-184-01 ~ AC-184-05 단일 파일에 5 cases (mixed-batch RDB / Mongo +
  100건 UPDATE / DELETE / INSERT perf smoke). Sprint 별 cohesion 우선.
- `docs/phases/phase-22.md` — status `완료` 마킹, 작업 단위 표 sprint
  별 실측 갱신, Exit Criteria 4 항목에 evidence 매핑. *결정* 부분 무수정.
- `docs/sprints/sprint-184/contract.md` (new) — sprint contract.
- `docs/sprints/sprint-184/findings.md` (new) — *코드 변경 0* 결정,
  AC 별 회귀 가드 의도, perf budget 산정, AC→테스트 매핑, Phase 22
  종료 보고, residual risk.
- `docs/sprints/sprint-184/handoff.md` — this file.

## Phase 22 종료 메모

본 sprint 로 Phase 22 (Row 인라인 편집 RDB 완성 + Preview/Commit/Discard
게이트) 가 종료된다. Sprint 181 (export 단판승, Phase 21) 은 별 phase
였지만 sprint 번호 sequence 의 직전 위치라 Phase 22 status 줄에 함께
인용. 다음 작업: **Phase 23 Safe Mode** (sprint 추정 185).
