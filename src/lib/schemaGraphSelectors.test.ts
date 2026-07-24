import { describe, expect, it } from "vitest";
import type { RuntimeRdbmsDatabaseType } from "@/types/rdbmsDataSources";
import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  TableInfo,
} from "@/types/schema";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import {
  schemaGraphColumnId,
  schemaGraphConstraintId,
  schemaGraphIndexId,
  schemaGraphTableId,
} from "@/test-utils/schemaGraphIds";
import { extractSchemaGraph } from "./schemaGraph";
import {
  selectSchemaGraphMigrationImpact,
  selectSchemaGraphIntelligence,
  selectSchemaGraphNodeMaps,
} from "./schemaGraphSelectors";

describe("SchemaGraph intelligence selectors", () => {
  it("indexes PostgreSQL-like graph nodes, FK direction, readiness, and diagnostics", () => {
    const selectors = selectSchemaGraphIntelligence(
      postgresLikeSnapshot("postgresql"),
    );
    const ordersTableId = schemaGraphTableId("public", "orders");
    const usersTableId = schemaGraphTableId("public", "users");
    const fkConstraintId = schemaGraphConstraintId(
      "public",
      "orders",
      "orders_user_id_fkey",
    );

    expect([...selectors.tablesById.keys()]).toEqual([
      ordersTableId,
      usersTableId,
    ]);
    expect(
      selectors.columnsByTableId
        .get(ordersTableId)
        ?.map((column) => column.column),
    ).toEqual(["id", "total", "user_id"]);
    expect(
      selectors.indexesByTableId.get(usersTableId)?.map((index) => index.index),
    ).toEqual(["users_email_idx"]);
    expect(
      selectors.constraintsByTableId
        .get(ordersTableId)
        ?.map((constraint) => constraint.constraint),
    ).toEqual(["orders_pkey", "orders_user_id_fkey"]);

    expect(
      selectors.foreignKeysByConstraintId.get(fkConstraintId),
    ).toMatchObject({
      constraintId: fkConstraintId,
      sourceTableId: ordersTableId,
      targetTableId: usersTableId,
      sourceColumnIds: [schemaGraphColumnId("public", "orders", "user_id")],
      targetColumnIds: [schemaGraphColumnId("public", "users", "id")],
    });
    expect(
      selectors.foreignKeysByTableId
        .get(ordersTableId)
        ?.outgoingForeignKeys.map((foreignKey) => foreignKey.constraintId),
    ).toEqual([fkConstraintId]);
    expect(
      selectors.foreignKeysByTableId
        .get(usersTableId)
        ?.incomingForeignKeys.map((foreignKey) => foreignKey.constraintId),
    ).toEqual([fkConstraintId]);
    expect(
      selectors.metadataReadinessByTableId.get(ordersTableId),
    ).toMatchObject({
      source: "catalog-snapshot",
      status: "ready",
      ready: true,
      columns: "available",
      indexes: "available",
      constraints: "available",
      missing: [],
      diagnostics: [],
    });
    expect(selectors.diagnosticsBySubjectId.size).toBe(0);
  });

  it("keeps MySQL and MariaDB selector shape aligned without vendor-specific parsing", () => {
    for (const dbType of ["mysql", "mariadb"] as const) {
      const selectors = selectSchemaGraphIntelligence(
        postgresLikeSnapshot(dbType),
      );

      expect(selectors.graph.source.dbType).toBe(dbType);
      expect(
        selectors.foreignKeys.map((foreignKey) => [
          foreignKey.relationship.source.table,
          foreignKey.relationship.target.table,
        ]),
      ).toEqual([["orders", "users"]]);
      expect(
        selectors.metadataReadinessByTableId.get(
          schemaGraphTableId("public", "orders"),
        )?.status,
      ).toBe("ready");
    }
  });

  it("keeps SQLite synthetic PK/FK selectors visible while marking sparse metadata", () => {
    const selectors = selectSchemaGraphIntelligence(sqliteLikeSnapshot());
    const ordersTableId = schemaGraphTableId("main", "orders");

    expect(
      selectors.constraintsByTableId.get(ordersTableId)?.map((constraint) => ({
        name: constraint.constraint,
        synthetic: constraint.data.synthetic,
      })),
    ).toEqual([
      { name: "__synthetic_foreign_key_user_id", synthetic: true },
      { name: "__synthetic_primary_key", synthetic: true },
    ]);
    expect(
      selectors.foreignKeysByTableId
        .get(ordersTableId)
        ?.outgoingForeignKeys.map((foreignKey) => ({
          source: foreignKey.relationship.source.table,
          target: foreignKey.relationship.target.table,
        })),
    ).toEqual([{ source: "orders", target: "users" }]);
    expect(
      selectors.metadataReadinessByTableId.get(ordersTableId),
    ).toMatchObject({
      status: "partial",
      ready: false,
      columns: "available",
      indexes: "missing",
      constraints: "missing",
      missing: ["indexes", "constraints"],
    });
    expect(
      selectors.metadataReadinessByTableId
        .get(ordersTableId)
        ?.diagnostics.map((diagnostic) => diagnostic.kind),
    ).toEqual(["inferred-reference-schema"]);
  });

  it("keeps DuckDB sparse catalogs valid without inventing relationship claims", () => {
    const selectors = selectSchemaGraphIntelligence(duckdbSparseSnapshot());
    const salesTableId = schemaGraphTableId("main", "sales");

    expect(selectors.foreignKeys).toEqual([]);
    expect(selectors.constraintsByTableId.get(salesTableId)).toBeUndefined();
    expect(
      selectors.metadataReadinessByTableId.get(salesTableId),
    ).toMatchObject({
      status: "partial",
      ready: false,
      columns: "available",
      indexes: "missing",
      constraints: "missing",
      diagnostics: [],
    });
  });

  it("preserves delimiter-safe IDs in selector maps", () => {
    const selectors = selectSchemaGraphNodeMaps({
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
    expect([...selectors.tablesById.keys()]).toEqual(
      [right, left].sort((a, b) => a.localeCompare(b, "en")),
    );
  });

  it("does not infer metadata readiness from graph-only inputs", () => {
    const graph = extractSchemaGraph(postgresLikeSnapshot("postgresql"));
    const selectors = selectSchemaGraphIntelligence(graph);

    expect(
      selectors.metadataReadinessByTableId.get(
        schemaGraphTableId("public", "orders"),
      ),
    ).toMatchObject({
      source: "schema-graph",
      status: "unknown",
      ready: false,
      columns: "unknown",
      indexes: "unknown",
      constraints: "unknown",
      missing: [],
    });
  });

  it("summarizes table removal impact with incoming FK metadata", () => {
    const selectors = selectSchemaGraphIntelligence(migrationImpactSnapshot());
    const impact = selectSchemaGraphMigrationImpact(selectors, {
      kind: "table",
      tableId: schemaGraphTableId("public", "users"),
    });

    expect(impact.targetFound).toBe(true);
    expect(impact.targetLabel).toBe("public.users");
    expect(impact.affectedTables.map((table) => table.table)).toEqual([
      "sessions",
      "users",
    ]);
    expect(
      impact.affectedConstraints.map((constraint) => constraint.constraint),
    ).toEqual(["sessions_user_email_fkey", "users_email_key", "users_pkey"]);
    expect(
      impact.foreignKeys.map(
        (foreignKey) => foreignKey.relationship.rawMetadata.constraintName,
      ),
    ).toEqual(["sessions_user_email_fkey"]);
  });

  it("summarizes column removal impact with dependent indexes, constraints, and FK columns", () => {
    const selectors = selectSchemaGraphIntelligence(migrationImpactSnapshot());
    const impact = selectSchemaGraphMigrationImpact(selectors, {
      kind: "column",
      columnId: schemaGraphColumnId("public", "users", "email"),
    });

    expect(impact.affectedIndexes.map((indexNode) => indexNode.index)).toEqual([
      "users_email_idx",
    ]);
    expect(
      impact.affectedConstraints.map((constraint) => constraint.constraint),
    ).toEqual(["sessions_user_email_fkey", "users_email_key"]);
    expect(
      impact.affectedColumns.map((columnNode) => columnNode.column),
    ).toEqual(["user_email", "email"]);
  });

  it("summarizes unique constraint removal impact with inbound FK metadata", () => {
    const selectors = selectSchemaGraphIntelligence(migrationImpactSnapshot());
    const impact = selectSchemaGraphMigrationImpact(selectors, {
      kind: "constraint",
      constraintId: schemaGraphConstraintId(
        "public",
        "users",
        "users_email_key",
      ),
    });

    expect(
      impact.affectedConstraints.map((constraint) => constraint.constraint),
    ).toEqual(["sessions_user_email_fkey", "users_email_key"]);
    expect(impact.affectedTables.map((tableNode) => tableNode.table)).toEqual([
      "sessions",
      "users",
    ]);
    expect(
      impact.foreignKeys.map(
        (foreignKey) => foreignKey.relationship.rawMetadata.constraintName,
      ),
    ).toEqual(["sessions_user_email_fkey"]);
  });

  it("summarizes unique index removal impact through same-column constraints and inbound FKs", () => {
    const selectors = selectSchemaGraphIntelligence(migrationImpactSnapshot());
    const impact = selectSchemaGraphMigrationImpact(selectors, {
      kind: "index",
      indexId: schemaGraphIndexId("public", "users", "users_email_idx"),
    });

    expect(impact.affectedIndexes.map((indexNode) => indexNode.index)).toEqual([
      "users_email_idx",
    ]);
    expect(
      impact.affectedConstraints.map((constraint) => constraint.constraint),
    ).toEqual(["sessions_user_email_fkey", "users_email_key"]);
    expect(
      impact.foreignKeys.map(
        (foreignKey) => foreignKey.relationship.rawMetadata.constraintName,
      ),
    ).toEqual(["sessions_user_email_fkey"]);
  });

  it("returns an empty summary for a missing removal target", () => {
    const selectors = selectSchemaGraphIntelligence(migrationImpactSnapshot());
    const impact = selectSchemaGraphMigrationImpact(selectors, {
      kind: "table",
      tableId: schemaGraphTableId("public", "missing"),
    });

    expect(impact.targetFound).toBe(false);
    expect(impact.affectedTables).toEqual([]);
    expect(impact.foreignKeys).toEqual([]);
  });
});

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
  };
}

function duckdbSparseSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "duckdb", database: "analytics.duckdb" },
    schemas: [{ name: "main" }],
    tablesBySchema: { main: [table("main", "sales")] },
    columnsByTable: {
      main: {
        sales: [column("id", { is_primary_key: false }), column("amount")],
      },
    },
  };
}

function migrationImpactSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "users"), table("public", "sessions")],
    },
    columnsByTable: {
      public: {
        users: [
          column("id", { is_primary_key: true }),
          column("email", { data_type: "text" }),
        ],
        sessions: [
          column("id", { is_primary_key: true }),
          column("user_email", {
            data_type: "text",
            is_foreign_key: true,
            fk_reference: "public.users(email)",
          }),
        ],
      },
    },
    indexesByTable: {
      public: {
        users: [
          index("users_pkey_idx", ["id"], {
            is_primary: true,
            is_unique: true,
          }),
          index("users_email_idx", ["email"], { is_unique: true }),
        ],
        sessions: [index("sessions_user_email_idx", ["user_email"])],
      },
    },
    constraintsByTable: {
      public: {
        users: [
          constraint("users_pkey", "PRIMARY KEY", ["id"]),
          constraint("users_email_key", "UNIQUE", ["email"]),
        ],
        sessions: [
          constraint("sessions_pkey", "PRIMARY KEY", ["id"]),
          constraint(
            "sessions_user_email_fkey",
            "FOREIGN KEY",
            ["user_email"],
            {
              reference_table: "public.users",
              reference_columns: ["email"],
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
