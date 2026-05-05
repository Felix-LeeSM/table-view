/**
 * Sprint 208 — per-connection "last active tab" tracker.
 *
 * Extracted from the 1009-line `tabStore.ts` god file. Originally
 * introduced in Sprint 127 for the (now-removed in S134) `<ConnectionSwitcher>`
 * graceful-fallback chain (last active tab → first tab → new query tab).
 * The tracker is kept because the same fallback chain is still useful for
 * future connection-swap surfaces (Quick Open scoped jumps, etc.) and
 * removing it now would force a re-introduction.
 *
 * Implementation note: this is deliberately a module-scoped `Map`, **not**
 * a zustand-persisted slice. The contract for sprint 127 explicitly
 * forbids persisting the value (it is "last active in this session" only),
 * and a plain Map keeps the public store API of `useTabStore` unchanged.
 *
 * To avoid a circular dependency with the entry `tabStore` module (which
 * imports `recordActiveTab` from this file to wire the subscriber), the
 * tracker accepts a `tabsAccessor` injection at init time — the entry
 * passes `() => useTabStore.getState().tabs`.
 */
import type { Tab } from "./types";

type TabsAccessor = () => readonly Tab[];

const lastActiveTabIdByConnection = new Map<string, string>();
let tabsAccessor: TabsAccessor | null = null;

/**
 * Wire the tracker to the entry's tab list. Called once at module init
 * from `tabStore.ts`. Subsequent reads via {@link getLastActiveTabIdForConnection}
 * use the injected accessor for the defensive prune.
 */
export function initTracker(accessor: TabsAccessor): void {
  tabsAccessor = accessor;
}

/**
 * Update the tracker with the active tab. Wired from the entry's
 * `useTabStore.subscribe` so every `setActiveTab` (and every action that
 * mutates `activeTabId` such as `addTab` / `addQueryTab` / `removeTab`)
 * flows through here without per-action instrumentation.
 */
export function recordActiveTab(tab: Tab): void {
  lastActiveTabIdByConnection.set(tab.connectionId, tab.id);
}

/**
 * Returns the last-active tab id for a given connection, or `undefined`
 * when no tab from that connection has ever been focused this session
 * (or all such tabs have been closed and pruned by the defensive check
 * below).
 */
export function getLastActiveTabIdForConnection(
  connectionId: string,
): string | undefined {
  const tracked = lastActiveTabIdByConnection.get(connectionId);
  if (!tracked) return undefined;
  // Defensive prune — if the tracked tab has since been closed we treat
  // the connection as having no last-active tab so any caller using this
  // tracker as a graceful-fallback chain advances to the next step.
  const tabs = tabsAccessor?.() ?? [];
  if (!tabs.some((t) => t.id === tracked)) {
    lastActiveTabIdByConnection.delete(connectionId);
    return undefined;
  }
  return tracked;
}

/**
 * Test-only helper to clear the in-memory tracker. Production code never
 * needs to reset the map — when a tab closes the next read auto-prunes.
 */
export function __resetLastActiveTabsForTests(): void {
  lastActiveTabIdByConnection.clear();
}
