// #1256 — DuckDB reopen (flat shape) mounts a *rehydrated* workspace.
//
// The e2e `duckdb-file-analytics.spec` reopens the workspace, so the sidebar
// mounts against a workspace produced by the boot rehydrate pipeline
// (`migrateLoadedWorkspaces`) rather than the in-memory test helpers. That
// path is the one #1217's `expanded: string[] | null` seed marker flows
// through, and it is exactly the surface the CI regression pointed at. This
// pins it: rehydrate must preserve the marker (null → seed the single
// implicit schema; a real array — including `[]` — is respected) and the flat
// file-analytics source must render without a mount-time throw.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { migrateLoadedWorkspaces } from "@stores/workspaceStore/persistence";
import type { ConnectionConfig } from "@/types/connection";

const mockLoadSchemas = vi.fn().mockResolvedValue(undefined);
const mockLoadTables = vi.fn().mockResolvedValue(undefined);
const mockLoadViews = vi.fn().mockResolvedValue(undefined);
const mockLoadFunctions = vi.fn().mockResolvedValue(undefined);
const mockPrefetchSchemaColumns = vi.fn().mockResolvedValue(undefined);
const mockLoadFileAnalyticsSources = vi.fn().mockResolvedValue([]);
const mockClearFileAnalyticsSources = vi.fn().mockResolvedValue(undefined);

function duckConnection(): ConnectionConfig {
  return {
    id: "duck-reopen",
    name: "duck-reopen DB",
    dbType: "duckdb",
    host: "localhost",
    port: 0,
    user: "u",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

describe("SchemaTree — DuckDB reopen (rehydrated workspace, #1256)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [duckConnection()],
      focusedConnId: "duck-reopen",
      activeStatuses: {
        "duck-reopen": { type: "connected", activeDb: "db1" },
      },
    });
  });

  for (const rehydratedExpanded of [null, [], ["main"]] as (
    | string[]
    | null
  )[]) {
    it(`mounts and lists the file source with rehydrated expanded=${JSON.stringify(
      rehydratedExpanded,
    )}`, async () => {
      useWorkspaceStore.setState({
        workspaces: migrateLoadedWorkspaces({
          "duck-reopen": {
            db1: {
              tabs: [],
              activeTabId: null,
              closedTabHistory: [],
              dirtyTabIds: [],
              sidebar: {
                selectedNode: null,
                expanded: rehydratedExpanded,
                scrollTop: 0,
              },
            },
          },
        }),
      });
      useSchemaStore.setState({
        schemas: { "duck-reopen": { db1: [{ name: "main" }] } },
        tables: {
          "duck-reopen": {
            db1: { main: [{ name: "events", schema: "main", row_count: 2 }] },
          },
        },
        views: {},
        functions: {},
        fileAnalyticsSources: {
          "duck-reopen": [
            {
              source: {
                id: "duckdb-reopen-1",
                alias: "file_reopen",
                fileName: "sales.csv",
                kind: "csv",
                sizeBytes: 32,
              },
              columns: [{ name: "id", dataType: "INTEGER" }],
              previewSql: 'SELECT * FROM "file_reopen" LIMIT 100',
            },
          ],
        },
        loading: false,
        error: null,
        loadSchemas: mockLoadSchemas,
        loadTables: mockLoadTables,
        loadViews: mockLoadViews,
        loadFunctions: mockLoadFunctions,
        loadFileAnalyticsSources: mockLoadFileAnalyticsSources,
        clearFileAnalyticsSources: mockClearFileAnalyticsSources,
        prefetchSchemaColumns: mockPrefetchSchemaColumns,
      });

      await act(async () => {
        render(<SchemaTree connectionId="duck-reopen" />);
      });

      // No mount-time throw; the flat table + file source both render.
      expect(screen.getByLabelText("events table")).toBeInTheDocument();
      expect(screen.getByLabelText("file_reopen source")).toBeInTheDocument();

      // Seed marker semantics survive rehydrate: `null` seeds the implicit
      // schema, a real array (even `[]`) is respected.
      const expanded =
        useWorkspaceStore.getState().workspaces["duck-reopen"]?.db1?.sidebar
          .expanded;
      expect(expanded).toEqual(
        rehydratedExpanded === null ? ["main"] : rehydratedExpanded,
      );
    });
  }
});
