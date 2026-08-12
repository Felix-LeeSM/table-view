import { describe, expect, it } from "vitest";
import { extractSchemaGraph } from "@/lib/schemaGraph";
import type { ColumnInfo, IndexInfo, TableInfo } from "@/types/schema";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import {
  buildErdElkGraph,
  buildErdModel,
  buildErdNeighborhood,
  ERD_DETAIL_ZOOM_FULL,
  ERD_DETAIL_ZOOM_KEYS,
  ERD_SCHEMA_TONE_COUNT,
  ERD_TABLE_WIDTH,
  erdCardShape,
  erdColumnHandleId,
  erdDetailLevel,
  erdModelFingerprint,
  erdReferenceCounts,
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

  it("orders columns and reserves a slot sized for every one of them", () => {
    const model = buildErdModel(extractSchemaGraph(wideTableSnapshot()));
    const table = model.tables[0]!;

    expect(table.columns.map((column) => column.column)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
      "c8",
      "c9",
    ]);
    expect(table.width).toBe(ERD_TABLE_WIDTH);
    // No six-column cap any more: the slot elkjs gets is the full-detail card,
    // which is the tallest semantic zoom can ever make it.
    expect(table.layoutHeight).toBe(erdTableHeight(9, 0));
    expect(erdTableHeight(9, 0)).toBeGreaterThan(erdTableHeight(2, 0));
  });

  it("drops FK edges whose endpoint table is absent from the graph", () => {
    const model = buildErdModel(extractSchemaGraph(danglingFkSnapshot()));

    expect(model.tables).toHaveLength(1);
    expect(model.relationships).toEqual([]);
  });
});

describe("column anchors", () => {
  it("names the FK column at both ends and lists it on both cards", () => {
    const model = buildErdModel(extractSchemaGraph(ordersSnapshot()));

    expect(
      model.relationships.map((relationship) => [
        relationship.sourceTableId,
        relationship.sourceColumn,
        relationship.targetTableId,
        relationship.targetColumn,
      ]),
    ).toEqual([
      ["table:public.orders", "user_id", "table:public.users", "id"],
      ["table:public.payments", "order_id", "table:public.orders", "id"],
    ]);

    // `orders` is both an FK holder and a reference target, so its card needs
    // a handle for the column it points from and the one it is pointed at.
    expect(
      model.tables.map((entry) => [entry.qualifiedName, entry.anchorColumns]),
    ).toEqual([
      ["public.orders", ["id", "user_id"]],
      ["public.payments", ["order_id"]],
      ["public.users", ["id"]],
    ]);
  });

  it("keeps an anchor for a column no detail level draws", () => {
    const model = buildErdModel(extractSchemaGraph(lateColumnFkSnapshot()));
    const wide = model.tables.find(
      (entry) => entry.qualifiedName === "public.wide",
    )!;

    // ADR 0054 (2) retired the six-column cap, so the level that draws no
    // column row at all is what now hides an anchor column. React Flow drops
    // an edge whose handle id is missing, so the anchor list must not follow
    // the level down.
    expect(erdCardShape(wide, "compact").visibleColumns).toEqual([]);
    expect(wide.anchorColumns).toEqual(["owner_id"]);
  });

  it("keeps the two handles of one column apart", () => {
    expect(erdColumnHandleId("source", "user_id")).not.toBe(
      erdColumnHandleId("target", "user_id"),
    );
    expect(erdColumnHandleId("source", "user_id")).not.toBe(
      erdColumnHandleId("source", "order_id"),
    );
  });
});

describe("cardinality", () => {
  it("reads a foreign key onto a primary key as 1:N", () => {
    const model = buildErdModel(extractSchemaGraph(ordersSnapshot()));

    expect(
      model.relationships.map((relationship) => relationship.cardinality),
    ).toEqual(["1:N", "1:N"]);
  });

  // The property this pins is that `IndexInfo.is_unique` — not the presence of
  // an index, not the column name — is what separates 1:1 from 1:N.
  it("turns 1:N into 1:1 only when the FK column's index is unique", () => {
    const unique = buildErdModel(
      extractSchemaGraph(
        profileSnapshot({ index: ["user_id"], isUnique: true }),
      ),
    );
    const nonUnique = buildErdModel(
      extractSchemaGraph(
        profileSnapshot({ index: ["user_id"], isUnique: false }),
      ),
    );

    expect(unique.relationships[0]?.cardinality).toBe("1:1");
    expect(nonUnique.relationships[0]?.cardinality).toBe("1:N");
  });

  // A unique index over (user_id, tenant_id) permits many rows per user_id, so
  // it must not be read as pinning the FK column on its own.
  it("does not let a wider unique index pin the FK column", () => {
    const model = buildErdModel(
      extractSchemaGraph(
        profileSnapshot({ index: ["user_id", "tenant_id"], isUnique: true }),
      ),
    );

    expect(model.relationships[0]?.cardinality).toBe("1:N");
  });

  it("reads a reference onto a column with no key as N:M", () => {
    const loose = buildErdModel(
      extractSchemaGraph(looseReferenceSnapshot({ uniqueHandle: false })),
    );
    const keyed = buildErdModel(
      extractSchemaGraph(looseReferenceSnapshot({ uniqueHandle: true })),
    );

    expect(loose.relationships[0]?.cardinality).toBe("N:M");
    // The same graph with a unique index on the referenced column pins that
    // end, which is the only difference between N:M and 1:N here.
    expect(keyed.relationships[0]?.cardinality).toBe("1:N");
  });
});

// ADR 0054 (2): the fixed six-column cap is retired and the zoom step decides
// how much of a table a card spells out.
describe("semantic zoom", () => {
  it("maps zoom onto the three detail levels at the published thresholds", () => {
    expect(erdDetailLevel(0.15)).toBe("compact");
    expect(erdDetailLevel(ERD_DETAIL_ZOOM_KEYS - 0.01)).toBe("compact");
    expect(erdDetailLevel(ERD_DETAIL_ZOOM_KEYS)).toBe("keys");
    expect(erdDetailLevel(ERD_DETAIL_ZOOM_FULL - 0.01)).toBe("keys");
    expect(erdDetailLevel(ERD_DETAIL_ZOOM_FULL)).toBe("full");
    expect(erdDetailLevel(2)).toBe("full");
    // An unmeasured viewport must not blank every card out.
    expect(erdDetailLevel(Number.NaN)).toBe("full");
  });

  it("draws the box, then the key columns, then every column", () => {
    const table = buildErdModel(extractSchemaGraph(keyedTableSnapshot()))
      .tables[0]!;

    expect(erdCardShape(table, "compact").visibleColumns).toEqual([]);
    expect(erdCardShape(table, "compact").hiddenColumnCount).toBe(4);
    expect(
      erdCardShape(table, "keys").visibleColumns.map((column) => column.column),
    ).toEqual(["id", "order_id"]);
    expect(erdCardShape(table, "keys").hiddenColumnCount).toBe(2);
    // `extractSchemaGraph` sorts columns by name, and every level keeps that
    // order — the key filter must not reshuffle the rows.
    expect(
      erdCardShape(table, "full").visibleColumns.map((column) => column.column),
    ).toEqual(["amount", "id", "note", "order_id"]);
    expect(erdCardShape(table, "full").hiddenColumnCount).toBe(0);
  });

  // The layout input is what a re-run keys on, and a re-run resets every node
  // position — so zooming must shrink the card without touching the slot.
  it("shrinks the card with the level and leaves the elkjs slot alone", () => {
    const model = buildErdModel(extractSchemaGraph(keyedTableSnapshot()));
    const table = model.tables[0]!;

    expect(erdCardShape(table, "compact").height).toBeLessThan(
      erdCardShape(table, "keys").height,
    );
    expect(erdCardShape(table, "keys").height).toBeLessThan(
      erdCardShape(table, "full").height,
    );
    expect(erdCardShape(table, "full").height).toBe(table.layoutHeight);
    for (const child of buildErdElkGraph(model).children ?? []) {
      expect(child.height).toBe(table.layoutHeight);
    }
  });

  // Every column is a key here, so the mid-range card hides nothing and the
  // overflow marker must stay away.
  it("reports no hidden columns when the keys are the whole table", () => {
    const table = buildErdModel(extractSchemaGraph(hubSnapshot())).tables.find(
      (entry) => entry.qualifiedName === "public.a",
    )!;

    expect(table.columns.map((column) => column.column)).toEqual(["ref_id"]);
    expect(erdCardShape(table, "keys").hiddenColumnCount).toBe(0);
    expect(erdCardShape(table, "keys").height).toBe(table.layoutHeight);
  });
});

describe("erdModelFingerprint", () => {
  // The ERD panel keeps fetching indexes/constraints per table after first
  // paint, so a fresh SchemaGraph object arrives many times for the same
  // diagram. Re-laying out on each one would throw away every node the user
  // dragged, so metadata that elkjs never reads must not change the identity.
  it("ignores index and constraint metadata that arrives after first paint", () => {
    const bare = buildErdModel(extractSchemaGraph(ordersSnapshot()));
    const enriched = buildErdModel(
      extractSchemaGraph(ordersSnapshotWithMetadata()),
    );

    expect(enriched.tables.map((entry) => entry.layoutHeight)).toEqual(
      bare.tables.map((entry) => entry.layoutHeight),
    );
    // The FK constraint landing renames the edge id (synthetic -> real
    // constraint name) without changing which tables the edge joins.
    expect(bare.relationships.map((entry) => entry.edge.id)).not.toEqual(
      enriched.relationships.map((entry) => entry.edge.id),
    );
    expect(erdModelFingerprint(enriched)).toBe(erdModelFingerprint(bare));
  });

  // `SchemaErdPanel` prefetches columns per schema after first paint, and
  // columns decide card height. A schema with no FKs at all gains no edges
  // when they land, so a fingerprint that skipped height held — the one
  // layout that ever ran was sized for empty cards and every card then
  // overlapped the one below it.
  it("changes when late columns grow the cards of an FK-less schema", () => {
    const beforeColumns = buildErdModel(
      extractSchemaGraph(fkFreeSnapshot({ withColumns: false })),
    );
    const afterColumns = buildErdModel(
      extractSchemaGraph(fkFreeSnapshot({ withColumns: true })),
    );

    expect(beforeColumns.relationships).toEqual([]);
    expect(afterColumns.relationships).toEqual([]);
    expect(afterColumns.tables).toHaveLength(3);
    for (const [index, entry] of afterColumns.tables.entries()) {
      expect(entry.layoutHeight).toBeGreaterThan(
        beforeColumns.tables[index]!.layoutHeight,
      );
    }

    expect(erdModelFingerprint(afterColumns)).not.toBe(
      erdModelFingerprint(beforeColumns),
    );
  });

  it("distinguishes one foreign key from two between the same table pair", () => {
    const single = buildErdModel(extractSchemaGraph(ordersSnapshot()));
    const doubled = buildErdModel(extractSchemaGraph(parallelFkSnapshot()));

    // Same tables, same directed pair, two FK columns instead of one. elkjs
    // weights a layer sweep by incident edge count, so this is a different
    // layout input — the fingerprint lists every edge rather than the set of
    // pairs, and the extra edge also raises the target's `elk.priority`.
    expect(doubled.relationships).toHaveLength(single.relationships.length + 1);
    expect(erdReferenceCounts(doubled).get("table:public.users")).toBe(2);
    expect(erdReferenceCounts(single).get("table:public.users")).toBe(1);
    expect(erdModelFingerprint(doubled)).not.toBe(erdModelFingerprint(single));
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
  });

  it("gives elkjs the slot each card can grow into", () => {
    const model = buildErdModel(extractSchemaGraph(mixedColumnCountSnapshot()));
    const heightById = new Map(
      (buildErdElkGraph(model).children ?? []).map((child) => [
        child.id,
        child.height,
      ]),
    );

    // A two-column card and a nine-column card must not be handed over as the
    // same box, or elkjs spaces the layers for the wrong size.
    expect(heightById.get("table:main.narrow")).toBe(erdTableHeight(2, 0));
    expect(heightById.get("table:main.wide")).toBe(erdTableHeight(9, 0));
    expect(heightById.get("table:main.narrow")).not.toBe(
      heightById.get("table:main.wide"),
    );
    for (const child of buildErdElkGraph(model).children ?? []) {
      expect(child.width).toBe(ERD_TABLE_WIDTH);
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

  // The overlap this guards against is what PR #2100 measured: cards
  // laid out at one height and rendered at another sat on top of each other.
  it("places FK-less tables without overlapping once their columns arrive", async () => {
    const model = buildErdModel(
      extractSchemaGraph(fkFreeSnapshot({ withColumns: true })),
    );
    const positions = await layoutErdModel(model);

    const boxes = model.tables.map((entry) => {
      const position = positions.get(entry.table.id);
      expect(position).toBeDefined();
      return {
        id: entry.table.id,
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        right: (position?.x ?? 0) + entry.width,
        bottom: (position?.y ?? 0) + entry.layoutHeight,
      };
    });

    expect(boxes).toHaveLength(3);
    for (const [index, box] of boxes.entries()) {
      for (const other of boxes.slice(index + 1)) {
        const overlaps =
          box.left < other.right &&
          other.left < box.right &&
          box.top < other.bottom &&
          other.top < box.bottom;
        expect({ pair: [box.id, other.id], overlaps }).toEqual({
          pair: [box.id, other.id],
          overlaps: false,
        });
      }
    }
  });

  it("resolves with nothing to place instead of throwing on an empty graph", async () => {
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

describe("schema badge tones", () => {
  it("gives every schema its own tone until the palette wraps", () => {
    const model = buildErdModel(extractSchemaGraph(manySchemaSnapshot()));
    const toneBySchema = new Map(
      model.tables.map((entry) => [
        String(entry.table.schema),
        entry.schemaToneIndex,
      ]),
    );

    // Sorted schema order: analytics, app, main, public, sales.
    expect([...toneBySchema.entries()].sort()).toEqual([
      ["analytics", 0],
      ["app", 1],
      ["main", 2],
      ["public", 3],
      ["sales", 0],
    ]);
    expect(new Set([...toneBySchema.values()]).size).toBe(
      ERD_SCHEMA_TONE_COUNT,
    );
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

/** Same columns as `ordersSnapshot`; only indexes and constraints land late. */
function ordersSnapshotWithMetadata(): SchemaGraphCatalogSnapshot {
  const base = ordersSnapshot();
  return {
    ...base,
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

/** Two key columns and two plain ones, so each detail level differs. */
function keyedTableSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: { public: [table("public", "orders")] },
    columnsByTable: {
      public: {
        orders: [
          column("id", { is_primary_key: true }),
          column("order_id", {
            is_foreign_key: true,
            fk_reference: "public.orders(id)",
          }),
          column("note", { data_type: "text" }),
          column("amount", { data_type: "numeric" }),
        ],
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

function fkFreeSnapshot({
  withColumns,
}: {
  withColumns: boolean;
}): SchemaGraphCatalogSnapshot {
  const names = ["alpha", "beta", "gamma"];
  return {
    source: { dbType: "duckdb", database: "warehouse.duckdb" },
    schemas: [{ name: "main" }],
    tablesBySchema: { main: names.map((name) => table("main", name)) },
    columnsByTable: {
      main: Object.fromEntries(
        names.map((name) => [
          name,
          withColumns
            ? [
                column("id", { is_primary_key: true }),
                column("label", { data_type: "text" }),
                column("amount", { data_type: "numeric" }),
              ]
            : [],
        ]),
      ),
    },
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function parallelFkSnapshot(): SchemaGraphCatalogSnapshot {
  const base = ordersSnapshot();
  return {
    ...base,
    columnsByTable: {
      public: {
        ...base.columnsByTable.public,
        orders: [
          column("id", { is_primary_key: true }),
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
          column("billing_user_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
        ],
      },
    },
  };
}

function mixedColumnCountSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "duckdb", database: "mixed.duckdb" },
    schemas: [{ name: "main" }],
    tablesBySchema: {
      main: [table("main", "narrow"), table("main", "wide")],
    },
    columnsByTable: {
      main: {
        narrow: [column("id", { is_primary_key: true }), column("label")],
        wide: Array.from({ length: 9 }, (_unused, index) =>
          column(`c${index + 1}`),
        ),
      },
    },
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function manySchemaSnapshot(): SchemaGraphCatalogSnapshot {
  const schemas = ["public", "sales", "analytics", "main", "app"];
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: schemas.map((name) => ({ name })),
    tablesBySchema: Object.fromEntries(
      schemas.map((schema) => [schema, [table(schema, "t")]]),
    ),
    columnsByTable: Object.fromEntries(
      schemas.map((schema) => [
        schema,
        { t: [column("id", { is_primary_key: true })] },
      ]),
    ),
    indexesByTable: {},
    constraintsByTable: {},
  };
}

/** `profiles.user_id` references `users.id`, with one index over `profiles`. */
function profileSnapshot({
  index,
  isUnique,
}: {
  index: string[];
  isUnique: boolean;
}): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "users"), table("public", "profiles")],
    },
    columnsByTable: {
      public: {
        users: [column("id", { is_primary_key: true })],
        profiles: [
          column("id", { is_primary_key: true }),
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
          column("tenant_id"),
        ],
      },
    },
    indexesByTable: {
      public: { profiles: [tableIndex("profiles_idx", index, isUnique)] },
    },
    constraintsByTable: {},
  };
}

/** `events.actor` points at `actors.handle`, which is not the primary key. */
function looseReferenceSnapshot({
  uniqueHandle,
}: {
  uniqueHandle: boolean;
}): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "actors"), table("public", "events")],
    },
    columnsByTable: {
      public: {
        actors: [
          column("id", { is_primary_key: true }),
          column("handle", { data_type: "text" }),
        ],
        events: [
          column("id", { is_primary_key: true }),
          column("actor", {
            is_foreign_key: true,
            fk_reference: "public.actors(handle)",
          }),
        ],
      },
    },
    indexesByTable: {
      public: {
        actors: [tableIndex("actors_handle_idx", ["handle"], uniqueHandle)],
      },
    },
    constraintsByTable: {},
  };
}

/** A wide table whose only key column is the FK the edge anchors on. */
function lateColumnFkSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "owners"), table("public", "wide")],
    },
    columnsByTable: {
      public: {
        owners: [column("id", { is_primary_key: true })],
        wide: [
          ...Array.from({ length: 6 }, (_unused, index) =>
            column(`c${index + 1}`),
          ),
          column("owner_id", {
            is_foreign_key: true,
            fk_reference: "public.owners(id)",
          }),
        ],
      },
    },
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function table(schema: string, name: string): TableInfo {
  return { schema, name, row_count: null };
}

function tableIndex(
  name: string,
  columns: string[],
  isUnique: boolean,
): IndexInfo {
  return {
    name,
    columns,
    index_type: "btree",
    is_unique: isUnique,
    is_primary: false,
  };
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
