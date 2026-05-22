# Feature Spec: connectionStore hydrateFromSession extraction (Sprint 224 — P10 step 3a)

## Description

`src/stores/connectionStore.ts` 의 `hydrateFromSession` action (lines 225-237) 은 boot 시점 (`src/main.tsx:47`) 과 window-focus 시점 (`src/hooks/useWindowFocusHydration.ts:30`) 양쪽에서 호출되어 session-scoped localStorage 에서 `focusedConnId` / `activeStatuses` 를 store 로 복원한다 (`docs/archives/backlogs/refactoring-candidates-2026-05-06.md` § P10 step 3). 이 action 은 store 본문에서 `readConnectionSession()` 입력 검증 + partial-patch 빌드 + `set(patch)` 적용 — read-only side-effect 한 흐름을 store 가 직접 소유한다. P10 candidate 의 step 1 (Sprint 219, `useConnectionMutations`, evaluator 9.20/10) 과 step 2 (Sprint 223, `useSchemaTableMutations`, evaluator 8.35/10) 의 narrow-scope hook-extraction pattern 을 그대로 답습한다.

본 sprint 는 P10 step 3 의 **3a (read-only path 만)** 를 분리해서 좁힌다. step 3 의 4 session site 중 `hydrateFromSession` (read-only) 만 본 sprint scope 이고, 나머지 3 persist site (`persistFocusedConnId` in `setFocusedConn` / `persistActiveStatuses` in `connectToDatabase` / `persistActiveStatuses` in `disconnectFromDatabase`) 는 **step 3b 별도 sprint (Sprint 225+ 후보) 로 분리** — store action body 안에서 `attachZustandIpcBridge` SYNCED_KEYS broadcast 와 함께 발생하는 ordering invariant 가 hook 추출 시 risk 가 매우 높고, 5 callers update + Sprint 219 freeze 영역 (`useConnectionLifecycle`) 과 충돌하기 때문이다. 본 sprint 의 read-only `hydrateFromSession` 은 cross-window broadcast / IPC bridge ordering 과 무관 — risk 가 낮고 callers 가 2 곳뿐이다.

행동 변경 0 강제. 사용자 관점 boot 시 hydrate 결과 (`focusedConnId` / `activeStatuses` 의 사후 상태) / window-focus 시 hydrate 결과 / `ConnectionState` 16-method signature / SYNCED_KEYS 4 key / `attachZustandIpcBridge` module-load attach / Tauri command 호출 / cross-window sync / persist 3 site 동작 모두 사전 동일. P10 후속 step 3b (persist 3 site 추출) 와 step 4 (`attachZustandIpcBridge` module-load attach 분리) 영향 범위에는 손대지 않는다.

## Sprint Breakdown

### Sprint 224: connectionStore hydrateFromSession extraction (read-only path only)

**Goal**: `connectionStore.ts` 의 `hydrateFromSession` action (lines 225-237, 13 LOC) 본문에서 `readConnectionSession()` 호출 + partial-patch 빌드 + `set(patch)` orchestration 을 신규 use-case module 로 이동. 두 export 분리 — `hydrateConnectionSession` (plain function, React tree 외부 boot 시점 + window-focus 시점에서 직접 호출) + `useConnectionSessionHydration` (React hook wrap, 사용처가 hook context 일 때 사용 가능). store action 본문은 `hydrateConnectionSession()` 호출 1 줄 (≤ 2 LOC) 까지 축소되거나, store action 자체가 thin proxy 로 남는다 (interface signature 동결 위해). 2 callers (`src/main.tsx:47` / `src/hooks/useWindowFocusHydration.ts:30`) 는 store getter 대신 신규 plain function 을 직접 호출. boot 시점 / window-focus 시점 두 entry point 의 결과는 모든 input 에 대해 사전 코드와 byte-equivalent.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. **Store body shrink — `hydrateFromSession` 본문 축소.**
   - `src/stores/connectionStore.ts` 의 `hydrateFromSession` 본문은 `hydrateConnectionSession()` (혹은 동등한 신규 plain function) 호출 1 줄로 축소되거나, action 자체가 신규 module 의 export 를 호출하는 thin proxy 가 된다. `readConnectionSession` 호출 + `patch` 객체 빌드 + `if (Object.keys(patch).length > 0) set(patch)` 분기 전체 store 본문 밖으로 이동.
   - 검증: `git diff --stat src/stores/connectionStore.ts` 의 `-` count ≥ 10 (rough estimate; ~13 LOC 가 본문에서 제거).
   - 검증: store 가 더 이상 `hydrateFromSession` 경로에서 `readConnectionSession` 을 직접 호출하지 않는다면 `grep -nE '\breadConnectionSession\b' src/stores/connectionStore.ts | wc -l` 매치 = 0 (Generator 가 hook/module 로 import 이동 시). 만약 store action 이 thin proxy 로 plain function 을 호출하고 plain function 이 `readConnectionSession` 을 소유한다면 import 도 이동 — store 의 import block 에서 `readConnectionSession` 사라짐 허용. (Generator 재량.)
   - 검증: store 본문 안의 `Pick<ConnectionState, "focusedConnId" | "activeStatuses">` literal 매치 = 0 (partial-patch 빌드가 module 로 이동했으므로).
   - **금지**: store 본문에서 다른 15 action (`loadConnections` / `loadGroups` / `addConnection` / `updateConnection` / `removeConnection` / `testConnection` / `connectToDatabase` / `disconnectFromDatabase` / `setFocusedConn` / `setActiveDb` / `addGroup` / `updateGroup` / `removeGroup` / `moveConnectionToGroup` / `initEventListeners`) 변경. `pickFallbackFocus` helper 변경. `SYNCED_KEYS` 4 key 변경. `attachZustandIpcBridge` module-load attach (lines 311-318) 변경. `ConnectionState` interface 16 method signature 변경. **CRITICAL**: persist 3 call site — `connectToDatabase` body 의 `persistActiveStatuses(get().activeStatuses)` (line 198) / `disconnectFromDatabase` body 의 `persistActiveStatuses(get().activeStatuses)` (line 217) / `setFocusedConn` body 의 `persistFocusedConnId(id)` (line 222) — byte-equivalent.

2. **신규 module 파일 + named exports.**
   - 신규: `src/hooks/useConnectionSessionHydration.ts` (~30-50 LOC).
   - export shape — 두 export 분리 (Option C):
     - `export function hydrateConnectionSession(): void` — plain function, React tree 외부 (boot path / `main.tsx`) 와 React hook context 외부에서 직접 호출 가능. 본문은 `readConnectionSession()` 호출 + partial-patch 빌드 + `useConnectionStore.setState(patch)` (외부 진입점 사용) 또는 `useConnectionStore.getState().<thin store action>()` 호출. 호출 시점 `focusedConnId` / `activeStatuses` 의 사후 상태가 사전 store action 호출 결과와 byte-equivalent.
     - `export function useConnectionSessionHydration(): { hydrateFromSession: () => void }` — React hook wrap. `useCallback(() => hydrateConnectionSession(), [])` 형태로 stable identity 제공. 본 sprint 의 caller 는 plain function 만 호출하므로 hook export 는 future-use 용이지만 **테스트 가능해야 함**. (Generator 가 hook 을 단일 export 로 통합하고 싶다면 Option A — `useCallback` 으로 wrap, 단 main.tsx 는 별도 plain helper 사용 — 도 OK. 단 main.tsx 가 React tree 외부에서 호출하므로 plain function entry point 는 반드시 존재해야 함.)
   - module 은 새 useEffect / setInterval / setTimeout / subscribe / window event listener 0 건. **순수 read-only orchestration**.
   - module 은 Sprint 219 의 `useConnectionMutations.ts` + Sprint 223 의 `useSchemaTableMutations.ts` 패턴 답습 (selector / setState 외부 진입점 + useCallback).
   - 검증: `test -f src/hooks/useConnectionSessionHydration.ts` exit 0.
   - 검증: `grep -nE '^export function hydrateConnectionSession' src/hooks/useConnectionSessionHydration.ts` 매치 = 1.
   - 검증: `grep -nE '^export function useConnectionSessionHydration' src/hooks/useConnectionSessionHydration.ts` 매치 ≥ 0 (Generator 재량 — Option C 권장이므로 = 1 권장).

3. **신규 module test — 2 case migration from store test.**
   - 신규: `src/hooks/useConnectionSessionHydration.test.ts` (≥ 2 case).
   - 다음 2 case 가 module test 에 마이그레이션 (assertion logic 동일, mount 만 `useConnectionStore.getState().hydrateFromSession()` → `hydrateConnectionSession()` plain function 호출 또는 `renderHook(() => useConnectionSessionHydration()).result.current.hydrateFromSession()`):
     - `hydrateFromSession restores focusedConnId and activeStatuses` (사전 `src/stores/connectionStore.test.ts:950`)
     - `hydrateFromSession is a no-op when session is empty` (사전 `src/stores/connectionStore.test.ts:973`)
   - 사전 store test 의 위 2 case 는 **삭제**. 다른 store test case 는 사전 동일 (변경 0). 특히 `mockPersistFocusedConnId` / `mockPersistActiveStatuses` 사용 case 는 절대 변경하지 않음 — persist 3 site 동결.
   - mock 패턴: Sprint 219 / 223 verbatim — `vi.hoisted` + `vi.mock("@stores/connectionStore", ...)` + `vi.mock("@lib/session-storage", ...)`. `mockReadConnectionSession` 만 사용 (사전 store test 와 동일). store mock factory 는 `setState` / `getState` 노출 (module 이 외부 진입점으로 호출).
   - 검증: `pnpm vitest run src/hooks/useConnectionSessionHydration.test.ts` exit 0, ≥ 2 cases pass.
   - 검증: `pnpm vitest run src/stores/connectionStore.test.ts` exit 0, 사전 case 수 -2 (다른 case 는 모두 통과).
   - 검증: `grep -nE 'hydrateFromSession restores focusedConnId|hydrateFromSession is a no-op when session is empty' src/stores/connectionStore.test.ts | wc -l` = 0.
   - 검증: `grep -nE 'hydrateFromSession restores focusedConnId|hydrateFromSession is a no-op when session is empty' src/hooks/useConnectionSessionHydration.test.ts | wc -l` ≥ 2.

4. **Caller swap — 2 sites.**
   - `src/main.tsx:47` 의 `useConnectionStore.getState().hydrateFromSession();` 를 `hydrateConnectionSession();` 직접 호출로 교체. (React tree 외부 boot path — hook 으로 wrap 불가, plain function 사용 필수.)
   - `src/hooks/useWindowFocusHydration.ts:30` 의 `useConnectionStore.getState().hydrateFromSession();` 를 `hydrateConnectionSession();` 직접 호출 또는 `useConnectionSessionHydration()` hook destructure 후 `hydrateFromSession()` 호출로 교체. **단 inner `hydrate` 함수는 `useEffect` 안에서 `addEventListener`/`removeEventListener` 와 함께 동작하므로** plain function 호출이 더 직관적 (Generator 재량).
   - 두 caller 모두 `prevConnId` / `newConnId` snapshot 패턴 (window-focus hydration) 의 stale-tab clear 로직은 사전 동일 (라인 33-42 byte-equivalent — `useTabStore` / `clearTabsForConnection` 호출 변경 0).
   - 검증: `grep -rnE 'useConnectionStore\.getState\(\)\.hydrateFromSession\(\)' src/` 매치 = 0 (단, store action 자체의 thin proxy 가 internal 로 호출하는 경우 — Generator 가 hook bypass 패턴 선택 시 — 0 유지; store action body 가 plain function 을 호출하는 경우도 grep pattern 이 동일하므로 0).
   - 검증: `grep -rn 'hydrateConnectionSession\b' src/` 매치 ≥ 3 (module impl + main.tsx + useWindowFocusHydration.ts).
   - 검증: `grep -rn 'useConnectionSessionHydration\b' src/` 매치 ≥ 2 (module impl + module test; component caller 가 hook 을 사용한 경우 ≥ 3).

5. **Invariants — `ConnectionState` interface + persist 3 site + sibling drift = 0.**
   - `ConnectionState` interface 의 16 method signature (lines 32-61: `loadConnections` / `loadGroups` / `addConnection` / `updateConnection` / `removeConnection` / `testConnection` / `connectToDatabase` / `disconnectFromDatabase` / `setFocusedConn` / `hydrateFromSession` / `setActiveDb` / `addGroup` / `updateGroup` / `removeGroup` / `moveConnectionToGroup` / `initEventListeners`) — return type / param type / async 정책 byte-equivalent. 특히 `hydrateFromSession: () => void` (line 45) — interface 에 method 가 남아있음 (제거 금지) — store action 자체는 thin proxy 가 되거나 본문이 신규 plain function 을 호출하는 형태로 보존.
   - **CRITICAL FREEZE**: persist 3 call site byte-equivalent —
     - `connectToDatabase` body (line 198): `persistActiveStatuses(get().activeStatuses);`
     - `disconnectFromDatabase` body (line 217): `persistActiveStatuses(get().activeStatuses);`
     - `setFocusedConn` body (line 222): `persistFocusedConnId(id);`
   - **CRITICAL FREEZE**: `attachZustandIpcBridge` module-load attach (lines 311-318) — `channel: "connection-sync"`, `syncKeys: SYNCED_KEYS`, `originId: getCurrentWindowLabel() ?? "test"` 모두 byte-equivalent.
   - **CRITICAL FREEZE**: `SYNCED_KEYS` 4 key 배열 (lines 90-95) — `["connections", "groups", "activeStatuses", "focusedConnId"]` byte-equivalent.
   - 사이블링 drift 0 (P10-out-of-scope files):
     - `git diff --stat src/hooks/useConnectionMutations.ts src/hooks/useConnectionMutations.test.ts` = 0 (Sprint 219 결과 동결).
     - `git diff --stat src/hooks/useConnectionLifecycle.ts src/hooks/useConnectionLifecycle.test.ts` = 0 (Sprint 219 freeze).
     - `git diff --stat src/hooks/useSchemaTableMutations.ts src/hooks/useSchemaTableMutations.test.ts` = 0 (Sprint 223 결과 동결).
     - `git diff --stat src/hooks/useSchemaCache.ts src/hooks/useSchemaCache.test.ts` = 0.
     - `git diff --stat src/hooks/useMigrationExport.ts` = 0.
     - `git diff --stat src/stores/schemaStore.ts src/stores/schemaStore.test.ts` = 0.
     - `git diff --stat src/lib/toast.ts src/lib/session-storage.ts src/lib/zustand-ipc-bridge.ts src/lib/window-label.ts` = 0.
     - `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` = 0.

## Global Acceptance Criteria

1. **행동 변경 0** — 모든 input 에 대해 boot 시점 hydrate 결과 (`focusedConnId` / `activeStatuses` 사후 상태) 사전과 byte-equivalent. window-focus 시점 hydrate 결과 (`prevConnId` 비교 + stale-tab clear 로직 포함) 사전과 byte-equivalent. session 이 비어있을 때 store 무변화 (`Object.keys(patch).length === 0` 조건). session 에 `focusedConnId` 만 있을 때 / `activeStatuses` 만 있을 때 partial-patch 동일.

2. **`ConnectionState` 16 method signature 동결** — return type / param type / async 정책 모두 byte-equivalent. `hydrateFromSession: () => void` interface signature 보존 (외부 caller 가 `useConnectionStore.getState().hydrateFromSession()` 직접 호출해도 컴파일 + 동작) — 단 본 sprint 의 두 caller 는 plain function 으로 swap.

3. **`SYNCED_KEYS` 4 key 동결** — `["connections", "groups", "activeStatuses", "focusedConnId"]` 배열 변경 0. cross-window broadcast allowlist 변경 0.

4. **`attachZustandIpcBridge` module-load attach 동결** — `connectionStore.ts` lines 311-318 byte-equivalent. P10 step 4 영향 범위 보존.

5. **persist 3 site 동결 (P10 step 3b 영역)** — `persistFocusedConnId` / `persistActiveStatuses` 4 call site (현재 3 site, `connectToDatabase` 의 try-block 끝 + `disconnectFromDatabase` body + `setFocusedConn` body) byte-equivalent. broadcast / persist ordering invariant 보존.

6. **Cross-window sync 영향 0** — `cross-window-connection-sync.test.tsx` 회귀 통과. `attachZustandIpcBridge` / `SYNCED_KEYS` 변경 0. window-lifecycle 회귀 통과.

7. **Project-wide regression bar**:
   - `pnpm vitest run` exit 0. baseline → 사후 file count +2 (module + module test). store test case count -2, module test case count +2 (≥), net delta = 0 (또는 +1 if Generator 가 추가 edge case 작성).
   - `pnpm tsc --noEmit` exit 0 — 새 `any` 0.
   - `pnpm lint` exit 0.
   - 새 `eslint-disable*` 0. 새 silent `catch{}` 0. `it.only` / `it.skip` 0.

8. **새 useEffect / setInterval / setTimeout / subscribe / window event listener 0** in `useConnectionSessionHydration.ts`. (단, `useWindowFocusHydration.ts` 의 기존 `window.addEventListener("focus", hydrate)` 는 사전 동일 — 본 sprint 가 window event listener 추가/제거 0.)

9. **Toast / IPC / persist 영향 0** — 본 sprint 는 read-only hydration 만 다룬다. `toast.*` 호출 추가/제거 0. `attachZustandIpcBridge` 호출 변경 0. `persistFocusedConnId` / `persistActiveStatuses` 호출 변경 0 (read-only path 만 이동).

10. **P10 후속 step freeze** — step 3b (persist 3 site 추출) / step 4 (`attachZustandIpcBridge` module-load attach 분리) 영향 범위 사전 동일. `attachZustandIpcBridge` import / module-load 호출 / SYNCED_KEYS / persist 3 site 모두 byte-equivalent.

## Components to Create / Modify

### Create

- `src/hooks/useConnectionSessionHydration.ts` (신규 module, ~30-50 LOC).
  - `export function hydrateConnectionSession(): void` — plain function. `readConnectionSession()` → partial-patch 빌드 → `useConnectionStore.setState(patch)` (외부 진입점). React tree 외부에서도 호출 가능.
  - `export function useConnectionSessionHydration(): { hydrateFromSession: () => void }` — React hook wrap. `useCallback(() => hydrateConnectionSession(), [])` 으로 stable identity. (Generator 재량으로 Option A/B 채택 가능 — 단 plain function entry point 는 반드시 export.)
  - 새 effect / interval / timeout / subscribe / window event listener 0.
- `src/hooks/useConnectionSessionHydration.test.ts` (신규 module test, ≥ 2 case — 위 2 case 마이그레이션).

### Modify

- `src/stores/connectionStore.ts` (-~10 LOC):
  - `hydrateFromSession` 본문: 13 LOC → 1-2 LOC (`hydrateConnectionSession()` thin proxy 호출). 또는 store action body 가 신규 module 의 export 를 호출하는 형태 — `ConnectionState.hydrateFromSession: () => void` interface 보존.
  - `readConnectionSession` import 제거 가능 (Generator 재량 — module 이 소유 시).
  - 다른 15 method body / `pickFallbackFocus` helper / `SYNCED_KEYS` / `attachZustandIpcBridge` module-load attach / `ConnectionState` interface 변경 0.
  - **CRITICAL FREEZE**: persist 3 call site (lines 198, 217, 222) byte-equivalent.
- `src/stores/connectionStore.test.ts` (-~30 LOC):
  - 사전 lines 950-984 의 2 case (`hydrateFromSession restores focusedConnId and activeStatuses` / `hydrateFromSession is a no-op when session is empty`) 삭제.
  - 다른 모든 case 변경 0. 특히 `mockPersistFocusedConnId` / `mockPersistActiveStatuses` 검증 case 는 절대 변경 0.
- `src/main.tsx` (~1 LOC swap):
  - line 47 `useConnectionStore.getState().hydrateFromSession();` → `hydrateConnectionSession();`.
  - import 1 줄 추가 (`import { hydrateConnectionSession } from "@hooks/useConnectionSessionHydration";` 또는 동등). `useConnectionStore` import 가 더 이상 필요 없다면 제거 (단 다른 import 가 있으면 보존). `markBootMilestone("connectionStore:hydrated")` (line 48) 보존.
- `src/hooks/useWindowFocusHydration.ts` (~1 LOC swap):
  - line 30 `useConnectionStore.getState().hydrateFromSession();` → `hydrateConnectionSession();`.
  - inner `hydrate` 함수 안의 `prevConnId` snapshot (line 29) / `newConnId` 비교 (line 31) / stale-tab clear (lines 33-42) byte-equivalent.
  - import 1 줄 추가. `useConnectionStore` import 는 다른 site (line 29 `getState().focusedConnId` / line 31) 에서 사용하므로 보존.
  - `useEffect` / `addEventListener("focus", hydrate)` / `removeEventListener("focus", hydrate)` byte-equivalent.

### Untouched (sibling drift = 0)

- `src/hooks/useConnectionMutations.ts` / `src/hooks/useConnectionMutations.test.ts` (Sprint 219 결과 동결).
- `src/hooks/useConnectionLifecycle.ts` / `src/hooks/useConnectionLifecycle.test.ts` (Sprint 219 freeze).
- `src/hooks/useSchemaTableMutations.ts` / `src/hooks/useSchemaTableMutations.test.ts` (Sprint 223 결과 동결).
- `src/hooks/useSchemaCache.ts` / `src/hooks/useSchemaCache.test.ts`.
- `src/hooks/useMigrationExport.ts`.
- `src/stores/schemaStore.ts` / `src/stores/schemaStore.test.ts`.
- `src/lib/toast.ts` / `src/lib/session-storage.ts` / `src/lib/zustand-ipc-bridge.ts` / `src/lib/window-label.ts` / `src/lib/tauri.ts`.
- `src/__tests__/cross-window-connection-sync.test.tsx` / `src/__tests__/window-lifecycle.ac141.test.tsx`.
- 다른 모든 connection 관련 components (`Sidebar` / `HomePage` / dialogs) — 본 sprint 가 caller 추가/제거 없음 (persist 3 site 의 5 callers 는 step 3b 영역).
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` (Sprint 223 결과 동결).
- 기타 모든 `src/components/**` / `src/pages/**`.

## Data Flow

### Before (current — `hydrateFromSession`)

```
boot path (main.tsx:47)
  └─→ useConnectionStore.getState().hydrateFromSession()
        └─→ store body (lines 225-237):
              ├─→ session = readConnectionSession()
              ├─→ patch = {}
              ├─→ if (session.focusedConnId) patch.focusedConnId = ...
              ├─→ if (session.activeStatuses) patch.activeStatuses = ...
              └─→ if (Object.keys(patch).length > 0) set(patch)

window-focus path (useWindowFocusHydration.ts:30)
  └─→ inside `hydrate()` (called on mount + window focus event)
        ├─→ prevConnId = useConnectionStore.getState().focusedConnId
        ├─→ useConnectionStore.getState().hydrateFromSession()
        │    └─→ store body (same 13 LOC as above)
        ├─→ newConnId = useConnectionStore.getState().focusedConnId
        └─→ if (newConnId !== prevConnId) clearTabsForConnection(staleConnIds)
```

### After (target — `hydrateFromSession`)

```
boot path (main.tsx:47)
  └─→ hydrateConnectionSession()                                  ←── plain function, direct
        └─→ module body (~10 LOC in useConnectionSessionHydration.ts):
              ├─→ session = readConnectionSession()
              ├─→ patch = {}
              ├─→ if (session.focusedConnId) patch.focusedConnId = ...
              ├─→ if (session.activeStatuses) patch.activeStatuses = ...
              └─→ if (Object.keys(patch).length > 0)
                    useConnectionStore.setState(patch)             ←── external entry

window-focus path (useWindowFocusHydration.ts:30)
  └─→ inside `hydrate()` (unchanged outer shape — useEffect/addEventListener byte-equivalent)
        ├─→ prevConnId = useConnectionStore.getState().focusedConnId
        ├─→ hydrateConnectionSession()                             ←── plain function, direct
        │    └─→ same module body as above
        ├─→ newConnId = useConnectionStore.getState().focusedConnId
        └─→ if (newConnId !== prevConnId) clearTabsForConnection(staleConnIds)
                                                                     ←── stale-tab clear preserved

store action (thin proxy — interface preserved)
  store.hydrateFromSession() body (≤ 2 LOC):
    └─→ hydrateConnectionSession()                                 ←── delegates to module
        (so external callers using store.getState().hydrateFromSession() still work
         byte-equivalent — interface signature `() => void` frozen.)
```

### State invariant (preserved — byte-equivalent)

```
For all session shapes (empty / focusedConnId-only / activeStatuses-only / both):
  before: post-call useConnectionStore.getState() yields
            { ..., focusedConnId: <patched|previous>,
                   activeStatuses: <patched|previous> }
  after:  post-call useConnectionStore.getState() yields
            { ..., focusedConnId: <patched|previous>,
                   activeStatuses: <patched|previous> }
            ←── identical patch shape, identical set(...) call
```

### persist invariant (out of scope — frozen)

```
connectToDatabase body, line 198: persistActiveStatuses(get().activeStatuses)  ←── byte-equivalent
disconnectFromDatabase body, line 217: persistActiveStatuses(get().activeStatuses)  ←── byte-equivalent
setFocusedConn body, line 222: persistFocusedConnId(id)  ←── byte-equivalent
  → P10 step 3b deferred. Hook NEVER touches these sites.
  → broadcast-then-persist ordering w/ attachZustandIpcBridge SYNCED_KEYS preserved.
```

### Cross-window invariant (preserved — out of scope)

```
attachZustandIpcBridge module-load attach (lines 311-318) byte-equivalent.
SYNCED_KEYS 4 key array byte-equivalent.
hydrateFromSession path is read-only — no store mutation broadcasts that
weren't already broadcast in the pre-extraction code (set(patch) goes
through the same Zustand setState path → bridge broadcasts on
`focusedConnId` / `activeStatuses` keys identically).
```

## Edge Cases

- **Empty session (both `focusedConnId` and `activeStatuses` undefined)** — module: patch = {} → `Object.keys(patch).length === 0` → `setState` 호출 0 → store 무변화. 사전 store 본문과 byte-equivalent. (사전 store test case `hydrateFromSession is a no-op when session is empty` 의 검증 대상.)
- **Partial session — only `focusedConnId`** — module: `patch = { focusedConnId: session.focusedConnId }` → `setState({ focusedConnId })` → `activeStatuses` 미터치 (사전 store 본문과 동일).
- **Partial session — only `activeStatuses`** — module: `patch = { activeStatuses: ... }` → `setState({ activeStatuses })` → `focusedConnId` 미터치 (사전 동일).
- **Both fields present** — module: `patch = { focusedConnId, activeStatuses }` → `setState(patch)` 한 번 호출 (사전 store 본문 `set(patch)` 와 동일 — 두 key 가 한 update 로 묶임).
- **Re-entrancy (boot 직후 window-focus 두 번 fire)** — module 은 idempotent. `readConnectionSession()` 매 호출마다 fresh read. 동일 session 내용이면 동일 patch → `setState` 가 referentially-equal value 로 호출 — Zustand 의 shallow eq 가 re-render 차단 (사전 동일).
- **Module-load IPC bridge attach 시점 vs hydrate 호출 시점** — `attachZustandIpcBridge` 는 `connectionStore.ts` module load 시점 (lines 311-318) 에 비동기 attach. `hydrateConnectionSession()` 호출이 attach 완료 전이어도 `setState` 가 동기적으로 store 를 mutate — bridge attach 후 broadcast 시점에 이미 mutated 상태 (사전 동일 — store body 가 set(patch) 했던 시점과 동일).
- **multi-window race — launcher 가 hydrate 하는 동안 workspace 가 동시 hydrate** — 두 window 가 각자 own session-scoped localStorage 에서 read (process UUID 로 격리). `setState` 는 각 window 내에서 동기 — 사전 동일.
- **React tree 외부 호출 (main.tsx boot path)** — `hydrateConnectionSession()` 은 plain function. React hooks (`useState` / `useEffect` / `useCallback`) 사용 0 — boot 시점 (`ReactDOM.createRoot(...).render(...)` 이전) 에 안전하게 호출 가능. `renderHook` 외부 — pure function call.
- **React tree 내부 호출 (useWindowFocusHydration `useEffect` 안)** — `hydrate()` 함수가 `useEffect` callback 안에서 `hydrateConnectionSession()` 직접 호출 — hook context 도 정상 (plain function 은 hook context 안팎 모두 가능).
- **Hook unmount mid-call** — 본 sprint 의 module 은 새 effect 0. `useWindowFocusHydration` 의 기존 `removeEventListener` cleanup (line 46) 사전 동일. unmount 후 `setState(...)` 호출되어도 Zustand 외부 진입점이므로 React warn 없음 (사전 store 본문 동작과 동일).
- **store.hydrateFromSession 외부 직접 호출 (non-migrated caller 가 향후 추가될 경우)** — interface signature 동결 — `useConnectionStore.getState().hydrateFromSession()` 사후에도 컴파일 + 동작. store action body 가 thin proxy 로 module function 을 호출하므로 결과 byte-equivalent.
- **mock leakage in module test** — `vi.hoisted` + factory pattern (`useConnectionMutations.test.ts` / `useSchemaTableMutations.test.ts` verbatim 답습). connectionStore mock factory 가 `setState` / `getState` 모두 노출 — leakage 0. session-storage mock 은 `mockReadConnectionSession` 만 사용 (사전 store test 와 동일).
- **`ConnectionState` 16-method count 변경 0** — interface 자체에 method 추가/제거 없음. `hydrateFromSession: () => void` 라인 (line 45) 보존.
- **`markBootMilestone("connectionStore:hydrated")` 위치** — `main.tsx:48` 의 `markBootMilestone` 호출이 hydrate 완료 *후* 실행 — plain function 동기 return 후 호출되어야 함 (사전 동일). hydrate 가 비동기로 변하지 않음 — module function 도 동기 (`set` 까지 동기).

## Verification Hints

### Primary regression
```sh
pnpm vitest run \
  src/stores/connectionStore.test.ts \
  src/hooks/useConnectionSessionHydration.test.ts \
  src/hooks/useWindowFocusHydration.test.ts \
  src/__tests__/cross-window-connection-sync.test.tsx \
  src/__tests__/window-lifecycle.ac141.test.tsx
```

### Sprint 219 / 223 sibling 영역 freeze
```sh
pnpm vitest run \
  src/hooks/useConnectionMutations.test.ts \
  src/hooks/useConnectionLifecycle.test.ts \
  src/hooks/useSchemaTableMutations.test.ts \
  src/hooks/useSchemaCache.test.ts \
  src/stores/schemaStore.test.ts
```

### Project-wide
```sh
pnpm vitest run    # exit 0
pnpm tsc --noEmit  # exit 0
pnpm lint          # exit 0
```

### Store body shrink 검증
```sh
git diff --stat src/stores/connectionStore.ts                                       # delta ≥ -10 LOC
grep -nE 'Pick<ConnectionState,' src/stores/connectionStore.ts | wc -l              # = 0 (partial-patch literal moved to module)
grep -nE '\bhydrateFromSession\s*:' src/stores/connectionStore.ts | wc -l           # = 1 (interface entry only) OR 2 (interface + thin-proxy impl line) — both acceptable
```

### Persist 3 site 동결 검증 (CRITICAL)
```sh
grep -nE 'persistActiveStatuses\(get\(\)\.activeStatuses\)' src/stores/connectionStore.ts | wc -l  # = 2 (connectToDatabase + disconnectFromDatabase)
grep -nE 'persistFocusedConnId\(id\)' src/stores/connectionStore.ts | wc -l                       # = 1 (setFocusedConn)
grep -nE 'attachZustandIpcBridge<ConnectionState>' src/stores/connectionStore.ts | wc -l          # = 1 (module-load attach)
grep -nE '"connections", "groups", "activeStatuses", "focusedConnId"' src/stores/connectionStore.ts | wc -l  # = 1 (SYNCED_KEYS)
```

### Module surface 검증
```sh
test -f src/hooks/useConnectionSessionHydration.ts
test -f src/hooks/useConnectionSessionHydration.test.ts
grep -nE '^export function hydrateConnectionSession' src/hooks/useConnectionSessionHydration.ts   # = 1
grep -rn 'hydrateConnectionSession\b' src/                                                        # ≥ 3 (module + main.tsx + useWindowFocusHydration.ts)
```

### Caller swap 검증
```sh
grep -rnE 'useConnectionStore\(\)\.getState\(\)\.hydrateFromSession\(\)|useConnectionStore\.getState\(\)\.hydrateFromSession\(\)' src/ \
  | grep -v 'src/stores/connectionStore.ts'                                                       # = 0 (after swap; store thin-proxy may match — exclude store file)
grep -n 'hydrateConnectionSession' src/main.tsx                                                   # ≥ 1
grep -n 'hydrateConnectionSession' src/hooks/useWindowFocusHydration.ts                           # ≥ 1
```

### Store test case migration 검증
```sh
grep -nE 'hydrateFromSession restores focusedConnId and activeStatuses|hydrateFromSession is a no-op when session is empty' \
  src/stores/connectionStore.test.ts | wc -l                                                      # = 0 (both migrated)
grep -nE 'hydrateFromSession restores focusedConnId and activeStatuses|hydrateFromSession is a no-op when session is empty' \
  src/hooks/useConnectionSessionHydration.test.ts | wc -l                                         # ≥ 2
```

### `ConnectionState` interface 동결
```sh
grep -nE '^\s*(loadConnections|loadGroups|addConnection|updateConnection|removeConnection|testConnection|connectToDatabase|disconnectFromDatabase|setFocusedConn|hydrateFromSession|setActiveDb|addGroup|updateGroup|removeGroup|moveConnectionToGroup|initEventListeners):' \
  src/stores/connectionStore.ts | wc -l                                                           # 사전과 동일 (interface signatures preserved)
```

### Out-of-scope freeze (Sprint 219 / 223 + P10 후속 step + sibling)
```sh
git diff --stat src/hooks/useConnectionMutations.ts src/hooks/useConnectionMutations.test.ts \
                src/hooks/useConnectionLifecycle.ts src/hooks/useConnectionLifecycle.test.ts \
                src/hooks/useSchemaTableMutations.ts src/hooks/useSchemaTableMutations.test.ts \
                src/hooks/useSchemaCache.ts src/hooks/useSchemaCache.test.ts \
                src/hooks/useMigrationExport.ts                                                   # 모두 0
git diff --stat src/stores/schemaStore.ts src/stores/schemaStore.test.ts                          # 0
git diff --stat src/lib/toast.ts src/lib/session-storage.ts \
                src/lib/zustand-ipc-bridge.ts src/lib/window-label.ts src/lib/tauri.ts            # 모두 0
git diff --stat src/__tests__/cross-window-connection-sync.test.tsx \
                src/__tests__/window-lifecycle.ac141.test.tsx                                     # 모두 0
```

### 새 effect / event listener 0 검증 (in module)
```sh
grep -nE '\b(useEffect|setInterval|setTimeout|addEventListener|subscribe)\b' \
  src/hooks/useConnectionSessionHydration.ts | wc -l                                              # = 0
```

### 행동 변경 0 의 마지막 증거
```sh
# Store test still passes (minus the 2 migrated cases) — the 15 remaining
# actions' behaviour is byte-equivalent because their bodies (incl. persist
# 3 site) are untouched.
pnpm vitest run src/stores/connectionStore.test.ts                                                # exit 0
# Module test asserts the migrated 2 cases under direct function call (or
# renderHook) with byte-equivalent input/output expectations (same
# readConnectionSession mock, same final focusedConnId/activeStatuses).
pnpm vitest run src/hooks/useConnectionSessionHydration.test.ts                                   # exit 0
# Cross-window + window-lifecycle regression untouched.
pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx \
                src/__tests__/window-lifecycle.ac141.test.tsx                                     # exit 0
```

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/stores/connectionStore.ts
- /Users/felix/Desktop/study/view-table/src/stores/connectionStore.test.ts
- /Users/felix/Desktop/study/view-table/src/main.tsx
- /Users/felix/Desktop/study/view-table/src/hooks/useWindowFocusHydration.ts
- /Users/felix/Desktop/study/view-table/src/hooks/useConnectionMutations.ts
