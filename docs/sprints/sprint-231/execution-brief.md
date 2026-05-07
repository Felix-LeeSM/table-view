# Sprint Execution Brief: sprint-231

## Objective

`useQueryExecution.handleExecute` 의 raw RDB query path (single + multi
statement) 에 Safe Mode gate 를 삽입해 production connection 에서 `UPDATE
… SET …`, WHERE 없는 `DELETE`, `DROP TABLE` 등 dangerous statement 가
즉시 실행되는 P0 회귀 (2026-05-07 사용자 보고) 를 닫는다. Mongo aggregate
path (`useQueryExecution.ts:238`) 의 패턴 — `analyzeStatement` →
`safeModeGate.decide` → `block` / `confirm` / `allow` dispatch + warn-tier
`pendingMongoConfirm` UI — 을 그대로 답습한다. AC-231-04 (DataGrid preview
commit audit) + AC-231-05 (ConnectionDialog environment audit) 동반.

## Task Why

Phase 23 (Safe Mode) 가 Sprint 185–190 에서 grid edit / DDL / Mongo path
에는 gate 를 깔았지만, raw RDB query editor 의 실행 경로는 Sprint 188–198
cycle 에서 누락됐다. `useQueryExecution.ts:341` 의 `executeQuery(...)` 호출
앞에는 어떠한 분석도 없으며, line 386 의 multi-statement loop 도 동일.
사용자는 production connection 으로 `UPDATE users SET active = false` 를
입력하고 Run 을 누르면 즉시 실행되는 회귀를 보고했다. Phase 23 의
"production 데이터 보호" invariant 가 깨진 상태이며, 본 sprint 는 그
유일한 raw RDB editor 경로의 closure 다.

## Scope Boundary

In:
- `src/components/query/QueryTab/useQueryExecution.ts` 의 single + multi
  statement RDB branch 에 gate dispatch + `pendingRdbConfirm` /
  `confirmRdbDangerous` / `cancelRdbDangerous` 추가. helper 추출
  (`runRdbSingleNow` / `runRdbBatchNow`) 로 confirm 후 재실행 경로 공통화.
- `src/components/query/QueryTab.tsx` 에 raw-RDB pending 용 두 번째
  `<ConfirmDangerousDialog>` mount.
- `src/components/query/QueryTab.execution.test.tsx` 또는 신규 sibling
  `QueryTab.safe-mode.test.tsx` 에 ≥ 8 vitest case (matrix + multi + cancel
  + confirm-then-run + TDD red→green).
- `src/components/query/__tests__/queryTabTestHelpers.ts` 의
  `resetQueryTabStores` 에 `useSafeModeStore.setState({ mode: "strict" })`
  초기화 1줄 추가 (테스트 격리).
- `docs/PLAN.md` Feature sequencing 표 6번 row → ✓.
- `docs/sprints/sprint-231/{findings.md,handoff.md,tdd-evidence/red-state.log}`.
- AC-231-04 audit findings 에 따라 `useDataGridPreviewCommit.ts` leak
  fix (발견 시).

Out: Sprint 232/233/234 항목, ConnectionDialog UX 개선, MongoDB raw query
path, `decideSafeModeAction` / `analyzeStatement` 본문, Sprint 226–230
freeze 산출물.

## Invariants

- `useDdlPreviewExecution.ts`, `SqlPreviewDialog.tsx`,
  `cross-window-*.test.tsx`, `window-lifecycle.ac141.test.tsx`,
  `connectionStore.ts`, `schemaStore.ts`, `safeModeStore.ts` (body),
  `src/lib/safeMode.ts` (body), `src/lib/sql/sqlSafety.ts` (body),
  Sprint 226–230 frozen files (CreateTableDialog tabs + helpers /
  `usePostgresTypes.ts` / `postgresTypes.ts` /
  `CreateTableTypeCombobox.tsx`), Sprint 226–230 backend fixture —
  모두 diff = 0.
- `useDataGridPreviewCommit.ts` diff = 0 unless AC-231-04 audit 가 leak
  발견. `useRawQueryGridEdit.ts` diff = 0 (이미 gated).
- ConnectionDialog 본문 diff = 0 (AC-231-05 audit only).
- Mongo aggregate gate (`pendingMongoConfirm`) byte-equivalent.
- 신규 `it.skip` / `eslint-disable` / `any` / silent `catch{}` 0.

## Done Criteria

1. **AC-231-01** — `useQueryExecution.ts:335-368` 단일 statement RDB path:
   `await executeQuery` 직전에 `analyzeStatement(sql)` →
   `safeModeGate.decide(analysis)`. dispatch:
   - `allow` → 기존 흐름.
   - `block` → `updateQueryState(tab.id, { status: "error", error:
     decision.reason })`, `recordHistory(...status: "error", duration: 0)`,
     `executeQuery` 호출 0, `dispatchDbMutationHint` 호출 0 (실행 안
     했으므로).
   - `confirm` → `setPendingRdbConfirm({ statements: [sql], reason })`,
     `executeQuery` 호출 0.
2. **AC-231-02** — `useQueryExecution.ts:374-431` multi-statement RDB
   path: 모든 statement 를 단일 pass 로 분석. block > confirm > allow
   우선순위. `block` 발견 시 batch 전체 abort (executeQuery 0회). 어떤
   statement 라도 dangerous + warn 이면 `setPendingRdbConfirm({ statements,
   reason })` 1회만 호출 (per-statement 개별 승인 금지).
3. **AC-231-03** — `QueryTab.tsx` 가 `pendingRdbConfirm` truthy 시
   `<ConfirmDangerousDialog>` mount. `sqlPreview` =
   `pendingRdbConfirm.statements.join(";\n")`. `confirmRdbDangerous` 는
   gate skip + `runRdbSingleNow` 또는 `runRdbBatchNow` 재실행.
   `cancelRdbDangerous` 는 `pendingRdbConfirm` null 만 (running 미진입).
4. **AC-231-04** — `useDataGridPreviewCommit.ts` audit findings 문서화
   (`findings.md`). leak 발견 시 fix 동반. 미발견 시 diff = 0.
5. **AC-231-05** — `ConnectionDialogBody.tsx:250-280` environment dropdown
   verification 문서화. 코드 변경 0.
6. **AC-231-06** — vitest ≥ 8 새 case (matrix + multi + cancel + confirm).
   최소 1 case 가 TDD red→green capture
   (`docs/sprints/sprint-231/tdd-evidence/red-state.log`).
7. **AC-231-07** — Sprint 226–230 회귀 0. 4-set verification + clippy +
   cargo test PASS.
8. **AC-231-08** — `docs/PLAN.md` 6번 row → ✓ 갱신.

## Verification Plan

- Profile: `command + static`.
- Required checks (16):
  1. `pnpm vitest run` — 새 case 8건 PASS, 기존 모두 PASS, file count ≥ 219.
  2. `pnpm tsc --noEmit` exit 0.
  3. `pnpm lint` exit 0.
  4. `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
     --all-features -- -D warnings` exit 0.
  6. `cargo test --manifest-path src-tauri/Cargo.toml` PASS — Sprint 226–230
     test 모두 동일 결과 (`create_table` 16/16, `create_index` 11/11,
     `add_constraint` 12/12, `list_types` 2/2).
  7. `git diff --stat src/components/structure/useDdlPreviewExecution.ts`
     = 0.
  8. `git diff --stat src/components/structure/SqlPreviewDialog.tsx` = 0.
  9. `git diff --stat src/__tests__/cross-window-*.test.tsx
     src/__tests__/window-lifecycle.ac141.test.tsx` = 0.
  10. `git diff --stat src/stores/connectionStore.ts
      src/stores/schemaStore.ts src/stores/safeModeStore.ts` = 0.
  11. `git diff --stat src/lib/safeMode.ts src/lib/sql/sqlSafety.ts` = 0.
  12. `git diff --stat src/components/schema/CreateTableDialog/Header.tsx
      src/components/schema/CreateTableDialog/IndexesTabBody.tsx
      src/components/schema/CreateTableDialog/ForeignKeysTabBody.tsx
      src/hooks/useFkReferencePicker.ts src/hooks/usePostgresTypes.ts
      src/lib/sql/postgresTypes.ts
      src/components/schema/CreateTableTypeCombobox.tsx` = 0.
  13. `grep -nE 'safeModeGate|useSafeModeGate'
      src/components/query/QueryTab/useQueryExecution.ts` ≥ 2 hits.
  14. `grep -nE 'analyzeStatement'
      src/components/query/QueryTab/useQueryExecution.ts` ≥ 1 hit.
  15. `grep -nE 'pendingRdbConfirm'
      src/components/query/QueryTab/useQueryExecution.ts
      src/components/query/QueryTab.tsx` ≥ 3 hits.
  16. Sprint 226–230 vitest fixture (특히
      `useDataGridEdit.safe-mode.test.ts` 7 case)
      byte-equivalent PASS.
- Required evidence:
  - 변경 파일 표 (file → purpose).
  - vitest before/after count.
  - AC-231-NN ↔ vitest case name + line table.
  - 16 verification check 결과.
  - audit findings (AC-231-04 / AC-231-05).
  - TDD red→green log capture.
  - assumption + residual risk.

## Evidence To Return

- Changed files and purpose:
  - `src/components/query/QueryTab/useQueryExecution.ts` — gate insertion +
    `pendingRdbConfirm` state + helpers.
  - `src/components/query/QueryTab.tsx` — second `<ConfirmDangerousDialog>`
    mount.
  - `src/components/query/QueryTab.execution.test.tsx` 또는 신규
    `QueryTab.safe-mode.test.tsx` — ≥ 8 vitest case.
  - (조건부) `src/components/query/__tests__/queryTabTestHelpers.ts` —
    `useSafeModeStore.setState({ mode: "strict" })` reset.
  - `docs/PLAN.md` — Feature sequencing row 갱신.
  - `docs/sprints/sprint-231/{contract.md,execution-brief.md,findings.md,
    handoff.md,tdd-evidence/red-state.log}`.
  - (조건부, leak 발견 시) `useDataGridPreviewCommit.ts` 또는
    `useDataGridEdit.ts` — closing fix.
- Checks run and outcomes (16 required checks 결과 표).
- Done criteria coverage with evidence (AC ↔ test name + line, code site
  line, audit memo).
- Assumptions:
  - `safeModeStore` mode 초기값은 `"strict"` 로 가정 (Sprint 185 컨트랙트와
    Sprint 188 lessons 와 일치).
  - 회귀 보고된 사용자의 connection 은 environment = "production". 만약
    "production" 이 아니라면 gate 가 의도적으로 allow → 사용자 액션은
    AC-231-05 audit memo 에 따라 connection 환경 태그 변경.
  - `splitSqlStatements` 가 returning N statements 의 순서를 보존 (Sprint 36
    invariant).
  - `dispatchDbMutationHint` 는 실제 실행된 SQL 한정으로 호출 — block /
    confirm cancel 경로에서 호출 금지.
- Residual risk:
  - SQL 분석기 (`analyzeStatement`) 가 일부 dangerous variant 를 누락할
    가능성 (예: `WITH x AS (...) DELETE FROM x` CTE 형식, `MERGE` /
    `REPLACE INTO` 등). 본 sprint 는 분석기를 동결하므로, 분석기가 `safe`
    로 판정한 statement 는 통과 — 후속 hardening sprint 에서 분석기 확장.
  - Multi-statement reason 에 첫 번째 dangerous statement 의 reason 만
    노출 — 사용자가 batch 안의 다른 dangerous statement 를 인지하지 못할
    수 있음. 그러나 `sqlPreview` 에 모든 statement 를 verbatim 표시하므로
    visual 노출은 보존.
  - cancel 경로에서 `running` 진입 안 했으므로 `tab.queryState` 는 fix
    이전 값 그대로 — 사용자에게 별도 cancellation feedback 없음. cancel
    시 toast 추가는 본 sprint OOS (별도 polish sprint).

## References

- Contract: `docs/sprints/sprint-231/contract.md`
- Findings: `docs/sprints/sprint-231/findings.md` (Generator 작성)
- Relevant files:
  - `src/components/query/QueryTab/useQueryExecution.ts:110,238,335-368,374-431`
    — fix site (gate 호출 위치 + Mongo path 답습 reference).
  - `src/components/query/QueryTab.tsx:16,98-101,217-225` — Mongo dialog
    mount (raw-RDB dialog mirror 위치).
  - `src/hooks/useSafeModeGate.ts:18-32` — gate hook API.
  - `src/lib/safeMode.ts:24-48` — `decideSafeModeAction` matrix.
  - `src/lib/sql/sqlSafety.ts:50-121` — `analyzeStatement` 분석기.
  - `src/stores/safeModeStore.ts` — mode persistence.
  - `src/components/datagrid/useDataGridEdit.safe-mode.test.ts` — gold
    standard test pattern (matrix + warn + cancel + confirm).
  - `src/hooks/useDataGridPreviewCommit.ts:127-130,419-444` — already-correct
    wiring (mirror 대상).
  - `src/components/query/useRawQueryGridEdit.ts:112,275-309` —
    already-correct wiring (mirror 대상).
  - `src-tauri/src/models/connection.rs:71` — `environment: Option<String>`.
  - `src/components/connection/ConnectionDialog/ConnectionDialogBody.tsx:250-280`
    — environment dropdown (AC-231-05 audit 대상).
  - `src/components/connection/ConnectionDialog.test.tsx:555-629` — 기존
    environment dropdown 테스트 커버리지.
  - `src/types/connection.ts:268-285` — `ENVIRONMENT_META` /
    `ENVIRONMENT_OPTIONS`.
  - `src/components/query/QueryTab.execution.test.tsx`,
    `src/components/query/__tests__/queryTabTestHelpers.ts:145-164` —
    test fixture / reset helper.
  - `src/components/workspace/ConfirmDangerousDialog.tsx` — 재사용 dialog
    컴포넌트.
  - `docs/PLAN.md:151-157` — Feature sequencing 표 (post-225 cycle, 6번 row
    갱신 대상).
