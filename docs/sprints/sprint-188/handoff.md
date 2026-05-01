# Sprint 188 — Handoff

Sprint: `sprint-188` (Phase 23 closure / Mongo aggregate dangerous-op gate +
`useSafeModeGate` helper hook 추출).
Date: 2026-05-01.

## Files changed

| 파일 | Purpose |
|------|---------|
| `src/lib/sqlSafety.ts` | `StatementKind` union 에 `"mongo-out" \| "mongo-merge" \| "mongo-other"` 추가 — paradigm 무관하게 `StatementAnalysis` shape 재사용. |
| **NEW** `src/lib/mongoSafety.ts` | `analyzeMongoPipeline(pipeline: unknown[]): StatementAnalysis` — `$out` / `$merge` 가 등장하면 첫 위반 stage 의 reason 으로 danger 분류, 그 외는 safe. |
| **NEW** `src/lib/mongoSafety.test.ts` | 10 케이스 (`AC-188-01a~j`) — empty / read-only / `$out` end / `$out` start / `$merge` / mixed first-wins / `$merge` before `$out` / non-object stage 무시 / 빈 object 무시 / `$unset` `$addFields` `$group` safe. |
| **NEW** `src/hooks/useSafeModeGate.ts` | `useSafeModeGate(connectionId): { decide(analysis): SafeModeDecision }` — paradigm-agnostic decision matrix (safe / non-prod / strict / warn / off). |
| **NEW** `src/hooks/useSafeModeGate.test.ts` | 6 케이스 (`AC-188-02a~f`) — safe → allow / non-prod → allow / strict block (canonical reason verbatim) / warn confirm (reason verbatim) / off allow / missing connection → allow. |
| `src/components/workspace/ConfirmDangerousDialog.tsx` | `aria-label="SQL preview"` → `"Statement preview"` (AC-188-04). `sqlPreview` prop 명은 RDB call-site 회귀 방지 위해 보존. 도크스트링에 Sprint 188 paradigm-agnostic 사용 명시. |
| `src/components/query/QueryTab.tsx` | `useSafeModeGate(tab.connectionId)` 도입; `runMongoAggregateNow` helper 추출 (dispatch + queryState completed/error + history); `handleExecute` aggregate 경로에 `analyzeMongoPipeline(parsed)` + `mongoGate.decide(...)` 분기 (block / confirm / allow); `pendingMongoConfirm` state + `confirmMongoDangerous` / `cancelMongoDangerous`; `<ConfirmDangerousDialog>` mount (`sqlPreview={JSON.stringify(pipeline, null, 2)}`). find 경로 무영향. |
| `src/components/query/QueryTab.test.tsx` | `describe("Sprint 188 — Mongo aggregate safe-mode gate")` 6 케이스 (`AC-188-03a~f`) — strict block / warn confirm-then-run / warn cancel / off allow / non-prod allow / safe pipeline allow. `setupProductionMongo()` helper 로 환경 셋업 표준화. |
| `docs/sprints/sprint-188/contract.md` | 본 sprint contract. |
| `docs/sprints/sprint-188/findings.md` | 설계 결정 + AC→테스트 매핑 + Sprint 187 §10 가정 정정 + 후속 sprint 후보 (Sprint 197 mongodb.rs split / Sprint 198 Mongo bulk-write). |
| `docs/sprints/sprint-188/handoff.md` | 본 파일. |

총 코드 4 modified + 4 new = 8 파일, docs 3 파일.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-188-01 | `pnpm vitest run src/lib/mongoSafety.test.ts` | **10 passed** (NEW; AC-188-01a~j). |
| AC-188-02 | `pnpm vitest run src/hooks/useSafeModeGate.test.ts` | **6 passed** (NEW; AC-188-02a~f). canonical block reason 문자열 verbatim 단언 — copy drift 가드. |
| AC-188-03 | `pnpm vitest run src/components/query/QueryTab.test.tsx` | Sprint 188 describe **6 passed** (AC-188-03a~f). `mockAggregateDocuments` invocation count + queryState.error / dialog 가시성으로 분기 결과 단언. |
| AC-188-04 | `git diff src/components/workspace/ConfirmDangerousDialog.tsx` | `aria-label="Statement preview"` 라인 + Sprint 188 도크스트링 라인. 기존 RDB 테스트 (Sprint 186) regression 0. |
| AC-188 전체 | `pnpm vitest run` + tsc + lint + invariant `git diff` | **181 files / 2640 tests passed** (+2 files, +22 tests vs Sprint 187 baseline 179/2616); tsc 0 errors; lint 0 warnings; `git diff src-tauri/` empty. |

## Required checks (재현)

```sh
pnpm vitest run src/lib/mongoSafety.test.ts \
  src/hooks/useSafeModeGate.test.ts \
  src/components/query/QueryTab.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
git diff --stat src-tauri/
```

기대값: 모두 zero error / empty diff.

## Phase 23 종료 선언

Sprint 188 완료로 Phase 23 (Safe Mode / TablePlus parity) 종료. 활성 가드:

- **RDB**: DataGrid edit, EditableQueryResultGrid, ColumnsEditor,
  IndexesEditor, ConstraintsEditor (5 사이트 inline gate).
- **Document**: QueryTab aggregate (`$out` / `$merge` via
  `useSafeModeGate`).

## 후속 (`docs/refactoring-plan.md` 의 10단계 sequencing 으로 통합)

- **Sprint 189 (Phase 23 closure refactor)**: RDB 5 사이트 inline gate 를
  `useSafeModeGate` 로 마이그레이션. 회귀 risk 격리 단위 — 각 사이트가
  `ConfirmDangerousDialog` state 를 다르게 관리하므로 별도 sprint 로 분리.
- **Sprint 190 (FB-1b)**: prod-auto SafeMode.
- **Sprint 191**: SchemaTree 분해 (refactor).
- **Sprint 192 (FB-3)**: DB 단위 export.
- **Sprint 193**: useDataGridEdit 분해 (refactor).
- **Sprint 194 (FB-4)**: Quick Look 편집.
- **Sprint 195**: tabStore intent actions (refactor).
- **Sprint 196 (FB-5b)**: query history source 필드.
- **Sprint 197**: `mongodb.rs` 4분할 (refactor).
- **Sprint 198 (Phase 신설 없이)**: Mongo bulk-write Tauri command 신규
  (`delete_many`, `update_many`, `drop_collection`) + UI 진입점 (sidebar
  context menu / Quick Look 모드 / aggregate stage extension 중 택일) +
  `analyzeMongoOperation` analyzer. `useSafeModeGate` 는 paradigm-agnostic
  이므로 인풋 analyzer 만 추가됨. (Phase 24 = Index Write UI 와 명명 충돌
  회피 위해 Phase 신설 안 함.)
- **단건 mutate 정책 미결**: `insert_document` / `update_document` /
  `delete_document` 단건 + RDB row-level single delete 는 통합 정책 결정
  후 일괄 적용. user feedback 추가 수집 후 별도 sprint 단위로 결정.
