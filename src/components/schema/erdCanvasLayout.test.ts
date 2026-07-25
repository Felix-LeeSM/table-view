import { describe, expect, it } from "vitest";
import { MarkerType } from "@xyflow/react";
import { extractSchemaGraph } from "@/lib/schemaGraph";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import type { ColumnInfo, TableInfo } from "@/types/schema";
import { buildErdCanvasModel } from "./erdCanvasModel";
import {
  ERD_TABLE_NODE_TYPE,
  erdNodeHeight,
  layoutErdCanvasModel,
} from "./erdCanvasLayout";

// Purpose: ERD canvas foundation (#1655, ADR 0054) — elkjs `layered` layout
// adapter. Runs the real (deterministic) main-thread elk build so the wiring
// between the pure model and React Flow-shaped positioned nodes/edges is
// covered end to end.
describe("layoutErdCanvasModel", () => {
  // Reason: every table node must receive a finite elk-computed position and
  // the canvas node type/data must survive the layout pass; FK edges are
  // preserved with an accessible label (#1655, 2026-07-25).
  it("assigns finite positions to all nodes and preserves FK edges", async () => {
    const model = buildErdCanvasModel(extractSchemaGraph(ordersSnapshot()));

    const layout = await layoutErdCanvasModel(model);

    expect(layout.nodes).toHaveLength(2);
    for (const node of layout.nodes) {
      expect(node.type).toBe(ERD_TABLE_NODE_TYPE);
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
    expect(layout.nodes.map((node) => node.data.table.table).sort()).toEqual([
      "orders",
      "users",
    ]);

    // Referenced table (users) is placed on a higher layer (smaller y) than the
    // referencing table (orders) under `elk.direction: DOWN` — ADR 0054.
    expect(nodeY(layout, "table:public.users")).toBeLessThan(
      nodeY(layout, "table:public.orders"),
    );

    expect(layout.edges).toEqual([
      {
        id: expect.any(String),
        source: "table:public.orders",
        target: "table:public.users",
        ariaLabel: "public.orders.user_id references public.users.id",
        focusable: false,
      },
    ]);
  });

  // Reason: regression — PR #1783 review (2026-07-25) found FK edges rendered
  // without an arrow head, a behavior regression against the hand-rolled SVG
  // renderer on `main`, which pointed a `marker-end` arrow at the referenced
  // table. Direction is the whole meaning of an FK edge, so the marker is part
  // of the layout contract, not styling.
  it("marks every FK edge with an arrow head pointing at the referenced table", async () => {
    const model = buildErdCanvasModel(extractSchemaGraph(ordersSnapshot()));

    const layout = await layoutErdCanvasModel(model);

    expect(layout.edges).not.toHaveLength(0);
    for (const edge of layout.edges) {
      expect(edge.markerEnd).toEqual({ type: MarkerType.ArrowClosed });
    }
  });

  // Reason: node height scales with column count (so elk reserves vertical
  // room), never collapsing below a one-row minimum (#1655, 2026-07-25).
  it("derives node height from column count with a one-row floor", () => {
    expect(erdNodeHeight(0)).toBe(erdNodeHeight(1));
    expect(erdNodeHeight(5)).toBeGreaterThan(erdNodeHeight(1));
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
        users: [column("id", { is_primary_key: true })],
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

function nodeY(
  layout: Awaited<ReturnType<typeof layoutErdCanvasModel>>,
  id: string,
): number {
  const node = layout.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`missing node ${id}`);
  return node.position.y;
}
