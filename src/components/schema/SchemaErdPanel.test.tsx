import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { SchemaGraphIntelligenceSelectors } from "@/lib/schemaGraphSelectors";
import type { SchemaGraph } from "@/types/schemaGraph";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";

vi.mock("./SchemaErdRenderer", () => ({
  default: ({
    graph,
    intelligence,
  }: {
    graph: SchemaGraph;
    intelligence?: SchemaGraphIntelligenceSelectors;
  }) => (
    <output aria-label="erd graph">
      {JSON.stringify({
        indexes: graph.nodes
          .filter((node) => node.kind === "index")
          .map((node) => node.id),
        constraints: graph.nodes
          .filter((node) => node.kind === "constraint")
          .map((node) => node.id),
        metadata: [...(intelligence?.metadataReadinessByTableId.values() ?? [])]
          .map((metadata) => ({
            tableId: metadata.tableId,
            status: metadata.status,
            missing: metadata.missing,
          }))
          .sort((left, right) => left.tableId.localeCompare(right.tableId)),
      })}
    </output>
  ),
}));

import SchemaErdPanel from "./SchemaErdPanel";

const INDEXES = [
  {
    name: "users_email_idx",
    columns: ["email"],
    index_type: "btree",
    is_unique: true,
    is_primary: false,
  },
];

const CONSTRAINTS = [
  {
    name: "users_email_key",
    constraint_type: "UNIQUE",
    columns: ["email"],
    reference_table: null,
    reference_columns: null,
  },
];

describe("SchemaErdPanel", () => {
  beforeEach(() => {
    setupTauriMock({
      getTableIndexes: vi.fn(() => Promise.resolve(INDEXES)),
      getTableConstraints: vi.fn(() => Promise.resolve(CONSTRAINTS)),
      listSchemas: vi.fn(() => Promise.resolve([])),
      listTables: vi.fn(() => Promise.resolve([])),
      listSchemaColumns: vi.fn(() => Promise.resolve({})),
    });
    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "Local Postgres",
          dbType: "postgresql",
          paradigm: "rdb",
          host: "localhost",
          port: 5432,
          user: "postgres",
          database: "app",
          groupId: null,
          color: null,
          hasPassword: false,
        },
      ],
      activeStatuses: { conn1: { type: "connected", activeDb: "app" } },
      focusedConnId: "conn1",
    });
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      postgresExtensions: {},
      sqliteCapabilities: {},
      tableColumnsCache: {},
      tableIndexesCache: {},
      tableConstraintsCache: {},
      triggers: {},
      loading: false,
      error: null,
    });
  });

  it("passes cached table indexes and constraints into the ERD graph", () => {
    useSchemaStore.setState({
      schemas: { conn1: { app: [{ name: "public" }] } },
      tables: {
        conn1: {
          app: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
        },
      },
      tableColumnsCache: {
        conn1: { app: { public: { users: [emailColumn()] } } },
      },
      tableIndexesCache: {
        conn1: { app: { public: { users: INDEXES } } },
      },
      tableConstraintsCache: {
        conn1: { app: { public: { users: CONSTRAINTS } } },
      },
    });

    render(<SchemaErdPanel connectionId="conn1" database="app" />);

    expect(readGraphSummary().indexes).toEqual([
      "table:public.users.index:users_email_idx",
    ]);
    expect(readGraphSummary().constraints).toEqual([
      "table:public.users.constraint:users_email_key",
    ]);
    expect(readGraphSummary().metadata).toEqual([
      {
        tableId: "table:public.users",
        status: "ready",
        missing: [],
      },
    ]);
  });

  it("fetches missing table metadata for loaded ERD tables and renders it", async () => {
    const tauri = await import("@lib/tauri");
    useSchemaStore.setState({
      schemas: { conn1: { app: [{ name: "public" }] } },
      tables: {
        conn1: {
          app: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
        },
      },
      tableColumnsCache: {
        conn1: { app: { public: { users: [emailColumn()] } } },
      },
    });

    render(<SchemaErdPanel connectionId="conn1" database="app" />);

    expect(readGraphSummary().metadata).toEqual([
      {
        tableId: "table:public.users",
        status: "partial",
        missing: ["indexes", "constraints"],
      },
    ]);

    await waitFor(() => {
      expect(tauri.getTableIndexes).toHaveBeenCalledTimes(1);
      expect(tauri.getTableConstraints).toHaveBeenCalledTimes(1);
    });
    expect(tauri.getTableIndexes).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "app",
    );
    expect(tauri.getTableConstraints).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "app",
    );

    await waitFor(() => {
      expect(readGraphSummary().indexes).toEqual([
        "table:public.users.index:users_email_idx",
      ]);
      expect(readGraphSummary().constraints).toEqual([
        "table:public.users.constraint:users_email_key",
      ]);
      expect(readGraphSummary().metadata).toEqual([
        {
          tableId: "table:public.users",
          status: "ready",
          missing: [],
        },
      ]);
    });
  });

  it("shows non-RDB and file analytics aliases as unsupported for SchemaGraph", async () => {
    const tauri = await import("@lib/tauri");
    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "Document Store",
          dbType: "mongodb",
          paradigm: "document",
          host: "localhost",
          port: 27017,
          user: "mongo",
          database: "app",
          groupId: null,
          color: null,
          hasPassword: false,
        },
      ],
    });

    render(<SchemaErdPanel connectionId="conn1" database="app" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /erd and dependency view are available for relational runtime adapters/i,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /file analytics aliases do not expose this schemagraph surface/i,
    );
    expect(tauri.getTableIndexes).not.toHaveBeenCalled();
    expect(tauri.getTableConstraints).not.toHaveBeenCalled();
  });
});

function emailColumn() {
  return {
    name: "email",
    data_type: "text",
    nullable: false,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  };
}

function readGraphSummary(): {
  indexes: string[];
  constraints: string[];
  metadata: {
    tableId: string;
    status: string;
    missing: string[];
  }[];
} {
  const text = screen.getByLabelText("erd graph").textContent ?? "{}";
  return JSON.parse(text) as {
    indexes: string[];
    constraints: string[];
    metadata: {
      tableId: string;
      status: string;
      missing: string[];
    }[];
  };
}
