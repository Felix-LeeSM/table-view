# Sprint Execution Brief: sprint-254

## Objective

Statement classifier 의 `severity` union 을 `"safe" | "danger"` (2-tier)
에서 **`"info" | "warn" | "danger"` (3-tier)** 로 split. SQL + Mongo
양 paradigm. 추가: WARN-tier bounded UPDATE/DELETE 의 dry-run row-count
가 100+ 면 STOP 으로 자동 escalate (Sprint 247 IPC 재사용, 2s timeout,
timeout/unsupported → STOP fallback). DML CTE (`WITH x AS (UPDATE …)
SELECT *`) 인식 추가. UI / dialog mount 변경 0 — Sprint 255 의
`pendingRdbWarn` / `pendingMongoWarn` flow 보존.

## Task Why

ADR 0023 grill Q2-(a) "3-tier severity 채택" 정식 도입. Sprint 255 가
신규 `kind: "info"` 휴리스틱 + `severity === "safe"` 비교로 우회한
부분을 정식 분류로 흡수 — INSERT / UPDATE WHERE 가 명확히 WARN 임을
타입으로 표현. dry-run row-count escalation 으로 "WARN 인 줄 알았는데
실제로 100 만 row update" 사고 방지.

## Scope Boundary

### 변경
- `src/lib/sql/sqlSafety.ts`: `Severity` union → `"info" | "warn" | "danger"`. INFO/WARN/STOP 분류 + DML CTE 식별. `isInfoStatement` 본문 단순화.
- `src/lib/sql/sqlSafety.test.ts`: 3-tier corpus + DML CTE.
- `src/lib/mongo/mongoSafety.ts`: 3-tier 동일. `isInfoMongoOperation` 본문 단순화.
- `src/lib/mongo/mongoSafety.test.ts`: 3-tier corpus.
- `src/lib/safeMode.ts`: `decideSafeModeAction` 의 새 union 처리. 매트릭스 결과 회귀 0.
- `src/lib/safeMode.test.ts`: 새 union 회귀.
- `src/hooks/useSafeModeGate.ts` / `.test.ts`: 새 union 회귀 (시그니처 변경 0).
- `src/components/query/QueryTab/useQueryExecution.ts`: `isInfoStatement(analysis)` → `analysis.severity === "info"` 전환. dry-run escalation helper 호출 추가.
- `src/components/query/QueryTab/useQueryExecution.escalation.test.tsx` (신규): dry-run 100+ row → STOP escalate / timeout → STOP fallback / unsupported → STOP fallback.
- `src/components/query/QueryTab.execution.test.tsx` / `.safe-mode.test.tsx` / `.warn-dialog.test.tsx`: 새 union 회귀.
- (가능 시 신규) `src/lib/sql/escalateWarnIfLargeImpact.ts` 또는 동등 helper.

### 변경 금지
- Chrome H / top stripe / window border — Sprint 256.
- Button F (composed Execute button) — Sprint 256.
- ConfirmDestructiveDialog 헤더 token 정렬 — Sprint 256.
- Per-theme syntax palette — Sprint 257.
- Sprint 253 의 6 env tokens / `--tv-warning` 값 / TabBar.
- Sprint 255 의 SqlPreviewDialog / MqlPreviewModal mount JSX.
- IPC (`executeQuery`, `executeQueryDryRun`, `aggregateDocuments`, `findDocuments`, `cancelQuery`).
- safeModeStore / connectionStore / tabStore / queryHistoryStore.
- Mongo grid read-only invariant.
- ADR 0022 Phase 1-5 / Sprint 250-252 polish.
- `decideSafeModeAction` 의 *결과 매트릭스* (info → allow, warn → allow, danger → confirm).

## Invariants

- IPC 시그니처 0 변경.
- `analyzeStatement` / `analyzeMongoPipeline` / `analyzeMongoOperation` 함수 시그니처 보존 (반환 union 의 *값* 만 변경).
- `decideSafeModeAction` / `useSafeModeGate` 시그니처 보존.
- SafeMode 매트릭스 결과 회귀 0 — STOP 의 confirm / WARN 의 allow / INFO 의 allow.
- 다중 statement 우선순위: STOP > WARN > INFO (Sprint 255 와 동일).
- WARN dialog Cancel/X → IPC 미발동 + state clear (Sprint 255).
- AC-255-01..06 / AC-253-01..06 / AC-251-S1..S5 H1..H5 T1..T3 R1..R4 /
  AC-250-01..06 / AC-249-U1..U9 / AC-248-* / AC-247-* / AC-246-* /
  AC-245-* / AC-186-* / AC-185-* / AC-109 모두 회귀 0.

## Done Criteria

1. `Severity` union 3-tier 로 확장 + 모든 callsite 매핑.
2. INFO/WARN/STOP 분류 — SELECT/EXPLAIN/SHOW/DESCRIBE → INFO; INSERT/bounded UPDATE WHERE/bounded DELETE WHERE/CREATE/ALTER additive → WARN; DROP/TRUNCATE/WHERE-less DELETE·UPDATE/ALTER DROP/GRANT/REVOKE → STOP.
3. Mongo 3-tier — find/read aggregate → INFO, *-many → WARN, *-all/$out/$merge/drop → STOP.
4. DML CTE 식별 — WARN/STOP wrapped 시 INFO 가 아님.
5. dry-run row-count 100+ → STOP escalate. 2s timeout / unsupported → STOP fallback. Mongo 는 escalate skip.
6. `decideSafeModeAction` 새 union 처리 (매트릭스 결과 회귀 0).
7. AC-254-01..07 모두 매핑.
8. /tdd 흐름: 신규 corpus + escalation 테스트 먼저, fail → 구현 → pass.
9. Verification Plan 7개 check 모두 pass.

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 / 0)
  3. `pnpm vitest run` (전체 통과 + AC-254 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀 — Rust 변경 0)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "severity: \"info\"|severity: \"warn\"" src/lib/` (≥ 5 매치)
  7. `rg "escalateWarn|dry-run.*100|rowCount.*100" src/` (≥ 1 매치)

## Evidence To Return

- 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
- 7 check stdout 발췌.
- AC ↔ 파일:라인 매핑 (7 ACs).
- `Severity` union 변경 본문 인용.
- `analyzeStatement` 의 3-tier 분류 + DML CTE 분기 인용.
- `analyzeMongoPipeline` / `analyzeMongoOperation` 의 3-tier 분류 인용.
- dry-run escalation helper 본문 + timeout / unsupported fallback 인용.
- `decideSafeModeAction` 의 새 union 처리 diff 인용 (매트릭스 결과 회귀 0 확인).
- `useQueryExecution.handleExecute` 의 `severity === "info"` 직접 비교 전환 diff.
- Sprint 245-249 + 255 회귀 테스트 모두 pass 증거.
- /tdd 흐름 증거 (red → green log).
- 가정 (예: dry-run 2s timeout, 100-row threshold, DML CTE 인식 휴리스틱, Mongo escalate skip) / 잔여 위험.

## References

- Spec (master): `docs/sprints/sprint-253/spec.md` §Sprint 254
- Contract: `docs/sprints/sprint-254/contract.md`
- 13-question grill (Q2-(a) 3-tier severity): `docs/sprints/sprint-253/grill-decisions.md`
- ADR 0023: `docs/archives/decisions/0023-production-warning-environment-aware-chrome-and-warn-dialog/memory.md`
- Sprint 253 baseline: `docs/sprints/sprint-253/contract.md` (commit 528063b)
- Sprint 255 baseline: `docs/sprints/sprint-255/contract.md` (commit b8600bc)
- Relevant files:
  - `src/lib/sql/sqlSafety.ts`
  - `src/lib/sql/sqlSafety.test.ts`
  - `src/lib/mongo/mongoSafety.ts`
  - `src/lib/mongo/mongoSafety.test.ts`
  - `src/lib/safeMode.ts`
  - `src/lib/safeMode.test.ts`
  - `src/hooks/useSafeModeGate.ts`
  - `src/hooks/useSafeModeGate.test.ts`
  - `src/components/query/QueryTab/useQueryExecution.ts`
  - `src/components/query/QueryTab.execution.test.tsx`
  - `src/components/query/QueryTab.safe-mode.test.tsx`
  - `src/components/query/QueryTab.warn-dialog.test.tsx`
  - `src/lib/tauri/query.ts` (참조만)
