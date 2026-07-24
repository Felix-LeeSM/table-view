import { describe, expect, it } from "vitest";
import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  TableInfo,
} from "@/types/schema";
import type {
  SchemaGraph,
  SchemaGraphCatalogSnapshot,
  SchemaGraphForeignKeyEndpoint,
} from "@/types/schemaGraph";
import { schemaName, tableName } from "@/test-utils/brandedKeys";
import { selectSchemaGraphDiff } from "./schemaGraphDiff";

describe("SchemaGraph diff", () => {
  it("detects stable table, column, index, constraint, and FK changes", () => {
    const diff = selectSchemaGraphDiff(
      baseSnapshot("source"),
      changedSnapshot(),
    );

    expect(diff.sameSource).toBe(true);
    expect(diff.totals).toEqual({
      added: 5,
      removed: 1,
      changed: 6,
      total: 12,
    });
    expect(diff.tables.added.map((entry) => entry.label)).toEqual([
      "public.audit_log",
    ]);
    expect(diff.tables.changed.map((entry) => entry.label)).toEqual([
      "public.orders",
      "public.users",
    ]);
    expect(diff.columns.added.map((entry) => entry.label)).toEqual([
      "public.audit_log.id",
      "public.orders.status",
    ]);
    expect(diff.columns.removed.map((entry) => entry.label)).toEqual([
      "public.users.name",
    ]);
    expect(diff.columns.changed.map((entry) => entry.label)).toEqual([
      "public.users.email",
    ]);
    expect(diff.indexes.added.map((entry) => entry.label)).toEqual([
      "public.orders.orders_status_idx",
    ]);
    expect(diff.indexes.changed.map((entry) => entry.label)).toEqual([
      "public.users.users_email_idx",
    ]);
    expect(diff.constraints.added.map((entry) => entry.label)).toEqual([
      "public.orders.orders_status_check",
    ]);
    expect(diff.constraints.changed.map((entry) => entry.label)).toEqual([
      "public.orders.orders_user_id_fkey",
    ]);
    expect(diff.foreignKeys.changed.map((entry) => entry.label)).toEqual([
      "public.orders.orders_user_id_fkey",
    ]);
  });

  it("compares cross-source cached snapshots without live parsing", () => {
    const diff = selectSchemaGraphDiff(
      baseSnapshot("left", { dbType: "postgresql", database: "prod" }),
      baseSnapshot("right", { dbType: "mysql", database: "staging" }),
    );

    expect(diff.sameSource).toBe(false);
    expect(diff.source).toEqual({
      before: { dbType: "postgresql", database: "prod" },
      after: { dbType: "mysql", database: "staging" },
    });
    expect(diff.totals.total).toBe(0);
    expect(diff.tables.added).toEqual([]);
    expect(diff.foreignKeys.changed).toEqual([]);
  });

  it("keeps same database names from different cached connections distinct", () => {
    const diff = selectSchemaGraphDiff(
      baseSnapshot("left", {
        dbType: "postgresql",
        database: "app",
        connectionId: "conn-a",
      }),
      baseSnapshot("right", {
        dbType: "postgresql",
        database: "app",
        connectionId: "conn-b",
      }),
    );

    expect(diff.sameSource).toBe(false);
    expect(diff.totals.total).toBe(0);
  });

  it("compares structured array values before formatting display labels", () => {
    const before = indexArraySnapshot(["a, b"]);
    const after = indexArraySnapshot(["a", "b"]);
    const diff = selectSchemaGraphDiff(before, after);

    expect(diff.indexes.changed).toHaveLength(1);
    expect(diff.indexes.changed[0]?.changes).toEqual([
      { field: "columns", before: '"a, b"', after: "a, b" },
    ]);
  });

  it("keeps structurally equal FK endpoints unchanged regardless of key order", () => {
    const diff = selectSchemaGraphDiff(
      foreignKeyGraph("canonical"),
      foreignKeyGraph("reordered"),
    );

    expect(diff.foreignKeys.changed).toEqual([]);
    expect(diff.totals.total).toBe(0);
  });
});

type SnapshotVariant = "source" | "left" | "right";

function baseSnapshot(
  variant: SnapshotVariant,
  source: SchemaGraphCatalogSnapshot["source"] = {
    dbType: "postgresql",
    database: "app",
  },
): SchemaGraphCatalogSnapshot {
  const emailIndexType = variant === "right" ? "btree" : "btree";
  return {
    source,
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "orders"), table("public", "users")].sort(
        (left, right) => right.name.localeCompare(left.name),
      ),
    },
    columnsByTable: {
      public: {
        users: [
          column("name", { data_type: "text", nullable: true }),
          column("email", { data_type: "text", nullable: true }),
          column("id", { is_primary_key: true }),
        ],
        orders: [
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
          column("id", { is_primary_key: true }),
        ],
      },
    },
    indexesByTable: {
      public: {
        users: [
          index("users_email_idx", ["email"], {
            index_type: emailIndexType,
          }),
        ],
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
            reference_table: "public.users",
            reference_columns: ["id"],
          }),
        ],
      },
    },
  };
}

function changedSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        table("public", "users"),
        table("public", "orders"),
        table("public", "audit_log"),
      ],
    },
    columnsByTable: {
      public: {
        users: [
          column("id", { is_primary_key: true }),
          column("email", { data_type: "varchar(255)", nullable: false }),
        ],
        orders: [
          column("id", { is_primary_key: true }),
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
          column("status", { data_type: "text" }),
        ],
        audit_log: [column("id")],
      },
    },
    indexesByTable: {
      public: {
        users: [
          index("users_email_idx", ["email"], {
            index_type: "hash",
            is_unique: true,
          }),
        ],
        orders: [
          index("orders_user_id_idx", ["user_id"]),
          index("orders_status_idx", ["status"]),
        ],
        audit_log: [],
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
            reference_table: "public.users",
            reference_columns: ["email"],
          }),
          constraint("orders_status_check", "CHECK", ["status"]),
        ],
        audit_log: [],
      },
    },
  };
}

function indexArraySnapshot(
  columns: readonly string[],
): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [table("public", "metrics")],
    },
    columnsByTable: {
      public: {
        metrics: [column("a, b"), column("a"), column("b")],
      },
    },
    indexesByTable: {
      public: {
        metrics: [index("metrics_columns_idx", columns)],
      },
    },
    constraintsByTable: {
      public: {
        metrics: [],
      },
    },
  };
}

function foreignKeyGraph(order: "canonical" | "reordered"): SchemaGraph {
  const ordersTableId = "table:public.orders";
  const usersTableId = "table:public.users";
  const constraintId = `${ordersTableId}.constraint:orders_user_id_fkey`;
  const relationship = {
    kind: "foreign-key" as const,
    direction: "source-to-target" as const,
    source: foreignKeyEndpoint(order, "public", "orders", ["user_id"]),
    target: foreignKeyEndpoint(order, "public", "users", ["id"]),
    rawMetadata: {
      constraintName: "orders_user_id_fkey",
      constraintType: "FOREIGN KEY",
      sourceColumns: ["user_id"],
      referenceTable: "public.users",
      referenceColumns: ["id"],
      columnReferences: ["public.users(id)"],
      synthetic: false,
    },
  };

  return {
    source: { dbType: "postgresql", database: "app" },
    nodes: [
      {
        id: "schema:public",
        kind: "schema",
        label: "public",
        schema: schemaName("public"),
        data: { name: "public" },
      },
      {
        id: ordersTableId,
        kind: "table",
        label: "orders",
        schema: schemaName("public"),
        table: tableName("orders"),
        data: table("public", "orders"),
      },
      {
        id: usersTableId,
        kind: "table",
        label: "users",
        schema: schemaName("public"),
        table: tableName("users"),
        data: table("public", "users"),
      },
      {
        id: constraintId,
        kind: "constraint",
        label: "orders_user_id_fkey",
        schema: schemaName("public"),
        table: tableName("orders"),
        constraint: "orders_user_id_fkey",
        data: {
          name: "orders_user_id_fkey",
          constraintType: "FOREIGN KEY",
          columns: ["user_id"],
          referenceTable: "public.users",
          referenceColumns: ["id"],
          foreignKey: relationship,
          synthetic: false,
        },
      },
    ],
    edges: [
      {
        id: `edge:foreign-key-table:${constraintId}:${ordersTableId}->${usersTableId}`,
        kind: "foreign-key-table",
        from: ordersTableId,
        to: usersTableId,
        constraintId,
        foreignKey: relationship,
      },
    ],
    diagnostics: [],
  };
}

function foreignKeyEndpoint(
  order: "canonical" | "reordered",
  schema: string,
  table: string,
  columns: readonly string[],
): SchemaGraphForeignKeyEndpoint {
  if (order === "reordered") {
    return {
      columns: [...columns],
      table: tableName(table),
      schema: schemaName(schema),
    };
  }
  return {
    schema: schemaName(schema),
    table: tableName(table),
    columns: [...columns],
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
