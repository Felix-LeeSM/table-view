# Sprint Execution Brief: sprint-255

## Objective

raw SQL editor (`QueryTab`) 와 raw MQL editor 의 **WARN-tier 실행** 직전에
SqlPreviewDialog / MqlPreviewModal 신규 mount — 현재의 직접 실행 (no
dialog) gap 해소. INFO (SELECT/EXPLAIN/SHOW/DESCRIBE/WITH …SELECT no
DML CTE) 만 휴리스틱으로 식별 → dialog skip. STOP-tier 는 기존
ConfirmDestructiveDialog 보존 (STOP > WARN 우선).

## Task Why

ADR 0023 grill Q3-(b) "모든 환경 + 모든 write 표면" 의 핵심 보호 —
사용자가 raw editor 에서 ad-hoc INSERT/UPDATE WHERE/CREATE/ALTER
additive 실행 시 *시각적 preview 없이* 즉시 IPC 발동하는 현재 동작이
가장 사고 내기 쉬운 표면. Sprint 254 의 3-tier classifier 도입 전에
*현재의 2-tier* `severity: "safe" | "danger"` 그대로 활용 → INFO 식별
휴리스틱만 추가 → WARN 후보 (= `safe` 중 non-INFO) 로 분기.

본 sprint 는 5-sprint chain (253→255→254→256→257) 의 두 번째 —
foundation token (Sprint 253) 위에 immediate user protection 도입.

## Scope Boundary

### 변경
- `src/lib/sql/sqlSafety.ts`: `isInfoStatement` helper 신설 + EXPLAIN/SHOW/DESCRIBE 분기 추가 (`kind: "select"` 또는 신규 `info` kind).
- `src/lib/mongo/mongoSafety.ts`: `isInfoMongoOperation` helper 신설.
- `src/components/query/QueryTab/useQueryExecution.ts`: `pendingRdbWarn` / `pendingMongoWarn` state + confirm/cancel callbacks + `handleExecute` 분기 확장.
- `src/components/query/QueryTab.tsx`: SqlPreviewDialog / MqlPreviewModal mount JSX 추가.
- `src/components/query/QueryTab.execution.test.tsx` (또는 신규 `QueryTab.warn-dialog.test.tsx`): WARN dialog 회귀 + 신규 케이스.
- `src/lib/sql/sqlSafety.test.ts` / `src/lib/mongo/mongoSafety.test.ts`: helper 단위 테스트.

### 변경 금지
- Severity classifier 3-tier split — Sprint 254.
- Dry-run row-count escalation — Sprint 254.
- `decideSafeModeAction` / `useSafeModeGate` 의 새 tier 분기 — Sprint 254.
- Chrome H / Button F / ConfirmDestructiveDialog 헤더 — Sprint 256.
- Per-theme syntax palette — Sprint 257.
- Sprint 253 의 6 env tokens / `--tv-warning` 값 / TabBar.
- IPC (`executeQuery`, `aggregateDocuments`, `findDocuments`, `executeQueryDryRun`, `cancelQuery`).
- `safeModeStore` / `connectionStore` / `tabStore` / `queryHistoryStore`.
- Sprint 231 의 `pendingMongoConfirm` / `pendingRdbConfirm` 동작.
- Mongo grid read-only invariant.
- ADR 0022 Phase 1-5 / Sprint 250-252 polish.

## Invariants

- IPC 시그니처 0 변경.
- AC-253-01..06 / AC-251-S1..S5 H1..H5 T1..T3 R1..R4 / AC-250-01..06 /
  AC-249-U1..U9 / AC-248-* / AC-247-* / AC-246-* / AC-245-* / AC-186-* /
  AC-185-* / AC-109 모두 회귀 0.
- ADR 0022 destructive-only ConfirmDestructiveDialog 동작 보존.
- `analyzeStatement` / `analyzeMongoPipeline` 의 기존 반환 회귀 0
  (신규 helper 만 추가, 기존 분기 변경 시 corpus 테스트로 가드).
- `pendingMongoConfirm` / `pendingRdbConfirm` (Sprint 231) 동작 보존.
- 다중 statement: STOP > WARN > INFO 우선순위 — STOP 1+ 면 WARN dialog
  발동 안 함, WARN 1+ 면 INFO 도 dialog 안에서 같이 보임.
- WARN dialog Cancel → IPC 미발동 + state clear.

## Done Criteria

1. `sqlSafety.ts` 에 `isInfoStatement(analysis)` helper export — `kind: "select"` 또는 EXPLAIN/SHOW/DESCRIBE 식별.
2. `mongoSafety.ts` 에 `isInfoMongoOperation(analysis)` helper export — find / read-only aggregate 식별.
3. `useQueryExecution.ts` 에 `pendingRdbWarn` / `pendingMongoWarn` state + `confirmRdbWarn` / `cancelRdbWarn` / `confirmMongoWarn` / `cancelMongoWarn` 4 callback export.
4. `handleExecute` 분기 — RDB 와 Mongo aggregate 모두에서 STOP / WARN / INFO 3-tier 우선순위 결정 + WARN 시 dialog state set.
5. `QueryTab.tsx` 에 SqlPreviewDialog (RDB WARN) + MqlPreviewModal (Mongo WARN) mount JSX 추가.
6. AC-255-01..06 모두 매핑.
7. /tdd 흐름: 신규 테스트 먼저, fail → 구현 → pass.
8. Verification Plan 7개 check 모두 pass.

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 / 0)
  3. `pnpm vitest run` (전체 통과 + AC-255 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀 — Rust 변경 0 예상)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "pendingRdbWarn|pendingMongoWarn" src/components/query/` (≥ 2 매치)
  7. `rg "isInfoStatement|isInfoMongoOperation" src/lib/` (≥ 2 매치)

## Evidence To Return

- 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
- 7 check stdout 발췌.
- AC ↔ 파일:라인 매핑 (6 ACs).
- `sqlSafety.ts` 의 `isInfoStatement` 본문 + INFO 분류 corpus 테스트 인용.
- `mongoSafety.ts` 의 `isInfoMongoOperation` 본문 인용.
- `useQueryExecution.ts` 의 신규 state + callback 본문 인용.
- `handleExecute` 분기 확장 diff 인용 (STOP > WARN > INFO 우선순위 명시).
- `QueryTab.tsx` 의 WARN dialog mount JSX 인용.
- 신규 테스트 — INSERT/UPDATE WHERE 가 SqlPreviewDialog mount → Execute → IPC 1회 호출 케이스 인용.
- /tdd 흐름 증거 (red → green log).
- 가정 (예: EXPLAIN/SHOW/DESCRIBE 분류, Mongo find 항상 INFO, 다중 statement 우선순위) / 잔여 위험.

## References

- Spec (master): `docs/sprints/sprint-253/spec.md` §Sprint 255
- Contract: `docs/sprints/sprint-255/contract.md`
- 13-question grill (Q3-(b) 모든 환경 + 모든 write 표면): `docs/sprints/sprint-253/grill-decisions.md`
- ADR 0023: `docs/archives/decisions/0023-production-warning-environment-aware-chrome-and-warn-dialog/memory.md`
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
  - `src/lib/safeMode.ts` (참조만, 변경 없음)
  - `src/hooks/useSafeModeGate.ts` (참조만, 변경 없음)
