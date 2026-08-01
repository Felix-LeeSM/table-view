import { describe, expect, it } from "vitest";
import type { ColumnInfo, ConstraintInfo } from "@/types/schema";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import { extractSchemaGraph } from "./schemaGraph";
import {
  schemaGraphToDbml,
  schemaGraphToMermaid,
} from "./schemaGraphTextExport";

describe("schemaGraphToMermaid", () => {
  it("emits entities in id order, columns in graph ordinal order, and one relation per FK edge", () => {
    expect(schemaGraphToMermaid(shopSnapshot())).toBe(
      [
        "erDiagram",
        '    "public.orders" {',
        "        integer id PK",
        "        numeric(10_2) total",
        "        integer user_id FK",
        "    }",
        '    "public.users" {',
        "        text email",
        "        integer id PK",
        "    }",
        '    "public.orders" }o--|o "public.users" : "orders_user_id_fkey"',
        "",
      ].join("\n"),
    );
  });

  it("marks the parent side as exactly-one when every FK source column is NOT NULL", () => {
    const diagram = schemaGraphToMermaid(
      shopSnapshot({ userIdNullable: false }),
    );

    expect(diagram).toContain(
      '    "public.orders" }o--|| "public.users" : "orders_user_id_fkey"',
    );
    expect(diagram).not.toContain("}o--|o");
  });

  it("keeps the parent side optional when only one column of a composite FK is nullable", () => {
    expect(schemaGraphToMermaid(compositeSnapshot())).toContain(
      '    "public.order_items" }o--|o "public.orders" : "order_items_order_fkey"',
    );
  });

  it("takes FK marks from graph edges, not from the column is_foreign_key flag", () => {
    // `user_id` 는 두 스냅샷 모두에서 is_foreign_key: true 다. 참조 메타데이터가
    // 없으면 그래프가 edge 를 만들지 않고, 그러면 표시도 관계선도 없어야 한다.
    const diagram = schemaGraphToMermaid(shopSnapshot({ constraints: {} }));

    expect(diagram).toContain("        integer user_id\n");
    expect(diagram).not.toContain("FK");
    expect(diagram).not.toContain("}o--");
  });

  it("neutralises catalog names and types that would break the line grammar", () => {
    expect(schemaGraphToMermaid(hostileSnapshot())).toBe(
      [
        "erDiagram",
        `    "public.we'ird tbl" {`,
        "        character_varying(255) full_name",
        "    }",
        "",
      ].join("\n"),
    );
  });

  it("returns a header-only diagram for an empty catalog", () => {
    expect(schemaGraphToMermaid(emptySnapshot())).toBe("erDiagram\n");
  });

  it("produces the same text for a SchemaGraph and for the snapshot it came from", () => {
    expect(schemaGraphToMermaid(extractSchemaGraph(shopSnapshot()))).toBe(
      schemaGraphToMermaid(shopSnapshot()),
    );
  });
});

describe("schemaGraphToDbml", () => {
  it("emits schema-qualified tables, column settings, and a Ref per FK edge", () => {
    expect(schemaGraphToDbml(shopSnapshot())).toBe(
      [
        'Table "public"."orders" {',
        '  "id" integer [pk, not null]',
        '  "total" numeric(10,2)',
        '  "user_id" integer',
        "}",
        "",
        'Table "public"."users" {',
        '  "email" text',
        '  "id" integer [pk, not null]',
        "}",
        "",
        'Ref: "public"."orders"."user_id" > "public"."users"."id"',
        "",
      ].join("\n"),
    );
  });

  it("writes composite foreign keys as parenthesised column lists", () => {
    expect(schemaGraphToDbml(compositeSnapshot())).toContain(
      'Ref: "public"."order_items".("order_id", "tenant_id") > "public"."orders".("id", "tenant_id")',
    );
  });

  it("quotes identifiers and types that are not bare words", () => {
    expect(schemaGraphToDbml(hostileSnapshot())).toBe(
      [
        'Table "public"."we\\"ird tbl" {',
        '  "full name" "character varying(255)"',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("returns an empty string for an empty catalog", () => {
    expect(schemaGraphToDbml(emptySnapshot())).toBe("");
  });

  it("produces the same text for a SchemaGraph and for the snapshot it came from", () => {
    expect(schemaGraphToDbml(extractSchemaGraph(shopSnapshot()))).toBe(
      schemaGraphToDbml(shopSnapshot()),
    );
  });
});

function column(name: string, overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name,
    data_type: "integer",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
    ...overrides,
  };
}

function foreignKey(
  name: string,
  columns: readonly string[],
  referenceTable: string,
  referenceColumns: readonly string[],
): ConstraintInfo {
  return {
    name,
    constraint_type: "FOREIGN KEY",
    columns: [...columns],
    reference_table: referenceTable,
    reference_columns: [...referenceColumns],
  };
}

interface ShopSnapshotOptions {
  readonly userIdNullable?: boolean;
  readonly constraints?: SchemaGraphCatalogSnapshot["constraintsByTable"];
}

function shopSnapshot({
  userIdNullable = true,
  constraints = {
    public: {
      orders: [
        foreignKey("orders_user_id_fkey", ["user_id"], "public.users", ["id"]),
      ],
    },
  },
}: ShopSnapshotOptions = {}): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        { name: "orders", schema: "public", row_count: null },
        { name: "users", schema: "public", row_count: null },
      ],
    },
    columnsByTable: {
      public: {
        orders: [
          column("id", { is_primary_key: true, nullable: false }),
          column("user_id", {
            nullable: userIdNullable,
            is_foreign_key: true,
          }),
          column("total", { data_type: "numeric(10,2)" }),
        ],
        users: [
          column("id", { is_primary_key: true, nullable: false }),
          column("email", { data_type: "text" }),
        ],
      },
    },
    constraintsByTable: constraints,
  };
}

function compositeSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        { name: "order_items", schema: "public", row_count: null },
        { name: "orders", schema: "public", row_count: null },
      ],
    },
    columnsByTable: {
      public: {
        order_items: [
          column("order_id", { nullable: true }),
          column("tenant_id", { nullable: false }),
        ],
        orders: [
          column("id", { is_primary_key: true, nullable: false }),
          column("tenant_id", { is_primary_key: true, nullable: false }),
        ],
      },
    },
    constraintsByTable: {
      public: {
        order_items: [
          foreignKey(
            "order_items_order_fkey",
            ["order_id", "tenant_id"],
            "public.orders",
            ["id", "tenant_id"],
          ),
        ],
      },
    },
  };
}

function hostileSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [{ name: 'we"ird tbl', schema: "public", row_count: null }],
    },
    columnsByTable: {
      public: {
        'we"ird tbl': [
          column("full name", { data_type: "character varying(255)" }),
        ],
      },
    },
  };
}

function emptySnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [],
    tablesBySchema: {},
    columnsByTable: {},
  };
}
