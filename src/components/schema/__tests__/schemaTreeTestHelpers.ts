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
import { useWorkspaceStore } from "@stores/workspaceStore";

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
  useWorkspaceStore.setState({ workspaces: {} });
  // ADR 0027 — workspace key resolves via `(focusedConnId, activeDb)`.
  // SchemaTree tests render with `connectionId="conn1"` and expect tabs
  // to land in the default test slot; seeding the connection status
  // keeps that mapping deterministic. Mirrors the seed pattern from
  // `workspaceStoreTestHelpers.seedConnection()`.
  useConnectionStore.setState({
    connections: [],
    focusedConnId: "conn1",
    activeStatuses: { conn1: { type: "connected", activeDb: "db1" } },
  });
}
