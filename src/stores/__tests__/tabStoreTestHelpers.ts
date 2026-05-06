import { vi } from "vitest";
import type { TableTab, QueryTab, Tab } from "../tabStore";

export function makeTableTab(
  overrides: Partial<Omit<TableTab, "id" | "isPreview">> & {
    id?: string;
    permanent?: boolean;
  },
): Omit<TableTab, "id" | "isPreview"> & { permanent?: boolean } {
  return {
    title: "Test Tab",
    connectionId: "conn1",
    type: "table",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records" as const,
    ...overrides,
  };
}

export function getTableTab(state: { tabs: Tab[] }, index: number): TableTab {
  const tab = state.tabs[index];
  if (!tab || tab.type !== "table") throw new Error("Expected TableTab");
  return tab;
}

export function getQueryTab(state: { tabs: Tab[] }, index: number): QueryTab {
  const tab = state.tabs[index];
  if (!tab || tab.type !== "query") throw new Error("Expected QueryTab");
  return tab;
}

/**
 * Build a `setState` payload that resets `useTabStore` to an empty
 * collection. Axis tests apply this via `useTabStore.setState(emptyTabStoreState())`
 * — the helper avoids a runtime `useTabStore` import here so the
 * `no-restricted-imports` rule (which targets `src/stores/**\/*.ts`)
 * passes for the helper file itself.
 */
export function emptyTabStoreState(): {
  tabs: Tab[];
  activeTabId: null;
  closedTabHistory: Tab[];
  dirtyTabIds: Set<string>;
} {
  return {
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: new Set<string>(),
  };
}

export function installFakeLocalStorage(): { storage: Record<string, string> } {
  const ref: { storage: Record<string, string> } = { storage: {} };
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => ref.storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      ref.storage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete ref.storage[key];
    }),
    clear: vi.fn(() => {
      ref.storage = {};
    }),
    get length() {
      return Object.keys(ref.storage).length;
    },
    key: vi.fn(() => null),
  });
  return ref;
}

export function restoreLocalStorage(): void {
  vi.useRealTimers();
}

/**
 * Build a `setState` payload that seeds a single running query tab. Axis
 * tests apply this via `useTabStore.setState(buildRunningQueryTabState(...))`
 * — verbatim from the original sprint-195 inline helper at
 * `tabStore.test.ts` L2075-2091. The function lives in this helper file
 * (rather than each axis) so the cross-axis fixture stays single-source.
 */
export function buildRunningQueryTabState(
  tabId = "q1",
  queryId = "q1-1700000000",
): { tabs: QueryTab[]; activeTabId: string } {
  const tab: QueryTab = {
    type: "query",
    id: tabId,
    title: "Query 1",
    connectionId: "conn1",
    closable: true,
    sql: "SELECT 1",
    queryState: { status: "running", queryId },
    paradigm: "rdb",
    queryMode: "sql",
  } as QueryTab;
  return { tabs: [tab], activeTabId: tabId };
}
