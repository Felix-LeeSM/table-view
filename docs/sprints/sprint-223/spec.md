# Feature Spec: schemaStore optimistic refresh fallback extraction (Sprint 223 — P10 step 2)

## Description

`src/stores/schemaStore.ts` 의 `dropTable` / `renameTable` 두 action 은 (a) Tauri mutation 호출, (b) 성공 후 `tauri.listTables` reload, (c) reload 실패 시 cache 를 optimistic 하게 patch 하는 fallback — 세 단계를 한 store 본문에서 동시에 소유한다 (`docs/archives/etc/refactoring-candidates.md` § P10). 이로 인해 store unit test 가 cache state transition 뿐 아니라 reload-then-fallback orchestration policy 까지 같이 검증하게 되고, 같은 use-case 가 hook 으로 분리된 다른 mutation flow 들 (e.g. Sprint 219 의 `useConnectionMutations`) 과 경계가 어긋난다.

본 sprint 는 P10 candidate 의 **second step** — Sprint 219 (P10 step 1, `connectionStore` toast extraction, evaluator 9.20/10) 의 narrow-scope pattern 을 그대로 답습한다. 이번 step 의 narrow scope 는 `schemaStore` 의 **`dropTable` / `renameTable` 2 action 의 `try { reload } catch { fallback }` orchestration 한 흐름**을 신규 use-case hook (`useSchemaTableMutations`) 으로 이동. store action 본문은 Tauri mutation 호출 1 줄 (≤ 2-3 LOC) 까지 축소.

행동 변경 0 강제. 사용자 관점 cache 결과 (`state.tables[key]` 배열의 byte-equivalent 동등성) / public Zustand `SchemaState` 16-method signature / Tauri command 호출 횟수 및 인자 / cross-window 동기화 / event listener / `listTables` rebroadcast policy 모두 사전 동일. P10 후속 step 3 (connectionStore session persistence) 와 step 4 (`attachZustandIpcBridge` module-load attach 분리) 영향 범위에는 손대지 않는다.

## Sprint Breakdown

### Sprint 223: schemaStore optimistic refresh fallback extraction

**Goal**: `schemaStore.ts` 의 `dropTable` (lines 267-288, 22 LOC) / `renameTable` (lines 298-321, 24 LOC) 두 action 본문에서 reload-then-fallback orchestration 을 신규 use-case hook `useSchemaTableMutations` 으로 이동. action 본문은 `await tauri.dropTable(...)` / `await tauri.renameTable(...)` 1 호출만 남긴다 (≤ 2-3 LOC each). 1 component caller (`useSchemaTreeActions.ts`) 는 store selector 대신 hook 의 wrapped action 을 호출. cache 결과는 모든 input 에 대해 사전 코드와 byte-equivalent.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. **Store body shrink — `dropTable` / `renameTable` 본문 축소.**
   - `src/stores/schemaStore.ts` 의 `dropTable` 본문은 `await tauri.dropTable(connectionId, table, schema);` 1 줄로 (혹은 explicit `Promise<void>` return 포함 ≤ 2-3 LOC). reload (`tauri.listTables` + `set(...)`) 와 fallback (`set((state) => ...)`) 분기 전체 제거.
   - `renameTable` 본문도 동일 — `await tauri.renameTable(connectionId, table, schema, newName);` 1 줄로. reload + fallback 분기 전체 제거.
   - 검증: `git diff --stat src/stores/schemaStore.ts` 의 `-` count ≥ 50 (rough estimate; ~55 LOC 가 두 action 합쳐 제거).
   - 검증: `grep -nE 'tauri\.listTables' src/stores/schemaStore.ts` 의 매치 횟수가 사전 (loadTables 본문 1건만 남도록) 대비 -2 줄 (dropTable / renameTable 의 happy-path reload 호출 사라짐).
   - 검증: `grep -nE 'state\.tables\[key\]' src/stores/schemaStore.ts` 의 매치 횟수가 사전 대비 -2 (drop/rename fallback 의 `state.tables[key] ?? []` 두 줄 사라짐).
   - **금지**: store 본문에서 다른 14 action (`loadSchemas` / `loadTables` / `loadViews` / `loadFunctions` / `getTableColumns` / `getTableIndexes` / `getTableConstraints` / `getViewColumns` / `getViewDefinition` / `queryTableData` / `executeQuery` / `executeQueryBatch` / `clearSchema` / `clearForConnection` / `evictSchemaForName` / `prefetchSchemaColumns`) 변경. `clearConnectionEntries` helper 변경. `SchemaState` interface 16 method signature 변경. `tableColumnsCache` / `views` / `functions` / `schemas` cache shape 변경.

2. **신규 hook 파일 + named export.**
   - 신규: `src/hooks/useSchemaTableMutations.ts` (~70 LOC).
   - export shape: `export function useSchemaTableMutations(): { dropTable, renameTable }` — 2 method signature 가 store action signature 와 byte-equivalent.
     - `dropTable(connectionId: string, table: string, schema: string): Promise<void>` — wrapped: `await storeDrop(connectionId, table, schema)` → reload 시도 (`await tauri.listTables(connectionId, schema)` → `useSchemaStore.setState((state) => ({ tables: { ...state.tables, [key]: tables } }))`) → reload throw 시 fallback (`useSchemaStore.setState((state) => { const current = state.tables[key] ?? []; return { tables: { ...state.tables, [key]: current.filter((t) => t.name !== table) } }; })`). store throw 시 reload / fallback 호출 0회 (re-throw 보존).
     - `renameTable(connectionId: string, table: string, schema: string, newName: string): Promise<void>` — 동일 패턴. fallback 은 `current.map((t) => t.name === table ? { ...t, name: newName } : t)`.
   - hook 은 `useSchemaStore((s) => s.dropTable)` / `useSchemaStore((s) => s.renameTable)` 2 selector 호출 + `useCallback` 으로 wrap. cache write 는 `useSchemaStore.setState(...)` (외부 진입점) 또는 별도 selector 노출 (Generator 재량) — 단, `SchemaState` interface 16 method signature 변경 금지.
   - hook 은 새 useEffect / setInterval / setTimeout / subscribe / window event listener 0 건. **순수 orchestration**.
   - hook 은 Sprint 219 의 `useConnectionMutations.ts` 패턴 답습 (selector + useCallback + side-effect).
   - 검증: `test -f src/hooks/useSchemaTableMutations.ts` exit 0.
   - 검증: `grep -nE '^export function useSchemaTableMutations' src/hooks/useSchemaTableMutations.ts` 매치 = 1.

3. **신규 hook test — 6 case migration from store test.**
   - 신규: `src/hooks/useSchemaTableMutations.test.ts` (≥ 6 case).
   - 다음 6 case 가 hook test 에 마이그레이션 (assertion logic 동일, mount 만 `useSchemaStore.getState().X(...)` → `renderHook(() => useSchemaTableMutations())`):
     - `dropTable refreshes table list on success`
     - `dropTable removes table optimistically when refresh fails`
     - `dropTable handles missing cache key gracefully`
     - `renameTable refreshes table list on success`
     - `renameTable updates table name optimistically when refresh fails`
     - `renameTable handles missing cache key gracefully`
   - 사전 store test (`src/stores/schemaStore.test.ts` lines 440-584) 의 위 6 case 는 **삭제**. 다른 store test case 는 사전 동일 (변경 0).
   - mock 패턴: Sprint 219 `useConnectionMutations.test.ts` verbatim — `vi.hoisted` + `vi.mock("@stores/schemaStore", ...)` + `vi.mock("@lib/tauri", ...)`. 단, hook 이 store 의 setState 를 호출하는 경로를 검증하려면 mock factory 가 selector + setState/getState 를 모두 노출해야 함 (Generator 재량 — `Object.assign((selector) => selector(state), { getState, setState })` 형태).
   - 검증: `pnpm vitest run src/hooks/useSchemaTableMutations.test.ts` exit 0, ≥ 6 cases pass.
   - 검증: `pnpm vitest run src/stores/schemaStore.test.ts` exit 0, 사전 case 수 -6 (다른 case 는 모두 통과).

4. **Caller swap — 1 component.**
   - `src/components/schema/SchemaTree/useSchemaTreeActions.ts` lines 100-101 의 두 줄
     ```ts
     const dropTable = useSchemaStore((s) => s.dropTable);
     const renameTableAction = useSchemaStore((s) => s.renameTable);
     ```
     를 `useSchemaTableMutations()` destructure 로 교체 (예: `const { dropTable, renameTable: renameTableAction } = useSchemaTableMutations();`). 호출 site signature 변경 0 (인자 / return / await 정책 동일).
   - 검증: `grep -nE 'useSchemaStore\(\(s\) => s\.(dropTable|renameTable)\)' src/components/ src/hooks/ -r` 매치 = 0. (단, 새 hook 파일 자체는 매치 0 이거나, 만약 hook 이 selector 로 `dropTable` 을 더 이상 사용하지 않는 패턴이라면 0; 만약 사용한다면 hook 파일 1 매치는 허용 — 하지만 store body 가 비었으므로 hook 이 store action 을 호출할 필요가 없음. 권장: hook 은 `useSchemaStore.setState` 만 사용하고 `tauri.dropTable` / `tauri.renameTable` 을 직접 호출 — 단 이 경우 기존 `SchemaState.dropTable` / `renameTable` interface signature 가 hook 으로 위임된 thin wrapper 가 되어도 OK. Generator 재량.)
   - 검증: `grep -rn 'useSchemaTableMutations' src/` 매치 ≥ 3 (hook 자체 + 1 component import + hook test).

5. **Invariants — `SchemaState` interface + sibling drift = 0.**
   - `SchemaState` interface 의 16 method signature (lines 31-111: `loadSchemas` / `loadTables` / `loadViews` / `loadFunctions` / `getTableColumns` / `getTableIndexes` / `getTableConstraints` / `getViewColumns` / `getViewDefinition` / `queryTableData` / `dropTable` / `executeQuery` / `executeQueryBatch` / `renameTable` / `clearSchema` / `clearForConnection` / `evictSchemaForName` / `prefetchSchemaColumns`) — return type / param type / async 정책 byte-equivalent. (`dropTable` / `renameTable` 은 thin wrapper 로 남거나, hook 이 별도 setState path 를 가지면 store action 자체는 단순 `await tauri.X(...)` 로 줄어들지만 signature 는 동결.)
   - `tables: Record<string, TableInfo[]>` cache shape 동결.
   - 사이블링 drift 0:
     - `git diff --stat src/stores/connectionStore.ts src/stores/connectionStore.test.ts` = 0.
     - `git diff --stat src/hooks/useConnectionLifecycle.ts src/hooks/useConnectionLifecycle.test.ts` = 0.
     - `git diff --stat src/hooks/useConnectionMutations.ts src/hooks/useConnectionMutations.test.ts` = 0.
     - `git diff --stat src/hooks/useSchemaCache.ts src/hooks/useSchemaCache.test.ts` = 0.
     - `git diff --stat src/hooks/useMigrationExport.ts` = 0.
     - `git diff --stat src/lib/tauri.ts src/lib/toast.ts src/lib/session-storage.ts src/lib/zustand-ipc-bridge.ts src/lib/window-label.ts` = 0.
     - `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.

## Global Acceptance Criteria

1. **행동 변경 0** — 모든 input 에 대해 사후 `state.tables[key]` 가 사전과 byte-equivalent. happy-path 에서는 `tauri.listTables` 결과 그대로 (참조 보존). fallback path 에서는 `current.filter((t) => t.name !== table)` (drop) / `current.map((t) => t.name === table ? { ...t, name: newName } : t)` (rename) 결과 동일. cache key 가 없을 때 `state.tables[key] ?? []` → 빈 배열 처리도 동일.

2. **`SchemaState` 16 method signature 동결** — return type / param type / async 정책 모두 byte-equivalent. `dropTable` / `renameTable` 도 `Promise<void>` 계약 유지.

3. **`tables` / `views` / `functions` / `schemas` / `tableColumnsCache` shape 동결** — cache key naming (`${connectionId}:${schema}` / `${connectionId}:${schema}:${table}`) 변경 0.

4. **Tauri command 호출 동결** — `tauri.dropTable(connectionId, table, schema)` / `tauri.renameTable(connectionId, table, schema, newName)` / `tauri.listTables(connectionId, schema)` 호출 횟수 / 인자 / 순서 사전 동일. happy-path: 1× drop/rename + 1× listTables. fallback path: 1× drop/rename + 1× listTables (실패) + 0× extra. cache miss path: 1× drop/rename + 1× listTables (실패) + 0× extra.

5. **Cross-window sync 영향 0** — `connectionStore` 의 `attachZustandIpcBridge` / `SYNCED_KEYS` 변경 0. schemaStore 는 사전과 마찬가지로 IPC bridge 외부 (cache 가 cross-window 동기 대상이 아님). 본 sprint 가 cross-window contract 변경 0.

6. **Project-wide regression bar**:
   - `pnpm vitest run` exit 0. baseline → 사후 file count +2 (hook + hook test). store test case count -6, hook test case count +6 (≥), net delta = 0 (또는 +1 if Generator 가 추가 edge case 케이스 작성).
   - `pnpm tsc --noEmit` exit 0 — 새 `any` 0.
   - `pnpm lint` exit 0.
   - 새 `eslint-disable*` 0. 새 silent `catch{}` 0 (단, 기존 fallback 의 `catch {}` 패턴은 hook 으로 이동 — 신규가 아니라 이동이므로 net 0). `it.only` / `it.skip` 0.

7. **새 useEffect / setInterval / setTimeout / subscribe / window event listener 0** in `useSchemaTableMutations.ts`.

8. **Toast / IPC / session 영향 0** — 본 sprint 는 cache mutation 만 다룬다. `toast.*` 호출 추가/제거 0. `attachZustandIpcBridge` 호출 변경 0. session-storage 호출 (3건: `persistFocusedConnId` / `persistActiveStatuses` / `readConnectionSession`) 변경 0.

9. **P10 후속 step freeze** — step 3 / step 4 영향 범위 (connectionStore session persistence + IPC bridge attach) 사전 동일. `git diff --stat src/stores/connectionStore.ts` = 0.

10. **`useConnectionLifecycle` / `useConnectionMutations` / `useSchemaCache` / `useMigrationExport` 변경 0** — 본 sprint scope 외.

## Components to Create / Modify

### Create

- `src/hooks/useSchemaTableMutations.ts` (신규 hook, ~70 LOC).
  - `export function useSchemaTableMutations()` returning `{ dropTable, renameTable }`.
  - 2 method signature: `dropTable(connectionId, table, schema): Promise<void>` / `renameTable(connectionId, table, schema, newName): Promise<void>`.
  - reload-then-fallback orchestration owned here.
- `src/hooks/useSchemaTableMutations.test.ts` (신규 hook test, ≥ 6 case — 위 6 case 마이그레이션).

### Modify

- `src/stores/schemaStore.ts` (-~55 LOC):
  - `dropTable` 본문: 22 LOC → 1-3 LOC (`await tauri.dropTable(...)` 만).
  - `renameTable` 본문: 24 LOC → 1-3 LOC (`await tauri.renameTable(...)` 만).
  - 다른 14 method body / `clearConnectionEntries` helper / `SchemaState` interface / cache shape 변경 0.
- `src/stores/schemaStore.test.ts` (-~145 LOC):
  - 사전 lines 440-584 의 6 case (`dropTable refreshes...` / `dropTable removes...` / `dropTable handles missing...` / `renameTable refreshes...` / `renameTable updates...` / `renameTable handles missing...`) 삭제.
  - 다른 모든 case 변경 0.
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` (~2 LOC swap):
  - lines 100-101 의 두 selector → `useSchemaTableMutations()` destructure.
  - 다른 라인 변경 0 (다른 11 selector / state / handler 모두 사전 동일).

### Untouched (sibling drift = 0)

- `src/stores/connectionStore.ts` / `src/stores/connectionStore.test.ts` (P10 step 3/4 영역).
- `src/hooks/useConnectionLifecycle.ts` / `src/hooks/useConnectionLifecycle.test.ts`.
- `src/hooks/useConnectionMutations.ts` / `src/hooks/useConnectionMutations.test.ts` (Sprint 219 결과 동결).
- `src/hooks/useSchemaCache.ts` / `src/hooks/useSchemaCache.test.ts`.
- `src/hooks/useMigrationExport.ts`.
- `src/lib/tauri.ts` / `src/lib/toast.ts` / `src/lib/session-storage.ts` / `src/lib/zustand-ipc-bridge.ts` / `src/lib/window-label.ts`.
- `src/__tests__/cross-window-connection-sync.test.tsx` / `src/__tests__/window-lifecycle.ac141.test.tsx`.
- `src/main.tsx` (`hydrateFromSession` 호출 보존).
- `src/components/schema/SchemaTree/treeRows.ts` / `dialogs.ts` / `SchemaTree.tsx` (rendering / dialog logic 변경 0).
- 다른 모든 `src/components/**` (오직 `useSchemaTreeActions.ts` 만 본 sprint scope).

## Data Flow

### Before (current — `dropTable`)

```
useSchemaTreeActions.ts
  └─→ const dropTable = useSchemaStore((s) => s.dropTable)
        └─→ store.dropTable(connectionId, table, schema)
              ├─→ tauri.dropTable(...)                            (1)
              ├─→ try {                                           (2)
              │     tables = await tauri.listTables(...)
              │     set({ tables: { ...state.tables, [key]: tables } })
              │   } catch {
              │     set({ tables: { ...state.tables,              ←── fallback
              │                     [key]: current.filter(...) } })
              │   }
              └─→ resolves Promise<void>
```

### After (target — `dropTable`)

```
useSchemaTreeActions.ts
  └─→ const { dropTable } = useSchemaTableMutations()
        └─→ hook.dropTable(connectionId, table, schema)
              ├─→ await storeDrop(connectionId, table, schema)
              │     └─→ store.dropTable body now ≤ 3 LOC:
              │           └─→ await tauri.dropTable(...)          (1)  ←── store body ends here
              ├─→ try {                                           (2)  ←── hook owns reload
              │     tables = await tauri.listTables(...)
              │     useSchemaStore.setState({ tables: { ...s.tables, [key]: tables } })
              │   } catch {
              │     useSchemaStore.setState({ tables: { ...s.tables,  ←── hook owns fallback
              │                                          [key]: current.filter(...) } })
              │   }
              └─→ resolves Promise<void>
```

### Cache invariant (preserved — byte-equivalent)

```
For all (connectionId, table, schema):
  before:  state.tables[`${connectionId}:${schema}`]
                  = (happy)    listTables(...) result
                  | (fallback) (state.tables[key] ?? []).filter(t => t.name !== table)
  after:   state.tables[`${connectionId}:${schema}`]
                  = (happy)    listTables(...) result            ←── identical reference
                  | (fallback) (state.tables[key] ?? []).filter(t => t.name !== table)
                                                                  ←── byte-equivalent array
```

### Store-action contract preserved

```
store.dropTable / store.renameTable still resolve Promise<void> on tauri success
  → SchemaState interface unchanged
  → any external caller using `useSchemaStore.getState().dropTable(...)` directly
    continues to compile (signature byte-equivalent).
  → cache reload+fallback simply no longer happens in the store path —
    callers that bypass the hook lose only the optimistic refresh
    (acceptable: only `useSchemaTreeActions.ts` calls this; it is migrated).
```

### Cross-window invariant (preserved — out of scope)

```
schemaStore is NOT in attachZustandIpcBridge sync set
  → no IPC broadcast on `tables` mutation (sprint scope unchanged).
  → connectionStore's SYNCED_KEYS (4 keys) unchanged.
```

## Edge Cases

- **`tauri.dropTable` throw** — store action re-throws; hook never enters reload/fallback; `state.tables[key]` 변경 0; caller's `try/catch` (사전 `useSchemaTreeActions.ts` 의 `setIsOperating(false)` finally + error toast) 사전 동일.
- **`tauri.renameTable` throw** — 동일 — re-throw, no cache mutation.
- **`tauri.listTables` throw on reload (drop)** — fallback path: `state.tables[key]` 가 `current.filter((t) => t.name !== table)` 로 patch. cache miss 시 `state.tables[key] ?? []` → `[]` → filter → `[]` 그대로 (사전 동일).
- **`tauri.listTables` throw on reload (rename)** — fallback path: `current.map((t) => t.name === table ? { ...t, name: newName } : t)`. cache miss 시 `[]` → map → `[]` (사전 동일).
- **Missing cache key (`state.tables[key]` undefined)** — both happy-path 과 fallback path 모두 `?? []` 로 방어 (사전 store 코드와 byte-equivalent).
- **Re-entrancy (사용자가 빠르게 두 번 drop 클릭)** — `useSchemaTreeActions.ts` 의 `setIsOperating(true)` flag 가 재진입을 차단 (사전 동일). hook 본문이 `isOperating` 상태를 새로 도입하지 않음 (caller 가 owns).
- **Cache invariant — `state.tables[key]` 배열 참조** — happy-path 에서 새 array 참조 (`tauri.listTables` 결과); fallback path 에서 새 array 참조 (`filter` / `map` 산출물). 사전 코드와 동일하게 reference identity 변경 — downstream selector 의 memo invalidation 사전 동일.
- **Other table cache keys (`${connectionId}:other_schema`)** — drop/rename 이 `${connectionId}:${schema}` 한 key 만 patch. 다른 key 미터치. spread (`...state.tables`) 가 다른 key reference 보존 — 사전 동일.
- **`views` / `functions` / `tableColumnsCache` 미터치** — drop/rename 이 사전부터 이들 cache 를 손대지 않음 (`tableColumnsCache` 의 stale entry 는 사전 코드도 함께 invalidate 하지 않는다는 사실 보존). 사후 동일.
- **Concurrent drop + listTables race** — 사전 코드는 `await tauri.dropTable` → `await tauri.listTables` 순차. 사후 hook 도 `await storeDrop` → `await tauri.listTables` 순차 — race window 동일.
- **Hook unmount mid-await** — caller component (`SchemaTree`) unmount 시점은 `useSchemaTreeActions` 의 lifetime 과 일치. hook 이 새 effect 를 도입하지 않으므로 leak 0. `setState(...)` 는 zustand 외부 진입점이므로 unmount 후 호출되어도 React warn 없음 (사전 store 호출 동작과 동일).
- **store action signature change 금지** — `SchemaState.dropTable` / `renameTable` `Promise<void>` 계약 동결. 외부에서 `useSchemaStore.getState().dropTable(...)` 직접 호출이 사후에도 컴파일 + tauri 호출 동작 — 단 reload+fallback 은 hook 경로에서만 발생 (이는 의도된 책임 이전).
- **mock leakage in hook test** — `vi.hoisted` + factory pattern (`useConnectionMutations.test.ts` verbatim 답습). schemaStore mock 이 selector + `setState` + `getState` 모두 노출하도록 factory 작성 — leakage 0.
- **`SchemaState` interface 16-method count 변경 0** — interface 자체에 method 추가/제거 없음.

## Verification Hints

### Primary regression
```sh
pnpm vitest run \
  src/stores/schemaStore.test.ts \
  src/hooks/useSchemaTableMutations.test.ts \
  src/components/schema/SchemaTree/useSchemaTreeActions.test.tsx \
  src/hooks/useSchemaCache.test.ts
```

### Cross-window / connection 회귀 (sibling 영역 freeze)
```sh
pnpm vitest run \
  src/stores/connectionStore.test.ts \
  src/hooks/useConnectionLifecycle.test.ts \
  src/hooks/useConnectionMutations.test.ts \
  src/__tests__/cross-window-connection-sync.test.tsx \
  src/__tests__/window-lifecycle.ac141.test.tsx
```

### Project-wide
```sh
pnpm vitest run    # exit 0
pnpm tsc --noEmit  # exit 0
pnpm lint          # exit 0
```

### Store body shrink 검증
```sh
git diff --stat src/stores/schemaStore.ts                                            # delta ≥ -50 LOC
grep -nE 'tauri\.listTables' src/stores/schemaStore.ts | wc -l                       # = 1 (loadTables only)
grep -nE 'state\.tables\[key\]' src/stores/schemaStore.ts | wc -l                    # = 0 (drop/rename fallback removed)
grep -nE '^\s*dropTable: async' src/stores/schemaStore.ts                            # = 1 match (still in interface impl)
grep -nE '^\s*renameTable: async' src/stores/schemaStore.ts                          # = 1 match
```

### Hook surface 검증
```sh
test -f src/hooks/useSchemaTableMutations.ts
test -f src/hooks/useSchemaTableMutations.test.ts
grep -nE '^export function useSchemaTableMutations' src/hooks/useSchemaTableMutations.ts  # = 1
grep -rn 'useSchemaTableMutations' src/                                              # ≥ 3 (hook + caller + test)
```

### Caller swap 검증
```sh
grep -rnE 'useSchemaStore\(\(s\) => s\.(dropTable|renameTable)\)' src/components/ src/hooks/  # = 0 (excluding hook impl itself if it doesn't use selector)
grep -n 'useSchemaTableMutations' src/components/schema/SchemaTree/useSchemaTreeActions.ts    # ≥ 1
```

### Store test case migration 검증
```sh
grep -nE 'dropTable refreshes table list on success|dropTable removes table optimistically|dropTable handles missing cache key|renameTable refreshes table list on success|renameTable updates table name optimistically|renameTable handles missing cache key' \
  src/stores/schemaStore.test.ts | wc -l                                             # = 0 (all 6 migrated)
grep -nE 'dropTable refreshes table list on success|dropTable removes table optimistically|dropTable handles missing cache key|renameTable refreshes table list on success|renameTable updates table name optimistically|renameTable handles missing cache key' \
  src/hooks/useSchemaTableMutations.test.ts | wc -l                                  # ≥ 6
```

### `SchemaState` interface 동결
```sh
grep -nE '^\s*(loadSchemas|loadTables|loadViews|loadFunctions|getTableColumns|getTableIndexes|getTableConstraints|getViewColumns|getViewDefinition|queryTableData|dropTable|executeQuery|executeQueryBatch|renameTable|clearSchema|clearForConnection|evictSchemaForName|prefetchSchemaColumns):' \
  src/stores/schemaStore.ts | wc -l                                                  # 사전과 동일 (interface signatures preserved)
```

### Out-of-scope freeze (P10 후속 step + sibling)
```sh
git diff --stat src/stores/connectionStore.ts src/stores/connectionStore.test.ts     # 0
git diff --stat src/hooks/useConnectionLifecycle.ts src/hooks/useConnectionLifecycle.test.ts \
                src/hooks/useConnectionMutations.ts src/hooks/useConnectionMutations.test.ts \
                src/hooks/useSchemaCache.ts src/hooks/useSchemaCache.test.ts \
                src/hooks/useMigrationExport.ts                                      # 모두 0
git diff --stat src/lib/tauri.ts src/lib/toast.ts src/lib/session-storage.ts \
                src/lib/zustand-ipc-bridge.ts src/lib/window-label.ts                # 모두 0
git diff --stat src/__tests__/cross-window-connection-sync.test.tsx \
                src/__tests__/window-lifecycle.ac141.test.tsx                        # 모두 0
```

### 행동 변경 0 의 마지막 증거
```sh
# Store test still passes (minus the 6 migrated cases) — the 14 remaining
# actions' behaviour is byte-equivalent because their bodies are untouched.
pnpm vitest run src/stores/schemaStore.test.ts                                       # exit 0
# Hook test asserts the migrated 6 cases under renderHook with byte-equivalent
# input/output expectations (same listTables mock results, same final
# state.tables[key] arrays).
pnpm vitest run src/hooks/useSchemaTableMutations.test.ts                            # exit 0
```

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/stores/schemaStore.ts
- /Users/felix/Desktop/study/view-table/src/stores/schemaStore.test.ts
- /Users/felix/Desktop/study/view-table/src/hooks/useConnectionMutations.ts
- /Users/felix/Desktop/study/view-table/src/hooks/useConnectionMutations.test.ts
- /Users/felix/Desktop/study/view-table/src/components/schema/SchemaTree/useSchemaTreeActions.ts
