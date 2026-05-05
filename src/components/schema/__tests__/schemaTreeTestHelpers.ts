// Sprint 216 — shared helpers extracted from `SchemaTree.test.tsx` (P11
// step 1) so the behaviour-axis test files can reuse the same `vi.fn()`
// instances + store seed pattern. The 5 `mockLoad*` functions, the
// `setSchemaStoreState` overlay, and the `resetStores` cleaner mirror
// the original mega-test verbatim — no behaviour change. Each axis file
// imports these and re-applies them in its own `beforeEach` so worker
// isolation + `vi.clearAllMocks()` keep state from leaking across cases.
import { vi } from "vitest";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const mockLoadSchemas = vi.fn().mockResolvedValue(undefined);
export const mockLoadTables = vi.fn().mockResolvedValue(undefined);
export const mockLoadViews = vi.fn().mockResolvedValue(undefined);
export const mockLoadFunctions = vi.fn().mockResolvedValue(undefined);
export const mockPrefetchSchemaColumns = vi.fn().mockResolvedValue(undefined);

export function setSchemaStoreState(overrides: Record<string, unknown> = {}) {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
    ...overrides,
    // Preserve mocked actions
    loadSchemas: mockLoadSchemas,
    loadTables: mockLoadTables,
    loadViews: mockLoadViews,
    loadFunctions: mockLoadFunctions,
    prefetchSchemaColumns: mockPrefetchSchemaColumns,
  });
}

export function resetStores() {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
    loadSchemas: mockLoadSchemas,
    loadTables: mockLoadTables,
    loadViews: mockLoadViews,
    loadFunctions: mockLoadFunctions,
    prefetchSchemaColumns: mockPrefetchSchemaColumns,
  });
  useTabStore.setState({ tabs: [], activeTabId: null });
  useConnectionStore.setState({ connections: [] });
}
