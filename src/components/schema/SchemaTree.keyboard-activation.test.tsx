// #1142 — SchemaTree row activation keys must be consistent. Schema and
// category rows already activate on Enter AND Space; the leaf item rows
// (table/view/function via the shared handler, and metadata/sequence rows)
// only handled Enter. WAI-ARIA `treeitem` expects Space to activate too.
// Regression: Space on a leaf/metadata row must run the same handler as Enter.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";
import type { TableInfo, FunctionInfo } from "@/types/schema";

const mockLoadSchemas = vi.fn().mockResolvedValue(undefined);
const mockLoadTables = vi.fn().mockResolvedValue(undefined);
const mockLoadViews = vi.fn().mockResolvedValue(undefined);
const mockLoadFunctions = vi.fn().mockResolvedValue(undefined);
const mockPrefetchSchemaColumns = vi.fn().mockResolvedValue(undefined);
const mockLoadFileAnalyticsSources = vi.fn().mockResolvedValue([]);
const mockClearFileAnalyticsSources = vi.fn().mockResolvedValue(undefined);

const DEFAULT_DB = "db1";

function makeConnection(id: string, dbType: DatabaseType): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    dbType,
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

function seedActiveStatusesFor(connIds: Iterable<string>) {
  useConnectionStore.setState((s) => {
    const next = { ...s.activeStatuses };
    for (const id of connIds) {
      next[id] ??= { type: "connected", activeDb: DEFAULT_DB };
    }
    return { activeStatuses: next };
  });
}

function setSchemaStoreState(
  overrides: {
    schemas?: Record<string, { name: string }[]>;
    tables?: Record<string, TableInfo[]>;
    functions?: Record<string, FunctionInfo[]>;
  } = {},
) {
  const nest = <T,>(raw?: Record<string, T[]>) => {
    if (!raw) return undefined;
    const out: Record<string, Record<string, Record<string, T[]>>> = {};
    for (const [composite, list] of Object.entries(raw)) {
      const [cid, schema] = composite.split(":");
      if (!cid) continue;
      out[cid] ??= {};
      out[cid]![DEFAULT_DB] ??= {};
      // schema-less axis (`schemas`) keys are just the conn id.
      out[cid]![DEFAULT_DB]![schema ?? ""] = list;
    }
    return out;
  };

  const schemas: Record<string, Record<string, { name: string }[]>> = {};
  if (overrides.schemas) {
    for (const [cid, list] of Object.entries(overrides.schemas)) {
      schemas[cid] = { [DEFAULT_DB]: list };
    }
    seedActiveStatusesFor(Object.keys(overrides.schemas));
  }

  useSchemaStore.setState({
    schemas,
    tables: nest(overrides.tables) ?? {},
    views: {},
    functions: nest(overrides.functions) ?? {},
    fileAnalyticsSources: {},
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
}

function tabsFor(connId: string) {
  return (
    useWorkspaceStore.getState().workspaces[connId]?.[DEFAULT_DB]?.tabs ?? []
  );
}

describe("SchemaTree — Space activates leaf rows (#1142)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ connections: [] });
    setSchemaStoreState();
  });

  it("Space on a table row opens a tab (parity with Enter/click)", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("pg1", "postgresql")],
    });
    setSchemaStoreState({
      schemas: { pg1: [{ name: "public" }] },
      tables: {
        "pg1:public": [{ name: "users", schema: "public", row_count: null }],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="pg1" />);
    });

    const row = screen.getByLabelText("users table");
    expect(tabsFor("pg1")).toHaveLength(0);

    await act(async () => {
      fireEvent.keyDown(row, { key: " " });
    });

    const tabs = tabsFor("pg1");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ type: "table", table: "users" });
  });

  it("Space on a metadata (sequence) row selects it (parity with Enter/click)", async () => {
    useConnectionStore.setState({
      connections: [makeConnection("ora1", "oracle")],
    });
    setSchemaStoreState({
      schemas: { ora1: [{ name: "APP" }] },
      tables: {
        "ora1:APP": [{ name: "ORDERS", schema: "APP", row_count: null }],
      },
      functions: {
        "ora1:APP": [
          {
            name: "ORDER_SEQ",
            schema: "APP",
            arguments: "",
            returnType: null,
            language: "Oracle sequence",
            source: null,
            kind: "sequence",
          },
        ],
      },
    });

    await act(async () => {
      render(<SchemaTree connectionId="ora1" />);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Sequences in APP"));
    });

    const seq = screen.getByLabelText("ORDER_SEQ sequence");
    expect(seq).toHaveAttribute("aria-selected", "false");

    await act(async () => {
      fireEvent.keyDown(seq, { key: " " });
    });

    expect(screen.getByLabelText("ORDER_SEQ sequence")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
