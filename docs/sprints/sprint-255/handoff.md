# Sprint 255 — Generator Handoff

> ADR 0023 grill Q3-(b) "모든 환경 + 모든 write 표면" — raw SQL/MQL editor
> 의 WARN-tier preview dialog mount. INFO (SELECT/EXPLAIN/SHOW/DESCRIBE/
> WITH …SELECT no DML CTE) → 직접 IPC; STOP (`severity: "danger"` + 게이트
> confirm) → 기존 ConfirmDestructiveDialog; WARN (`severity: "safe"` 중
> non-INFO — INSERT / UPDATE WHERE / DELETE WHERE / CREATE / ALTER additive
> 등) → 신규 SqlPreviewDialog (RDB) / MqlPreviewModal (Mongo aggregate).
> STOP > WARN > INFO 우선순위.

## Changed Files

### 신규
- `src/components/query/QueryTab.warn-dialog.test.tsx` — Sprint 255 WARN
  dialog mount 회귀 + 신규 케이스 14 cases (INSERT/UPDATE WHERE/CREATE/
  ALTER additive WARN dialog mount, INFO skip, multi-statement priority,
  Mongo aggregate INFO/STOP 회귀).

### 수정
- `src/lib/sql/sqlSafety.ts` — `isInfoStatement` helper export +
  EXPLAIN/SHOW/DESCRIBE/DESC 분기를 `kind: "info"` 로 추가. 기존 분기 회귀 0.
- `src/lib/sql/sqlSafety.test.ts` — `isInfoStatement` 단위 테스트 15 cases
  (SELECT/WITH/EXPLAIN/SHOW/DESCRIBE/DESC INFO + INSERT/UPDATE/DELETE/
  CREATE/ALTER/DROP NOT-INFO + 빈 입력 defensive).
- `src/lib/mongo/mongoSafety.ts` — `isInfoMongoOperation` helper export.
  `analyzeMongoPipeline` / `analyzeMongoOperation` 시그니처 회귀 0.
- `src/lib/mongo/mongoSafety.test.ts` — `isInfoMongoOperation` 단위 테스트 8
  cases (read-only pipeline INFO + $out/$merge/dropCollection/non-empty
  filter NOT-INFO).
- `src/components/query/QueryTab/useQueryExecution.ts`:
  - `pendingRdbWarn` / `pendingMongoWarn` state 신설.
  - `confirmRdbWarn` / `cancelRdbWarn` / `confirmMongoWarn` /
    `cancelMongoWarn` callback 신설 (기존 `runRdbSingleNow` /
    `runRdbBatchNow` / `runMongoAggregateNow` helper 재사용).
  - `handleExecute` 분기 확장 — RDB / Mongo 양측에서 STOP > WARN > INFO
    우선순위. `severity: "safe"` 인 non-INFO 만 WARN dialog mount;
    severity:"danger" + gate-allow (예: dev+warn DROP TABLE — env-gated
    unguarded) 는 WARN bypass → 기존 직접 IPC 유지 (ADR 0022 회귀 0).
- `src/components/query/QueryTab.tsx`:
  - `SqlPreviewDialog` (RDB WARN) + `MqlPreviewModal` (Mongo WARN) JSX
    mount 추가. 기존 `ConfirmDestructiveDialog` 와 동시 mount 금지 (STOP >
    WARN priority 는 hook 단에서 보장).
- `src/components/query/QueryTab.execution.test.tsx` — 1개 테스트
  ("collapses to error status when ALL statements fail") 가 `BAD 1; BAD 2`
  → analyzer `kind: "other"` → WARN dialog mount 흐름으로 변경됨; dialog
  Execute click 추가하도록 수정.
- `src/components/query/QueryTab.safe-mode.test.tsx` — 3개 테스트
  ([AC-245-C4] / [AC-245-C4-2] / [AC-245-C4-3]) 가 production+strict
  INSERT/UPDATE/CREATE WARN dialog mount 흐름으로 변경됨; dialog Execute
  click 추가하도록 수정 (assertion intent 보존).
- `src/components/query/QueryTab.document.test.tsx` — 2개 [S132] 테스트
  (`\c admin` PG meta-command) 가 analyzer `kind: "other"` → WARN dialog
  mount 흐름으로 변경됨; dialog Execute click 추가.

## Checks Run

| Check | Result |
| --- | --- |
| `pnpm tsc --noEmit` | pass (0 errors) |
| `pnpm lint` | pass (0 errors / 0 warnings) |
| `pnpm vitest run` | pass (Test Files: 241 passed; Tests: 3065 passed) |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | pass (627 passed; 0 failed; 2 ignored) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | pass (exit 0) |
| `rg "pendingRdbWarn\|pendingMongoWarn" src/components/query/` | 19 매치 (≥ 2) |
| `rg "isInfoStatement\|isInfoMongoOperation" src/lib/` | 28 매치 (≥ 2) |

## Done Criteria Coverage

| AC | Evidence |
| --- | --- |
| AC-255-01 (`isInfoStatement` helper 신설 + EXPLAIN/SHOW/DESCRIBE 분기) | `src/lib/sql/sqlSafety.ts:139-148` (helper) + `:121-130` (info 분기). 단위 테스트: `src/lib/sql/sqlSafety.test.ts:163-258`. |
| AC-255-02 (`isInfoMongoOperation` helper 신설) | `src/lib/mongo/mongoSafety.ts:113-130` (helper). 단위 테스트: `src/lib/mongo/mongoSafety.test.ts:142-204`. |
| AC-255-03 (`useQueryExecution` WARN state + callback 4개) | `src/components/query/QueryTab/useQueryExecution.ts:166-179` (state) + `:367-396` (callbacks) + interface fields `:97-118`. |
| AC-255-04 (`handleExecute` STOP > WARN > INFO 분기 확장) | RDB: `src/components/query/QueryTab/useQueryExecution.ts:546-606` (worstAction loop + hasWarn 추적 + WARN routing). Mongo aggregate: `:438-467` (INFO heuristic + WARN routing). |
| AC-255-05 (`QueryTab.tsx` SqlPreviewDialog + MqlPreviewModal mount JSX) | `src/components/query/QueryTab.tsx:281-308` (RDB) + `:310-323` (Mongo). |
| AC-255-06 (다중 statement STOP > WARN > INFO 우선순위) | `useQueryExecution.ts:594-606` — `worstAction === "confirm"` 시 STOP routing 후 early return; WARN state 미설정으로 두 dialog 동시 mount 차단. 회귀 테스트: `QueryTab.warn-dialog.test.tsx:[AC-255-06b]` (production + warn + INSERT + DELETE → STOP only). |

## /tdd 흐름 증거

- **Red phase 1** (helper 단위 테스트 작성 후 fail):
  ```
  FAIL  src/lib/sql/sqlSafety.test.ts > sqlSafety.analyzeStatement >
    isInfoStatement (Sprint 255) > [AC-255-01a] SELECT → INFO
  TypeError: isInfoStatement is not a function
  Tests  23 failed | 34 passed (57)
  ```
- **Red phase 2** (`QueryTab.warn-dialog.test.tsx` 작성 후 fail):
  ```
  FAIL  src/components/query/QueryTab.warn-dialog.test.tsx > QueryTab —
    Sprint 255 WARN dialog mount > [AC-255-03a] INSERT INTO single → ...
  AssertionError: expected "vi.fn()" to not be called at all, but actually
    been called 2 times
  Tests  6 failed | 8 passed (14)
  ```
- **Green phase 1** (helper 구현 후):
  ```
  Test Files  2 passed (2)
  Tests  57 passed (57)
  ```
- **Green phase 2** (state + callback + handleExecute + JSX mount 구현 후):
  ```
  Test Files  1 passed (1)
  Tests  14 passed (14)
  ```
- **Final regression**: 전체 vitest 3065 / 3065 passed.

## 핵심 helper 본문 인용

`src/lib/sql/sqlSafety.ts:139-148`:
```ts
/**
 * Sprint 255 — INFO tier 식별 휴리스틱. raw SQL editor 의 WARN dialog mount
 * 분기에서 호출되어 `severity: "safe"` 인 statement 중 read-only /
 * metadata-introspection 만 dialog skip → 직접 IPC 발동.
 *
 * INFO = `kind === "select"` (SELECT / WITH …SELECT no DML CTE; analyzer 가
 * 이미 그렇게 분류) || `kind === "info"` (EXPLAIN / SHOW / DESCRIBE / DESC).
 * 그 외 safe (INSERT / UPDATE WHERE / DELETE WHERE / CREATE / ALTER additive)
 * 는 WARN tier — `false` 반환.
 *
 * `severity: "danger"` (STOP) 는 INFO 가 아니므로 false.
 */
export function isInfoStatement(analysis: StatementAnalysis): boolean {
  return analysis.kind === "select" || analysis.kind === "info";
}
```

`src/lib/mongo/mongoSafety.ts:113-130`:
```ts
/**
 * Sprint 255 — Mongo paradigm 의 INFO tier 식별 휴리스틱. raw MQL editor 의
 * WARN dialog mount 분기에서 호출되어 read-only aggregate pipeline (find /
 * pure-read pipeline: $match / $sort / $project / $group / $addFields /
 * $unset 만으로 구성) 만 dialog skip → 직접 IPC 발동.
 *
 * INFO = `severity: "safe"` && `kind === "mongo-other"` — `analyzeMongoPipeline`
 * 가 read-only pipeline 만 `mongo-other` + safe 로 분류하기 때문.
 * `analyzeMongoOperation` 으로부터 온 `mongo-delete-many` / `mongo-update-many`
 * (non-empty filter) 는 safe 지만 INFO 가 아님 → WARN 후보. `*-all` /
 * `mongo-out` / `mongo-merge` / `mongo-drop` 은 danger 이므로 STOP.
 *
 * Mongo find path 는 `useQueryExecution` 에서 항상 INFO 로 처리 (이 helper
 * 거치지 않음 — find 는 pipeline analyzer 가 적용되지 않는 경로).
 */
export function isInfoMongoOperation(analysis: StatementAnalysis): boolean {
  return analysis.severity === "safe" && analysis.kind === "mongo-other";
}
```

## handleExecute 분기 핵심 인용 (RDB, STOP > WARN > INFO 우선순위)

`src/components/query/QueryTab/useQueryExecution.ts` (RDB 분기):
```ts
let worstAction: "allow" | "confirm" | "block" = "allow";
let worstReason = "";
let hasWarn = false;
for (const stmt of statements) {
  const analysis = analyzeStatement(stmt);
  const decision = safeModeGate.decide(analysis);
  if (decision.action === "block") {
    worstAction = "block";
    worstReason = decision.reason;
    break;
  }
  if (decision.action === "confirm" && worstAction === "allow") {
    worstAction = "confirm";
    worstReason = decision.reason;
  }
  // INFO heuristic: only `select` / `info` (EXPLAIN / SHOW / DESCRIBE)
  // skip the WARN dialog. Everything else under `severity: "safe"` is
  // a write surface that benefits from a preview. `severity: "danger"`
  // statements that the gate allowed (e.g. DROP TABLE on dev + warn /
  // off — env-gated unguarded) bypass WARN entirely so ADR 0022 's
  // "destructive on dev + warn = unguarded" stays intact.
  if (
    decision.action === "allow" &&
    analysis.severity === "safe" &&
    !isInfoStatement(analysis)
  ) {
    hasWarn = true;
  }
}
// ...
if (worstAction === "confirm") {
  // STOP wins over WARN — set only the destructive-confirm state.
  setPendingRdbConfirm({ statements, reason: worstReason });
  return;
}
// Sprint 255 — WARN tier: every statement gate-allowed and at least
// one is a non-INFO write. Mount SqlPreviewDialog for the whole batch
if (hasWarn) {
  setPendingRdbWarn({ statements });
  return;
}
```

## QueryTab.tsx WARN dialog mount JSX 인용

```tsx
{pendingRdbWarn && (
  <SqlPreviewDialog
    sql={pendingRdbWarn.statements.join(";\n")}
    loading={false}
    error={null}
    commitError={null}
    environment={connection?.environment ?? null}
    onConfirm={confirmRdbWarn}
    onCancel={cancelRdbWarn}
  />
)}

{pendingMongoWarn && (
  <MqlPreviewModal
    previewLines={JSON.stringify(
      pendingMongoWarn.pipeline,
      null,
      2,
    ).split("\n")}
    errors={[]}
    onExecute={confirmMongoWarn}
    onCancel={cancelMongoWarn}
    loading={false}
  />
)}
```

## Assumptions

- **EXPLAIN/SHOW/DESCRIBE/DESC 분류**: `kind: "info"` 신규 분기로 통합 — analyzer
  반환 union 에 `info` literal 추가했으나 기존 caller (`useSafeModeGate`,
  raw editor warn flow) 는 모두 `severity` 만 보거나 신규 helper
  (`isInfoStatement`) 만 사용하므로 회귀 0. EXPLAIN ANALYZE / EXPLAIN
  (ANALYZE, BUFFERS) variant 는 prefix 매칭으로 자연 처리.
- **Mongo find 항상 INFO**: `useQueryExecution` 의 find branch 는 analyzer 를
  거치지 않고 즉시 IPC dispatch. (find body 가 filter object 라서 pipeline
  analyzer 가 적용 안 됨.) 본 sprint 는 find path 를 변경하지 않으므로
  현재 동작 보존.
- **danger + gate-allow → WARN bypass**: dev+warn / dev+off 의 destructive
  statement (ADR 0022 의 env-gated unguarded) 는 severity:"safe" 가 아니므로
  WARN dialog 미발동. 이는 기존 [AC-245-N2] / [AC-231-01d] 의 invariant 와
  align — destructive 가 dev 에서 dialog 없이 통과해야 한다.
- **`other` kind 도 WARN 대상**: 분류 불가 statement (예: PG meta-command
  `\c admin`, syntax-error `BAD ...`) 는 WARN dialog mount. 사용자가 의도
  파악 못 한 statement 를 직접 IPC 보내기보다 preview 후 명시 confirm 이
  ADR 0023 grill Q3-(b) 의 "모든 write 표면" 정신에 부합.
- **다중 statement (INFO + WARN) 의 dialog body**: `statements.join(";\n")`
  로 INFO 를 포함한 전체 batch 가 preview 에 노출. 사용자가 확정 시 INFO 도
  WARN flow 의 multi-statement 경로로 dispatch (별도 분리 불가 — 기존
  `runRdbBatchNow` 는 array 단위로 동작).
- **`pendingRdbConfirm` / `pendingMongoConfirm` (Sprint 231) 동작 보존**:
  STOP path 는 hook 단에서 early return 하므로 WARN state 가 set 되지 않음;
  JSX 에서 두 dialog 가 동시 mount 되지 않는다.

## Residual Risk

- **Mongo aggregate WARN path 의 thin coverage**: 현재 2-tier classifier 에서
  `analyzeMongoPipeline` 가 모든 read-only pipeline 을 `mongo-other` + safe
  로 분류 → `isInfoMongoOperation` 가 항상 true. 즉, aggregate WARN dialog
  는 *현재 분기 상* 발동되지 않는 발판 코드. Sprint 254 의 3-tier split 후
  WARN candidate 가 분류되면 자연 활성화. 이는 contract 의 "*severity:
  "safe"* 인 non-INFO aggregate" 정의와 일치하며, contract 의 brief 역시
  "현재 분류상 거의 없음 — 보존을 위한 발판" 명시.
- **다중 statement (INFO + WARN) preview 의 가독성**: `;\n` join 으로 모든
  statement 가 한 preview 에 노출. 매우 긴 batch 의 경우 SqlPreviewDialog
  의 `max-h-scroll-lg` overflow scroll 이 적용되지만, 분리된 syntax
  highlighting 이 큰 batch 에서 성능에 영향 가능. Sprint 257 (per-theme
  syntax palette) 에서 대상 검토.
- **`other` kind WARN 의 user surprise**: PG `\c admin` 같은 meta-command 는
  사용자가 즉시 효과 기대 가능. WARN dialog 가 friction 추가 → UX 마찰
  잠재. 본 sprint OUT OF SCOPE 이지만 추후 user feedback 모니터링 필요.
