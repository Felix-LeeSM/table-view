# Sprint 127 — Evaluator Findings

## Sprint 127 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | **9/10** | Connected-only filter is exactly the contract-mandated predicate (`ConnectionSwitcher.tsx:73-75`). Three-step fallback chain (`ConnectionSwitcher.tsx:80-103`) implements last-active → first-tab → new-query-tab in the order the contract requires. Active-tab label sync is selector-driven, no `useEffect` involved (`tabStore.ts:556-562`). Last-active tracker auto-prunes when the tracked tab disappears (`tabStore.ts:598-612`), so closed-tab races advance the fallback chain instead of pointing at a vanished id. |
| **Completeness** | **9/10** | All 12 ACs satisfied with code/test citations (see "Acceptance Criteria" section below). 27 new tests across 4 files; 1934/1934 vitest green. Toolbar mounted directly above `<TabBar />` in `MainArea.tsx:196-197` — exactly the location the contract recommends. DB / Schema switchers expose the tooltip and disabled affordance the contract mandated; visual-as-dropdown styling preserved to avoid S128 layout shift. Minor caveat: the `SchemaSwitcher` tooltip says "Switching schemas is coming in sprint 128" while the contract phrased the example tooltip for the DB switcher only — the parallel wording is reasonable, though the contract text technically only specified the DB tooltip copy verbatim. |
| **Reliability** | **8/10** | Module-scoped Map + zustand subscriber is the simplest correct design and respects the contract's "no zustand persist" rule. Subscriber is global and runs once per module load — duplication would only occur on hot-reload (Vite HMR could install multiple subscribers, but `useTabStore.subscribe` returns an unsubscribe handle that is being discarded). Test isolation via `__resetLastActiveTabsForTests` is good. The empty-workspace case (`activeTab === null`, no connected connections) is covered by tests in both `ConnectionSwitcher.test.tsx:119-129` and `WorkspaceToolbar.test.tsx:105-120`. Edge case: when the active tab points at a *disconnected* connection, the trigger label still shows that connection's name (graceful — see `ConnectionSwitcher.tsx:68-71`). The dropdown excludes disconnected entries, so the user cannot re-select the current value, which is fine because `handleChange` short-circuits same-id selection (`:81`). |
| **Verification Quality** | **8/10** | All 4 hard verification commands pass clean: vitest 1934/1934, tsc 0, eslint 0, contrast:check 0 new violations. The 5th item ("e2e 정적 컴파일") was claimed via "no e2e file touched + grep WorkspaceToolbar e2e/ → 0" rather than a real `tsc -p e2e/tsconfig.json` because no such tsconfig exists in the repo. This is acceptable but slightly weaker evidence than the contract literally requested; the absence of an e2e tsconfig is a pre-existing repo state, not a Generator omission. The `getByRole("combobox", …)` in `WorkspaceToolbar.test.tsx:95-97` confirms the trigger exposes the right ARIA semantics. |
| **Overall** | **8.5/10** | |

## Verdict: PASS

All four dimensions ≥ 7/10. PASS_THRESHOLD met.

## Verification Command Outcomes

| Command | Outcome |
| --- | --- |
| `pnpm vitest run` | **PASS** — 1934/1934 tests across 122 files (1907 baseline + 27 new). |
| `pnpm tsc --noEmit` | **PASS** — 0 errors. |
| `pnpm lint` | **PASS** — 0 ESLint errors. |
| `pnpm contrast:check` | **PASS** — 0 new violations (64 allowlisted). |
| e2e static compile | **N/A** — repo has no `e2e/tsconfig.json`; no e2e spec was modified, no new selector clashes (verified via grep). |

## Sprint Contract Status (Acceptance Criteria)

- [x] **AC-01** — `WorkspaceToolbar` renders `ConnectionSwitcher` / `DbSwitcher` / `SchemaSwitcher`. Verified at `src/components/workspace/WorkspaceToolbar.tsx:15-27`. Test: `WorkspaceToolbar.test.tsx:88-103` asserts the toolbar role + each child's accessible name.
- [x] **AC-02** — Toolbar mounts above `<TabBar />`. Verified at `src/components/layout/MainArea.tsx:196-197` (`<WorkspaceToolbar />` immediately precedes `<TabBar />`).
- [x] **AC-03** — Trigger label = active tab's connection name; options = `activeStatuses[id]?.type === "connected"` only. Verified at `ConnectionSwitcher.tsx:73-75` (filter) and `:78` (label fallback to "No connection"). Test: `ConnectionSwitcher.test.tsx:131-167` exercises the connected/disconnected/connecting/errored mix and asserts only the connected option appears.
- [x] **AC-04** — Graceful fallback chain. Verified at `ConnectionSwitcher.tsx:80-103` — Step 1 last-active (`getLastActiveTabIdForConnection`), Step 2 first existing tab, Step 3 `addQueryTab`. Tests: `ConnectionSwitcher.test.tsx:169-223` (last-active wins), `:225-265` (first-tab fallback), `:267-299` (spawns new query tab).
- [x] **AC-05** — Option visual + literal `aria-label="Connection: <name>"`. Verified at `ConnectionSwitcher.tsx:139` (`aria-label={\`Connection: ${c.name}\`}`) plus dot + paradigm icon at `:142-146`. Tests: `ConnectionSwitcher.test.tsx:301-324` and `:131-167` use `[aria-label="Connection: …"]` attribute selectors.
- [x] **AC-06** — DbSwitcher `aria-disabled="true"` + tooltip "Switching DBs is coming in sprint 128". Verified at `DbSwitcher.tsx:53-58, 45-46, 75`. Tests: `DbSwitcher.test.tsx:44-70` cover em-dash, `aria-disabled`, `tabindex=-1`, exact tooltip text.
- [x] **AC-07** — SchemaSwitcher: `aria-disabled="true"`, label = `tab.schema` or `(default)`/em-dash. Verified at `SchemaSwitcher.tsx:23-75`. Tests: `SchemaSwitcher.test.tsx:43-105`.
- [x] **AC-08** — Toolbar labels sync with active tab via zustand selector (no `useEffect`). Verified at `tabStore.ts:556-562` (`useActiveTab`). Test: `WorkspaceToolbar.test.tsx:147-181` flips `activeTabId` and asserts the trigger / schema labels update.
- [x] **AC-09** — Empty workspace graceful: trigger disabled when no connected, em-dash for DB/Schema. Verified at `ConnectionSwitcher.tsx:77-78, 109` (`disabled={noConnected}`); `DbSwitcher.tsx:30-31`, `SchemaSwitcher.tsx:27-28`. Tests: `WorkspaceToolbar.test.tsx:105-120`, `ConnectionSwitcher.test.tsx:119-129`.
- [x] **AC-10** — 4 unit-test files added with the required scenarios. Files: `WorkspaceToolbar.test.tsx`, `ConnectionSwitcher.test.tsx`, `DbSwitcher.test.tsx`, `SchemaSwitcher.test.tsx`. 27 new tests in total — all green.
- [x] **AC-11** — All 4 verification commands green (see table above).
- [x] **AC-12** — e2e regression: 0 e2e specs touched (`grep -i 'WorkspaceToolbar\|combobox\|aria-label="Active' e2e/` matches only an unrelated comment in `data-grid.spec.ts:110` "shows Format button in query tab toolbar"). New `aria-label="Workspace toolbar"` does not clash with existing `aria-label="Open connections"` etc.

## Connected-only filter (cited)

```ts
// src/components/workspace/ConnectionSwitcher.tsx:73-75
const connectedConnections = connections.filter(
  (c) => activeStatuses[c.id]?.type === "connected",
);
```

`disconnected`, `connecting`, and `error` statuses are all excluded. Test exercises all four status variants in one assertion (`ConnectionSwitcher.test.tsx:131-167`).

## Fallback chain (cited)

```ts
// src/components/workspace/ConnectionSwitcher.tsx:80-103
function handleChange(nextId: string) {
  if (nextId === activeConn?.id) return;
  const lastActive = getLastActiveTabIdForConnection(nextId);
  if (lastActive) { setActiveTab(lastActive); return; }
  const firstTab = useTabStore.getState().tabs.find((t) => t.connectionId === nextId);
  if (firstTab) { setActiveTab(firstTab.id); return; }
  const conn = connections.find((c) => c.id === nextId);
  addQueryTab(nextId, { paradigm: conn?.paradigm ?? "rdb" });
}
```

Each branch is covered by a dedicated test (`ConnectionSwitcher.test.tsx:169-223`, `:225-265`, `:267-299`).

## DB / Schema switchers truly disabled (RTL evidence)

- `DbSwitcher.test.tsx:52-59` — `expect(trigger).toHaveAttribute("aria-disabled", "true"); expect(trigger).toHaveAttribute("tabindex", "-1");`
- `SchemaSwitcher.test.tsx:52-59` — same assertions for the schema button.
- `DbSwitcher.test.tsx:110-122` and `SchemaSwitcher.test.tsx:107-119` — store snapshot before/after click is identical (no mutation).

## Public store API preserved

`git diff HEAD -- src/stores/tabStore.ts` shows changes only at the file tail (lines 537→621): two new exported helpers, one in-memory `Map`, one `subscribe` registration, one test-only reset. **No edits inside the `create<TabState>(…)` body**, no mutation of `TabState` interface, no rename or type change to `tabs` / `activeTabId` / `setActiveTab` / `addQueryTab`. Selector additions are exactly what the contract permits.

## Empty workspace graceful (RTL evidence)

`WorkspaceToolbar.test.tsx:105-120` mounts the toolbar with `tabs: []`, `activeTabId: null`, and zero connections. Asserts (a) "No connection" placeholder text, (b) DB / Schema buttons each show the em-dash sentinel. No throw, no console error.

## Findings

### P1 (blocking)
- None.

### P2 (should-fix before next sprint)
- None.

### P3 (nice-to-have)
- **HMR safety of `useTabStore.subscribe(...)` at module scope**: The subscriber registered in `tabStore.ts:584-590` does not capture/return its unsubscribe handle. In Vite dev HMR a module re-evaluation could install a second subscriber that mirrors the first one's writes. This is harmless (the Map ends up with the same value) but could cause a brief memory leak across many HMR edits. Suggested mitigation: store the unsubscribe handle in `import.meta.hot.dispose` or wrap the subscription in `if (!import.meta.hot) {…}` once. Out of scope for this sprint per the contract; logging here so a future sprint catches it.
- **Tooltip wording on `SchemaSwitcher`**: `SchemaSwitcher.tsx:41` says "Switching schemas is coming in sprint 128", but schema switching is actually slated for S130/S131 per the contract scope ("실제 DB switch (PG sub-pool / Mongo `use_db`) → S130/S131"). Consider "coming in sprint 130" so the user-facing message is accurate. Non-blocking.
- **e2e static compile claim is informal**: The contract's 5th required check is `pnpm tsc --noEmit -p e2e/tsconfig.json` *or* a wdio import check. Neither exists as a script in the repo. The Generator's evidence ("no e2e file touched") is reasonable but not what the contract literally specified. Future sprints touching `src/types` or selectors that e2e specs depend on should add a real e2e tsc invocation.

## Feedback for Generator

1. **Wording: schema-switcher tooltip** — `SchemaSwitcher.tsx:41` references "sprint 128", but schema/collection switching is in S130/S131 per the contract scope. Currently the user sees a tooltip pointing at the wrong sprint.
   - Current: `const tooltipText = "Switching schemas is coming in sprint 128";`
   - Expected: tooltip aligns with the S130/S131 scope ("coming in sprint 130" or generic "coming soon").
   - Suggestion: change line 41 to `"Switching schemas is coming in sprint 130";` and update the corresponding test in `SchemaSwitcher.test.tsx:99-105` (currently `toMatch(/sprint 128/i)`).

2. **HMR safety nit on `tabStore.subscribe`** — the new module-scope subscription installed at `tabStore.ts:584-590` does not retain its unsubscribe handle. Not a correctness bug today, but if Vite HMR ever re-evaluates the module the second subscriber leaks.
   - Current: subscriber registered, return value discarded.
   - Expected: subscription managed defensively for HMR.
   - Suggestion: capture the return value and dispose on `import.meta.hot.dispose` if HMR is configured.

(No P1/P2 findings — sprint passes the gate.)

## Exit Criteria Check

- Open P1/P2 findings: **0**
- Required checks passing: **yes** (4/4 hard checks; 5th is N/A by repo state)
- Acceptance criteria evidence linked above
- Existing 1907 vitest count ≤ 1934 new total
- Existing e2e static compile not regressed (no spec touched, no selector clash)
