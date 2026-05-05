/**
 * Per-connection "last active tab" tracker. Powers the
 * connection-swap fallback chain (last active tab → first tab → new
 * query tab) used by Quick Open and similar surfaces.
 *
 * Deliberately a module-scoped `Map`, not a zustand slice — the value
 * is session-only and must not persist, and keeping it off the public
 * store API stops external code from depending on it.
 *
 * Init takes a `tabsAccessor` callback to dodge the circular dep that
 * would otherwise form between this file and the `tabStore` entry.
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
