# Sprint 127 — Generator Handoff

## Changed Files

- `src/components/workspace/WorkspaceToolbar.tsx` — top-of-pane container
  (`role="toolbar"`, `aria-label="Workspace toolbar"`) that stacks
  `<ConnectionSwitcher>` / `<DbSwitcher>` / `<SchemaSwitcher>`. Paradigm-agnostic;
  reads no state itself.
- `src/components/workspace/ConnectionSwitcher.tsx` — active Radix
  `<Select>` showing only `activeStatuses[id]?.type === "connected"`
  connections. Selection routes through the graceful fallback chain
  (last-active → first tab → new query tab).
- `src/components/workspace/DbSwitcher.tsx` — read-only display of the
  active tab's db/schema label. `role="button"` + `aria-disabled="true"` +
  `tabindex={-1}` + tooltip "Switching DBs is coming in sprint 128".
- `src/components/workspace/SchemaSwitcher.tsx` — read-only display of
  the active tab's schema/collection label, same disabled trigger
  pattern as `DbSwitcher`.
- `src/components/workspace/WorkspaceToolbar.test.tsx` — 5 tests covering
  child-render, empty-workspace placeholder, label sync on tab switch,
  document-paradigm labels.
- `src/components/workspace/ConnectionSwitcher.test.tsx` — 8 tests covering
  trigger label, placeholder fallback, disabled-when-no-connected,
  connected-only filter (disconnected/connecting/errored excluded),
  graceful-fallback chain (last-active / first tab / new query tab),
  `aria-label="Connection: <name>"` attribute presence.
- `src/components/workspace/DbSwitcher.test.tsx` — 7 tests covering
  em-dash sentinel, aria-disabled, tooltip text, document database label,
  rdb schema label, `(default)` sentinel, read-only on click.
- `src/components/workspace/SchemaSwitcher.test.tsx` — 7 tests covering
  em-dash sentinel, aria-disabled, schema label, document collection label,
  `(default)` sentinel, tooltip text, read-only on click.
- `src/components/layout/MainArea.tsx` — mounts `<WorkspaceToolbar>`
  directly above `<TabBar>` (single import + single JSX line).
- `src/stores/tabStore.ts` — adds **selector-only** helpers (no public
  API change to the store): `useActiveTab()`,
  `getLastActiveTabIdForConnection()`, plus an internal subscriber that
  maintains a module-scoped `Map<connectionId, lastActiveTabId>`. Also
  exports `__resetLastActiveTabsForTests` for test isolation.

## Checks Run

| Command | Outcome |
| --- | --- |
| `pnpm vitest run` | **passed** — 1934/1934 tests across 122 files (1907 baseline + 27 new). |
| `pnpm tsc --noEmit` | **passed** — 0 errors. |
| `pnpm lint` | **passed** — 0 ESLint errors. |
| `pnpm contrast:check` | **passed** — 0 new violations (64 allowlisted). |
| e2e static compile (wdio import surface) | **passed** — `src/` tsc compile + no e2e spec touched (`grep WorkspaceToolbar e2e/` returns 0). |

## Done Criteria Coverage

| AC | Evidence |
| --- | --- |
| AC-01 — `<WorkspaceToolbar>` renders 3 children | `src/components/workspace/WorkspaceToolbar.tsx:14-23` (renders `ConnectionSwitcher` / `DbSwitcher` / `SchemaSwitcher`); test `WorkspaceToolbar.test.tsx:84-99` asserts the toolbar role + each child's accessible name. |
| AC-02 — Toolbar mounts above TabBar | `src/components/layout/MainArea.tsx:194-197` (`<WorkspaceToolbar />` immediately precedes `<TabBar />`). |
| AC-03 — Connected-only options + active-tab name | `ConnectionSwitcher.tsx:65-67` (`connectedConnections = connections.filter(c => activeStatuses[c.id]?.type === "connected")`); test `ConnectionSwitcher.test.tsx:138-160` exercises connected/disconnected/connecting/errored mix and asserts only the connected one is in the dropdown. |
| AC-04 — Graceful fallback chain | `ConnectionSwitcher.tsx:75-100` (3-step `setActiveTab` → first-tab → `addQueryTab`); tests `ConnectionSwitcher.test.tsx:163-220` (last-active wins), `:223-261` (first-tab fallback), `:263-293` (spawns new query tab). |
| AC-05 — Option visual + aria-label | `ConnectionSwitcher.tsx:115-130` renders dot + paradigm icon + name + literal `aria-label="Connection: <name>"`; tests `ConnectionSwitcher.test.tsx:295-314` and `:138-160` assert the attribute selector. |
| AC-06 — DbSwitcher read-only + tooltip | `DbSwitcher.tsx:42-78` (role=button + aria-disabled + tabindex=-1 + title "Switching DBs is coming in sprint 128"); tests `DbSwitcher.test.tsx:43-72` cover em-dash, `aria-disabled`, `tabindex`, tooltip text. |
| AC-07 — SchemaSwitcher read-only + label | `SchemaSwitcher.tsx:43-78`; tests `SchemaSwitcher.test.tsx:43-104`. |
| AC-08 — Toolbar labels sync with active tab | Achieved via zustand selector hooks (`useActiveTab` in `tabStore.ts:557-563`) — no `useEffect` is involved; the selector re-runs when `state.activeTabId` or the relevant tab fields change. Test `WorkspaceToolbar.test.tsx:140-170` flips `activeTabId` and asserts the trigger / schema labels update. |
| AC-09 — Empty workspace graceful | `ConnectionSwitcher.tsx:68-69` (`noConnected` flag drives `disabled`); `DbSwitcher.tsx:31` and `SchemaSwitcher.tsx:32` show `"—"` when no active tab. Tests `WorkspaceToolbar.test.tsx:103-118` and `ConnectionSwitcher.test.tsx:114-127` cover the case. |
| AC-10 — 4 unit-test files added | `WorkspaceToolbar.test.tsx`, `ConnectionSwitcher.test.tsx`, `DbSwitcher.test.tsx`, `SchemaSwitcher.test.tsx` — all green (27 new tests in total). |
| AC-11 — verification commands green | See "Checks Run" table above. |
| AC-12 — e2e regression 0 | No e2e spec touched (`grep WorkspaceToolbar e2e/` → 0 matches). Existing tablists target `aria-label="Open connections"` while our new toolbar uses `aria-label="Workspace toolbar"` — no selector clash. |

## Active-tab paradigm priority

The toolbar tracks the **active tab**, not a sidebar-focused connection.
This is enforced by the selector hook (no separate copy of state):

```ts
// src/stores/tabStore.ts:557-563
export function useActiveTab(): Tab | null {
  return useTabStore((state) => {
    const id = state.activeTabId;
    if (!id) return null;
    return state.tabs.find((t) => t.id === id) ?? null;
  });
}
```

Every consumer (`ConnectionSwitcher`, `DbSwitcher`, `SchemaSwitcher`)
calls `useActiveTab()` directly, so they all stay in sync without an
intermediate `useEffect`.

## Last-active-tab tracking mechanism

I picked the simplest of the three options listed in the brief — a
**module-scoped `Map` populated by a single zustand subscriber** — and
deliberately *not* a separate zustand store. Reasons:

- Sprint contract forbids `zustand persist` and explicitly allows
  module-scoped state.
- Adding a new zustand store would inflate test setup (`beforeEach`
  resets) for every consumer that mounts the toolbar.
- The subscriber pattern guarantees we react to **every** path that
  changes `activeTabId` (including `addTab`, `addQueryTab`, `removeTab`'s
  fallback, `reopenLastClosedTab`) without instrumenting each action.

Implementation:

```ts
// src/stores/tabStore.ts:573-606
const lastActiveTabIdByConnection = new Map<string, string>();

useTabStore.subscribe((state) => {
  const id = state.activeTabId;
  if (!id) return;
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  lastActiveTabIdByConnection.set(tab.connectionId, tab.id);
});

export function getLastActiveTabIdForConnection(
  connectionId: string,
): string | undefined {
  const tracked = lastActiveTabIdByConnection.get(connectionId);
  if (!tracked) return undefined;
  // Defensive prune — if the tracked tab has since been closed we treat
  // the connection as having no last-active tab so the
  // `<ConnectionSwitcher>` fallback chain advances to the next step.
  const tabs = useTabStore.getState().tabs;
  if (!tabs.some((t) => t.id === tracked)) {
    lastActiveTabIdByConnection.delete(connectionId);
    return undefined;
  }
  return tracked;
}
```

The `__resetLastActiveTabsForTests` export is used by the new test
suites' `beforeEach` so each test starts with a clean tracker.

## Connected-only filter (cited)

```ts
// src/components/workspace/ConnectionSwitcher.tsx:65-67
const connectedConnections = connections.filter(
  (c) => activeStatuses[c.id]?.type === "connected",
);
```

`disconnected` / `connecting` / `error` statuses are all excluded — see
the test exercise in `ConnectionSwitcher.test.tsx:138-160`.

## Graceful fallback chain (cited)

```ts
// src/components/workspace/ConnectionSwitcher.tsx:75-100
function handleChange(nextId: string) {
  if (nextId === activeConn?.id) return;
  // Step 1 — try the last active tab id for the chosen connection.
  const lastActive = getLastActiveTabIdForConnection(nextId);
  if (lastActive) {
    setActiveTab(lastActive);
    return;
  }
  // Step 2 — fall back to the first existing tab for the connection.
  const firstTab = useTabStore
    .getState()
    .tabs.find((t) => t.connectionId === nextId);
  if (firstTab) {
    setActiveTab(firstTab.id);
    return;
  }
  // Step 3 — spawn a new query tab so the user lands somewhere valid
  // even if no tab was ever opened against this connection.
  const conn = connections.find((c) => c.id === nextId);
  addQueryTab(nextId, { paradigm: conn?.paradigm ?? "rdb" });
}
```

## Assumptions

- **DB label for RDB tabs**: until S128 introduces real
  `current_database()` lookup, `<DbSwitcher>` shows the RDB tab's
  `tab.schema` rather than blank or "(default)". This matches the
  contract's "표시값이 없으면 '—' 또는 '(default)'" guidance — when the
  active tab actually carries a schema we surface it instead. Codified
  inline with the comment on `DbSwitcher.tsx:35-39`.
- **Mongo collection in the schema slot**: `<SchemaSwitcher>` falls back
  to `tab.collection` for document query tabs so Mongo workflows show a
  populated label. Sprint 131's collection switcher will replace this.
- **Aria-label on options**: Radix `<Select.Item>` always emits
  `aria-labelledby` to its `<ItemText>` id, so the accessible name is
  computed from the visible label. The contract requires the literal
  `aria-label="Connection: <name>"` attribute, which is preserved on the
  DOM element regardless of accname computation. Tests assert via
  `[aria-label="..."]` attribute selectors.
- **No e2e spec changes**: contract explicitly defers new e2e to S133;
  static compile relies on the touched `src/` surface compiling under
  `pnpm tsc --noEmit`.

## Residual Risk

- **Visual polish**: contract sets functional bar only; the trigger /
  option rows use the existing Radix Select tokens but the design system
  may want sprint 128+ to refine spacing / icon sizes. Out of scope per
  contract.
- **Disabled trigger keyboard a11y**: `<DbSwitcher>` / `<SchemaSwitcher>`
  use `tabindex={-1}` so they are skipped in the keyboard tab order
  (matches contract). Once S128 enables them, `tabIndex` should flip to
  `0` and `aria-disabled` should be removed.
- **Last-active tab tracker is in-memory by design**: refreshing the app
  resets the tracker (which is correct per the contract — "in-memory
  only"). Users who refresh between sessions will land on Step 2 (first
  tab) or Step 3 (new query) of the fallback chain, never Step 1.
