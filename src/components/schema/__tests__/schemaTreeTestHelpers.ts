// Sprint 216 — shared helpers extracted from `SchemaTree.test.tsx` (P11
// step 1) so the behaviour-axis test files can reuse the same `vi.fn()`
// instances + store seed pattern. The 5 `mockLoad*` functions, the
// `setSchemaStoreState` overlay, and the `resetStores` cleaner mirror
// the original mega-test verbatim — no behaviour change. Each axis file
// imports these and re-applies them in its own `beforeEach` so worker
// isolation + `vi.clearAllMocks()` keep state from leaking across cases.
//
// Sprint 263 (2026-05-12) — schemaStore cache shape changed from
// flat `{ "conn:schema": [...] }` to nested `{ conn: { db: { schema: [...] } } }`
// per ADR 0027. To keep the existing axis tests untouched, the helper
// auto-translates the legacy seed shapes (e.g. `schemas: { conn1: [...] }`
// or `tables: { "conn1:public": [...] }`) into the new nested form under
// the default db sentinel `"db1"`. New tests can pass the nested shape
// directly — passthrough leaves it intact.
import { vi } from "vitest";
import { formatWorkspaceLabel, getCurrentWindowLabel } from "@lib/window-label";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import type {
  ColumnInfo,
  FunctionInfo,
  SchemaInfo,
  TableInfo,
  ViewInfo,
} from "@/types/schema";

/**
 * sprint-366 (2026-05-16) — best-effort setter for the fake Tauri window
 * label. `useCurrentWorkspaceKey()` (and therefore `useActiveTab()`) now
 * resolves `connId` from the window label. SchemaTree tests rely on the
 * active-tab highlight which goes through that chain. Mirrors the
 * `trySetWindowLabel` in `workspaceStoreTestHelpers.ts`; both safely
 * no-op when the importer didn't declare `vi.mock("@lib/window-label",
 * ...)`.
 */
function trySetWindowLabel(connId: string): void {
  try {
    const mocked = vi.mocked(getCurrentWindowLabel);
    if (typeof mocked.mockReturnValue !== "function") return;
    mocked.mockReturnValue(formatWorkspaceLabel(connId));
  } catch {
    // No-op.
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const mockLoadSchemas = vi.fn().mockResolvedValue(undefined);
export const mockLoadTables = vi.fn().mockResolvedValue(undefined);
export const mockLoadViews = vi.fn().mockResolvedValue(undefined);
export const mockLoadFunctions = vi.fn().mockResolvedValue(undefined);
export const mockPrefetchSchemaColumns = vi.fn().mockResolvedValue(undefined);

// Default db sentinel — matches the `activeStatuses.conn1.activeDb` seeded
// by `resetStores` below so SchemaTree's `useWorkspaceKeyForConnection`
// resolves to the same workspace bucket the helper writes into.
const DEFAULT_DB = "db1";

function isFlatSchemasShape(
  value: unknown,
): value is Record<string, SchemaInfo[]> {
  if (typeof value !== "object" || value === null) return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(v)) return true;
    // Nested shape: every value is itself a Record<db, SchemaInfo[]>.
    if (typeof v !== "object" || v === null) return false;
  }
  return false;
}

function translateSchemas(
  raw: unknown,
): Record<string, Record<string, SchemaInfo[]>> {
  if (!raw || typeof raw !== "object") return {};
  if (isFlatSchemasShape(raw)) {
    const out: Record<string, Record<string, SchemaInfo[]>> = {};
    for (const [connId, list] of Object.entries(
      raw as Record<string, SchemaInfo[]>,
    )) {
      out[connId] = { [DEFAULT_DB]: list };
    }
    return out;
  }
  return raw as Record<string, Record<string, SchemaInfo[]>>;
}

type FlatBySchema<V> = Record<string, V[]>;
type NestedBySchema<V> = Record<string, Record<string, Record<string, V[]>>>;

function isFlatColonShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    // Flat shape keys are `"conn:schema"` (1 colon). Nested-shape outer
    // keys are bare connection IDs without colons.
    if (key.includes(":")) return true;
  }
  return false;
}

function translateBySchema<V>(raw: unknown): NestedBySchema<V> {
  if (!raw || typeof raw !== "object") return {};
  if (isFlatColonShape(raw)) {
    const out: NestedBySchema<V> = {};
    for (const [composite, list] of Object.entries(raw as FlatBySchema<V>)) {
      const [connId, schema] = composite.split(":");
      if (!connId || !schema) continue;
      out[connId] ??= {};
      out[connId]![DEFAULT_DB] ??= {};
      out[connId]![DEFAULT_DB]![schema] = list;
    }
    return out;
  }
  return raw as NestedBySchema<V>;
}

type FlatColumnsCache = Record<string, ColumnInfo[]>;
type NestedColumnsCache = Record<
  string,
  Record<string, Record<string, Record<string, ColumnInfo[]>>>
>;

function translateColumnsCache(raw: unknown): NestedColumnsCache {
  if (!raw || typeof raw !== "object") return {};
  // Flat shape: `"conn:schema:table"` (2 colons).
  if (isFlatColonShape(raw)) {
    const out: NestedColumnsCache = {};
    for (const [composite, list] of Object.entries(raw as FlatColumnsCache)) {
      const parts = composite.split(":");
      if (parts.length !== 3) continue;
      const [connId, schema, table] = parts;
      if (!connId || !schema || !table) continue;
      out[connId] ??= {};
      out[connId]![DEFAULT_DB] ??= {};
      out[connId]![DEFAULT_DB]![schema] ??= {};
      out[connId]![DEFAULT_DB]![schema]![table] = list;
    }
    return out;
  }
  return raw as NestedColumnsCache;
}

export function setSchemaStoreState(overrides: Record<string, unknown> = {}) {
  const translated: Record<string, unknown> = { ...overrides };
  if ("schemas" in overrides) {
    translated.schemas = translateSchemas(overrides.schemas);
  }
  if ("tables" in overrides) {
    translated.tables = translateBySchema<TableInfo>(overrides.tables);
  }
  if ("views" in overrides) {
    translated.views = translateBySchema<ViewInfo>(overrides.views);
  }
  if ("functions" in overrides) {
    translated.functions = translateBySchema<FunctionInfo>(overrides.functions);
  }
  if ("tableColumnsCache" in overrides) {
    translated.tableColumnsCache = translateColumnsCache(
      overrides.tableColumnsCache,
    );
  }

  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    loading: false,
    error: null,
    ...translated,
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
  // sprint-366 — also seed the fake window label so `useActiveTab()` /
  // `useCurrentWorkspaceKey()` resolve to (`conn1`, `db1`).
  trySetWindowLabel("conn1");
}
