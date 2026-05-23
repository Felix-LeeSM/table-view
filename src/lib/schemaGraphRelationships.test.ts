import { describe, expect, it } from "vitest";
import type { ColumnInfo, ConstraintInfo, TableInfo } from "@/types/schema";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import { extractSchemaGraph } from "./schemaGraph";
import {
  schemaGraphColumnId,
  schemaGraphConstraintId,
  schemaGraphTableId,
} from "./schemaGraphSupport";

describe("SchemaGraph relationship normalizer", () => {
  it("represents composite and single-column FKs with the same source-to-target contract", () => {
    const graph = extractSchemaGraph(compositeFkSnapshot());
    const compositeId = schemaGraphConstraintId(
      "public",
      "invoices",
      "invoices_user_fk",
    );
    const singleId = schemaGraphConstraintId(
      "public",
      "invoice_lines",
      "invoice_lines_invoice_fk",
    );
    const compositeEdge = graph.edges.find(
      (edge) =>
        edge.kind === "foreign-key-table" && edge.constraintId === compositeId,
    );
    const singleEdge = graph.edges.find(
      (edge) =>
        edge.kind === "foreign-key-table" && edge.constraintId === singleId,
    );

    expect(compositeEdge).toMatchObject({
      from: schemaGraphTableId("public", "invoices"),
      to: schemaGraphTableId("public", "users"),
      columns: ["tenant_id", "user_id"],
      referenceColumns: ["tenant_id", "id"],
      foreignKey: {
        direction: "source-to-target",
        source: {
          schema: "public",
          table: "invoices",
          columns: ["tenant_id", "user_id"],
        },
        target: {
          schema: "public",
          table: "users",
          columns: ["tenant_id", "id"],
        },
      },
    });
    expect(singleEdge?.foreignKey?.direction).toBe("source-to-target");
    expect(singleEdge?.foreignKey?.source.columns).toEqual(["invoice_id"]);
    expect(singleEdge?.foreignKey?.target.columns).toEqual(["id"]);
    expect(graph.diagnostics).toEqual([]);
  });

  it("fills partial FK metadata from column references while keeping raw metadata", () => {
    const graph = extractSchemaGraph({
      source: { dbType: "sqlite", database: "app.sqlite" },
      schemas: [{ name: "main" }],
      tablesBySchema: {
        main: [table("main", "users"), table("main", "orders")],
      },
      columnsByTable: {
        main: {
          users: [column("id", { is_primary_key: true })],
          orders: [
            column("id", { is_primary_key: true }),
            column("user_id", {
              is_foreign_key: true,
              fk_reference: "main.users(id)",
            }),
          ],
        },
      },
      constraintsByTable: {
        main: {
          orders: [
            constraint("orders_user_fk", "FOREIGN KEY", ["user_id"], {
              reference_table: "users",
              reference_columns: null,
            }),
          ],
        },
      },
    });
    const edge = graph.edges.find((item) => item.kind === "foreign-key-table");

    expect(edge).toMatchObject({
      from: schemaGraphTableId("main", "orders"),
      to: schemaGraphTableId("main", "users"),
      referenceColumns: ["id"],
      foreignKey: {
        rawMetadata: {
          referenceTable: "users",
          referenceColumns: null,
          columnReferences: ["main.users(id)"],
          synthetic: false,
        },
      },
    });
    expect(graph.diagnostics).toEqual([]);
  });

  it("fails soft with diagnostics when FK metadata cannot form a safe relationship", () => {
    const graph = extractSchemaGraph({
      source: { dbType: "postgresql", database: "app" },
      schemas: [{ name: "public" }],
      tablesBySchema: {
        public: [table("public", "users"), table("public", "orders")],
      },
      columnsByTable: {
        public: {
          users: [column("tenant_id"), column("id")],
          orders: [column("tenant_id"), column("user_id")],
        },
      },
      constraintsByTable: {
        public: {
          orders: [
            constraint(
              "orders_user_fk",
              "FOREIGN KEY",
              ["tenant_id", "user_id"],
              {
                reference_table: "users",
                reference_columns: ["id"],
              },
            ),
          ],
        },
      },
    });

    expect(graph.edges.some((edge) => edge.kind === "foreign-key-table")).toBe(
      false,
    );
    expect(graph.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      "mismatched-fk-column-count",
    ]);
  });

  it("normalizes unnamed constraints into deterministic graph identities", () => {
    const graph = extractSchemaGraph({
      source: { dbType: "postgresql", database: "app" },
      schemas: [{ name: "public" }],
      tablesBySchema: {
        public: [table("public", "users"), table("public", "orders")],
      },
      columnsByTable: {
        public: {
          users: [column("id")],
          orders: [column("user_id")],
        },
      },
      constraintsByTable: {
        public: {
          orders: [
            constraint("   ", "FOREIGN KEY", [" user_id "], {
              reference_table: " public.users ",
              reference_columns: [" id "],
            }),
          ],
        },
      },
    });
    const constraintId = schemaGraphConstraintId(
      "public",
      "orders",
      "__unnamed_foreign_key_user_id_public_users",
    );

    expect(graph.nodes.map((node) => node.id)).toContain(constraintId);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "foreign-key-column",
        from: schemaGraphColumnId("public", "orders", "user_id"),
        to: schemaGraphColumnId("public", "users", "id"),
      }),
    );
  });
});

function compositeFkSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        table("public", "users"),
        table("public", "invoices"),
        table("public", "invoice_lines"),
      ],
    },
    columnsByTable: {
      public: {
        users: [column("tenant_id"), column("id")],
        invoices: [column("tenant_id"), column("user_id"), column("id")],
        invoice_lines: [column("invoice_id"), column("line_no")],
      },
    },
    constraintsByTable: {
      public: {
        invoices: [
          constraint(
            "invoices_user_fk",
            "FOREIGN KEY",
            ["tenant_id", "user_id"],
            {
              reference_table: "public.users",
              reference_columns: ["tenant_id", "id"],
            },
          ),
        ],
        invoice_lines: [
          constraint(
            "invoice_lines_invoice_fk",
            "FOREIGN KEY",
            ["invoice_id"],
            {
              reference_table: "public.invoices",
              reference_columns: ["id"],
            },
          ),
        ],
      },
    },
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

function constraint(
  name: string,
  constraint_type: string,
  columns: readonly string[],
  overrides: Partial<ConstraintInfo> = {},
): ConstraintInfo {
  return {
    name,
    constraint_type,
    columns: [...columns],
    reference_table: null,
    reference_columns: null,
    ...overrides,
  };
}
