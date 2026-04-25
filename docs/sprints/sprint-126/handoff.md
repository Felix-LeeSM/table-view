# Sprint 126 — Generator Handoff

## Changed Files

- `src/components/workspace/pickSidebar.ts` — pure paradigm → `SidebarKind` mapping (`rdb` / `document` / `kv` / `search`). Exhaustive switch lights up TS errors when a new paradigm lands.
- `src/components/workspace/pickSidebar.test.ts` — unit tests for the 4 paradigm mappings.
- `src/components/workspace/UnsupportedShellNotice.tsx` — common placeholder for unsupported paradigms (`role="status"`, `aria-label="Key-value workspace placeholder"` / `"Search workspace placeholder"`, lucide `KeyRound` / `SearchCode` icon, "Phase 9" copy).
- `src/components/workspace/UnsupportedShellNotice.test.tsx` — RTL coverage for kv & search variants.
- `src/components/workspace/RdbSidebar.tsx` — thin wrapper rendering `<SchemaTree connectionId>`.
- `src/components/workspace/DocumentSidebar.tsx` — thin wrapper rendering `<DocumentDatabaseTree connectionId>`.
- `src/components/workspace/WorkspaceSidebar.tsx` — paradigm-aware slot. Active-tab connection wins over `selectedId`; absorbs the empty / connecting / error / disconnected cards previously owned by `SchemaPanel` (messages and icons identical).
- `src/components/workspace/WorkspaceSidebar.test.tsx` — covers empty, "select connection", unknown selectedId, connecting, error, disconnected, all 4 paradigms, active-tab-overrides-selectedId, no-active-tab fallback, active-tab-only path, vanished-connection fallback.
- `src/components/layout/Sidebar.tsx` — swap `SchemaPanel` import + mount for `WorkspaceSidebar`. The `selectedId={focusedConnId}` wiring is unchanged so external behaviour is preserved.
- `src/components/layout/Sidebar.test.tsx` — re-target the existing `data-testid="schema-panel"` mock from `@components/schema/SchemaPanel` to `@components/workspace/WorkspaceSidebar`.
- `src/components/schema/SchemaPanel.tsx` — left intact (still has a passing test suite). No production import path now references it; sprint 127+ may delete.

## Checks Run

- `pnpm vitest run` — pass (118 files / **1907 tests**, up from 1887).
- `pnpm tsc --noEmit` — pass (0 errors).
- `pnpm lint` — pass (0 errors).
- `pnpm contrast:check` — pass (0 new violations; 64 allowlisted).
- `git diff --stat src-tauri/` — empty (backend untouched).

## Done Criteria Coverage

- **AC-01** `<WorkspaceSidebar selectedId>` exists at `src/components/workspace/WorkspaceSidebar.tsx`. Active-tab priority is encoded at `WorkspaceSidebar.tsx:43-58` (the `useTabStore` selector reads `activeTabId` → `tab.connectionId`, then `activeTabConn ?? (selectedId ? ... : null)` resolves the driving connection). Test: `WorkspaceSidebar.test.tsx` "active tab paradigm overrides selectedId paradigm".
- **AC-02** `paradigm === 'rdb'` → `RdbSidebar` → `SchemaTree` — `WorkspaceSidebar.tsx:140` (renderKind 'rdb' arm) + `RdbSidebar.tsx:11`. Test: `WorkspaceSidebar.test.tsx` "renders RdbSidebar -> SchemaTree".
- **AC-03** `paradigm === 'document'` → `DocumentSidebar` → `DocumentDatabaseTree` — `WorkspaceSidebar.tsx:142` + `DocumentSidebar.tsx:14`. Test: `WorkspaceSidebar.test.tsx` "renders DocumentSidebar -> DocumentDatabaseTree".
- **AC-04** `paradigm === 'kv' | 'search'` → `<UnsupportedShellNotice>` placeholder with `role="status"`, paradigm-specific `aria-label`, and a single-line "{Paradigm} database support is coming in Phase 9." copy. `UnsupportedShellNotice.tsx:33-49`. Tests: `UnsupportedShellNotice.test.tsx` (kv + search) and `WorkspaceSidebar.test.tsx` "renders the kv placeholder" / "renders the search placeholder".
- **AC-05** Empty / connecting / error / disconnected cards owned by `WorkspaceSidebar.tsx:60-130`. Strings + icons (`Database` / `MousePointerClick` / `Plug`) byte-identical to the old `SchemaPanel`. Tests: `WorkspaceSidebar.test.tsx` "empty-state", "select a connection", "disconnected card", "connecting card", "error card".
- **AC-06** `Sidebar.tsx:16-17` imports `WorkspaceSidebar`; `Sidebar.tsx:184-189` mounts `<WorkspaceSidebar selectedId={focusedConnId} />`. SchemaPanel is no longer imported from production code (`grep` only finds it in its own file + its own test).
- **AC-07** No user-visible regression — empty/connecting/error copy is identical, the `Sidebar` prop wiring (`selectedId={focusedConnId}`) is unchanged, and the same paradigm branch (`rdb` → SchemaTree, `document` → DocumentDatabaseTree) is exercised. Existing `Sidebar.test.tsx` (which asserts on `data-testid="schema-panel"`) still passes.
- **AC-08** Unit tests added: `pickSidebar.test.ts` (4 paradigms), `UnsupportedShellNotice.test.tsx` (kv + search), `WorkspaceSidebar.test.tsx` (4 paradigms + empty / select-connection / connecting / error / disconnected / active-tab-priority / fallback / vanished-connection).
- **AC-09** All 5 commands green (see "Checks Run").
- **AC-10** Existing e2e specs unchanged — the user-visible DOM shape is preserved; the only DOM additions are the `<UnsupportedShellNotice>` cards which are not exercised by any current e2e selector.

## Active-tab Paradigm Resolution (code citation)

`src/components/workspace/WorkspaceSidebar.tsx:43-83`:

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

The active tab's connection wins, but only when it resolves to a known connection in the store; otherwise we degrade to the `selectedId` fallback so a stale tab id can never blank out the sidebar.

## SchemaPanel Paradigm-branch Removal (evidence)

The paradigm `if (isDocument) ...` lives only in the legacy `SchemaPanel.tsx`. No production component imports it any more — `Sidebar.tsx` switched to `WorkspaceSidebar`. Verified with `Grep "SchemaPanel"` after the change: only `src/components/schema/SchemaPanel.tsx` and `src/components/schema/SchemaPanel.test.tsx` reference the symbol. The branch in `WorkspaceSidebar` itself is the new `pickSidebar(driving.paradigm)` call (line ~138), routed through a single exhaustive `switch` in `renderKind` rather than nested ternaries.

## Assumptions

- The "active tab" is the tab returned by `useTabStore` for `activeTabId`. Any tab type (`table` / `query`) carries a `connectionId`, so we don't need to switch on `tab.type` to extract the connection — the tabStore Tab union guarantees the field.
- When the active tab references a connection that has been removed from the store, falling back to `selectedId` is the right behaviour (vs. rendering nothing or the empty card). This matches the pattern Sidebar's own focus-healing effect uses.
- Keeping the legacy "Switch to the Connections tab and add your first database" copy (and the "Double-click in the Connections tab to connect" copy) verbatim is preferred over rewording for the new screen layout — preserves snapshot stability and matches the contract's "기존 SchemaPanel 메시지/아이콘 동일" invariant.
- `SchemaPanel.tsx` and its test are intentionally left in place. They are dead code from a production-import perspective but pruning them is out of scope (sprint 127+).
- The placeholder uses `KeyRound` for kv and `SearchCode` for search (per the brief). Both are existing lucide-react exports already used elsewhere in the codebase ecosystem.

## Residual Risk

- None for AC scope. The only behaviour change visible to users is that switching active tabs across connections of different paradigms now flips the sidebar tree — which is the explicit S126 contract. Existing single-paradigm flows (PG → SchemaTree, Mongo → DocumentDatabaseTree) are unchanged.
- Cleanup of the now-orphaned `SchemaPanel.tsx` + `SchemaPanel.test.tsx` is deferred to sprint 127+ per the contract (`Out of Scope` allows the file to stay).
