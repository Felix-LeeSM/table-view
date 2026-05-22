# Feature Spec: connectionStore mutation-toast extraction (Sprint 219 — P10 step 1)

## Description

`src/stores/connectionStore.ts` (329 lines) 는 Zustand state transition + cache mutation 외에도 Tauri call orchestration / user-facing toast notification / session-scoped localStorage persistence / cross-window IPC bridge attach 를 한 모듈에서 동시에 소유한다 (`docs/archives/backlogs/refactoring-candidates-2026-05-06.md` § P10). 이로 인해 store unit test 가 API orchestration 과 UI notification policy 를 같이 검증하게 되고, hook-level orchestration (`useConnectionLifecycle`) 과 store-level side-effect 의 경계가 일관적이지 않다.

본 sprint 는 P10 candidate 의 **first step** — risk 높음 candidate 에서 가장 좁은 한 흐름만 이동. § P10 의 명시적 권고 ("한 번에 전체 store architecture 를 바꾸지 말고 connection lifecycle 한 흐름씩 이동") 를 따른다. 이번 step 의 narrow scope 는 `connectionStore` 의 **mutation 3 action (`addConnection` / `updateConnection` / `removeConnection`) 의 `toast.success(...)` 호출 1개씩, 합 3개**를 use-case hook (`useConnectionMutations`) 으로 이동.

후속 P10 step 은 별도 sprint candidate (Sprint 223+ 후보):
- step 2 — schemaStore 의 optimistic refresh fallback (`dropTable` / `renameTable` 의 `try { reload } catch { fallback }` 패턴) → use-case hook.
- step 3 — connectionStore 의 session persistence (`persistFocusedConnId` / `persistActiveStatuses` / `hydrateFromSession`) → use-case hook (cross-window sync 와 IPC bridge 영향 분석 필요 — 본 sprint 와 분리).
- step 4 — connectionStore 의 `attachZustandIpcBridge` 모듈-load attach 를 entry module 로 분리 (가장 위험, 마지막).

행동 변경 0 강제. UI surface / public Zustand action signature / toast text byte-equivalent / IPC behavior / cross-window sync (`SYNCED_KEYS` 4 key 동결) 모두 사전 동일. `attachZustandIpcBridge` 모듈-load attach 줄 변경 0. session-storage 호출 줄 (3건) 변경 0. event listener (`initEventListeners`) 변경 0.

## Sprint Breakdown

### Sprint 219: connectionStore mutation-toast extraction

**Goal**: `connectionStore.ts` 의 `addConnection` / `updateConnection` / `removeConnection` 3 action 본문에서 `toast.success(...)` 호출 (각 1건, 총 3건) 을 신규 use-case hook `useConnectionMutations` 으로 이동. component (ConnectionDialog / ConnectionItem) 은 store action 대신 hook 의 wrapped action 을 호출. store 본문은 toast import + 3 toast 호출 + (removeConnection 의 toast 용 `removed` lookup 1건 — 호출 위치만 hook 으로 이동) 만큼 축소. 행동 변경 0 — 사용자 관점 toast text / 호출 시점 / 호출 횟수 / cross-window 동작 모두 사전 동일.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. **store 본문 축소.**
   - `src/stores/connectionStore.ts` 에서 `import { toast } from "@lib/toast";` 제거 (store 가 toast 의존성 0).
   - `addConnection` 본문: ``toast.success(`Connection "${saved.name}" added.`);`` 1줄 제거. action 은 `saved` 만 return.
   - `updateConnection` 본문: ``toast.success(`Connection "${saved.name}" updated.`);`` 1줄 제거.
   - `removeConnection` 본문: ``toast.success(removed ? ... : "Connection removed.");`` 1줄 제거. `removed` lookup (`get().connections.find((c) => c.id === id);`) 도 toast 전용이므로 함께 제거 가능 (선택). hook 이 `removeConnection` 호출 전 자체적으로 name 을 lookup 하거나 component 에서 connection 객체를 hook 에 넘기는 변종 허용.
   - 검증: `grep -c 'toast' src/stores/connectionStore.ts` = 0.
   - 검증: `git diff --stat src/stores/connectionStore.ts` 의 `-` count ≥ 4 (1 import + 3 toast call). store body 의 다른 줄 변경 0.
   - **금지**: store 본문에서 `set(...)` / `tauri.*` / `persistActiveStatuses` / `persistFocusedConnId` / `attachZustandIpcBridge` / `listen` / `SYNCED_KEYS` / `pickFallbackFocus` / focus fallback 분기 / `connecting` 상태 seed / activeDb seed / IPC bridge attach / `initEventListeners` 변경.

2. **신규 hook 파일.**
   - 신규: `src/hooks/useConnectionMutations.ts`.
   - export shape: `export function useConnectionMutations(): { addConnection, updateConnection, removeConnection }` — 3 method signature 가 store action signature 와 byte-equivalent.
     - `addConnection(draft: ConnectionDraft): Promise<ConnectionConfig>` — wrapped: `await storeAdd(draft)` → on success ``toast.success(`Connection "${saved.name}" added.`)`` → return saved. throw 시 toast 없음.
     - `updateConnection(draft: ConnectionDraft): Promise<void>` — wrapped: `await storeUpdate(draft)` → on success ``toast.success(`Connection "${draft.name}" updated.`)``. (현재는 store 가 saved.name 을 사용하지만 store mock 이 echo 하므로 byte-equivalent. Generator 재량으로 hook 이 saved 를 받지 못하면 draft.name 사용 — 문구 byte-equivalent.)
     - `removeConnection(id: string): Promise<void>` — wrapped: name lookup (state 에서) → `await storeRemove(id)` → on success ``toast.success(removed ? `Connection "${name}" removed.` : "Connection removed.")``. throw 시 toast 없음.
   - hook 은 `useConnectionStore((s) => s.addConnection)` / `updateConnection` / `removeConnection` 3 selector 호출 + `useCallback` 으로 wrap.
   - hook 은 새 useEffect / setInterval / setTimeout / subscribe / window event listener 0건. **순수 wrapping** — orchestration only.
   - hook 은 `useConnectionLifecycle.ts` 의 패턴 답습.

3. **3 component call site 갱신.**
   - `src/components/connection/ConnectionDialog.tsx`: `useConnectionStore((s) => s.addConnection)` / `useConnectionStore((s) => s.updateConnection)` 두 줄을 `useConnectionMutations()` 의 destructure 로 교체. 호출 site signature 변경 0.
   - `src/components/connection/ConnectionItem.tsx`: `useConnectionStore((s) => s.removeConnection)` 한 줄을 `useConnectionMutations()` 의 destructure 로 교체. 호출 site signature 변경 0.
   - 검증: `grep -rn "useConnectionStore((s) => s\.\(addConnection\|updateConnection\|removeConnection\))" src/components/ src/hooks/` = 0.
   - 검증: `grep -rn "useConnectionMutations" src/` 매치 ≥ 4 (hook 자체 + 2 component import + hook test).

4. **신규 hook test.**
   - 신규: `src/hooks/useConnectionMutations.test.ts`.
   - vitest + `renderHook` (existing `useConnectionLifecycle.test.ts` 패턴 답습).
   - 최소 5 case 권고:
     - `addConnection on success calls toast.success with byte-equivalent text 'Connection "<name>" added.'`
     - `updateConnection on success calls toast.success with byte-equivalent text 'Connection "<name>" updated.'`
     - `removeConnection on success with resolved name calls toast.success with 'Connection "<name>" removed.'`
     - `removeConnection on success with unresolvable name (connection already gone from state) calls toast.success with fallback "Connection removed."`
     - `addConnection on store throw does not call toast` (re-throw 보존 / toast 0 호출).
   - mock 패턴: `vi.hoisted` + `vi.mock("@stores/connectionStore", ...)` + `vi.mock("@lib/toast", ...)`.

5. **store test 변경 0 — 행동 변경 0 의 1차 증거.**
   - `src/stores/connectionStore.test.ts` (사전 case 수 보존). `git diff --stat src/stores/connectionStore.test.ts` = 0.
   - 사전 모든 case 사후 통과 (`pnpm vitest run src/stores/connectionStore.test.ts` exit 0).
   - 사전 store test 가 toast 를 assert 하지 않으므로 store action signature (return type / throw 정책) 만 보존하면 통과. Generator 는 store action 의 return / throw 정책 변경 금지.

## Global Acceptance Criteria

1. **행동 변경 0** — toast text / 시점 / 횟수 / cross-window 동작 / IPC bridge / session persistence 모두 사전 동일. UI surface (component DOM / aria / DialogFooter / Sidebar event) 변경 0.

2. **store public API 신호 동결**:
   - `ConnectionState` interface 의 method signature (loadConnections / loadGroups / addConnection / updateConnection / removeConnection / testConnection / connectToDatabase / disconnectFromDatabase / setFocusedConn / hydrateFromSession / setActiveDb / addGroup / updateGroup / removeGroup / moveConnectionToGroup / initEventListeners) 변경 0. return type / param type / throw 정책 변경 0.
   - `SYNCED_KEYS` 4 key (connections / groups / activeStatuses / focusedConnId) 변경 0. AC-152-04 regression test 사후 통과.

3. **session-storage 호출 줄 보존** — `persistFocusedConnId` (`setFocusedConn` 안), `persistActiveStatuses` (`connectToDatabase` 성공 path + `disconnectFromDatabase`), `readConnectionSession` (`hydrateFromSession`) 3 호출 site 모두 사전 byte-equivalent.

4. **IPC bridge attach 보존** — module-load `attachZustandIpcBridge<ConnectionState>(useConnectionStore, { channel, syncKeys, originId })` 호출 변경 0. event listener (`initEventListeners` body) 변경 0.

5. **Cross-window sync 회귀 0** — `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` exit 0.

6. **toast text byte-equivalent**:
   - `Connection "${name}" added.`
   - `Connection "${name}" updated.`
   - `Connection "${name}" removed.`
   - `Connection removed.` (fallback when name unresolvable).
   - `grep -F` 로 4 텍스트 모두 hook 또는 hook test 에 정확히 1+ 매치.

7. **Project-wide regression bar**:
   - `pnpm vitest run` exit 0. 사전 baseline → 사후 file count +2 (hook + hook test, 옵션 store test 변경 0). tests delta ≥ +5 (신규 hook test cases).
   - `pnpm tsc --noEmit` exit 0 — 새 `any` 0.
   - `pnpm lint` exit 0.
   - 새 `eslint-disable*` 0. 새 silent `catch{}` 0. `it.only` / `it.skip` 0.

8. **`useConnectionLifecycle` 변경 0** — 본 sprint scope 외. `git diff --stat src/hooks/useConnectionLifecycle.ts src/hooks/useConnectionLifecycle.test.ts` = 0.

9. **`useSchemaCache` / `useMigrationExport` / `schemaStore` 변경 0** — 본 sprint 는 connectionStore 만 (P10 step 1 narrow scope). `git diff --stat src/stores/schemaStore.ts src/hooks/useSchemaCache.ts src/hooks/useMigrationExport.ts` = 0.

10. **toast lib 변경 0** — `src/lib/toast.ts` 변경 0.

## Components to Create/Modify

### Create

- `src/hooks/useConnectionMutations.ts` (신규 hook, ~50 LOC).
- `src/hooks/useConnectionMutations.test.ts` (신규 hook test, ≥ 5 case).

### Modify

- `src/stores/connectionStore.ts` (-4 ~ -6 LOC):
  - `import { toast } from "@lib/toast";` 제거.
  - `addConnection` 의 toast 호출 1줄 제거.
  - `updateConnection` 의 toast 호출 1줄 제거.
  - `removeConnection` 의 toast 호출 1줄 제거.
  - 선택: toast 전용 `removed` lookup 제거 (사후 미참조).
- `src/components/connection/ConnectionDialog.tsx` (~2 LOC swap): 2 selector → `useConnectionMutations()`.
- `src/components/connection/ConnectionItem.tsx` (~1 LOC swap): 1 selector → `useConnectionMutations()`.

### Untouched (sibling drift = 0)

- `src/stores/schemaStore.ts` / `src/stores/schemaStore.test.ts`.
- `src/hooks/useConnectionLifecycle.ts` / `useConnectionLifecycle.test.ts`.
- `src/hooks/useSchemaCache.ts` / `useSchemaCache.test.ts`.
- `src/hooks/useMigrationExport.ts`.
- `src/lib/session-storage.ts` / `src/lib/zustand-ipc-bridge.ts` / `src/lib/window-label.ts` / `src/lib/toast.ts`.
- `src/__tests__/cross-window-connection-sync.test.tsx` / `src/__tests__/window-lifecycle.ac141.test.tsx`.
- `src/main.tsx` (사전 `useConnectionStore.getState().hydrateFromSession()` 호출 보존).

## Data Flow

### Before (current)

```
component (ConnectionDialog / ConnectionItem)
  └─→ useConnectionStore((s) => s.addConnection|updateConnection|removeConnection)
        └─→ store action body
              ├─→ tauri.saveConnection / deleteConnection / disconnectFromDatabase
              ├─→ set(...) — state mutation
              └─→ toast.success(...)            ←── side effect entangled in store
```

### After (target)

```
component (ConnectionDialog / ConnectionItem)
  └─→ useConnectionMutations()
        ├─→ useConnectionStore((s) => s.addConnection|updateConnection|removeConnection)
        │     └─→ store action body (now slimmer)
        │           ├─→ tauri.saveConnection / deleteConnection / disconnectFromDatabase
        │           └─→ set(...) — state mutation
        └─→ on resolve: toast.success(...)      ←── side effect now in use-case layer
```

### Cross-window invariant (preserved)

```
window A: user clicks "Add" in ConnectionDialog
  └─→ useConnectionMutations.addConnection()
        ├─→ store action mutates `connections`
        ├─→ attachZustandIpcBridge broadcasts on `connection-sync`
        └─→ toast.success on window A only

window B: receives bridge event
  └─→ store state updated (connections array synced)
  └─→ NO useConnectionMutations.addConnection() call → NO toast        ←── byte-equivalent
```

### Session persistence invariant (preserved — out of scope)

```
setFocusedConn / connectToDatabase success / disconnectFromDatabase
  └─→ persistFocusedConnId | persistActiveStatuses     ←── all 3 call sites unchanged
```

## UI States

본 sprint 는 UI 변경 0 (DOM / aria / styling). UI state 사전 동일:

- **Loading**: ConnectionDialog 의 `setSaving(true)` flag 사전 동일.
- **Empty**: 해당 없음 (mutation flow).
- **Error**: ConnectionDialog 의 `setError(sanitizeMessage(...))` 분기 사전 동일. store action throw → component catch → setError. hook layer 의 toast 는 success path 에서만.
- **Success**: toast.success 한 번 + ConnectionDialog 의 `onClose()` + Sidebar 의 `connection-added` window event. 모두 사전 동일.

## Edge Cases

- **store action throw (Tauri 실패)**: store action throw → hook propagate, `toast.success` 호출 없음. ConnectionDialog 의 `try/catch (e) { setError(sanitizeMessage(...)) }` 분기 사전 동일.
- **`removeConnection` 의 name fallback**: `removed = get().connections.find((c) => c.id === id)` — undefined 시 toast text "Connection removed." (no name). hook 은 동일 lookup 을 store action 호출 전에 수행 (snapshot). 또는 component 에서 `connection.name` 을 hook 에 넘기는 변종 허용. Generator 재량 — 핵심은 fallback string 의 byte-equivalence.
- **cross-window race — window B 가 bridge 로 동일 connection 을 받음**: window B 의 `useConnectionMutations` 호출 0 → window B toast 0 (사전 동일).
- **재진입 (사용자가 빠르게 두 번 Save 클릭)**: ConnectionDialog 의 `setSaving(true)` 가 두 번째 클릭 차단. 사전 동일.
- **bridge attach 시점 의존**: 사전 module-load attach. hook 추가가 module-load timing 변경 0.
- **`hydrateFromSession` race**: main.tsx 의 호출 사전 동일. 사후 hook 추가는 hydrate timing 영향 0.
- **store action signature change 금지**: 사전 signature 동결. hook 의 wrapped method signature 동일.
- **mock leakage in hook test**: `vi.hoisted` + `vi.mock("@stores/connectionStore", ...)` + `vi.mock("@lib/toast", ...)` (`useConnectionLifecycle.test.ts` 답습) — leakage 0.
- **toast text 의 따옴표 escape**: 사전 backtick template literal — sustitute byte-equivalent. ESLint quotes 룰 준수.
- **store test 의 toast assertion 0 사실 확인**: `grep -n 'toast' src/stores/connectionStore.test.ts` = 0 매치 사전 사실. 사후 store test 변경 0 → 모든 사전 case 통과.
- **localStorage write timing**: 본 sprint 는 session-storage 줄 변경 0 — Sprint 152 의 timing 회귀 0.
- **`it.only` / `it.skip` 잔존 금지**: 사전 0 → 사후 0.
- **새 `any`**: hook 은 store selector return type 그대로 활용 → 새 `any` 0.

## Verification Hints

### Primary regression
```sh
pnpm vitest run src/stores/connectionStore.test.ts \
                src/stores/schemaStore.test.ts \
                src/hooks/useConnectionLifecycle.test.ts \
                src/hooks/useSchemaCache.test.ts \
                src/hooks/useConnectionMutations.test.ts
```

### Cross-window 회귀
```sh
pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx \
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
grep -c '^import.*toast' src/stores/connectionStore.ts  # 0
grep -nE 'toast\.(success|error|info|warning)' src/stores/connectionStore.ts  # 0 매치
git diff --stat src/stores/connectionStore.ts  # ≥ -4 LOC
```

### Hook surface 검증
```sh
test -f src/hooks/useConnectionMutations.ts
test -f src/hooks/useConnectionMutations.test.ts
grep -nE '^export function useConnectionMutations' src/hooks/useConnectionMutations.ts  # = 1
grep -rn 'useConnectionMutations' src/components/connection/ConnectionDialog.tsx  # ≥ 1
grep -rn 'useConnectionMutations' src/components/connection/ConnectionItem.tsx    # ≥ 1
```

### Component import swap 검증
```sh
grep -rn 'useConnectionStore((s) => s\.\(addConnection\|updateConnection\|removeConnection\))' \
  src/components/ src/hooks/ | wc -l  # = 0
```

### Toast text byte-equivalent 검증
```sh
grep -F '" added.' src/hooks/useConnectionMutations.ts                # ≥ 1
grep -F '" updated.' src/hooks/useConnectionMutations.ts              # ≥ 1
grep -F '" removed.' src/hooks/useConnectionMutations.ts              # ≥ 1
grep -F '"Connection removed."' src/hooks/useConnectionMutations.ts   # ≥ 1 (fallback)
```

### SYNCED_KEYS / IPC bridge / session-storage 동결
```sh
grep -nE 'SYNCED_KEYS' src/stores/connectionStore.ts                  # 사전과 동일
grep -nE 'attachZustandIpcBridge' src/stores/connectionStore.ts       # 사전과 동일
grep -nE 'persistFocusedConnId|persistActiveStatuses|readConnectionSession' \
  src/stores/connectionStore.ts                                       # 사전과 동일 (1 import + 3 call)
git diff --stat src/lib/session-storage.ts src/lib/zustand-ipc-bridge.ts \
                src/lib/toast.ts src/lib/window-label.ts              # 모두 0
```

### Out-of-scope freeze (P10 후속 step 보호)
```sh
git diff --stat src/stores/schemaStore.ts                             # 0
git diff --stat src/hooks/useConnectionLifecycle.ts \
                src/hooks/useConnectionLifecycle.test.ts \
                src/hooks/useSchemaCache.ts \
                src/hooks/useSchemaCache.test.ts \
                src/hooks/useMigrationExport.ts                       # 모두 0
```

### Behavior 변경 0 의 마지막 증거 (store test 동결)
```sh
git diff --stat src/stores/connectionStore.test.ts                    # 0
git diff --stat src/stores/schemaStore.test.ts                        # 0
```

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/stores/connectionStore.ts
- /Users/felix/Desktop/study/view-table/src/hooks/useConnectionLifecycle.ts
- /Users/felix/Desktop/study/view-table/src/hooks/useConnectionLifecycle.test.ts
- /Users/felix/Desktop/study/view-table/src/components/connection/ConnectionDialog.tsx
- /Users/felix/Desktop/study/view-table/src/components/connection/ConnectionItem.tsx
