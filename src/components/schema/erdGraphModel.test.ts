import { describe, expect, it } from "vitest";
import { extractSchemaGraph } from "@/lib/schemaGraph";
import type { ColumnInfo, TableInfo } from "@/types/schema";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import {
  buildErdElkGraph,
  buildErdModel,
  buildErdNeighborhood,
  ERD_MAX_VISIBLE_COLUMNS,
  ERD_SCHEMA_TONE_COUNT,
  ERD_TABLE_WIDTH,
  erdModelFingerprint,
  erdReferenceCounts,
  erdSchemaToneIndex,
  erdTableHeight,
  filterErdTables,
  layoutErdModel,
} from "./erdGraphModel";

describe("buildErdModel", () => {
  it("keeps every table and its FK edges from the SchemaGraph", () => {
    const model = buildErdModel(extractSchemaGraph(ordersSnapshot()));

    expect(model.tables.map((entry) => entry.qualifiedName)).toEqual([
      "public.orders",
      "public.payments",
      "public.users",
    ]);
    expect(
      model.relationships.map((relationship) => [
        relationship.sourceTableId,
        relationship.targetTableId,
        relationship.label,
      ]),
    ).toEqual([
      [
        "table:public.orders",
        "table:public.users",
        "public.orders.user_id references public.users.id",
      ],
      [
        "table:public.payments",
        "table:public.orders",
        "public.payments.order_id references public.orders.id",
      ],
    ]);
  });

  it("orders columns and sizes the card from the rows it will draw", () => {
    const model = buildErdModel(extractSchemaGraph(wideTableSnapshot()));
    const table = model.tables[0]!;

    expect(table.columns).toHaveLength(9);
    expect(table.visibleColumns.map((column) => column.column)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
    ]);
    expect(table.visibleColumns).toHaveLength(ERD_MAX_VISIBLE_COLUMNS);
    expect(table.hiddenColumnCount).toBe(3);
    expect(table.width).toBe(ERD_TABLE_WIDTH);
    // 6 column rows + the "+3 more columns" row.
    expect(table.height).toBe(erdTableHeight(6, 3));
    expect(erdTableHeight(6, 3)).toBeGreaterThan(erdTableHeight(2, 0));
  });

  it("drops FK edges whose endpoint table is absent from the graph", () => {
    const model = buildErdModel(extractSchemaGraph(danglingFkSnapshot()));

    expect(model.tables).toHaveLength(1);
    expect(model.relationships).toEqual([]);
  });
});

describe("erdModelFingerprint", () => {
  // The ERD panel keeps fetching indexes/constraints per table after first
  // paint, so a fresh SchemaGraph object arrives many times for the same
  // diagram. Re-laying out on each one would throw away every node the user
  // dragged, so only the table set and the FK edge set may change the identity.
  it("ignores metadata that arrives after the tables and FKs are known", () => {
    const bare = buildErdModel(extractSchemaGraph(ordersSnapshot()));
    const enriched = buildErdModel(
      extractSchemaGraph(ordersSnapshotWithMetadata()),
    );

    const columnCount = (
      model: ReturnType<typeof buildErdModel>,
      qualifiedName: string,
    ) =>
      model.tables.find((entry) => entry.qualifiedName === qualifiedName)
        ?.columns.length;

    expect(columnCount(bare, "public.users")).toBe(2);
    expect(columnCount(enriched, "public.users")).toBe(3);
    // The FK constraint landing renames the edge id (synthetic -> real
    // constraint name) without changing which tables the edge joins.
    expect(bare.relationships.map((entry) => entry.edge.id)).not.toEqual(
      enriched.relationships.map((entry) => entry.edge.id),
    );
    expect(erdModelFingerprint(enriched)).toBe(erdModelFingerprint(bare));
  });

  it("changes when a table or a foreign key enters the graph", () => {
    const base = erdModelFingerprint(
      buildErdModel(extractSchemaGraph(ordersSnapshot())),
    );

    const withExtraTable = ordersSnapshot();
    const extraTables = {
      ...withExtraTable,
      tablesBySchema: {
        public: [
          ...withExtraTable.tablesBySchema.public!,
          table("public", "refunds"),
        ],
      },
      columnsByTable: {
        public: {
          ...withExtraTable.columnsByTable.public,
          refunds: [column("id", { is_primary_key: true })],
        },
      },
    };
    expect(
      erdModelFingerprint(buildErdModel(extractSchemaGraph(extraTables))),
    ).not.toBe(base);

    const extraFk = {
      ...withExtraTable,
      columnsByTable: {
        public: {
          ...withExtraTable.columnsByTable.public,
          payments: [
            column("id", { is_primary_key: true }),
            column("order_id", {
              is_foreign_key: true,
              fk_reference: "public.orders(id)",
            }),
            column("user_id", {
              is_foreign_key: true,
              fk_reference: "public.users(id)",
            }),
          ],
        },
      },
    };
    expect(
      erdModelFingerprint(buildErdModel(extractSchemaGraph(extraFk))),
    ).not.toBe(base);
  });
});

describe("buildErdElkGraph", () => {
  it("hands elkjs the most-referenced tables first and tags them with priority", () => {
    const model = buildErdModel(extractSchemaGraph(hubSnapshot()));
    const elkGraph = buildErdElkGraph(model);

    expect(erdReferenceCounts(model).get("table:public.users")).toBe(3);
    expect(
      (elkGraph.children ?? []).map((child) => [
        child.id,
        child.layoutOptions?.["elk.priority"],
      ]),
    ).toEqual([
      ["table:public.users", "3"],
      ["table:public.a", "0"],
      ["table:public.b", "0"],
      ["table:public.c", "0"],
    ]);
    expect(elkGraph.layoutOptions?.["elk.algorithm"]).toBe("layered");
    expect(elkGraph.layoutOptions?.["elk.layered.cycleBreaking.strategy"]).toBe(
      "GREEDY",
    );
  });

  it("carries every node size elkjs needs to place a table", () => {
    const model = buildErdModel(extractSchemaGraph(ordersSnapshot()));

    for (const child of buildErdElkGraph(model).children ?? []) {
      expect(child.width).toBe(ERD_TABLE_WIDTH);
      expect(child.height).toBeGreaterThan(0);
    }
  });
});

describe("layoutErdModel", () => {
  it("ranks referenced tables above the tables that reference them", async () => {
    const model = buildErdModel(extractSchemaGraph(ordersSnapshot()));
    const positions = await layoutErdModel(model);

    const users = positions.get("table:public.users");
    const orders = positions.get("table:public.orders");
    const payments = positions.get("table:public.payments");
    expect(users).toBeDefined();
    expect(orders).toBeDefined();
    expect(payments).toBeDefined();
    // orders -> users and payments -> orders, so the FK chain reads upward.
    expect(users?.y).toBeLessThan(orders?.y ?? 0);
    expect(orders?.y).toBeLessThan(payments?.y ?? 0);
  });

  it("lays out a circular FK graph instead of failing on it", async () => {
    const model = buildErdModel(extractSchemaGraph(cycleSnapshot()));
    const positions = await layoutErdModel(model);

    expect(model.relationships).toHaveLength(3);
    expect([...positions.keys()].sort()).toEqual([
      "table:public.a",
      "table:public.b",
      "table:public.c",
    ]);
    for (const position of positions.values()) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
  });

  it("lays out a self-referencing table", async () => {
    const model = buildErdModel(extractSchemaGraph(selfReferenceSnapshot()));
    const positions = await layoutErdModel(model);

    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0]!.sourceTableId).toBe(
      model.relationships[0]!.targetTableId,
    );
    expect(positions.get("table:public.employees")).toBeDefined();
  });

  it("returns nothing to place for an empty graph", async () => {
    const positions = await layoutErdModel(
      buildErdModel(extractSchemaGraph(emptySnapshot())),
    );
    expect(positions.size).toBe(0);
  });
});

describe("buildErdNeighborhood", () => {
  it("collects only the edges and tables one FK hop from the selection", () => {
    const model = buildErdModel(extractSchemaGraph(ordersSnapshot()));
    const neighborhood = buildErdNeighborhood(
      model.relationships,
      "table:public.users",
    );

    expect([...neighborhood.relatedTableIds].sort()).toEqual([
      "table:public.orders",
      "table:public.users",
    ]);
    expect(neighborhood.highlightedEdgeIds.size).toBe(1);
  });

  it("highlights nothing without a selection", () => {
    const model = buildErdModel(extractSchemaGraph(ordersSnapshot()));
    const neighborhood = buildErdNeighborhood(model.relationships, null);

    expect(neighborhood.relatedTableIds.size).toBe(0);
    expect(neighborhood.highlightedEdgeIds.size).toBe(0);
  });
});

describe("filterErdTables", () => {
  it("matches the qualified name case-insensitively and keeps everything for a blank term", () => {
    const model = buildErdModel(extractSchemaGraph(ordersSnapshot()));

    expect(
      filterErdTables(model.tables, "PAY").map((entry) => entry.qualifiedName),
    ).toEqual(["public.payments"]);
    expect(filterErdTables(model.tables, "public.").length).toBe(3);
    expect(filterErdTables(model.tables, "   ").length).toBe(3);
    expect(filterErdTables(model.tables, "missing")).toEqual([]);
  });
});

describe("erdSchemaToneIndex", () => {
  it("is deterministic and stays inside the defined tone set", () => {
    for (const schema of ["public", "sales", "analytics", "main", "", "x"]) {
      const tone = erdSchemaToneIndex(schema);
      expect(tone).toBe(erdSchemaToneIndex(schema));
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(ERD_SCHEMA_TONE_COUNT);
    }
  });
});

function ordersSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        table("public", "users"),
        table("public", "orders"),
        table("public", "payments"),
      ],
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
        payments: [
          column("id", { is_primary_key: true }),
          column("order_id", {
            is_foreign_key: true,
            fk_reference: "public.orders(id)",
          }),
        ],
      },
    },
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function ordersSnapshotWithMetadata(): SchemaGraphCatalogSnapshot {
  const base = ordersSnapshot();
  return {
    ...base,
    columnsByTable: {
      public: {
        ...base.columnsByTable.public,
        users: [
          column("id", { is_primary_key: true }),
          column("email", { data_type: "text" }),
          column("age", { data_type: "integer" }),
        ],
      },
    },
    indexesByTable: {
      public: {
        users: [
          {
            name: "users_email_idx",
            columns: ["email"],
            index_type: "btree",
            is_unique: true,
            is_primary: false,
          },
        ],
        orders: [],
        payments: [],
      },
    },
    constraintsByTable: {
      public: {
        users: [
          {
            name: "users_email_key",
            constraint_type: "UNIQUE",
            columns: ["email"],
            reference_table: null,
            reference_columns: null,
          },
        ],
        orders: [
          {
            name: "orders_user_id_fkey",
            constraint_type: "FOREIGN KEY",
            columns: ["user_id"],
            reference_table: "public.users",
            reference_columns: ["id"],
          },
        ],
        payments: [
          {
            name: "payments_order_id_fkey",
            constraint_type: "FOREIGN KEY",
            columns: ["order_id"],
            reference_table: "public.orders",
            reference_columns: ["id"],
          },
        ],
      },
    },
  };
}

function hubSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        table("public", "a"),
        table("public", "b"),
        table("public", "c"),
        table("public", "users"),
      ],
    },
    columnsByTable: {
      public: {
        users: [column("id", { is_primary_key: true })],
        a: [referenceColumn("public.users(id)")],
        b: [referenceColumn("public.users(id)")],
        c: [referenceColumn("public.users(id)")],
      },
    },
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function cycleSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        table("public", "a"),
        table("public", "b"),
        table("public", "c"),
      ],
    },
    columnsByTable: {
      public: {
        a: [
          column("id", { is_primary_key: true }),
          referenceColumn("public.b(id)"),
        ],
        b: [
          column("id", { is_primary_key: true }),
          referenceColumn("public.c(id)"),
        ],
        c: [
          column("id", { is_primary_key: true }),
          referenceColumn("public.a(id)"),
        ],
      },
    },
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function selfReferenceSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: { public: [table("public", "employees")] },
    columnsByTable: {
      public: {
        employees: [
          column("id", { is_primary_key: true }),
          column("manager_id", {
            is_foreign_key: true,
            fk_reference: "public.employees(id)",
          }),
        ],
      },
    },
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function danglingFkSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: { public: [table("public", "orders")] },
    columnsByTable: {
      public: {
        orders: [
          column("id", { is_primary_key: true }),
          referenceColumn("public.accounts(id)"),
        ],
      },
    },
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function wideTableSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "duckdb", database: "wide.duckdb" },
    schemas: [{ name: "main" }],
    tablesBySchema: { main: [table("main", "wide")] },
    columnsByTable: {
      main: {
        wide: Array.from({ length: 9 }, (_unused, index) =>
          column(`c${index + 1}`),
        ),
      },
    },
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function emptySnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "sqlite", database: "empty.sqlite" },
    schemas: [],
    tablesBySchema: {},
    columnsByTable: {},
    indexesByTable: {},
    constraintsByTable: {},
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

function referenceColumn(fkReference: string): ColumnInfo {
  return column("ref_id", { is_foreign_key: true, fk_reference: fkReference });
}
