# Sprint 126 Findings (Evaluator)

## Verification Run

| Check | Result |
|-------|--------|
| `pnpm vitest run` | PASS — 118 files / **1907 tests** green (≥ 1887 invariant) |
| `pnpm tsc --noEmit` | PASS — 0 errors (silent exit) |
| `pnpm lint` | PASS — 0 errors |
| `pnpm contrast:check` | PASS — 0 new violations (64 allowlisted) |
| e2e static compile | N/A in repo tsconfig (`include: ["src"]`); e2e specs (WDIO) use their own ambient types. Verified e2e selectors do not depend on `data-testid="schema-panel"` (only unit test in `Sidebar.test.tsx` does, and it now mocks `WorkspaceSidebar` while keeping the same testid). The only `SchemaPanel` reference in `e2e/` is a non-load-bearing comment in `e2e/_helpers.ts:117`. |

## Sprint 126 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | `pickSidebar` is a pure exhaustive switch (`pickSidebar.ts:25-36`); `WorkspaceSidebar` resolves driving connection with active-tab priority then `selectedId` fallback (`WorkspaceSidebar.tsx:48-81`); active-tab connection only wins if it resolves in the store, otherwise gracefully degrades to `selectedId` (no blank shell on stale tab id). Vanished-tab path covered by test. The empty/select/connecting/error branches mirror SchemaPanel byte-for-byte (icons `Database`/`MousePointerClick`/`Plug`, copy verbatim). One nit: in the `if (!selectedId && !activeTabConn)` branch (line 83), a stale `activeTabConnId` that didn't resolve to a connection would fall through to `if (!driving)` returning `null`. This is intentional per author comment but slightly different from SchemaPanel (which would have shown "Select a connection"). Edge case is rare in practice (active tab without connection in store). |
| Completeness | 9/10 | All 10 ACs satisfied (see mapping below). Five new files with co-located tests, plus `Sidebar.tsx` swap and `Sidebar.test.tsx` mock retarget. SchemaPanel left intact per contract (S127+ cleanup). `KvSidebarPlaceholder.tsx` / `SearchSidebarPlaceholder.tsx` not authored as separate components — instead `WorkspaceSidebar` directly mounts `<UnsupportedShellNotice paradigm="kv|search">`. Contract literally lists those filenames as "신규 placeholder paradigm panel"; reading the In-Scope clause they were "한 줄짜리 안내 표시" — equivalent functional outcome and the placeholder file consolidation is a reasonable simplification, but a strict reading of the contract names two files that do not exist. |
| Reliability | 8/10 | TabStore selector is shallow (`s.tabs.find(...)`) — a new array reference on each store update will recompute selector return value, but Zustand will compare the primitive `connectionId ?? null` so re-renders are bounded by actual connection-id changes. `useConnectionStore.setState((s) => ({ ...s, connectToDatabase }))` in tests mutates the store directly which is OK because `beforeEach` resets via `setupStore({})` but the `connectToDatabase` override leaks into following tests in the same describe block (no afterEach restore). Not a correctness bug for the current tests because the only test that asserts `connectToDatabase` calls is the disconnected-card test and others either don't reach the disconnected branch or don't assert on it. SchemaPanel deletion deferred per contract — file remains and its tests still pass, so no orphaned coverage gap. No `any`, no console.logs, no TODOs. |
| Verification Quality | 9/10 | All 4 required commands run green; outputs captured. AC mapping in handoff cites file:line for each criterion. New tests cover all 4 paradigms, all 4 state cards (empty / select / connecting / error / disconnected), active-tab-overrides-selectedId, no-active-tab fallback, active-tab-only path, vanished-connection fallback (10 cases in `WorkspaceSidebar.test.tsx`). `pickSidebar.test.ts` covers all 4 paradigm arms. `UnsupportedShellNotice.test.tsx` covers both placeholder variants. e2e static compile evidence is limited to "no spec change required" (no e2e file modified, no e2e selector relies on `schema-panel`); the WDIO suite is not rerun in this evaluation but is invariant per contract. |
| **Overall** | **8.75/10** | |

## Verdict: PASS

All four dimensions are ≥ 7/10; no P1 findings.

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** `<WorkspaceSidebar selectedId>` exists at `src/components/workspace/WorkspaceSidebar.tsx:42`. Active-tab priority encoded at `WorkspaceSidebar.tsx:48-53` (tab selector) and resolved at `WorkspaceSidebar.tsx:76-81` (`activeTabConn ?? selectedId`-derived). Tested by `WorkspaceSidebar.test.tsx:220-236` ("active tab paradigm overrides selectedId paradigm").
- [x] **AC-02** `paradigm === 'rdb'` → `<RdbSidebar>` → `<SchemaTree>`: `WorkspaceSidebar.tsx:159-160` (`renderKind` 'rdb' arm) + `RdbSidebar.tsx:17-19`. Tested by `WorkspaceSidebar.test.tsx:159-167`.
- [x] **AC-03** `paradigm === 'document'` → `<DocumentSidebar>` → `<DocumentDatabaseTree>`: `WorkspaceSidebar.tsx:161-162` + `DocumentSidebar.tsx:17-21`. Tested by `WorkspaceSidebar.test.tsx:169-181`.
- [x] **AC-04** `paradigm === 'kv' | 'search'` → `<UnsupportedShellNotice>` placeholder, `role="status"`, paradigm-specific aria-label, "{Paradigm} database support is coming in Phase 9.": `UnsupportedShellNotice.tsx:43-55` + `WorkspaceSidebar.tsx:163-166`. Tested by `UnsupportedShellNotice.test.tsx` (both variants) and `WorkspaceSidebar.test.tsx:183-214`.
- [x] **AC-05** Empty / connecting / error / disconnected cards owned by `WorkspaceSidebar.tsx:55-142`. Strings & icons (`Database`, `MousePointerClick`, `Plug`) byte-identical to SchemaPanel (cross-checked against `SchemaPanel.tsx:25-99`). Tested by `WorkspaceSidebar.test.tsx:103-153`.
- [x] **AC-06** `Sidebar.tsx:16` imports `WorkspaceSidebar`; `Sidebar.tsx:186` mounts `<WorkspaceSidebar selectedId={focusedConnId} />`. SchemaPanel no longer imported by any production file (`grep` finds only `SchemaPanel.tsx` + `SchemaPanel.test.tsx` + non-load-bearing comments in `WorkspaceSidebar.tsx`, `UnsupportedShellNotice.tsx`, `e2e/_helpers.ts`).
- [x] **AC-07** No user-visible regression — all empty/select/connecting/error/disconnected copy is verbatim, paradigm branches preserved (PG → SchemaTree, Mongo → DocumentDatabaseTree). `Sidebar.test.tsx` still passes asserting on `data-testid="schema-panel"` because the mock retains that testid.
- [x] **AC-08** Unit tests added: `pickSidebar.test.ts` (4 paradigms), `UnsupportedShellNotice.test.tsx` (kv + search), `WorkspaceSidebar.test.tsx` (4 paradigms + 5 state cards + 4 active-tab-priority scenarios = 13 tests).
- [x] **AC-09** `pnpm vitest run` (1907 green) / `pnpm tsc --noEmit` (0) / `pnpm lint` (0) / `pnpm contrast:check` (0 new violations) all green.
- [x] **AC-10** No e2e spec was modified. `home-workspace-swap`, `data-grid`, `schema-tree` selectors do not depend on `SchemaPanel` (`schema-panel` testid was used only by Sidebar unit test, and the WorkspaceSidebar mock keeps the same testid). The user-visible DOM shape (sidebar root + tree contents) is unchanged for connected paradigms.

## Active-tab Paradigm Resolution (cited)

`src/components/workspace/WorkspaceSidebar.tsx:48-81`:

```ts
const activeTabConnId = useTabStore((s) => {
  const id = s.activeTabId;
  if (!id) return null;
  const tab = s.tabs.find((t) => t.id === id);
  return tab?.connectionId ?? null;
});
// ...
const activeTabConn = activeTabConnId
  ? connections.find((c) => c.id === activeTabConnId)
  : null;
const driving =
  activeTabConn ??
  (selectedId ? connections.find((c) => c.id === selectedId) : null);
```

Active-tab connection wins when it resolves to a known connection in the store; otherwise falls back to `selectedId` so a stale tab id can never blank out the sidebar. Confirmed by tests "active tab paradigm overrides selectedId paradigm", "uses active tab even when selectedId is null", "falls back to selectedId paradigm when there is no active tab", "falls back to selectedId when active tab references a vanished connection".

## SchemaPanel paradigm-branch removal evidence

`SchemaPanel.tsx:104-112` still contains the legacy `isDocument ? DocumentDatabaseTree : SchemaTree` branch — but `SchemaPanel` is no longer mounted in any production path. `Sidebar.tsx:16,186` swap to `WorkspaceSidebar`. `grep -r "from.*SchemaPanel\|import.*SchemaPanel" src/` returns a single hit: `src/components/schema/SchemaPanel.test.tsx:3`. The contract explicitly permits leaving the file untouched ("단순화 위해 후자를 권장: SchemaPanel은 deprecate, ... 단 SchemaPanel 파일은 보존"). New paradigm branch lives at `WorkspaceSidebar.tsx:146` (`pickSidebar(driving.paradigm)`) inside an exhaustive `switch` in `renderKind` (`WorkspaceSidebar.tsx:157-170`).

## Findings

### P1 (blockers)
None.

### P2 (should-fix)
None blocking; the contract drift below is sufficiently borderline to flag but not to fail.

### P3 (nits / future polish)

1. **Contract drift on placeholder filenames** — Contract In-Scope lists `KvSidebarPlaceholder.tsx` and `SearchSidebarPlaceholder.tsx` as separate files; Generator consolidated both into a single parameterised `<UnsupportedShellNotice paradigm>` mounted directly from `WorkspaceSidebar.tsx:163-166`. Functionally equivalent and arguably cleaner, but if a future sprint expects the named files (e.g. for paradigm-specific chrome) they will need to be re-introduced. Suggest the harness either update the contract or treat this as a contract-clarification note.
2. **Test isolation: `connectToDatabase` mock leaks** — `WorkspaceSidebar.test.tsx:128` uses `useConnectionStore.setState((s) => ({ ...s, connectToDatabase }))` to inject a `vi.fn()`. The next `setupStore` call in `beforeEach` overwrites `connections` and `activeStatuses` only via `useConnectionStore.setState({ connections, activeStatuses })`, which keeps the patched `connectToDatabase` between tests. Currently harmless because no other test asserts on it, but a future addition could be confused by a leftover `vi.fn()`. Suggest extending `setupStore` to reset `connectToDatabase` to a default vi.fn each beforeEach, or using `useConnectionStore.setState(initialState, true)` to fully replace the slice.
3. **Edge-case parity with SchemaPanel** — When `selectedId` is null AND active-tab `connectionId` does not resolve to any connection, SchemaPanel previously fell through to "Select a connection" (since `if (!selectedId)` short-circuited). The new code returns the "Select a connection" card only when `!selectedId && !activeTabConn` (line 83), which matches SchemaPanel for the no-tab case. The "stale active tab + null selectedId" case now still hits the "Select a connection" card because `activeTabConn` is null too — confirmed correct by inspection. No bug, but worth a regression test.
4. **`WorkspaceSidebar.tsx` line 102 comment claims "match SchemaPanel's previous render-nothing shape"** — that's accurate (SchemaPanel.tsx:62 returns `null` for unknown selectedId), but a brief inline link/jsdoc would help future readers. Cosmetic.

## Feedback for Generator

1. **Placeholder file split** — Contract listed `KvSidebarPlaceholder.tsx` / `SearchSidebarPlaceholder.tsx` as discrete files. Current implementation collapses both into `UnsupportedShellNotice` mounted inline. If the contract is normative, add the two thin wrappers; otherwise note the deviation in handoff so Planner can amend the next contract.
   - Current: single `<UnsupportedShellNotice paradigm="kv|search" />` rendered directly from `WorkspaceSidebar.renderKind`.
   - Expected (per literal contract): `KvSidebarPlaceholder.tsx` and `SearchSidebarPlaceholder.tsx` files exist and re-export `<UnsupportedShellNotice paradigm="..." />`.
   - Suggestion: either add the 5-line wrappers (cheap) or surface the deviation explicitly in the handoff "Assumptions" so it can be ratified.

2. **Test isolation hygiene** — `connectToDatabase` patching on `useConnectionStore` leaks between tests.
   - Current: `useConnectionStore.setState((s) => ({ ...s, connectToDatabase }))` then no restoration.
   - Expected: per-test default reset.
   - Suggestion: extend `setupStore` to always set `connectToDatabase: vi.fn()` (or accept it as an option) so every test starts with a fresh mock.

## Handoff to Next Sprint

- All sprint-126 ACs satisfied. Sprint 127 may proceed assuming `WorkspaceSidebar` is the canonical entry point.
- Cleanup of `SchemaPanel.tsx` + `SchemaPanel.test.tsx` is open work for sprint 127+ (explicitly out of scope here).
- Active-tab-paradigm-priority is in place and unit-tested; multi-paradigm tab coexistence in sprint 127+ can rely on it.
