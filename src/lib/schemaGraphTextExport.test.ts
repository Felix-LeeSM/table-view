import { Parser } from "@dbml/core";
import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { schemaName, tableName } from "@/test-utils/brandedKeys";
import { schemaGraphTableId } from "@/test-utils/schemaGraphIds";
import type { ColumnInfo, ConstraintInfo } from "@/types/schema";
import type {
  SchemaGraph,
  SchemaGraphCatalogSnapshot,
  SchemaGraphForeignKeyRelationship,
} from "@/types/schemaGraph";
import { extractSchemaGraph } from "./schemaGraph";
import {
  type SchemaGraphTextExportInput,
  schemaGraphToDbml,
  schemaGraphToMermaid,
} from "./schemaGraphTextExport";

// Purpose: pin the grammar validity and relationship semantics of the
// SchemaGraph → mermaid / DBML text conversion — issue #1661 (2026-08-01,
// revised 2026-08-02)
describe("schemaGraphToMermaid", () => {
  // Reason: pin the full output shape of entities, columns, and relation lines
  // in one go (2026-08-01)
  it("emits entities in id order, columns in graph ordinal order, and one relation per FK edge", () => {
    expect(schemaGraphToMermaid(shopSnapshot())).toBe(
      [
        "erDiagram",
        '    "public.orders" {',
        "        integer id PK",
        "        numeric_10_2_ total",
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

  // Reason: #2097 blocking ⑥ — when a name **starts** with `pk` and the next
  // character is not an ASCII word character, the mermaid lexer splits off a
  // key marker and the whole document is a Parse error. The separator case
  // (`pk-id`) and the non-ASCII case (`pk` followed by Hangul) come from the
  // same single rule, so both are pinned — the previous code checked only
  // exact matches and let both through (2026-08-03)
  it("keeps an attribute name that starts with a reserved key marker parseable", async () => {
    const diagram = schemaGraphToMermaid(reservedPrefixSnapshot());

    expect(diagram).toContain("        integer pk_id");
    expect(diagram).toContain("        integer _pk이름");
    await expect(mermaid.parse(diagram)).resolves.toMatchObject({
      diagramType: "er",
    });
  });

  // Reason: the `PK, FK` comma list that the PR body flagged as a grammar risk
  // had no fixture at all — a mutation that swapped the separator survived
  // (2026-08-02)
  it("lists both key markers on a column that is primary and foreign at once", () => {
    expect(
      schemaGraphToMermaid(shopSnapshot({ userIdPrimaryKey: true })),
    ).toContain("        integer user_id PK, FK");
  });

  // Reason: when every FK source column is NOT NULL, there is necessarily
  // exactly one parent (2026-08-01)
  it("marks the parent side as exactly-one when every FK source column is NOT NULL", () => {
    const diagram = schemaGraphToMermaid(
      shopSnapshot({ userIdNullable: false }),
    );

    expect(diagram).toContain(
      '    "public.orders" }o--|| "public.users" : "orders_user_id_fkey"',
    );
    expect(diagram).not.toContain("}o--|o");
  });

  // Reason: under MATCH SIMPLE, the FK is not checked when even one source
  // column is NULL (2026-08-01)
  it("keeps the parent side optional when only one column of a composite FK is nullable", () => {
    expect(schemaGraphToMermaid(compositeSnapshot())).toContain(
      '    "public.order_items" }o--|o "public.orders" : "order_items_order_fkey"',
    );
  });

  // Reason: drawing a column of unknown nullability as `||` (exactly one)
  // draws a constraint that does not exist — the mutation `?? true` →
  // `?? false` survived (2026-08-02)
  it("treats an FK whose source column node is missing as optional", () => {
    expect(schemaGraphToMermaid(handBuiltGraph())).toContain(
      '    "public.orders" }o--|o "public.users" : "orders_user_id_fkey"',
    );
  });

  // Reason: a directly supplied `SchemaGraph` is public input, so edges whose
  // end nodes are missing do arrive — a mutation that deleted this guard
  // survived (2026-08-02)
  it("skips a relation whose endpoint table node is absent from the graph", () => {
    const diagram = schemaGraphToMermaid(handBuiltGraph());

    expect(diagram).not.toContain("dangling");
    expect(diagram.match(/}o--/g)).toHaveLength(1);
  });

  // Reason: the edge, not the column flag, is the SOT for a relation
  // (2026-08-01)
  it("takes FK marks from graph edges, not from the column is_foreign_key flag", () => {
    // `user_id` has is_foreign_key: true in both snapshots. Without reference
    // metadata the graph makes no edge, and then there must be neither a mark
    // nor a relation line.
    const diagram = schemaGraphToMermaid(shopSnapshot({ constraints: {} }));

    expect(diagram).toContain("        integer user_id\n");
    expect(diagram).not.toContain("FK");
    expect(diagram).not.toContain("}o--");
  });

  // Reason: the module header says FKs synthesised for SQLite are carried
  // through as is, but no fixture ran that path — this also pins the
  // internal name that ends up in the label (#2097, 2026-08-02)
  it("draws foreign keys synthesised from column flags, internal constraint name and all", () => {
    expect(schemaGraphToMermaid(sqliteLikeSnapshot())).toContain(
      '    "main.orders" }o--|o "main.users" : "__synthetic_foreign_key_user_id"',
    );
  });

  // Reason: #2097 blocking ② — pins the four inputs the real parser rejected.
  // The quoted-string token rejects `%` and `\`; the word token rejects a
  // leading digit and `@` (2026-08-02)
  it("neutralises every character the mermaid lexer rejects", () => {
    expect(schemaGraphToMermaid(hostileSnapshot())).toBe(
      [
        "erDiagram",
        '    "public.we_ird_a_b tbl" {',
        "        boolean _2fa_enabled",
        "        integer a_b",
        "        character_varying_255_ full_name",
        "    }",
        "",
      ].join("\n"),
    );
  });

  // Reason: #2097 blocking ④ — the previous code lowered everything outside
  // ASCII to `_`, which folded two Hangul column names in one entity into the
  // same token and erased what the diagram pointed at. mermaid accepts Unicode
  // identifiers as is (2026-08-02)
  it("keeps non-ASCII identifiers intact and distinct", () => {
    const diagram = schemaGraphToMermaid(koreanSnapshot());

    expect(diagram).toContain("        문자열 이름");
    expect(diagram).toContain("        integer 나이");
    expect(diagram).toContain('    "public.사용자" {');
  });

  // Reason: column order must follow `ordinal`, not id (percent-encoded)
  // order. Hangul columns form a combination where the two orders disagree,
  // which closes the gap where deleting the sort went unnoticed
  // (#2097, 2026-08-02)
  it("orders columns by graph ordinal even when the encoded ids sort differently", () => {
    const columns = schemaGraphToMermaid(koreanSnapshot())
      .split("\n")
      .filter((line) => line.startsWith("        "))
      .map((line) => line.trim().split(" ")[1]);

    expect(columns).toEqual(["ab", "나이", "이름"]);
  });

  // Reason: #2097 — when names collide after sanitising, mermaid still parses,
  // but two columns merge into one line and two tables into one entity. Pins
  // the decision to split them by the same rule as DBML, in both formats
  // (2026-08-02)
  it("keeps sanitised attribute names unique inside an entity", () => {
    const diagram = schemaGraphToMermaid(collidingNameSnapshot());

    expect(diagram).toContain("        integer a_b\n");
    expect(diagram).toContain("        integer a_b_2\n");
  });

  // Reason: entity names must be split for the same reason — once merged, a
  // relation line points at the wrong table (2026-08-02)
  it("keeps sanitised entity names unique", () => {
    const diagram = schemaGraphToMermaid(collidingTableSnapshot());

    expect(diagram).toContain('    "public.a_b" {');
    expect(diagram).toContain('    "public.a_b_2" {');
  });

  // Reason: a wholly empty name emits empty quotes / an empty word, and
  // parsing breaks (2026-08-02)
  it("falls back to a placeholder word when a name or type is empty", () => {
    expect(schemaGraphToMermaid(blankNameSnapshot())).toBe(
      [
        "erDiagram",
        '    "public.blanks" {',
        "        unknown unknown",
        "        unknown ok_column",
        "    }",
        "",
      ].join("\n"),
    );
  });

  // Reason: a table whose columns have not loaded yet must still stay in the
  // diagram — mermaid accepts an empty entity block (the counterpart of
  // #2097 blocking ①, 2026-08-02)
  it("keeps a column-less table as an empty entity block", () => {
    expect(schemaGraphToMermaid(columnlessSnapshot())).toBe(
      ["erDiagram", '    "public.orders" {', "    }", ""].join("\n"),
    );
  });

  // Reason: surrounding whitespace must not come out differently in the two
  // formats (#2097, 2026-08-02)
  it("trims surrounding whitespace from an entity name", () => {
    expect(schemaGraphToMermaid(paddedNameSnapshot())).toContain(
      '    "public.spaced" {',
    );
  });

  // Reason: a wholly empty name emits `""`, and mermaid fails with a Parse
  // error. The suite once passed with this fallback deleted (2026-08-02)
  it("names an entity whose catalog name is empty", () => {
    expect(schemaGraphToMermaid(unnamedTableSnapshot())).toContain(
      '    "public.unnamed" {',
    );
  });

  // Reason: input with zero tables must still emit a valid header (2026-08-01)
  it("returns a header-only diagram for an empty catalog", () => {
    expect(schemaGraphToMermaid(emptySnapshot())).toBe("erDiagram\n");
  });

  // Reason: snapshot and graph input must yield the same output so the two
  // call paths do not drift apart (2026-08-01)
  it("produces the same text for a SchemaGraph and for the snapshot it came from", () => {
    expect(schemaGraphToMermaid(extractSchemaGraph(shopSnapshot()))).toBe(
      schemaGraphToMermaid(shopSnapshot()),
    );
  });
});

// Purpose: pin that the DBML output stays within the `@dbml/core` grammar —
// issue #1661 (2026-08-01, revised 2026-08-02)
describe("schemaGraphToDbml", () => {
  // Reason: pin the full output shape of table blocks, column settings, and
  // Refs in one go (2026-08-01)
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

  // Reason: a composite FK must be a parenthesised list (2026-08-01)
  it("writes composite foreign keys as parenthesised column lists", () => {
    expect(schemaGraphToDbml(compositeSnapshot())).toContain(
      'Ref: "public"."order_items".("order_id", "tenant_id") > "public"."orders".("id", "tenant_id")',
    );
  });

  // Reason: #2097 blocking ① — a single `Table` block without a body
  // invalidates the whole document in `@dbml/core`. The catalog fills in
  // columns asynchronously, so this state is common (2026-08-02)
  it("replaces a column-less table with a comment instead of an empty block", () => {
    const dbml = schemaGraphToDbml(columnlessSnapshot());

    expect(dbml).toBe(
      '// skipped table "public"."orders": no columns available\n',
    );
    expect(dbml).not.toContain("{");
  });

  // Reason: a leftover `Ref:` pointing at a skipped table invalidates the
  // whole document again (the second half of #2097 blocking ①, 2026-08-02)
  it("drops a Ref whose endpoint table was skipped for having no columns", () => {
    const dbml = schemaGraphToDbml(shopSnapshot({ columnsForUsers: [] }));

    expect(dbml).toContain(
      '// skipped table "public"."users": no columns available',
    );
    expect(dbml).not.toContain("Ref:");
    expect(dbml).toContain('Table "public"."orders" {');
  });

  // Reason: the parser also rejects the whole document for a `Ref:` pointing
  // at an undeclared **column**
  // (`Can't find field "user_id" in table "orders"`). This graph holds one
  // missing table and one missing column; both must be dropped, and their
  // count must stay in the comment (2026-08-02)
  it("drops Refs to tables or columns that were never declared", () => {
    const dbml = schemaGraphToDbml(handBuiltGraph());

    expect(dbml).not.toContain("dangling");
    expect(dbml).not.toContain("Ref:");
    expect(dbml).toContain(
      "// omitted 2 reference(s) to tables or columns that are not declared above",
    );
  });

  // Reason: when names collide after sanitising, the parser rejects the
  // document with `Field "a_b" existed in table` — distinct originals must
  // stay distinct in the output (2026-08-02)
  it("keeps sanitised identifiers unique inside their scope", () => {
    const dbml = schemaGraphToDbml(collidingNameSnapshot());

    expect(dbml).toContain('  "a_b" integer');
    expect(dbml).toContain('  "a_b_2" integer');
  });

  // Reason: #2097 blocking ③ — DBML identifiers have no escape syntax. The
  // parser rejects both `\"` and `""`, so `"` is lowered and a backslash stays
  // a literal character. The previous expected value had pinned an
  // unparseable string as the right answer (2026-08-02)
  it("lowers quotes and leaves backslashes alone inside quoted identifiers", () => {
    expect(schemaGraphToDbml(hostileSnapshot())).toBe(
      [
        'Table "public"."we_ird\\a%b tbl" {',
        '  "2fa_enabled" boolean',
        '  "a@b" integer',
        '  "full name" "character varying(255)"',
        "}",
        "",
      ].join("\n"),
    );
  });

  // Reason: #2097 blocking ③ — the parser rejects the empty identifier `""`.
  // A whitespace-only name is empty after trim, so it needs a placeholder
  // (2026-08-02)
  it("falls back to placeholders for a blank identifier and a blank type", () => {
    expect(schemaGraphToDbml(blankNameSnapshot())).toBe(
      [
        'Table "public"."blanks" {',
        '  "unnamed" "unknown"',
        '  "ok_column" "unknown"',
        "}",
        "",
      ].join("\n"),
    );
  });

  // Reason: #2097 blocking ③ — a wholly empty name leaves the table identifier
  // empty too, and the parser rejects it. The DBML counterpart of the mermaid
  // placeholder (2026-08-02)
  it("names a table whose catalog name is empty", () => {
    expect(schemaGraphToDbml(unnamedTableSnapshot())).toContain(
      'Table "public"."unnamed" {',
    );
  });

  // Reason: @dbml/core rejects two identical `Ref:` lines. When two FK
  // constraints on the same column pair differ only in name, this module does
  // not carry the name, so the two lines come out identical (#2097 — promoted
  // after measuring, 2026-08-02)
  it("folds byte-identical Ref lines into one", () => {
    const dbml = schemaGraphToDbml(duplicateForeignKeySnapshot());

    expect(dbml.match(/^Ref: /gm)).toHaveLength(1);
  });

  // Reason: trims surrounding whitespace by the same rule as mermaid
  // (#2097, 2026-08-02)
  it("trims surrounding whitespace from quoted identifiers", () => {
    expect(schemaGraphToDbml(paddedNameSnapshot())).toContain(
      'Table "public"."spaced" {',
    );
  });

  // Reason: zero-table input must yield an empty string so that no file is
  // created (2026-08-01)
  it("returns an empty string for an empty catalog", () => {
    expect(schemaGraphToDbml(emptySnapshot())).toBe("");
  });

  // Reason: snapshot and graph input must yield the same output so the two
  // call paths do not drift apart (2026-08-01)
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
  readonly userIdPrimaryKey?: boolean;
  readonly constraints?: SchemaGraphCatalogSnapshot["constraintsByTable"];
  readonly columnsForUsers?: readonly ColumnInfo[];
}

function shopSnapshot({
  userIdNullable = true,
  userIdPrimaryKey = false,
  constraints = {
    public: {
      orders: [
        foreignKey("orders_user_id_fkey", ["user_id"], "public.users", ["id"]),
      ],
    },
  },
  columnsForUsers = [
    column("id", { is_primary_key: true, nullable: false }),
    column("email", { data_type: "text" }),
  ],
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
            is_primary_key: userIdPrimaryKey,
            is_foreign_key: true,
          }),
          column("total", { data_type: "numeric(10,2)" }),
        ],
        users: [...columnsForUsers],
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

/**
 * SQLite-style input: no constraint catalog, so FKs are synthesised from
 * column flags.
 */
function sqliteLikeSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "sqlite", database: "shop" },
    schemas: [{ name: "main" }],
    tablesBySchema: {
      main: [
        { name: "orders", schema: "main", row_count: null },
        { name: "users", schema: "main", row_count: null },
      ],
    },
    columnsByTable: {
      main: {
        orders: [
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "users(id)",
          }),
        ],
        users: [column("id", { is_primary_key: true, nullable: false })],
      },
    },
  };
}

function hostileSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [{ name: 'we"ird\\a%b tbl', schema: "public", row_count: null }],
    },
    columnsByTable: {
      public: {
        'we"ird\\a%b tbl': [
          column("full name", { data_type: "character varying(255)" }),
          column("2fa_enabled", { data_type: "boolean" }),
          column("a@b"),
        ],
      },
    },
  };
}

/**
 * Names caught by mermaid's ATTRIBUTE_KEY rule (`\b(PK|FK|UK)\b`). `\b` is an
 * ASCII word boundary, so `pk` is caught the same way whether a separator, a
 * Hangul letter, or a combining mark follows it.
 */
function reservedPrefixSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [{ name: "keys", schema: "public", row_count: null }],
    },
    columnsByTable: {
      public: {
        keys: [
          column("pk-id"),
          column("pk이름"),
          column("fk.value", { data_type: "uk-type" }),
          column("pk"),
        ],
      },
    },
  };
}

function blankNameSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [{ name: "blanks", schema: "public", row_count: null }],
    },
    columnsByTable: {
      public: {
        blanks: [
          column("", { data_type: "" }),
          column("ok_column", { data_type: "  " }),
        ],
      },
    },
  };
}

function columnlessSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [{ name: "orders", schema: "public", row_count: null }],
    },
    columnsByTable: {},
  };
}

function paddedNameSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [{ name: " spaced ", schema: "public", row_count: null }],
    },
    columnsByTable: {
      public: { " spaced ": [column("id", { nullable: false })] },
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

/**
 * A graph the snapshot path cannot produce. `extractSchemaGraph` does not make
 * an edge that points at a missing table, but this module's public input type
 * accepts a `SchemaGraph` directly.
 */
function handBuiltGraph(): SchemaGraph {
  const ordersId = schemaGraphTableId("public", "orders");
  const usersId = schemaGraphTableId("public", "users");
  const relationship = (
    table: string,
    columns: readonly string[],
    constraintName: string,
  ): SchemaGraphForeignKeyRelationship => ({
    kind: "foreign-key",
    direction: "source-to-target",
    source: {
      schema: schemaName("public"),
      table: tableName("orders"),
      columns: [...columns],
    },
    target: {
      schema: schemaName("public"),
      table: tableName(table),
      columns: ["id"],
    },
    rawMetadata: {
      constraintName,
      constraintType: "FOREIGN KEY",
      sourceColumns: [...columns],
      referenceTable: `public.${table}`,
      referenceColumns: ["id"],
      columnReferences: [],
      synthetic: false,
    },
  });

  return {
    source: { dbType: "postgresql", database: "shop" },
    nodes: [
      {
        id: ordersId,
        kind: "table",
        label: "orders",
        schema: schemaName("public"),
        table: tableName("orders"),
        data: { name: "orders", schema: "public", row_count: null },
      },
      {
        id: usersId,
        kind: "table",
        label: "users",
        schema: schemaName("public"),
        table: tableName("users"),
        data: { name: "users", schema: "public", row_count: null },
      },
      {
        id: `${usersId}.column:id`,
        kind: "column",
        label: "id",
        schema: schemaName("public"),
        table: tableName("users"),
        column: "id",
        ordinal: 0,
        data: column("id", { nullable: false }),
      },
      {
        // The FK source column (`user_id`) deliberately gets no node. The
        // table itself needs a column to come out as a DBML block, and only
        // then can the Ref filter be observed.
        id: `${ordersId}.column:id`,
        kind: "column",
        label: "id",
        schema: schemaName("public"),
        table: tableName("orders"),
        column: "id",
        ordinal: 0,
        data: column("id", { nullable: false }),
      },
    ],
    edges: [
      {
        // FK without a source column node — nullability is unknown, so it
        // must be drawn as optional.
        id: "edge:foreign-key-table:orders->users",
        kind: "foreign-key-table",
        from: ordersId,
        to: usersId,
        constraintId: `${ordersId}.constraint:orders_user_id_fkey`,
        foreignKey: relationship("users", ["user_id"], "orders_user_id_fkey"),
      },
      {
        // FK without a target table node — neither a line nor a Ref may be
        // emitted.
        id: "edge:foreign-key-table:orders->dangling",
        kind: "foreign-key-table",
        from: ordersId,
        to: schemaGraphTableId("public", "dangling"),
        constraintId: `${ordersId}.constraint:orders_dangling_fkey`,
        foreignKey: relationship(
          "dangling",
          ["dangling_id"],
          "orders_dangling_fkey",
        ),
      },
    ],
    diagnostics: [],
  };
}

/**
 * Every input fed to the round-trip check. This list proves that the output
 * the string assertions pin **actually passes the real parsers** — the
 * #2097 blocking finding was "text built from a guessed grammar", and back
 * then the repo had no parser, so a string assertion could pin invalid output
 * as the right answer.
 */
const ROUND_TRIP_INPUTS: ReadonlyArray<[string, SchemaGraphTextExportInput]> = [
  ["shop", shopSnapshot()],
  ["shop with a NOT NULL fk", shopSnapshot({ userIdNullable: false })],
  ["shop with a PK+FK column", shopSnapshot({ userIdPrimaryKey: true })],
  ["shop without constraints", shopSnapshot({ constraints: {} })],
  ["shop with a column-less parent", shopSnapshot({ columnsForUsers: [] })],
  ["composite fk", compositeSnapshot()],
  ["sqlite-like synthesised fk", sqliteLikeSnapshot()],
  ["duplicate fk constraints", duplicateForeignKeySnapshot()],
  ["hostile names and types", hostileSnapshot()],
  ["reserved key marker prefixes", reservedPrefixSnapshot()],
  ["colliding sanitised names", collidingNameSnapshot()],
  ["colliding table names", collidingTableSnapshot()],
  ["non-ASCII names", koreanSnapshot()],
  ["blank column name and type", blankNameSnapshot()],
  ["unnamed table", unnamedTableSnapshot()],
  ["column-less table", columnlessSnapshot()],
  ["padded names", paddedNameSnapshot()],
  ["empty catalog", emptySnapshot()],
  ["hand-built graph with dangling edges", handBuiltGraph()],
];

/**
 * Input-space sweep — it covers a space, not examples. #2097 blocking ⑤ (the
 * `pk` / `fk` / `uk` reserved words) was not caught by adding more fixtures;
 * this sweep caught it by plugging every risky character and reserved-word
 * candidate into the identifier positions and feeding the result to both
 * parsers. When a new character or word axis appears, add tokens here — there
 * is no reason to build one more fixture.
 *
 * Identifiers are built by **concatenating two tokens** from this list.
 * #2097 blocking ⑥ got through because the generator plugged tokens in only
 * as whole identifiers and could not build the `pk` + separator shape at all
 * — the diagnosis was that the generator had inherited the shape of the
 * reviewer-written cases, blind spot included. Pairs produce the prefix
 * (`pk` + `-`), suffix (`-` + `pk`), and infix (`a-b` + `pk`) shapes, and
 * since the empty string is a token, the single-token cases are included as
 * they are.
 */
const SWEEP_TOKENS: readonly string[] = [
  // Character axis — every ASCII symbol except `_` (boundary axis), plus space
  ..."!\"#$%&'()*+,-./:;<=>?@[\\]^`{|}~ ".split(""),
  // Word axis — candidates that may mean something in either grammar.
  // Reserved-word candidates carry every case combination — the guard is `/i`,
  // so case makes no difference today, but with an asymmetric list, narrowing
  // the guard to case-sensitive would leave the sweep telling only half the
  // story (#2097)
  "pk",
  "PK",
  "Pk",
  "pK",
  "fk",
  "FK",
  "Fk",
  "fK",
  "uk",
  "UK",
  "Uk",
  "uK",
  "one",
  "many",
  "zero",
  "only",
  "key",
  "unique",
  "primary",
  "foreign",
  "index",
  "class",
  "style",
  "title",
  "direction",
  "erDiagram",
  "Table",
  "Ref",
  "Enum",
  "Note",
  "note",
  "as",
  "not null",
  "int",
  "type",
  "default",
  // Boundary-value axis
  "",
  " ",
  "2fa",
  "_",
  "이름",
  "日本語",
  "a-b",
  "a.b",
  // Unicode classes the sanitiser lets through that are not letters/digits —
  // this axis also builds the shape where a combining mark leads (`́` alone)
  "́",
  // The range (U+0080~U+00BF) that `\p{L}` / `\p{N}` accept but the grammar's
  // `\u00C0-\uFFFF` range does not. A whitelist written with Unicode
  // properties would let these two leak straight through, and that is a Parse
  // error
  "²",
  "ª",
];

// `schema` / `table` are quoted-string tokens (`mermaidSafeText`), `column` /
// `type` are word tokens that cannot be quoted (`mermaidWord`), and
// `constraint` is the relation-line label. The fifth position only appears
// once an FK exists, so the target table is attached only when that position
// is in use (#2097 — the position list had been missing a line).
const SWEEP_POSITIONS = [
  "schema",
  "table",
  "column",
  "type",
  "constraint",
] as const;

type SweepPosition = (typeof SWEEP_POSITIONS)[number];

function sweepSnapshot(
  position: SweepPosition,
  identifier: string,
): SchemaGraphCatalogSnapshot {
  if (position === "constraint") {
    return {
      source: { dbType: "postgresql", database: "shop" },
      schemas: [{ name: "public" }],
      tablesBySchema: {
        public: [
          { name: "t", schema: "public", row_count: null },
          { name: "u", schema: "public", row_count: null },
        ],
      },
      columnsByTable: {
        public: {
          t: [column("c", { is_foreign_key: true })],
          u: [column("id", { is_primary_key: true, nullable: false })],
        },
      },
      constraintsByTable: {
        public: { t: [foreignKey(identifier, ["c"], "public.u", ["id"])] },
      },
    };
  }

  const schema = position === "schema" ? identifier : "public";
  const table = position === "table" ? identifier : "t";
  const columnName = position === "column" ? identifier : "c";
  const dataType = position === "type" ? identifier : "integer";

  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: schema }],
    tablesBySchema: { [schema]: [{ name: table, schema, row_count: null }] },
    columnsByTable: {
      [schema]: { [table]: [column(columnName, { data_type: dataType })] },
    },
  };
}

function parserError(error: unknown): string {
  const diagnostics = (error as { diags?: { message?: string }[] }).diags;
  return (
    diagnostics?.[0]?.message ??
    (error as Error).message?.split("\n")[0] ??
    String(error)
  );
}

// Purpose: feed the exporter output to the real parsers so grammar judgments
// move from guesswork to measurement — devDependencies `mermaid` /
// `@dbml/core` (2026-08-02, #2097 decision)
describe("exporter output parses with the real parsers", () => {
  // Reason: whether mermaid accepts the output for rendering is the only pass
  // criterion for this format. #2097 blocking ②④ are defects this check would
  // have caught (2026-08-02)
  it.each(ROUND_TRIP_INPUTS)(
    "mermaid.parse accepts %s",
    async (_name, input) => {
      await expect(
        mermaid.parse(schemaGraphToMermaid(input)),
      ).resolves.toMatchObject({
        diagramType: "er",
      });
    },
  );

  // Reason: in DBML one broken token invalidates the whole document, so there
  // is no partial pass. #2097 blocking ① and blocking ③ are what this check
  // targets (2026-08-02)
  it.each(ROUND_TRIP_INPUTS)("Parser.parse accepts %s", (_name, input) => {
    expect(() => Parser.parse(schemaGraphToDbml(input), "dbml")).not.toThrow();
  });

  // Reason: #2097 blocking ⑤ — the character classes were right, but the word
  // axis of `pk` / `fk` / `uk` was missing entirely. Example fixtures cannot
  // catch the next reserved word, so the test covers the input space.
  // #2097 blocking ⑥ got through because that space held single tokens only
  // and could not build `pk` + separator — token pairs are concatenated and
  // plugged into the five positions (2026-08-02)
  it("keeps every sweep token pair parseable in all five identifier positions", async () => {
    const failures: string[] = [];
    // Sanitising turns different token pairs into the same output (in the
    // mermaid word positions every ASCII symbol token goes down to `_`), so
    // many pairs fold into a document already seen. The same document gets
    // the same answer, so each distinct document is parsed only once.
    const parsed = new Set<string>();
    let cases = 0;

    for (const position of SWEEP_POSITIONS) {
      for (const head of SWEEP_TOKENS) {
        for (const tail of SWEEP_TOKENS) {
          const identifier = `${head}${tail}`;
          // Expand the snapshot into a graph once — handing the snapshot to
          // each exporter would run the same extraction twice. That both
          // inputs yield the same text is pinned in both formats by
          // "produces the same text for a SchemaGraph and for the snapshot".
          const input = extractSchemaGraph(sweepSnapshot(position, identifier));
          cases += 1;

          const mermaidText = schemaGraphToMermaid(input);
          if (!parsed.has(mermaidText)) {
            parsed.add(mermaidText);
            try {
              await mermaid.parse(mermaidText);
            } catch (error) {
              failures.push(
                `mermaid ${position}=${JSON.stringify(identifier)}: ${parserError(error)}`,
              );
            }
          }

          const dbmlText = schemaGraphToDbml(input);
          if (!parsed.has(dbmlText)) {
            parsed.add(dbmlText);
            try {
              Parser.parse(dbmlText, "dbml");
            } catch (error) {
              failures.push(
                `dbml ${position}=${JSON.stringify(identifier)}: ${parserError(error)}`,
              );
            }
          }
        }
      }
    }

    expect(failures).toEqual([]);
    expect(cases).toBe(SWEEP_POSITIONS.length * SWEEP_TOKENS.length ** 2);
    // The most expensive test in this suite — measured at 33s locally, over
    // the default testTimeout (10s in vite.config.ts). Shrinking the space
    // was deliberately not chosen: the previous generator was narrowed on the
    // argument that "this axis does not matter", and a blocking defect turned
    // up on that very axis. The timeout gives slow runners about 4x.
  }, 120_000);

  // Reason: the test must also check that the parser hands the names back, to
  // catch "parses, but became something else" (e.g. a doubled backslash)
  // (2026-08-02)
  it("round-trips non-ASCII table and column names through @dbml/core", () => {
    const database = Parser.parse(schemaGraphToDbml(koreanSnapshot()), "dbml");
    const table = database.schemas[0]?.tables[0];

    expect(table?.name).toBe("사용자");
    expect(table?.fields.map((field) => field.name)).toEqual([
      "ab",
      "나이",
      "이름",
    ]);
  });
});

/** Hangul identifiers, arranged so id order and ordinal order disagree. */
function koreanSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [{ name: "사용자", schema: "public", row_count: null }],
    },
    columnsByTable: {
      public: {
        사용자: [
          column("이름", { data_type: "문자열" }),
          column("나이"),
          column("ab", { data_type: "text" }),
        ],
      },
    },
  };
}

function unnamedTableSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [{ name: "", schema: "public", row_count: null }],
    },
    columnsByTable: { public: { "": [column("id", { nullable: false })] } },
  };
}

/** Two tables that fold into the same string after sanitising. */
function collidingTableSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        { name: 'a"b', schema: "public", row_count: null },
        { name: "a_b", schema: "public", row_count: null },
      ],
    },
    columnsByTable: {
      public: { 'a"b': [column("id")], a_b: [column("id")] },
    },
  };
}

/**
 * Two columns that fold into the same string after sanitising — DBML rejects
 * two fields with the same name.
 */
function collidingNameSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "shop" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [{ name: "collide", schema: "public", row_count: null }],
    },
    columnsByTable: {
      public: { collide: [column('a"b'), column("a_b")] },
    },
  };
}

/**
 * Two FK constraints on the same column pair that differ only in name — the
 * two emitted `Ref:` lines are byte-identical.
 */
function duplicateForeignKeySnapshot(): SchemaGraphCatalogSnapshot {
  return {
    ...shopSnapshot(),
    constraintsByTable: {
      public: {
        orders: [
          foreignKey("orders_user_id_fkey", ["user_id"], "public.users", [
            "id",
          ]),
          foreignKey("orders_user_id_fkey2", ["user_id"], "public.users", [
            "id",
          ]),
        ],
      },
    },
  };
}
