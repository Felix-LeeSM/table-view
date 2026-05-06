# Sprint Contract: sprint-223

## Summary

- Goal: `src/stores/schemaStore.ts` 의 `dropTable` / `renameTable` 두 action 본문에서 `try { tauri.listTables + set } catch { fallback set }` orchestration (~46 LOC) 을 신규 use-case hook `useSchemaTableMutations` 으로 이동. store action 본문은 `await tauri.dropTable/renameTable(...)` 1 호출 (~1-3 LOC each) 로 축소. caller 1 (`useSchemaTreeActions.ts`) 가 hook 으로 swap. store test 6 case 가 hook test 로 migrate. 행동 변경 0; cache 결과 byte-equivalent; `SchemaState` 16 method signature 동결.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle, **P10 step 2**).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- 신규 hook: `src/hooks/useSchemaTableMutations.ts` (~70 LOC).
- 신규 hook test: `src/hooks/useSchemaTableMutations.test.ts` (≥ 6 case — 6 store case migration).
- `src/stores/schemaStore.ts` body shrink: `dropTable` + `renameTable` 본문에서 reload-then-fallback orchestration 제거 (-~50 LOC).
- `src/stores/schemaStore.test.ts` body shrink: 6 case 삭제 (-~145 LOC).
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts`: 2 selector → `useSchemaTableMutations()` destructure swap (~2 LOC).

## Out of Scope

- `SchemaState` 16 method signature / cache shape (`tables` / `views` / `functions` / `schemas` / `tableColumnsCache`) / cache key naming 변경.
- 다른 14 store action body 변경 (`loadSchemas` / `loadTables` / `loadViews` / `loadFunctions` / `getTableColumns` / `getTableIndexes` / `getTableConstraints` / `getViewColumns` / `getViewDefinition` / `queryTableData` / `executeQuery` / `executeQueryBatch` / `clearSchema` / `clearForConnection` / `evictSchemaForName` / `prefetchSchemaColumns`).
- `clearConnectionEntries` helper 변경.
- `connectionStore.ts` / `connectionStore.test.ts` 변경 (P10 step 3/4 영역).
- `useConnectionLifecycle.{ts,test.ts}` / `useConnectionMutations.{ts,test.ts}` (Sprint 219 결과) / `useSchemaCache.{ts,test.ts}` / `useMigrationExport.ts` 변경.
- `src/lib/{tauri,toast,session-storage,zustand-ipc-bridge,window-label}.ts` 변경.
- cross-window regression test (`cross-window-connection-sync.test.tsx` / `window-lifecycle.ac141.test.tsx`) 변경.
- `src/main.tsx` 변경.
- 다른 schema component (`SchemaTree.tsx` / `treeRows.ts` / `dialogs.ts`) 변경.
- toast / IPC bridge / session-storage 호출 추가/제거.
- P10 후속 step (step 3 connectionStore session / step 4 IPC bridge 분리).

## Invariants

- 사전 모든 input 에 대해 사후 `state.tables[key]` 배열 byte-equivalent.
- `SchemaState` 16 method signature (return / param / async) 동결.
- Tauri command 호출 횟수 / 인자 / 순서 사전 동일 (drop/rename: 1× tauri.X + 1× tauri.listTables; happy/fallback path).
- Cache key naming `${connectionId}:${schema}` / `${connectionId}:${schema}:${table}` 동결.
- ConnectionStore SYNCED_KEYS 4 key + IPC bridge module-load attach 동결.
- session-storage 3 호출 site (`persistFocusedConnId` / `persistActiveStatuses` / `readConnectionSession`) 동결.
- 새 useEffect / setInterval / setTimeout / subscribe / window event listener 0 in hook.
- 새 `eslint-disable*` / 새 silent `catch{}` (이동 외) / `it.only` / `it.skip` / 새 `any` 0.
- 사전 fallback 의 `catch {}` 패턴은 hook 으로 이동 (net 신규 0).

## Acceptance Criteria

- `AC-01`: store body shrink. `dropTable` 본문 ≤ 3 LOC + `renameTable` 본문 ≤ 3 LOC. `git diff --stat src/stores/schemaStore.ts` 의 `-` count ≥ 50. `grep -nE 'tauri\.listTables' src/stores/schemaStore.ts | wc -l` = 1 (loadTables only). `grep -nE 'state\.tables\[key\]' src/stores/schemaStore.ts | wc -l` = 0.
- `AC-02`: 신규 hook. `src/hooks/useSchemaTableMutations.ts` 존재 + named export `useSchemaTableMutations` 1건 + 2 method signature byte-equivalent. 새 useEffect / setInterval / setTimeout / subscribe / window event listener 0.
- `AC-03`: hook test ≥ 6 case 통과. 6 verbatim case name (`dropTable refreshes table list on success` / `dropTable removes table optimistically when refresh fails` / `dropTable handles missing cache key gracefully` / `renameTable refreshes table list on success` / `renameTable updates table name optimistically when refresh fails` / `renameTable handles missing cache key gracefully`) 매치 ≥ 6 in hook test, 0 in store test. mock 패턴: `vi.hoisted` + `vi.mock("@stores/schemaStore", ...)` + `vi.mock("@lib/tauri", ...)` (Sprint 219 답습).
- `AC-04`: caller swap. `grep -rnE 'useSchemaStore\(\(s\) => s\.(dropTable|renameTable)\)' src/components/ src/hooks/` = 0 (hook impl 자체 제외 가능). `grep -rn 'useSchemaTableMutations' src/` ≥ 3 (hook + caller + test).
- `AC-05`: 모든 invariant 충족. `connectionStore*` / `useConnectionLifecycle*` / `useConnectionMutations*` / `useSchemaCache*` / `useMigrationExport*` / `src/lib/*` / cross-window regression test / `main.tsx` / `SchemaTree.tsx` / `treeRows.ts` / `dialogs.ts` 모두 diff 0. Global AC 1-10 모두 충족.

## Design Bar / Quality Bar

- narrow extraction — `dropTable` / `renameTable` 의 reload-then-fallback orchestration 한 흐름만 이동.
- store body 다른 14 action / `clearConnectionEntries` helper / `SchemaState` interface 변경 0.
- hook 은 Sprint 219 의 `useConnectionMutations.ts` 패턴 답습 — `useCallback` + selector wrap.
- hook 은 store action signature 동결 유지 — `dropTable` / `renameTable` `Promise<void>` 계약 보존.
- hook test 는 Sprint 219 verbatim mock 패턴 — `vi.hoisted` + factory + selector + setState/getState 노출.
- cache 결과 byte-equivalence — happy-path 에서 `tauri.listTables` 결과 그대로, fallback path 에서 `current.filter` / `current.map` 결과 동일.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/hooks/useSchemaTableMutations.test.ts` exit 0 + ≥ 6 case pass.
2. `pnpm vitest run src/stores/schemaStore.test.ts` exit 0. 사전 case 수 -6 (다른 case 모두 통과).
3. `pnpm vitest run src/components/schema/SchemaTree/useSchemaTreeActions.test.tsx src/hooks/useSchemaCache.test.ts` exit 0 (사전 case 동일).
4. `pnpm vitest run src/stores/connectionStore.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useConnectionMutations.test.ts` exit 0.
5. `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` exit 0.
6. `pnpm vitest run` exit 0. file count 사전 +2 (hook + hook test). store test cases -6 + hook test cases +6 (≥) net delta ≥ 0.
7. `pnpm tsc --noEmit` exit 0.
8. `pnpm lint` exit 0.
9. `git diff --stat src/stores/schemaStore.ts` 의 `-` count ≥ 50.
10. `grep -nE 'tauri\.listTables' src/stores/schemaStore.ts | wc -l` = 1.
11. `grep -nE 'state\.tables\[key\]' src/stores/schemaStore.ts | wc -l` = 0.
12. `test -f src/hooks/useSchemaTableMutations.ts && test -f src/hooks/useSchemaTableMutations.test.ts`.
13. `grep -nE '^export function useSchemaTableMutations' src/hooks/useSchemaTableMutations.ts` = 1.
14. `grep -rnE 'useSchemaStore\(\(s\) => s\.(dropTable|renameTable)\)' src/components/ src/hooks/` 매치 0 (hook impl self 제외).
15. `grep -rn 'useSchemaTableMutations' src/` ≥ 3.
16. `grep -n 'useSchemaTableMutations' src/components/schema/SchemaTree/useSchemaTreeActions.ts` ≥ 1.
17. 6 verbatim case name `grep -nE` 사전 store test → hook test 이동:
    - `dropTable refreshes table list on success`
    - `dropTable removes table optimistically when refresh fails`
    - `dropTable handles missing cache key gracefully`
    - `renameTable refreshes table list on success`
    - `renameTable updates table name optimistically when refresh fails`
    - `renameTable handles missing cache key gracefully`
    각각 store test 매치 0 + hook test 매치 ≥ 1.
18. `git diff --stat src/stores/connectionStore.ts src/stores/connectionStore.test.ts` 모두 0.
19. `git diff --stat src/hooks/useConnectionLifecycle.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useConnectionMutations.ts src/hooks/useConnectionMutations.test.ts src/hooks/useSchemaCache.ts src/hooks/useSchemaCache.test.ts src/hooks/useMigrationExport.ts` 모두 0.
20. `git diff --stat src/lib/tauri.ts src/lib/toast.ts src/lib/session-storage.ts src/lib/zustand-ipc-bridge.ts src/lib/window-label.ts` 모두 0.
21. `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx src/main.tsx src/components/schema/SchemaTree/SchemaTree.tsx src/components/schema/SchemaTree/treeRows.ts src/components/schema/SchemaTree/dialogs.ts 2>/dev/null` 모두 0.
22. `git diff src/ | grep "^+.*eslint-disable"` 매치 0. `grep -rnE 'it\.only|it\.skip' src/hooks/useSchemaTableMutations.test.ts` 매치 0. `git diff src/hooks/useSchemaTableMutations.ts | grep -E "^\+.*\bany\b"` 매치 0.

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 + 각 LOC delta.
  - check 1-22 실행 결과 (exit code + 핵심 출력).
  - AC-01..AC-05 별 evidence.
  - 6 verbatim case name 매치 결과 (store test 0 + hook test ≥ 1 each).
  - cache 결과 byte-equivalence 검증 (hook test 의 expect 가 store 사전 코드와 동일 array 산출).
  - `dropTable` / `renameTable` 본문 thin 화 변종 명시 (예: store action 자체가 hook 에 위임된 thin wrapper / `await tauri.X(...)` 만).
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거.
  - missing 또는 weak evidence finding.

## Test Requirements

### Unit Tests (필수)
- AC-01 : `schemaStore.test.ts` 사후 case 수 = 사전 -6 + 모두 통과.
- AC-02 : `useSchemaTableMutations` named export + signature 검증 (hook test).
- AC-03 : 6 verbatim case migrate + 모두 통과.
- AC-04 : caller swap 후 `pnpm vitest run` exit 0.
- AC-05 : sibling diff 0 + cross-window regression 통과.

### Coverage Target
- 신규 `useSchemaTableMutations.ts`: 라인 ≥ 70% (6 case 로 cover).
- CI baseline: 라인 40% / 함수 40% / 브랜치 35%.

### Scenario Tests (필수)
- [x] Happy path (drop/rename success → reload + cache write)
- [x] 에러/예외 상황 (tauri.listTables throw → fallback set)
- [x] 경계 조건 (cache miss `state.tables[key]` undefined → `?? []`)
- [x] 기존 기능 회귀 없음 (cross-window / connectionStore / useConnectionLifecycle test 사전 동일 통과)

## Test Script / Repro Script

1. baseline:
   ```sh
   pnpm vitest run src/stores/schemaStore.test.ts
   ```
2. Generator 작업 후:
   ```sh
   pnpm vitest run src/hooks/useSchemaTableMutations.test.ts
   pnpm vitest run src/stores/schemaStore.test.ts
   pnpm vitest run src/components/schema/SchemaTree/useSchemaTreeActions.test.tsx src/hooks/useSchemaCache.test.ts
   pnpm vitest run src/stores/connectionStore.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useConnectionMutations.test.ts
   pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx
   pnpm vitest run
   pnpm tsc --noEmit
   pnpm lint
   ```
3. body shrink + hook surface 검증:
   ```sh
   git diff --stat src/stores/schemaStore.ts
   grep -nE 'tauri\.listTables|state\.tables\[key\]' src/stores/schemaStore.ts
   grep -nE '^export function useSchemaTableMutations' src/hooks/useSchemaTableMutations.ts
   ```

## Ownership

- Generator: general-purpose agent (Phase 3).
- Write scope: `src/hooks/useSchemaTableMutations.{ts,test.ts}` 신규 + `src/stores/schemaStore.ts` 본문 축소 + `src/stores/schemaStore.test.ts` 6 case 삭제 + `src/components/schema/SchemaTree/useSchemaTreeActions.ts` 의 selector swap.
- 변경 금지: 다른 14 store action / `connectionStore*` / `useConnectionLifecycle*` / `useConnectionMutations*` / `useSchemaCache*` / `useMigrationExport*` / `src/lib/*` / cross-window regression test / `main.tsx` / 다른 schema component.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-22 모두)
- Acceptance criteria evidence linked in `handoff.md`
- **본 sprint 후 P10 step 2 종료** — Sprint 224+ 후속 step (step 3 connectionStore session persistence / step 4 IPC bridge 분리) 시작 가능.
