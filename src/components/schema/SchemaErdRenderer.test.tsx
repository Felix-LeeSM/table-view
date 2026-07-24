import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { extractSchemaGraph } from "@/lib/schemaGraph";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import type { ColumnInfo, TableInfo } from "@/types/schema";
import { buildErdCanvasModel } from "./erdCanvasModel";

// Deterministic layout stub: keeps the real model->React Flow mapping and node
// type/constants, but replaces the elkjs run with a fixed grid so component
// tests are fast and independent of the layout engine (P1 layer separation).
// `measured` is supplied so React Flow treats each node as laid out and paints
// it `visibility: visible` — jsdom's no-op ResizeObserver never measures nodes,
// which in a real browser it does.
vi.mock("./erdCanvasLayout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./erdCanvasLayout")>();
  return {
    ...actual,
    layoutErdCanvasModel: vi.fn(
      async (model: import("./erdCanvasModel").ErdCanvasModel) => ({
        nodes: model.nodes.map((node, index) => ({
          id: node.id,
          type: actual.ERD_TABLE_NODE_TYPE,
          position: { x: index * 320, y: index * 240 },
          measured: {
            width: actual.ERD_NODE_WIDTH,
            height: actual.erdNodeHeight(node.data.columns.length),
          },
          data: node.data,
        })),
        edges: model.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          ariaLabel: edge.label,
          focusable: false,
        })),
      }),
    ),
  };
});

import SchemaErdRenderer from "./SchemaErdRenderer";

// Purpose: ERD canvas foundation (#1655, ADR 0054) — the React Flow renderer
// that replaces the hand-rolled SVG one. Covers the read-only render contract:
// table nodes list their columns, FK relationships are surfaced, empty/isolated
// states hold, and a fit-to-view control is present.
describe("SchemaErdRenderer", () => {
  // Reason: node = table with its columns rendered via semantic roles/text, so
  // the diagram is legible and a11y-visible (#1655, 2026-07-25).
  it("renders table nodes with their columns on the canvas", async () => {
    render(<SchemaErdRenderer graph={extractSchemaGraph(ordersSnapshot())} />);

    expect(
      screen.getByRole("figure", { name: /database relationship diagram/i }),
    ).toBeInTheDocument();

    const users = await screen.findByRole("group", {
      name: /public\.users table/i,
    });
    expect(within(users).getByText("id")).toBeInTheDocument();
    expect(within(users).getByText("email")).toBeInTheDocument();
    expect(within(users).getByLabelText("primary key")).toBeInTheDocument();

    const orders = await screen.findByRole("group", {
      name: /public\.orders table/i,
    });
    expect(within(orders).getByText("user_id")).toBeInTheDocument();
    expect(within(orders).getByLabelText("foreign key")).toBeInTheDocument();
  });

  // Reason: FK relationships must be represented — asserted both in the model
  // (edge with reference label) and surfaced to the user as the header
  // relationship count (#1655, 2026-07-25).
  it("surfaces FK relationships as edges and a relationship count", () => {
    const graph = extractSchemaGraph(ordersSnapshot());
    const model = buildErdCanvasModel(graph);

    expect(model.edges).toEqual([
      {
        id: expect.any(String),
        source: "table:public.orders",
        target: "table:public.users",
        label: "public.orders.user_id references public.users.id",
      },
    ]);

    render(<SchemaErdRenderer graph={graph} />);
    expect(screen.getByText("2 tables / 1 relationships")).toBeInTheDocument();
  });

  // Reason: an isolated table (no FK) still renders as a node with zero
  // relationships; an empty schema shows the "no tables" status instead of an
  // empty canvas (#1655, 2026-07-25).
  it("shows isolated-table and empty states", async () => {
    const { rerender } = render(
      <SchemaErdRenderer graph={extractSchemaGraph(isolatedSnapshot())} />,
    );
    expect(
      await screen.findByRole("group", {
        name: /main\.events table/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 tables / 0 relationships")).toBeInTheDocument();

    rerender(<SchemaErdRenderer graph={extractSchemaGraph(emptySnapshot())} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /no tables to diagram/i,
    );
  });

  // Reason: fit-to-view is the one explicit viewport control for the read-only
  // foundation (zoom/pan are React Flow built-ins); it must exist and be
  // operable without throwing (#1655, 2026-07-25).
  it("exposes a fit-to-view control", async () => {
    render(<SchemaErdRenderer graph={extractSchemaGraph(ordersSnapshot())} />);

    await screen.findByRole("group", {
      name: /public\.users table/i,
    });
    const fit = screen.getByRole("button", { name: /fit erd/i });
    expect(fit).toBeInTheDocument();
    fireEvent.click(fit);
    expect(fit).toBeInTheDocument();
  });
});

function ordersSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "users"), table("public", "orders")],
    },
    columnsByTable: {
      public: {
        users: [
          column("id", { is_primary_key: true }),
          column("email", { data_type: "text" }),
        ],
        orders: [
          column("id", { is_primary_key: true }),
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
        ],
      },
    },
    constraintsByTable: {},
    indexesByTable: {},
  };
}

function isolatedSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "duckdb", database: "events.duckdb" },
    schemas: [{ name: "main" }],
    tablesBySchema: { main: [table("main", "events")] },
    columnsByTable: {
      main: { events: [column("id", { is_primary_key: true })] },
    },
    constraintsByTable: {},
    indexesByTable: {},
  };
}

function emptySnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "sqlite", database: "empty.sqlite" },
    schemas: [],
    tablesBySchema: {},
    columnsByTable: {},
    constraintsByTable: {},
    indexesByTable: {},
  };
}

function table(schema: string, name: string): TableInfo {
  return { schema, name, row_count: null };
}

function column(name: string, overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name,
    data_type: "integer",
    nullable: false,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
    ...overrides,
  };
}
