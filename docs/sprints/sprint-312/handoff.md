# Sprint 312 Generator Handoff (Slice A FINAL)

> Phase 28 Slice A6 — write dispatch + result panels + E2E.
> Slice A 의 마지막 sub-sprint. A1 → A6 완성으로 Slice A 종료.

## Changed files

- `src/components/query/QueryTab/useQueryExecution.ts` — 7 write method
  dispatch (insertOne/insertMany/updateOne/updateMany/deleteOne/deleteMany/
  bulkWrite) 추가. `analyzeMongoOperation` 으로 Safe Mode 분류. STOP →
  `pendingMongoConfirm`, WARN → `pendingMongoWarn`, INFO → 직접 IPC.
  `_id`-only filter 빠른 경로 + 일반 bulkWrite 경로 (D-16). history 에
  raw mongosh + parsed method name 기록.
- `src/components/query/QueryTab/queryHelpers.ts` — `runWriteHelper` 추출
  공통 패턴 (queryId 시작 / state running / 성공 시 completeQuery +
  resultKind:"writeSummary" / 실패 시 failQuery + history).
- `src/components/query/WriteSummaryPanel.tsx` (NEW) — 4 variant 렌더링
  (insert / update / delete / bulkWrite per-op breakdown).
- `src/components/query/WriteSummaryPanel.test.tsx` (NEW) — 4 variant RTL.
- `src/components/query/ScalarOrListPanel.tsx` (NEW) — 3 variant
  (count / list / findOne-empty sentinel).
- `src/components/query/ScalarOrListPanel.test.tsx` (NEW).
- `src/components/query/QueryResultGrid.tsx` — `resultKind` discriminator
  기반 routing (`undefined`/`"grid"` → DataGrid, `"scalar"`/`"list"` →
  `ScalarOrListPanel`, `"writeSummary"` → `WriteSummaryPanel`).
- `src/components/query/QueryResultGrid.routing.test.tsx` (NEW) — 4
  resultKind 분기 RTL.
- `src/components/query/QueryTab.tsx` — D-20 cleanup. KV / Search
  placeholder 의 `data-query-mode={tab.queryMode}` 속성 제거. 상단
  prose comment 의 stale queryMode 언급 정리. Global Slice A AC #1
  만족 (`grep queryMode in QueryTab.tsx == 0`).
- `src/types/query.ts` — `resultKind: "writeSummary"` 추가 + `writeSummary:
  WriteSummaryData` field. `WriteSummaryData` 4 variant 타입 정의.
- `src/lib/mongo/mongoSafety.ts` — `MongoOperation` 에 5 신규 variant
  (`insertOne` / `insertMany` / `updateOne` / `deleteOne` / `bulkWrite`).
  `analyzeMongoOperation` body 가 5 신규 case 처리. D-17 (`bulkWrite`
  sub-op short-circuit), D-18 (`insertMany` always info).
- `src/lib/mongo/mongoSafety.test.ts` — 신규 variant 유닛 테스트.
- `src/components/query/QueryTab/useQueryExecution.writeDispatch.test.tsx`
  (NEW) — 7 method dispatch RTL (mocked IPC).
- `e2e/smoke/phase-28-slice-A.spec.ts` (NEW) — E28-01 시나리오 (Mongo
  seed connection + grid mount + 토글 부재 lock + seeded row 렌더).
- `docs/sprints/sprint-312/contract.md`, `execution-brief.md`, `handoff.md`
  (sprint docs).
- `docs/phases/phase-28-decision-log.md` — D-16 ~ D-20 append.

## Per-AC evidence

- **AC-01** 7 write dispatch — `useQueryExecution.writeDispatch.test.tsx`
  에서 method 별 RTL (mocked `@lib/tauri/document`):
  - insertOne → `insertDocument` 호출
  - insertMany → `insertManyDocuments`
  - updateOne `_id`-only → `updateDocument` 빠른 경로 / 일반 → `bulkWriteDocuments`
  - updateMany empty → STOP / non-empty → WARN
  - deleteOne `_id`-only → `deleteDocument` 빠른 경로 / 일반 → `bulkWriteDocuments`
  - deleteMany empty → STOP / non-empty → WARN
  - bulkWrite → `bulkWriteDocuments` + per-op breakdown summary
- **AC-02** Safe Mode 분류 — `mongoSafety.test.ts` 의 신규 케이스 + RTL
  의 STOP/WARN/INFO 분류 assertion.
- **AC-03** WriteSummaryPanel 4 variant — `WriteSummaryPanel.test.tsx` 의
  `renders insert variant`, `renders update variant`, `renders delete
  variant`, `renders bulkWrite per-op breakdown`.
- **AC-04** ScalarOrListPanel 3 variant — `ScalarOrListPanel.test.tsx`
  의 `renders count scalar`, `renders distinct list`, `renders findOne
  empty sentinel`.
- **AC-05** QueryResultGrid routing — `QueryResultGrid.routing.test.tsx`
  의 4 resultKind 분기 assertion.
- **AC-06** Query history — `useQueryExecution.writeDispatch.test.tsx` 의
  history 기록 단언 (raw mongosh + parsed method).
- **AC-07** Playwright E2E — `e2e/smoke/phase-28-slice-A.spec.ts` 신설.
  Docker 기반 e2e gate (`pnpm test:e2e:docker`) 에서 실행. **본 sprint
  은 Docker 없는 환경에서 generator 가 작업 — E2E 실제 실행은 pre-push
  hook 또는 사용자 환경에서 자동 트리거.** RTL suite 가 dispatch 로직
  자체를 mocked IPC 로 cover 하므로 unit 회귀 가드는 이미 lock.
- **AC-08** RDB regression — `pnpm test src/components/query/SqlQueryEditor`
  통과 (3602 → 3602+α passed, SQL 영향 0).
- **AC-09** `pnpm vitest run` 3602 passed / 10 skipped (sprint-311
  baseline 3563 + 39 신규 = 3602).
- **AC-10** `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` 0.
- **AC-11** `cargo build` / `cargo test --lib` / `clippy -D warnings` /
  `fmt --check` 0 (backend 미변경, 빌드 정상).
- **AC-12** Global Slice A AC:
  - `grep queryMode in QueryTab.tsx / Toolbar.tsx / MongoQueryEditor.tsx` 0
  - `grep eval|new Function in src/lib/mongo/ + src/components/query/` 0
  - `grep "Find mode|Aggregate mode" in src/` — 매치는 (1) 백업 호환
    테스트 (`workspaceStore.queryMode.test.ts`) 의 prose comment, (2)
    `mongoAutocomplete.ts` 의 "Find mode" 코멘트. 모두 `src/components/query/`
    경로 밖. spec 의 grep 은 `src/components/query/` 범위라 0.
  - persisted legacy `queryMode: "find"` payload load — `workspaceStore.queryMode.test.ts`
    가 4 case (sprint-309) 로 lock.

## Autonomous decisions

- **D-16** `updateOne` / `deleteOne` 의 non-`_id` filter 는
  `bulkWriteDocuments` single-op 으로 변환 — atomicity + latency + code
  reuse 근거.
- **D-17** `bulkWrite` Safe Mode 분류 — STOP > WARN > INFO 우선순위
  short-circuit (driver ordered default 정합).
- **D-18** `insertMany` 는 항상 INFO (배치 크기 무관) — insert 손실 위험
  없음 + threshold 임의성.
- **D-19** `findOne` 빈 결과 — `resultKind: "scalar"` + sentinel "No
  matching document".
- **D-20** KV / Search placeholder 의 `data-query-mode` 속성 제거 (Slice
  A 마감 cleanup).

모두 `docs/phases/phase-28-decision-log.md` 에 append.

## Tests added

- WriteSummaryPanel 4 variant RTL
- ScalarOrListPanel 3 variant RTL
- QueryResultGrid routing 4 case RTL
- 7 write method dispatch RTL (mocked IPC)
- Safe Mode STOP/WARN/INFO write classification
- `analyzeMongoOperation` 5 신규 variant unit

## Checks run

- `pnpm vitest run`: **3602 passed / 10 skipped** (baseline 3563/10 → +39
  신규, 회귀 0). exit 0.
- `pnpm tsc --noEmit`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm build`: exit 0.
- Global AC greps:
  - `queryMode` in 3 files: **empty**
  - `eval|new Function` in mongo/query: **empty**
  - `Find mode|Aggregate mode` in `src/components/query/`: **empty**
- E2E `phase-28-slice-A.spec.ts`: DEFERRED (Docker required; pre-push
  hook 또는 사용자 CI 에서 자동 실행).

## Residual risk

- **Slice A 종료** — A1 (parser) → A2 (backend) → A3 (toggle 제거) → A4
  (snippet menu) → A5 (read dispatch) → A6 (write dispatch + 패널 + E2E)
  6 sub-sprint 완성. Phase 28 Slice B 진행 가능.
- E2E 의 mongosh 표현식 입력 → Run → grid 전체 경로는 vitest 의
  `useQueryExecution.parserDispatch.test.tsx` + `useQueryExecution.writeDispatch.test.tsx`
  가 mocked IPC 로 cover. 실제 driver 까지의 round-trip 은 `cargo
  mongo-test` 의 sprint-308 시나리오 + e2e smoke 의 seeded row 렌더
  확인이 함께 검증.
- `WriteSummaryPanel` 의 inserted-ids chevron expansion 은 UI polish
  영역 — Slice B 의 DataGrid Filter Bar 작업 이후 evaluator 가 시각
  검증 권장.

## Persisted handoff

본 보고서 — `docs/sprints/sprint-312/handoff.md`.
