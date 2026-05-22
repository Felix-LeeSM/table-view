# Feature Spec: useDdlPreviewExecution shared hook + 3 Structure editor adoption (Sprint 214)

## Description

`src/components/structure/ColumnsEditor.tsx` (775 lines), `src/components/structure/IndexesEditor.tsx` (579 lines), `src/components/structure/ConstraintsEditor.tsx` (649 lines) 가 동일한 commit lifecycle — `previewSql` / `previewLoading` / `previewError` state, `useSafeModeGate` 호출, `;` split + `analyzeStatement` + `safeModeGate.decide` 루프 (block → previewError set + return / confirm → `pendingConfirm` set + return / 그 외 → run), warn-tier `ConfirmDangerousDialog` mount + confirm/cancel handler (cancel 시 "Safe Mode (warn): confirmation cancelled — no changes committed" 메시지), 성공/실패 분기에서 `addHistoryEntry({ source: "ddl-structure", paradigm: "rdb", queryMode: "sql", ... })` 기록, 그리고 cleanup + `await onRefresh()` 시퀀스 — 를 각자 자체 구현한다. UI / domain payload (ColumnsEditor 의 `tauri.alterTable` ALTER batch / IndexesEditor 의 `tauri.createIndex`/`tauri.dropIndex` / ConstraintsEditor 의 `tauri.addConstraint`/`tauri.dropConstraint`) 는 서로 다르지만, preview SQL 수신부터 history 기록까지의 commit lifecycle 은 거의 동일하다.

본 sprint 는 P7 candidate (`docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P7) 를 처리한다. 공통 lifecycle 만 **`useDdlPreviewExecution`** hook 으로 추출하고 (preview SQL / loading / error state, safe mode gate 평가 루프, pending confirm + ConfirmDangerousDialog handoff state, history recording, refresh trigger, cleanup), domain request builder (각 editor 의 `tauri.alterTable` / `createIndex` / `dropIndex` / `addConstraint` / `dropConstraint` payload + UI specifics — table rendering, add/create modal, inline editing, drop button) 는 각 editor 에 잔존시킨다. 각 editor 는 hook 에 (a) preview SQL 을 produce 하는 closure (`requestPreview: () => Promise<{ sql: string }>`) 와 (b) execute 하는 closure (`commitExecute: () => Promise<void>`) 만 전달한다. **3 editor 의 외부 prop / public default-export 시그니처 / 단일 importer (`StructurePanel.tsx:6-8`) / 3 regression test (`ColumnsEditor.test.tsx` 368 lines + `IndexesEditor.test.tsx` 233 lines + `ConstraintsEditor.test.tsx` 225 lines) + `SqlPreviewDialog.test.tsx` (126) 모두 동결**. 행동 변경 0 — Safe Mode strict block / warn confirm / cancel 메시지 / history `source: "ddl-structure"` tagging / production stripe / preview dialog DOM identity 모두 사전과 byte-equivalent.

이 sprint 는 entry-pattern god-file split (Sprint 199 / 200 / 201 / 210 / 211 / 213) 답습이 아닌 **cross-component DRY 추출** 패턴이다. P7 후보가 명시한 위험 — DDL별 Tauri payload 가 서로 다르므로 hook 이 너무 generic 해지면 오히려 복잡해진다 — 을 의식해 hook 의 책임을 "preview SQL 수신 + safe mode 평가 + warn-tier handoff + execute call + history record + cleanup + refresh" 로 한정하고, "어떤 Tauri command 를 어떤 payload 로 부를 것인가" 는 각 editor 의 closure 안에 잔존시킨다.

## Sprint Breakdown

### Sprint 214: useDdlPreviewExecution extraction + 3 editor adoption

**Goal**: `src/components/structure/useDdlPreviewExecution.ts` (create) 가 3 editor 의 공통 commit lifecycle (preview SQL state, safe mode gate 루프, warn-tier confirm flow, pending execute orchestration, history recording, refresh trigger, cleanup) 을 보유. 3 editor 가 각자의 lifecycle 보일러플레이트 (preview state declarations / `;`-split + `decide` loop / `ConfirmDangerousDialog` mount + handler / `addHistoryEntry` 호출 / cleanup) 을 hook 호출 + closure 2개 (preview request builder + execute request builder) 로 대체. 3 editor 의 default export 시그니처 (props) / 외부 importer / regression test 4개 모두 변경 0.

**Verification Profile**: command

**Acceptance Criteria**:

1. **Hook 파일 존재 + 비어있지 않음.** `src/components/structure/useDdlPreviewExecution.ts` 가 sprint 종료 후 존재, `wc -l` ≥ 80 lines (공통 lifecycle 8개 책임 + JSDoc 포함). hook 은 default export 가 아닌 **named export** 를 1개 이상 보유 — `grep -n "^export" src/components/structure/useDdlPreviewExecution.ts` 매치 ≥ 1, 그 중 적어도 하나가 hook 함수 자체 (`export function useDdlPreviewExecution\|export const useDdlPreviewExecution` 매치 1).

2. **3 editor 가 hook 사용.** `grep -n "useDdlPreviewExecution" src/components/structure/ColumnsEditor.tsx src/components/structure/IndexesEditor.tsx src/components/structure/ConstraintsEditor.tsx` 가 import + 호출 합산 ≥ 6 매치 (3 editor × 2 = import + 호출). 동일한 파일 안에서 `useState` 로 `previewSql` / `previewLoading` / `previewError` / `pendingConfirm` 을 새로 declare 하는 라인 0 — `grep -nE "useState[<(].*previewSql\|useState[<(].*previewLoading\|useState[<(].*previewError\|useState[<(].*pendingConfirm" src/components/structure/ColumnsEditor.tsx src/components/structure/IndexesEditor.tsx src/components/structure/ConstraintsEditor.tsx` 매치 0 (이 4개 state 는 hook 안에 옮겨졌음).

3. **Boilerplate 감소.** 사전 vs 사후 line-count delta:
   - `wc -l src/components/structure/ColumnsEditor.tsx` strictly less than **775** (사전).
   - `wc -l src/components/structure/IndexesEditor.tsx` strictly less than **579**.
   - `wc -l src/components/structure/ConstraintsEditor.tsx` strictly less than **649**.
   - 3 editor 합산 lines (post-sprint) + `useDdlPreviewExecution.ts` lines ≤ 사전 3 editor 합산 (`775 + 579 + 649 = 2003`) + **150 lines buffer** (JSDoc + interface boundary + import surface 허용). 즉 `(post Cols + post Idx + post Cons + hook) ≤ 2153`.

4. **3 regression test + SqlPreviewDialog test 변경 0.** `git diff --stat src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx` 모두 0 changes. 4 파일 byte-identical to pre-sprint baseline.

5. **공개 surface 동결.** `grep -rn "from \"@components/structure/ColumnsEditor\"\|from \"@components/structure/IndexesEditor\"\|from \"@components/structure/ConstraintsEditor\"" src/ e2e/` 매치 = 사전 3건 (`StructurePanel.tsx:6` / `:7` / `:8`). 3 editor 모두 **default export** 유지 — `grep -n "^export default" src/components/structure/ColumnsEditor.tsx src/components/structure/IndexesEditor.tsx src/components/structure/ConstraintsEditor.tsx` 매치 3건. 각 editor 의 props interface (`ColumnsEditorProps` / `IndexesEditorProps` / `ConstraintsEditorProps`) 시그니처 변경 0 — exported 또는 internal 모두 동일한 name + field 유지. `StructurePanel.tsx` 도 변경 0 (`git diff --stat src/components/schema/StructurePanel.tsx` = 0).

6. **Project-wide regression bar.** `pnpm vitest run` exit 0 — 사전 baseline (post-Sprint-213, 189 files / 2720 tests pass) 이상 유지 (file count ±1 buffer 허용 — hook 자체에 unit test 가 추가되는 경우 +1, 그렇지 않으면 동일). `pnpm tsc --noEmit` exit 0. `pnpm lint` exit 0. 본 sprint touched 파일들에 새 `eslint-disable*` directive 0 — `git diff src/components/structure/ | grep "^+.*eslint-disable"` 매치 0. 새 silent `catch {}` 0 — 사전 catch 블록 (각 editor 의 `runAlter` / `runPendingExecute` / `handleDropIndex` / `handleDropConstraint` catch 블록은 모두 `setPreviewError(String(e))` 또는 `addHistoryEntry({ status: "error", ...})` 본문 보유) 은 hook 안으로 이동되며 본문 의미 유지. `git diff` 추가 라인 안에서 `} catch (\\w+) \\{$` 직후 `}` 만 있는 패턴 0건.

**Components to Create/Modify**:

- `src/components/structure/useDdlPreviewExecution.ts` (create):
  공통 DDL preview/execute lifecycle hook. 입력: `{ connectionId: string; onRefresh: () => Promise<void> }` (필수) — `connectionId` 는 safe mode gate + history record 양쪽에 필요, `onRefresh` 는 성공 후 호출. 출력 (정확한 shape 은 generator 재량, 단 다음 의미 모두 노출):
  - `previewSql: string` / `setPreviewSql(sql: string): void` (또는 hook 내부 setter — generator 가 `loadPreview` API 로 외부 노출만 결정).
  - `previewLoading: boolean`.
  - `previewError: string | null`.
  - `pendingConfirm: { reason: string; sql: string } | null`.
  - `loadPreview(requestPreview: () => Promise<{ sql: string }>, prepareCommit: () => () => Promise<void>): Promise<void>` — preview SQL 호출 + 성공/실패 시 state set + commit closure 등록 (IndexesEditor / ConstraintsEditor 의 `pendingExecuteRef` 패턴을 hook 내부 ref 또는 closure 로 흡수). ColumnsEditor 처럼 `previewSql` 를 직접 set 하고 싶은 경우는 `setPreviewSql` + `setPendingExecute` 두 helper 로 분리 노출 (generator 재량).
  - `attemptExecute(): Promise<void>` — `;`-split + `analyzeStatement` + `safeModeGate.decide` loop. 결정 분기: block → `setPreviewError(decision.reason)` + return / confirm → `setPendingConfirm({ reason, sql: stmt })` + return / 그 외 → `runCommit()` 호출.
  - `confirmDangerous(): Promise<void>` — `setPendingConfirm(null)` + `runCommit()`.
  - `cancelDangerous(): void` — `setPendingConfirm(null)` + `setPreviewError("Safe Mode (warn): confirmation cancelled — no changes committed")`.
  - `cancelPreview(): void` — preview dialog cancel handler. `setPreviewSql("")` / `setPreviewError(null)` / `setPendingConfirm(null)` + commit closure clear. ColumnsEditor 의 `handleCancelPending` 추가 책임 (pending changes 등 도메인 reset) 은 editor 자체에 잔존하므로 hook 의 cancelPreview 는 lifecycle reset 만.
  - `runCommit(): Promise<void>` — internal helper (또는 hook 내부 함수): `setPreviewLoading(true)` + `setPreviewError(null)` + `startedAt = Date.now()` + `recordedSql = previewSql` 캡처 + 등록된 commit closure 호출 + 성공 시 cleanup (`setPreviewSql("")` 또는 caller-controlled flag) + `await onRefresh()` + `addHistoryEntry({ sql: recordedSql, executedAt: startedAt, duration: Date.now() - startedAt, status: "success", connectionId, paradigm: "rdb", queryMode: "sql", source: "ddl-structure" })` / 실패 시 `setPreviewError(String(e))` + `addHistoryEntry({ ..., status: "error" })` + `setPreviewLoading(false)`.

  hook 안에서 `useSafeModeGate(connectionId)` / `useQueryHistoryStore((s) => s.addHistoryEntry)` / `analyzeStatement` 사전 동일하게 호출. `useState` 로 `previewSql` / `previewLoading` / `previewError` / `pendingConfirm` + `useRef` 또는 `useState` 로 commit closure 보유 (generator 재량).

- `src/components/structure/ColumnsEditor.tsx` (modify):
  hook 호출 1건 + 자체 도메인 state (`editingColumn` / `pendingChanges` / `newColumnDrafts` / `droppedColumns` / `showSqlModal`) 잔존. `handleReviewSql` 안에서 hook 의 `loadPreview` 호출 — `loadPreview(() => tauri.alterTable(buildAlterRequest(true)), () => async () => { await tauri.alterTable(buildAlterRequest(false)); })` 패턴. `handleExecute` → `attemptExecute()`. `confirmDangerous` / `cancelDangerous` → hook alias. `handleCancelPending` (도메인 cleanup) 는 editor 자체 잔존 + 마지막에 `cancelPreview()` 호출.

- `src/components/structure/IndexesEditor.tsx` (modify):
  hook 호출 1건. `pendingExecuteRef` 사전 참조는 hook 내부로 이동. `handleCreateIndexPreview(params)` / `handleDropIndex(indexName)` 안에서 hook 의 preview/commit closure 등록. `handlePreviewConfirm` → `attemptExecute()`. `confirmDangerous` / `cancelDangerous` / `handlePreviewCancel` 모두 hook alias 또는 `cancelPreview` 호출.

- `src/components/structure/ConstraintsEditor.tsx` (modify):
  IndexesEditor 와 동일 패턴. `handleAddConstraintPreview(params)` / `handleDropConstraint(constraintName)` 안에서 hook closure 등록. `AddConstraintModal` / `dropConstraint` payload 변경 0.

- 신규 unit test 파일 (선택, generator 재량):
  `src/components/structure/useDdlPreviewExecution.test.ts` 생성 가능. 단, 본 sprint 는 refactor-only 이고 3 regression test 가 통합 커버하므로 hook unit test 0 도 허용.

## Global Acceptance Criteria

1. **행동 변경 0.** 사용자 관찰 가능한 모든 흐름이 사전과 동일:
   - **ColumnsEditor**: Add Column → 인라인 input 행 → Confirm → pendingChanges 머지 (`new` 배지 + bg-success/5 행) → Review SQL ({n}) 클릭 → `tauri.alterTable(buildAlterRequest(true))` 호출 → SqlPreviewDialog mount with previewSql / loading / error → Execute 클릭 → safe mode gate 평가 → safe → `tauri.alterTable(buildAlterRequest(false))` → cleanup (pendingChanges/droppedColumns/drafts/editingColumn reset) + dialog close + `await onRefresh()` + `addHistoryEntry({ source: "ddl-structure", status: "success" })` / strict block → `previewError = decision.reason` ("Safe Mode blocked: ALTER TABLE DROP COLUMN" 등) + Execute 호출 0 / warn confirm → ConfirmDangerousDialog mount with reason + sqlPreview → 사용자 input "ALTER TABLE DROP COLUMN" + Run anyway → 동일 commit 경로. Cancel inside warn dialog → previewError = "Safe Mode (warn): confirmation cancelled — no changes committed" + Execute 호출 0.
   - **IndexesEditor**: Create Index 버튼 → CreateIndexModal mount → 입력 → Preview SQL 클릭 → `tauri.createIndex({...preview_only: true})` → SqlPreviewDialog + pendingExecute closure 등록 (hook 내부) → Execute → safe mode 평가 → safe → `tauri.createIndex({...preview_only: false})` → dialog close + previewSql clear + onRefresh + history record. Delete index 트래시 → `tauri.dropIndex({...preview_only: true})` → preview → Execute → safe mode → 평가 (DROP INDEX warn-tier) → confirm dialog 또는 직접 commit. Primary index 의 Delete 버튼 미렌더 (`!idx.is_primary` 가드).
   - **ConstraintsEditor**: Add Constraint 버튼 → AddConstraintModal mount → primary_key/unique/foreign_key/check 4 종류 → Preview SQL → `tauri.addConstraint({...preview_only: true})` → SqlPreviewDialog → Execute → safe + commit. Delete constraint → `tauri.dropConstraint({...preview_only: true})` → preview → Execute → safe mode (`ALTER TABLE DROP CONSTRAINT` warn-tier).
   - **Safe Mode strict / warn 메시지 텍스트 동결**: "Safe Mode blocked: ..." prefix (decision.reason 그대로 사용 — `src/lib/safeMode.ts` 결과). Cancel 시 "Safe Mode (warn): confirmation cancelled — no changes committed" verbatim (3 editor 동일 문자열).
   - **History entry shape 동결**: `{ sql: recordedSql, executedAt: startedAt, duration: Date.now() - startedAt, status: "success" | "error", connectionId, paradigm: "rdb", queryMode: "sql", source: "ddl-structure" }`. `recordedSql` 은 `previewSql` snapshot (commit 직전 캡처). 3 editor 모두 동일.
   - **Production stripe**: SqlPreviewDialog 의 `environment={connectionEnvironment}` prop 으로 production 시 stripe 표시. 3 editor 모두 `connectionEnvironment` 를 `useConnectionStore((s) => s.connections.find((c) => c.id === connectionId)?.environment ?? null)` selector 로 사전 동일하게 획득.
   - **Empty state**: ColumnsEditor 는 paradigm-aware vocab.emptyUnits ("No columns found" / "No fields found"). IndexesEditor / ConstraintsEditor 는 "No indexes found" / "No constraints found" verbatim.
   - **ConfirmDangerousDialog props**: `open` / `reason={pendingConfirm.reason}` / `sqlPreview={pendingConfirm.sql}` / `onConfirm` / `onCancel` 시그니처 사전 동일.

2. **Public default export 동결.** 3 editor 모두 default export + props interface 시그니처 변경 0. `StructurePanel.tsx:6-8` default import 라인 변경 0.

3. **사전 catch 본문 의미 보존.** 사전 5 catch 블록 (handleReviewSql / runAlter / handleDropIndex / runPendingExecute / handleDropConstraint) 본문 (setPreviewError + addHistoryEntry) 은 hook 안으로 이동되며 의미 유지. silent `} catch (e) {}` 0건.

4. **새 `eslint-disable*` 0.**

5. **regression test 4 파일 byte-identical.** 사전 24 cases 모두 통과.

6. **Lint / TypeScript / build 모두 exit 0.**
   - `pnpm lint` exit 0.
   - `pnpm tsc --noEmit` exit 0 — 새 `any` 0.
   - `pnpm vitest run` exit 0 — 사전 baseline (189 files / 2720 tests) 와 동일 또는 +1 file (hook unit test 추가 시) 허용.

7. **Diff sanity.**
   - 3 editor 의 net `-` 라인 총합 > 0.
   - `useDdlPreviewExecution.ts` net `+` 라인 ≥ 80, ≤ 250.
   - 3 editor net delta + hook 합산 ≤ -100 (overall reduction).

8. **Hook 외부 import 0.** `grep -rn "from \"@components/structure/useDdlPreviewExecution\"\|from \"./useDdlPreviewExecution\"" src/ e2e/` 매치 ≤ 3 (3 editor 만).

9. **새 unit test 0 권고 (선택 허용).**

10. **기존 importer drift 0.** `git diff --stat src/components/schema/StructurePanel.tsx` = 0.

## Data Flow

### Before (current state — 3 editor 동일 패턴)

```
[Editor]                                                  [Tauri]
   │  user clicks Review/Preview                              │
   ├─→ tauri.alterTable / createIndex / dropIndex /        ───┤
   │   addConstraint / dropConstraint ({preview_only: true})  │
   │                                                       ←──┤  result.sql
   ├─→ setPreviewSql(result.sql)                              │
   ├─→ pendingExecuteRef.current = (closure for preview_only=false)
   ├─→ open SqlPreviewDialog                                  │
   │  user clicks Execute                                     │
   ├─→ previewSql.split(";") loop                             │
   │     for each stmt: analyzeStatement → safeModeGate.decide│
   │       if "block": setPreviewError(reason) + return       │
   │       if "confirm": setPendingConfirm({reason,sql}) + ret│
   │       else: continue                                     │
   ├─→ if loop completed safe: runAlter / runPendingExecute   │
   │     setPreviewLoading(true) + startedAt + recordedSql cap│
   │     try:                                                 │
   ├─→     pendingExecuteRef() / tauri.alterTable(false) ─────┤
   │                                                       ←──┤  ok
   │       cleanup (pendingChanges/showModal/refs reset)      │
   │       await onRefresh()                                  │
   │       addHistoryEntry({status: "success", source:        │
   │                        "ddl-structure", paradigm: "rdb"})│
   │     catch (e):                                           │
   │       setPreviewError(String(e))                         │
   │       addHistoryEntry({status: "error", ...})            │
   │     setPreviewLoading(false)                             │
```

3 editor 모두 위 lifecycle 자체 구현 — `previewSql/Loading/Error/PendingConfirm` state 4개, `;`-split + decide loop, `runAlter`/`runPendingExecute` 함수, `confirmDangerous`/`cancelDangerous`, history record entry 6 fields 가 보일러플레이트로 반복.

### After (this sprint)

```
[Editor]                          [useDdlPreviewExecution]                      [Tauri]
   ├─→ const ddl = useDdlPreviewExecution({ connectionId, onRefresh })
   │
   │  user clicks Review/Preview
   ├─→ ddl.loadPreview(
   │       () => tauri.alterTable(req(true)), ─────────────────────────────────────►│
   │       () => async () => { await tauri.alterTable(req(false)) })          ◄─ result.sql
   │                                       ├─→ setPreviewSql + register closure
   │  user clicks Execute
   ├─→ ddl.attemptExecute()                ├─→ ;-split → decide loop
   │                                       │     block: setPreviewError(reason)
   │                                       │     confirm: setPendingConfirm(...)
   │                                       │     safe: runCommit(): commit closure ─►│
   │                                       │                                      ◄─ ok
   │                                       ├─→ setPreviewSql("") + onRefresh + history
   │  cleanup (도메인 잔존):
   ├─→ pendingChanges = []  / showSqlModal = false
```

### Cross-module dependency

```
useDdlPreviewExecution.ts (new)
  ├─→ uses useSafeModeGate(connectionId)
  ├─→ uses useQueryHistoryStore((s) => s.addHistoryEntry)
  ├─→ uses analyzeStatement (from "@/lib/sql/sqlSafety")
  └─→ no Tauri dependency (caller passes closures)

ColumnsEditor.tsx / IndexesEditor.tsx / ConstraintsEditor.tsx
  ├─→ useDdlPreviewExecution
  ├─→ useConnectionStore (environment selector — stripe)
  ├─→ tauri.* (preview + commit closures)
  ├─→ SqlPreviewDialog (sql/loading/error/environment props from hook + selector)
  └─→ ConfirmDangerousDialog (open / reason / sqlPreview from hook)

(StructurePanel.tsx → unchanged; sees only 3 editor default exports)
```

## Edge Cases

- **Multi-statement preview with mixed safety (Columns)**: `ALTER TABLE ... ADD COLUMN x; ALTER TABLE ... DROP COLUMN y;` batch → hook 의 `;`-split + decide loop 가 first dangerous statement 발견 시 block/confirm 분기.
- **Preview returns empty SQL**: `previewSql` 빈 string 시 SqlPreviewDialog 의 `confirmDisabled={!sql.trim()}` 로 Execute 버튼 disabled.
- **Preview generation failure**: tauri reject → previewError set + previewSql = "" + dialog 마운트.
- **Commit failure (DB error)**: closure reject → previewError + history error entry + setPreviewLoading(false). dialog 잔존. recordedSql 은 commit 시작 직전 캡처값.
- **Cancel during commit phase**: 사용자 Cancel 클릭 → cancelPreview 호출 → 진행 중 promise abort 안 함 (사전 동일 — refactor-only).
- **Empty pendingChanges + Review SQL 클릭 (Columns)**: `pendingCount === 0` short-circuit (도메인 가드 — Review SQL 버튼 자체 hidden).
- **Multiple inflight preview requests**: 사전 race 조건 동일 보호 안 함 (refactor 후도 hook 안에서 동일 race 잔존).
- **Connection environment 변경 during preview**: SqlPreviewDialog environment prop 매 render selector → stripe 즉시 반영. 사전 동일.
- **Safe Mode store change during preview**: 사전 strict → warn 변경 시 다음 Execute 클릭 시 confirm prompt. 즉시 반영.
- **History record exception**: addHistoryEntry sync action 으로 throw 없음 가정. 사전 동일.
- **onRefresh failure**: try 블록에 await onRefresh + addHistoryEntry success 둘 다 포함 → onRefresh failure 시 success entry 미기록 (catch 분기 진입).
- **Unmount during commit**: 사전 동일 — 보호 추가 안 함.
- **Hook 재실행 (key change)**: connectionId 변경 시 useSafeModeGate 가 새로운 environment 읽음. previewSql 등 state 는 caller 의 cleanup 결정.

## Verification Hints

- **Primary regression command**: `pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx` exit 0. 4 파일 합산 24 cases 통과.

- **File-shape checks**:
  - `wc -l src/components/structure/useDdlPreviewExecution.ts` ≥ 80, ≤ 250.
  - `wc -l src/components/structure/ColumnsEditor.tsx` < 775.
  - `wc -l src/components/structure/IndexesEditor.tsx` < 579.
  - `wc -l src/components/structure/ConstraintsEditor.tsx` < 649.
  - 4 파일 합산 ≤ 사전 3 editor 합산 + 150 buffer.

- **Hook surface checks**:
  - `grep -n "^export" src/components/structure/useDdlPreviewExecution.ts` 매치 ≥ 1.
  - `grep -n "useDdlPreviewExecution" src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 매치 ≥ 6.
  - `grep -nE "useState[<(].*previewSql" src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 매치 0.
  - `grep -nE "useState[<(].*pendingConfirm" src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 매치 0.
  - `grep -n "pendingExecuteRef" src/components/structure/{IndexesEditor,ConstraintsEditor}.tsx` 매치 0.
  - `grep -nE "split\(\";\"\)" src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 매치 0.

- **Public-surface checks**:
  - `grep -rn "from \"@components/structure/ColumnsEditor\"\|from \"@components/structure/IndexesEditor\"\|from \"@components/structure/ConstraintsEditor\"" src/ e2e/` 매치 = 사전 3건 (`StructurePanel.tsx:6/7/8`).
  - `grep -rn "from \"@components/structure/useDdlPreviewExecution\"" src/ e2e/` 매치 ≤ 3.
  - `grep -n "^export default" src/components/structure/ColumnsEditor.tsx src/components/structure/IndexesEditor.tsx src/components/structure/ConstraintsEditor.tsx` 매치 3.

- **Project-wide gates**: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 모두 exit 0.

- **Test file 동결 검증**: `git diff --stat src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx` 모두 0 changes.

- **StructurePanel drift 0**: `git diff --stat src/components/schema/StructurePanel.tsx` = 0.

- **새 eslint-disable / silent catch 0**:
  - `git diff src/components/structure/ | grep "^+.*eslint-disable"` 0 라인.
  - `git diff` 추가 라인 안 빈 catch 0건.

- **Hook 너무 generic 방어 (P7 risk note)**:
  - hook props (입력) ≤ 4개.
  - hook 안의 `addHistoryEntry` payload `source: "ddl-structure"` / `paradigm: "rdb"` / `queryMode: "sql"` hardcoded 권고.
  - Tauri command 호출 hook 안 절대 0 — `grep -n "tauri\\." src/components/structure/useDdlPreviewExecution.ts` 매치 0.

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/components/structure/useDdlPreviewExecution.ts
- /Users/felix/Desktop/study/view-table/src/components/structure/ColumnsEditor.tsx
- /Users/felix/Desktop/study/view-table/src/components/structure/IndexesEditor.tsx
- /Users/felix/Desktop/study/view-table/src/components/structure/ConstraintsEditor.tsx
- /Users/felix/Desktop/study/view-table/src/hooks/useSafeModeGate.ts
