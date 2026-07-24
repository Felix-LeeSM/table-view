import { describe, expect, it } from "vitest";
import { RUNTIME_RDBMS_DATABASE_TYPES } from "@/types/rdbmsDataSources";
import type { RuntimeRdbmsDatabaseType } from "@/types/rdbmsDataSources";
import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  TableInfo,
} from "@/types/schema";
import type {
  SchemaGraph,
  SchemaGraphCatalogSnapshot,
  SchemaGraphNode,
} from "@/types/schemaGraph";
import {
  schemaGraphColumnId,
  schemaGraphConstraintId,
  schemaGraphSchemaId,
  schemaGraphTableId,
} from "@/test-utils/schemaGraphIds";
import { extractSchemaGraph } from "./schemaGraph";

describe("SchemaGraph extraction", () => {
  it("uses the Sprint 459 runtime RDBMS matrix as the accepted source set", () => {
    for (const dbType of RUNTIME_RDBMS_DATABASE_TYPES) {
      expect(() => extractSchemaGraph(emptySnapshot(dbType))).not.toThrow();
    }
  });

  it("extracts PostgreSQL-like schemas, tables, columns, indexes, constraints, and FK edges", () => {
    const graph = extractSchemaGraph(postgresLikeSnapshot("postgresql"));
    const ordersTableId = schemaGraphTableId("public", "orders");
    const usersTableId = schemaGraphTableId("public", "users");
    const fkConstraintId = schemaGraphConstraintId(
      "public",
      "orders",
      "orders_user_id_fkey",
    );

    expect(nodeIds(graph, "schema")).toContain(schemaGraphSchemaId("public"));
    expect(nodeIds(graph, "table")).toEqual([ordersTableId, usersTableId]);
    expect(nodeIds(graph, "column")).toEqual([
      schemaGraphColumnId("public", "orders", "id"),
      schemaGraphColumnId("public", "orders", "total"),
      schemaGraphColumnId("public", "orders", "user_id"),
      schemaGraphColumnId("public", "users", "email"),
      schemaGraphColumnId("public", "users", "id"),
    ]);
    expect(nodeIds(graph, "index")).toContain(
      "table:public.users.index:users_email_idx",
    );
    expect(nodeIds(graph, "constraint")).toContain(fkConstraintId);
    expect(
      graph.nodes
        .filter((node) => node.kind === "constraint")
        .some((node) => node.data.synthetic),
    ).toBe(false);
    expect(
      graph.edges.find(
        (edge) =>
          edge.kind === "foreign-key-table" &&
          edge.constraintId === fkConstraintId,
      ),
    ).toMatchObject({
      from: ordersTableId,
      to: usersTableId,
      columns: ["user_id"],
      referenceColumns: ["id"],
    });
    expect(graph.diagnostics).toEqual([]);
  });

  it("keeps MySQL and MariaDB graph shape aligned for MySQL-family catalogs", () => {
    for (const dbType of ["mysql", "mariadb"] as const) {
      const graph = extractSchemaGraph(postgresLikeSnapshot(dbType));
      expect(graph.source.dbType).toBe(dbType);
      expect(edgeKinds(graph)).toContain("foreign-key-column");
      expect(nodeIds(graph, "constraint")).toEqual([
        schemaGraphConstraintId("public", "orders", "orders_pkey"),
        schemaGraphConstraintId("public", "orders", "orders_user_id_fkey"),
        schemaGraphConstraintId("public", "users", "users_email_key"),
        schemaGraphConstraintId("public", "users", "users_pkey"),
      ]);
    }
  });

  it("synthesizes SQLite PK/FK constraints from column flags when constraints are absent", () => {
    const graph = extractSchemaGraph(sqliteLikeSnapshot());
    const syntheticConstraints = graph.nodes
      .filter((node) => node.kind === "constraint")
      .map((node) => node.data);

    expect(syntheticConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "__synthetic_primary_key",
          synthetic: true,
        }),
        expect.objectContaining({
          name: "__synthetic_foreign_key_user_id",
          synthetic: true,
        }),
      ]),
    );
    expect(edgeKinds(graph)).toContain("foreign-key-table");
    expect(graph.diagnostics.map((diagnostic) => diagnostic.kind)).toContain(
      "inferred-reference-schema",
    );
  });

  it("models CHECK clauses from column metadata as reusable constraint nodes", () => {
    const graph = extractSchemaGraph({
      source: { dbType: "postgresql", database: "app" },
      schemas: [{ name: "public" }],
      tablesBySchema: { public: [table("public", "accounts")] },
      columnsByTable: {
        public: {
          accounts: [
            column("id", { is_primary_key: true }),
            column("age", { check_clauses: ["CHECK ((age >= 0))"] }),
          ],
        },
      },
      constraintsByTable: {},
    });
    const checkNode = graph.nodes.find(
      (node) =>
        node.kind === "constraint" &&
        node.data.constraintType === "CHECK" &&
        node.data.checkExpression === "CHECK ((age >= 0))",
    );

    expect(checkNode).toBeDefined();
    expect(checkNode).toMatchObject({
      data: { columns: ["age"], synthetic: true },
    });
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "constraint-column",
        from: checkNode?.id,
        to: schemaGraphColumnId("public", "accounts", "age"),
      }),
    );
  });

  it("does not duplicate CHECK constraints when explicit metadata is present", () => {
    const graph = extractSchemaGraph({
      source: { dbType: "postgresql", database: "app" },
      schemas: [{ name: "public" }],
      tablesBySchema: { public: [table("public", "accounts")] },
      columnsByTable: {
        public: {
          accounts: [
            column("id", { is_primary_key: true }),
            column("age", { check_clauses: ["CHECK ((age >= 0))"] }),
          ],
        },
      },
      constraintsByTable: {
        public: {
          accounts: [constraint("accounts_age_check", "CHECK", ["age"])],
        },
      },
    });
    const checkNodes = graph.nodes.filter(
      (node) =>
        node.kind === "constraint" && node.data.constraintType === "CHECK",
    );

    expect(checkNodes).toHaveLength(1);
    expect(checkNodes[0]).toMatchObject({
      id: schemaGraphConstraintId("public", "accounts", "accounts_age_check"),
      data: { synthetic: false, columns: ["age"] },
    });
  });

  it("keeps dotted SQL identifiers from colliding in stable graph IDs", () => {
    const graph = extractSchemaGraph({
      source: { dbType: "postgresql", database: "app" },
      schemas: [{ name: "a.b" }, { name: "a" }],
      tablesBySchema: {
        "a.b": [table("a.b", "c")],
        a: [table("a", "b.c")],
      },
      columnsByTable: {
        "a.b": { c: [column("id")] },
        a: { "b.c": [column("id")] },
      },
    });
    const left = schemaGraphTableId("a.b", "c");
    const right = schemaGraphTableId("a", "b.c");

    expect(left).not.toBe(right);
    expect(nodeIds(graph, "table")).toEqual(
      [right, left].sort((a, b) => a.localeCompare(b, "en")),
    );
  });

  it("keeps DuckDB-like catalogs valid when relationship metadata is missing", () => {
    const graph = extractSchemaGraph({
      source: { dbType: "duckdb", database: "analytics.duckdb" },
      schemas: [{ name: "main" }],
      tablesBySchema: { main: [table("main", "sales")] },
      columnsByTable: {
        main: {
          sales: [column("id", { is_primary_key: false }), column("amount")],
        },
      },
      indexesByTable: {},
      constraintsByTable: {},
    });

    expect(nodeIds(graph, "table")).toEqual([
      schemaGraphTableId("main", "sales"),
    ]);
    expect(nodeIds(graph, "constraint")).toEqual([]);
    expect(edgeKinds(graph)).not.toContain("foreign-key-table");
    expect(graph.diagnostics).toEqual([]);
  });

  it("records diagnostics and skips unsafe FK edges when reference tables are missing", () => {
    const graph = extractSchemaGraph({
      source: { dbType: "postgresql", database: "app" },
      schemas: [{ name: "public" }],
      tablesBySchema: { public: [table("public", "orders")] },
      columnsByTable: {
        public: {
          orders: [column("id", { is_primary_key: true }), column("user_id")],
        },
      },
      constraintsByTable: {
        public: {
          orders: [
            constraint("orders_user_id_fkey", "FOREIGN KEY", ["user_id"], {
              reference_table: "missing_users",
              reference_columns: ["id"],
            }),
          ],
        },
      },
    });

    expect(graph.edges.some((edge) => edge.kind === "foreign-key-table")).toBe(
      false,
    );
    expect(graph.diagnostics).toEqual([
      expect.objectContaining({ kind: "inferred-reference-schema" }),
      expect.objectContaining({ kind: "missing-reference-table" }),
    ]);
  });

  it("sorts graph output deterministically regardless of backend catalog order", () => {
    const stable = extractSchemaGraph(postgresLikeSnapshot("postgresql"));
    const shuffled = extractSchemaGraph(shuffledPostgresLikeSnapshot());

    expect(stable).toEqual(shuffled);
  });
});

function emptySnapshot(
  dbType: RuntimeRdbmsDatabaseType,
): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType },
    schemas: [],
    tablesBySchema: {},
    columnsByTable: {},
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function postgresLikeSnapshot(
  dbType: Extract<RuntimeRdbmsDatabaseType, "postgresql" | "mysql" | "mariadb">,
): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType, database: "app" },
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
          column("total", { data_type: "numeric" }),
        ],
      },
    },
    indexesByTable: {
      public: {
        users: [index("users_email_idx", ["email"], { is_unique: true })],
        orders: [index("orders_user_id_idx", ["user_id"])],
      },
    },
    constraintsByTable: {
      public: {
        users: [
          constraint("users_pkey", "PRIMARY KEY", ["id"]),
          constraint("users_email_key", "UNIQUE", ["email"]),
        ],
        orders: [
          constraint("orders_pkey", "PRIMARY KEY", ["id"]),
          constraint("orders_user_id_fkey", "FOREIGN KEY", ["user_id"], {
            reference_table: "users",
            reference_columns: ["id"],
          }),
        ],
      },
    },
  };
}

function shuffledPostgresLikeSnapshot(): SchemaGraphCatalogSnapshot {
  const snapshot = postgresLikeSnapshot("postgresql");
  return {
    ...snapshot,
    tablesBySchema: {
      public: [...(snapshot.tablesBySchema.public ?? [])].reverse(),
    },
    columnsByTable: {
      public: {
        users: [...(snapshot.columnsByTable.public?.users ?? [])].reverse(),
        orders: [...(snapshot.columnsByTable.public?.orders ?? [])].reverse(),
      },
    },
    indexesByTable: {
      public: {
        users: [...(snapshot.indexesByTable?.public?.users ?? [])].reverse(),
        orders: [...(snapshot.indexesByTable?.public?.orders ?? [])].reverse(),
      },
    },
    constraintsByTable: {
      public: {
        users: [
          ...(snapshot.constraintsByTable?.public?.users ?? []),
        ].reverse(),
        orders: [
          ...(snapshot.constraintsByTable?.public?.orders ?? []),
        ].reverse(),
      },
    },
  };
}

function sqliteLikeSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "sqlite", database: "app.sqlite" },
    schemas: [{ name: "main" }],
    tablesBySchema: {
      main: [table("main", "users"), table("main", "orders")],
    },
    columnsByTable: {
      main: {
        users: [column("id", { is_primary_key: true }), column("email")],
        orders: [
          column("id", { is_primary_key: true }),
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "users(id)",
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

function index(
  name: string,
  columns: readonly string[],
  overrides: Partial<IndexInfo> = {},
): IndexInfo {
  return {
    name,
    columns: [...columns],
    index_type: "btree",
    is_unique: false,
    is_primary: false,
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

function nodeIds(
  graph: SchemaGraph,
  kind: SchemaGraphNode["kind"],
): readonly string[] {
  return graph.nodes
    .filter((node) => node.kind === kind)
    .map((node) => node.id);
}

function edgeKinds(graph: SchemaGraph): readonly string[] {
  return graph.edges.map((edge) => edge.kind);
}
