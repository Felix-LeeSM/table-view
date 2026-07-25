import { describe, expect, it } from "vitest";
import { extractSchemaGraph } from "@/lib/schemaGraph";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import type { ColumnInfo, TableInfo } from "@/types/schema";
import { buildErdCanvasModel } from "./erdCanvasModel";

// Purpose: ERD canvas foundation (#1655, ADR 0054) — pure SchemaGraph → canvas
// model adapter (table nodes + columns + FK edges), independent of React Flow
// and elkjs (P1 layer separation).
describe("buildErdCanvasModel", () => {
  // Reason: node = table carrying its columns in ordinal order; edge = FK
  // relationship with a legible reference label — the read-only render contract
  // #1655 replaces the hand-rolled SVG renderer with (2026-07-25).
  it("maps table nodes with ordered columns and FK edges from a SchemaGraph", () => {
    const model = buildErdCanvasModel(extractSchemaGraph(ordersSnapshot()));

    const nodeIds = model.nodes.map((node) => node.id).sort();
    expect(nodeIds).toEqual(["table:public.orders", "table:public.users"]);

    const orders = model.nodes.find(
      (node) => node.id === "table:public.orders",
    );
    expect(orders?.data.table.table).toBe("orders");
    expect(orders?.data.columns.map((column) => column.column)).toEqual([
      "id",
      "user_id",
    ]);

    expect(model.edges).toEqual([
      {
        id: expect.any(String),
        source: "table:public.orders",
        target: "table:public.users",
        label: "public.orders.user_id references public.users.id",
      },
    ]);
  });

  // Reason: isolated tables (no FK) still render as nodes; the canvas must not
  // drop them just because they have no relationships (#1655, 2026-07-25).
  it("keeps isolated tables and yields no edges when there are no FKs", () => {
    const model = buildErdCanvasModel(extractSchemaGraph(isolatedSnapshot()));

    expect(model.nodes.map((node) => node.id)).toEqual(["table:main.events"]);
    expect(model.edges).toEqual([]);
  });

  // Reason: columns are grouped by the shared `schemaGraphTableId` encoding, so
  // quoted identifiers containing the delimiter ("a"."b c" vs "a b"."c") cannot
  // collide and leak each other's columns (#1655 review, 2026-07-25).
  it("keeps columns apart for identifiers that share a naive schema/table join", () => {
    const model = buildErdCanvasModel(extractSchemaGraph(ambiguousSnapshot()));

    const first = model.nodes.find((node) => node.data.table.table === "b c");
    const second = model.nodes.find((node) => node.data.table.schema === "a b");
    expect(first?.data.columns.map((column) => column.column)).toEqual(["x"]);
    expect(second?.data.columns.map((column) => column.column)).toEqual(["y"]);
  });

  // Reason: an empty schema produces an empty model so the canvas can show its
  // "no tables to diagram" state instead of an empty React Flow (#1655).
  it("returns an empty model for an empty snapshot", () => {
    const model = buildErdCanvasModel(extractSchemaGraph(emptySnapshot()));
    expect(model.nodes).toEqual([]);
    expect(model.edges).toEqual([]);
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

function ambiguousSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "a" }, { name: "a b" }],
    tablesBySchema: {
      a: [table("a", "b c")],
      "a b": [table("a b", "c")],
    },
    columnsByTable: {
      a: { "b c": [column("x")] },
      "a b": { c: [column("y")] },
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
