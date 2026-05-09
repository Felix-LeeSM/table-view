# Sprint 255 Contract

> Reference: master spec `docs/sprints/sprint-253/spec.md` §Sprint 255.
> Reference: ADR 0023 / grill Q3-(b).

## Scope

본 sprint 는 raw SQL editor (`QueryTab`) 와 raw MQL editor 의 *write 표면* 에 **WARN-tier preview dialog** 를 신규 mount — 현재의 직접 실행 (no-dialog) gap 을 해소. Sprint 254 의 3-tier classifier 가 도입되기 전이므로, 본 sprint 는 *현재의 2-tier* `severity: "safe" | "danger"` 그대로 활용 — `safe` 중 INFO 후보 (SELECT/EXPLAIN/SHOW/DESCRIBE/WITH …SELECT no DML CTE) 만 휴리스틱으로 식별 후 dialog skip, 나머지 `safe` (= WARN 후보) 는 SqlPreviewDialog / MqlPreviewModal mount.

기존 STOP (`severity: "danger"`) 는 그대로 ConfirmDestructiveDialog 로 routing — STOP > WARN 우선순위. 두 dialog 동시 mount 금지.

Acceptance criteria 매핑: AC-255-01 / AC-255-02 / AC-255-03 / AC-255-04 / AC-255-05 / AC-255-06.

## Done Criteria (완료 기준)

Generator 와 Evaluator 양측이 본 sprint 를 DONE 으로 합의하는 조건:

1. **INFO 휴리스틱 helper 신설**: `src/lib/sql/sqlSafety.ts` 에 `isInfoStatement(analysis: StatementAnalysis): boolean` (또는 `isReadOnly`) export — `kind === "select"` 만 true (SELECT / WITH …SELECT no DML CTE 는 analyzer 에서 이미 `kind: "select"` 로 분류). EXPLAIN / SHOW / DESCRIBE 등 추가 키워드는 본 sprint 에서 신규 분기 추가하여 `kind: "select"` 또는 신규 `kind: "info"` 로 매핑. Analyzer 의 기존 분기 회귀 0.

2. **Mongo INFO 휴리스틱 helper 신설**: `src/lib/mongo/mongoSafety.ts` 에 `isInfoMongoOperation(analysis): boolean` — find / read-only aggregate (no $out/$merge/drop/*-all) 식별. 기존 `analyzeMongoPipeline` 시그니처 / 반환 회귀 0.

3. **`useQueryExecution` 의 WARN dialog state 추가**:
   - 신규 state `pendingRdbWarn: { statements: string[] } | null` + `setPendingRdbWarn` + `confirmRdbWarn` + `cancelRdbWarn` callback.
   - 신규 state `pendingMongoWarn: { pipeline: Record<string, unknown>[] } | null` + `setPendingMongoWarn` + `confirmMongoWarn` + `cancelMongoWarn` callback.
   - `confirm*Warn` 은 `runRdbSingleNow` / `runRdbBatchNow` / `runMongoAggregateNow` 재사용 (기존 confirm-tier 와 동일 dispatch).
   - `cancel*Warn` 은 state clear 만 (IPC 미발동).

4. **`handleExecute` 분기 확장**:
   - RDB path:
     - 모든 statement 가 INFO → 기존처럼 직접 IPC (회귀 0).
     - 1+ STOP → 기존 ConfirmDestructiveDialog (회귀 0).
     - STOP 없고 1+ WARN → 신규 `setPendingRdbWarn({ statements })` 후 return (IPC 미발동). 사용자 confirm → `runRdbSingleNow` / `runRdbBatchNow` 재진입.
     - STOP 과 WARN 동시 존재 → STOP 우선 (ConfirmDestructiveDialog 만 mount).
   - Mongo aggregate path:
     - INFO (read-only pipeline) → 기존 직접 IPC.
     - STOP → 기존 ConfirmDestructiveDialog.
     - WARN (현재 `severity: "safe"` 인 non-INFO aggregate) → 신규 `setPendingMongoWarn`.
   - Mongo find path:
     - 항상 INFO (read) — 신규 dialog 발동 없음 (현재 동작 보존).

5. **JSX dialog mount 추가** (`QueryTab.tsx`):
   - `pendingRdbWarn` 시 `SqlPreviewDialog` mount with `sql={pendingRdbWarn.statements.join(";\n")}`, `loading={false}`, `error={null}`, `commitError={null}`, `environment={connection?.environment}`, `onConfirm={confirmRdbWarn}`, `onCancel={cancelRdbWarn}`.
   - `pendingMongoWarn` 시 `MqlPreviewModal` mount with `previewLines={JSON.stringify(pendingMongoWarn.pipeline, null, 2).split("\n")}`, `errors={[]}`, `onExecute={confirmMongoWarn}`, `onCancel={cancelMongoWarn}`, `loading={false}`.
   - STOP dialog (ConfirmDestructiveDialog) 와 동시 mount 방지 — STOP 우선 분기에서 WARN state set 안 함.

6. **AC-255-01..06 모두 매핑**.

7. **/tdd 흐름**:
   - 신규 테스트 먼저 (`QueryTab.warn-dialog.test.tsx` 또는 기존 `QueryTab.execution.test.tsx` 확장) — INSERT/UPDATE WHERE/DELETE WHERE/CREATE/ALTER additive 가 SqlPreviewDialog mount → "Execute" 클릭 → `executeQuery` IPC mock 1회 호출, "Cancel" 클릭 → IPC 미호출.
   - 신규 sqlSafety / mongoSafety helper 단위 테스트 (INFO 분류 corpus).
   - red → 구현 → green.

8. **Verification Plan** 7개 check 모두 pass.

## Out of Scope

- Severity classifier 3-tier split (`info` / `warn` / `danger`) — Sprint 254.
- Dry-run row-count STOP escalation (100+ row → STOP) — Sprint 254.
- `decideSafeModeAction` 의 새 tier 분기 — Sprint 254.
- Chrome H (top stripe + prod border) — Sprint 256.
- Button F (composed Execute button color × target) — Sprint 256.
- ConfirmDestructiveDialog 헤더 env token 정렬 — Sprint 256.
- Per-theme syntax palette curation — Sprint 257.
- TabBar polish (item ②/④) — Sprint 253 (완료).
- Token foundation (env-specific 6 tokens + warning deepen) — Sprint 253 (완료).

## Invariants

- ADR 0022 Safe Mode (destructive-only ConfirmDestructiveDialog) 동작 회귀 0.
- ADR 0023 의 *영구 환경 chrome* 은 Sprint 256 — 본 sprint 에서 mount 금지.
- AC-253-01..06 / AC-251-S1..S5 H1..H5 T1..T3 R1..R4 / AC-250-01..06 / AC-249-U1..U9 / AC-248-* / AC-247-* / AC-246-* / AC-245-* / AC-186-* / AC-185-* / AC-109 모두 회귀 0.
- IPC 시그니처 변경 0 — `executeQuery`, `aggregateDocuments`, `findDocuments`, `executeQueryDryRun`, `cancelQuery` 모두 그대로.
- `safeModeStore` / `connectionStore` / `tabStore` / `queryHistoryStore` 의 액션·상태 변경 0.
- `useSafeModeGate` / `decideSafeModeAction` 시그니처 변경 0 (Sprint 254 에서 확장).
- `analyzeStatement` / `analyzeMongoPipeline` 의 기존 반환 회귀 0 (신규 helper 만 추가).
- `pendingMongoConfirm` / `pendingRdbConfirm` (Sprint 231) 동작 보존 — 새 `pendingRdbWarn` / `pendingMongoWarn` 와 별개.
- Mongo grid read-only invariant 보존.
- Sprint 250-252 polish (onBlur commit / Esc discard / store-lift / Copy 버튼 / SqlSyntax) 회귀 0.
- 다중 statement WARN/STOP/INFO 혼합 시 우선순위: STOP > WARN > INFO (worst tier 결정).
- WARN dialog 의 사용자 Cancel/X → IPC 미발동 + state clear.

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 errors / 0 warnings)
  3. `pnpm vitest run` (전체 통과 + AC-255 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀 — Rust 변경 0 예상)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "pendingRdbWarn\|pendingMongoWarn" src/components/query/` (≥ 2 매치 — state 신설 + JSX mount + helper)
  7. `rg "isInfoStatement\|isInfoMongoOperation" src/lib/` (≥ 2 매치 — helper export + 사용처)

- **Required evidence**:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 7 check stdout 발췌.
  - AC ↔ 파일:라인 매핑 (6 ACs).
  - `sqlSafety.ts` 의 `isInfoStatement` 신규 helper 본문 인용 + INFO 분류 corpus 테스트 인용.
  - `mongoSafety.ts` 의 `isInfoMongoOperation` 신규 helper 본문 인용.
  - `useQueryExecution.ts` 의 `pendingRdbWarn` / `pendingMongoWarn` state + `confirmRdbWarn` / `confirmMongoWarn` callback 본문 인용.
  - `handleExecute` 분기 확장 diff 인용 (STOP > WARN > INFO 우선순위 명시).
  - `QueryTab.tsx` 의 WARN dialog mount JSX 인용.
  - 신규 테스트 (`QueryTab.warn-dialog.test.tsx` 또는 확장 경로) — INSERT/UPDATE WHERE 가 SqlPreviewDialog mount → Execute → IPC 1회 호출 케이스 인용.
  - /tdd 흐름 증거 (red → green log).
  - 가정 / 잔여 위험.

## References

- Master spec: `docs/sprints/sprint-253/spec.md` §Sprint 255
- 13-question grill (Q3-(b)): `docs/sprints/sprint-253/grill-decisions.md`
- ADR 0023: `memory/decisions/0023-production-warning-environment-aware-chrome-and-warn-dialog/memory.md`
- Sprint 253 baseline: `docs/sprints/sprint-253/contract.md` (commit 528063b)
- Relevant files:
  - `src/components/query/QueryTab.tsx`
  - `src/components/query/QueryTab/useQueryExecution.ts`
  - `src/components/query/QueryTab.execution.test.tsx`
  - `src/components/query/QueryTab.safe-mode.test.tsx`
  - `src/components/structure/SqlPreviewDialog.tsx`
  - `src/components/document/MqlPreviewModal.tsx`
  - `src/lib/sql/sqlSafety.ts`
  - `src/lib/mongo/mongoSafety.ts`
  - `src/lib/safeMode.ts` (참조만 — 변경 없음)
  - `src/hooks/useSafeModeGate.ts` (참조만 — 변경 없음)
