# Sprint Contract: sprint-188

## Summary

- **Goal**: Phase 23 closure — **Mongo dangerous-op gate**. RDB 측에서
  `analyzeStatement` + `useSafeModeStore` + `ConfirmDangerousDialog` 로
  완성된 strict / warn 가드 패턴을 Document paradigm 의 aggregate
  pipeline 에 적용. 실제로 frontend 에 노출된 Mongo write surface 가
  좁아 (`insert_document` / `update_document` / `delete_document` 단건
  + `aggregate_documents` pipeline) **`aggregate_documents` 의 `$out` /
  `$merge` stage** 가 유일하게 도달 가능한 destructive path 다 (`db.
  collection.drop()`, `deleteMany({})` 는 backend 에도 노출 안 됨 —
  Phase 24 후속 후보로 분리).
- **Audience**: Generator (single agent) — implements; Evaluator — verifies AC.
- **Owner**: harness orchestrator.
- **Verification Profile**: `mixed` (browser smoke 권장 — production
  Mongo 연결에서 `[{$out:"x"}]` 시 strict block / warn confirm 동작이
  사람이 보는 contract).

## In Scope

- `AC-188-01`: **`analyzeMongoPipeline` 신설** — `src/lib/mongoSafety.ts`:
  - 입력: `unknown[]` (또는 `Record<string, unknown>[]`) 의 pipeline.
  - 각 stage 의 첫 (= 유일) 키가 `$out` 일 때 →
    `{ kind: "mongo-out", severity: "danger",
       reasons: ["MongoDB $out (collection replace)"] }`.
  - 첫 키가 `$merge` → `{ kind: "mongo-merge", severity: "danger",
      reasons: ["MongoDB $merge (collection upsert)"] }`.
  - 그 외 모든 stage / 빈 배열 / 비-object stage →
    `{ kind: "mongo-other", severity: "safe", reasons: [] }`.
  - **여러 danger stage** 가 섞이면 첫 위반 stage 의 reason 만 사용 —
    UI 가 한 reason 만 표시하므로 단순화. 다른 위반은 해소 후 같은
    경로로 다시 차단되어 자연스럽게 노출.
  - `StatementAnalysis` 와 `Severity` 는 `sqlSafety.ts` 의 export 를
    재사용 (RDB 와 같은 shape 이므로 `useSafeModeGate` 가 paradigm-
    agnostic 으로 동작).

- `AC-188-02`: **`useSafeModeGate` helper hook 신설** —
  `src/hooks/useSafeModeGate.ts`:
  - 시그니처: `useSafeModeGate(connectionId: string | null) →
    { decide(analysis: StatementAnalysis): SafeModeDecision }`.
  - `SafeModeDecision = { action: "allow" } | { action: "block";
    reason: string } | { action: "confirm"; reason: string }`.
  - 내부 read: `useSafeModeStore` 의 `mode`, `useConnectionStore` 의
    `connections.find(c => c.id === connectionId)?.environment`.
  - 분기 (RDB 4 call site 와 동치):
    - `analysis.severity === "safe"` → `allow`.
    - `environment !== "production"` → `allow`.
    - `mode === "strict"` → `block` with reason
      `"Safe Mode blocked: <reasons[0]> (toggle Safe Mode off in
      toolbar to override)"`.
    - `mode === "warn"` → `confirm` with reason `analysis.reasons[0]`.
    - `mode === "off"` → `allow`.
  - 이 sprint 에서는 **새 call site (Mongo aggregate)** 만 hook 을
    consume. RDB 4 사이트의 마이그레이션은 별도 후속 (회귀 위험
    분리 — 각 사이트가 ConfirmDangerousDialog state 를 다르게 관리).

- `AC-188-03`: **`QueryTab` aggregate path 가드 inject** —
  `src/components/query/QueryTab.tsx`:
  - `tab.paradigm === "document"` && `tab.queryMode === "aggregate"`
    경로에서 `aggregateDocuments` 호출 직전:
    - `analyzeMongoPipeline(parsed)` 실행.
    - `useSafeModeGate(tab.connectionId).decide(analysis)`:
      - `block` → `updateQueryState(tab.id, { status: "error",
        error: <reason> })` set, return.
      - `confirm` → component-local `pendingMongoConfirm` state
        (`{ reason: string, pipeline: Record<string, unknown>[] }`)
        set, dispatch 보류, `<ConfirmDangerousDialog>` mount.
      - `allow` → 기존 흐름.
  - `confirmMongoDangerous` / `cancelMongoDangerous`:
    - confirm: `pendingMongoConfirm` clear → 동일한 dispatch path
      재진입 (helper 함수로 추출).
    - cancel: `pendingMongoConfirm` clear, queryState 미터치 (사용자가
      쿼리를 그냥 안 실행한 셈).
  - find path (`queryMode !== "aggregate"`) 는 무영향.

- `AC-188-04`: **`ConfirmDangerousDialog` paradigm-agnostic label** —
  `src/components/workspace/ConfirmDangerousDialog.tsx`:
  - `sqlPreview` prop 명을 유지하되 (RDB call site 회귀 방지) aria-
    label `"SQL preview"` → `"Statement preview"`. Mongo pipeline JSON
    도 같은 자리에 들어가므로 paradigm 표현이 SQL 로 한정되지 않게
    한다.
  - props/contract 변경 없음 — 회귀 0.

## Out of Scope

- **RDB 4 call site 의 hook 마이그레이션** — `useDataGridEdit`,
  `EditableQueryResultGrid`, `ColumnsEditor`, `ConstraintsEditor` 는
  현재 inline gate 유지. 마이그레이션은 후속 sprint (회귀 위험 분리).
- **Mongo bulk-write Tauri command 신설** (`delete_many`, `update_many`,
  `drop_collection`) — Phase 24 후보. Sprint 187 findings §10 의 가정과
  달리 현재 backend 에 미노출.
- **`insert_document` / `update_document` / `delete_document` 단건 가드**
  — 단건 mutate 는 RDB row delete 와 동등 분류 (현재 미가드). 별도 정책
  결정 필요.
- **Aggregate write stage 외 위험 (e.g. `$lookup` cycle, `$function`
  server-side eval)** — 차단 정의 명확치 않음. Sprint 188 은 collection-
  level destructive 만 cover.

## Acceptance verification

- vitest: `mongoSafety.test.ts` (8+ cases), `useSafeModeGate.test.ts`
  (5 cases — safe / non-prod / strict / warn / off), QueryTab aggregate
  integration test (3 cases — strict block / warn confirm-then-run /
  warn cancel).
- tsc 0, lint 0.
- Manual smoke (optional): production-tagged Mongo connection,
  aggregate `[{"$out":"foo"}]` 를 strict / warn / off 각 모드에서 실행
  → 차단 / 다이얼로그 / 통과.
