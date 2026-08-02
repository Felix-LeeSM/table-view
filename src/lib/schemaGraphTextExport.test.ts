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
  schemaGraphToDbml,
  schemaGraphToMermaid,
} from "./schemaGraphTextExport";

// Purpose: SchemaGraph → mermaid / DBML 텍스트 변환의 문법 정합성과 관계 의미론
// 고정 — issue #1661 1차 PR (2026-08-01, 라운드 1 반영 2026-08-02)
describe("schemaGraphToMermaid", () => {
  // Reason: 엔티티·컬럼·관계선의 전체 산출 형태를 한 번에 못 박는다 (2026-08-01)
  it("emits entities in id order, columns in graph ordinal order, and one relation per FK edge", () => {
    expect(schemaGraphToMermaid(shopSnapshot())).toBe(
      [
        "erDiagram",
        '    "public.orders" {',
        "        integer id PK",
        "        numeric(10,2) total",
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

  // Reason: 라운드 1 non-blocking 2 — mermaid 는 타입 안 콤마를 그대로 받는다.
  // `numeric(10,2)` 를 `numeric(10_2)` 로 낮추던 손실을 되돌리고 고정한다 (2026-08-02)
  it("keeps commas inside a column type instead of lowering them", () => {
    expect(schemaGraphToMermaid(shopSnapshot())).toContain(
      "        numeric(10,2) total",
    );
  });

  // Reason: PR body 가 문법 위험으로 지목한 `PK, FK` 콤마 나열에 fixture 가 하나도
  // 없었다 — 라운드 1 리뷰어 변조가 구분자 교체로 생존했다 (2026-08-02)
  it("lists both key markers on a column that is primary and foreign at once", () => {
    expect(
      schemaGraphToMermaid(shopSnapshot({ userIdPrimaryKey: true })),
    ).toContain("        integer user_id PK, FK");
  });

  // Reason: FK 소스 컬럼이 전부 NOT NULL 이면 부모가 반드시 1개다 (2026-08-01)
  it("marks the parent side as exactly-one when every FK source column is NOT NULL", () => {
    const diagram = schemaGraphToMermaid(
      shopSnapshot({ userIdNullable: false }),
    );

    expect(diagram).toContain(
      '    "public.orders" }o--|| "public.users" : "orders_user_id_fkey"',
    );
    expect(diagram).not.toContain("}o--|o");
  });

  // Reason: MATCH SIMPLE 은 소스 컬럼 하나만 NULL 이어도 FK 를 검사하지 않는다 (2026-08-01)
  it("keeps the parent side optional when only one column of a composite FK is nullable", () => {
    expect(schemaGraphToMermaid(compositeSnapshot())).toContain(
      '    "public.order_items" }o--|o "public.orders" : "order_items_order_fkey"',
    );
  });

  // Reason: nullability 를 모르는 컬럼을 `||`(정확히 1) 로 그리면 없는 제약을
  // 있다고 그리게 된다 — 리뷰어 변조 `?? true` → `?? false` 가 생존했다 (2026-08-02)
  it("treats an FK whose source column node is missing as optional", () => {
    expect(schemaGraphToMermaid(handBuiltGraph())).toContain(
      '    "public.orders" }o--|o "public.users" : "orders_user_id_fkey"',
    );
  });

  // Reason: `SchemaGraph` 직접 주입은 공개 입력이라 양끝 노드가 없는 edge 가
  // 도달한다 — 리뷰어 변조가 이 가드를 지우고도 생존했다 (2026-08-02)
  it("skips a relation whose endpoint table node is absent from the graph", () => {
    const diagram = schemaGraphToMermaid(handBuiltGraph());

    expect(diagram).not.toContain("dangling");
    expect(diagram.match(/}o--/g)).toHaveLength(1);
  });

  // Reason: 컬럼 플래그가 아니라 edge 가 관계의 SOT 다 (2026-08-01)
  it("takes FK marks from graph edges, not from the column is_foreign_key flag", () => {
    // `user_id` 는 두 스냅샷 모두에서 is_foreign_key: true 다. 참조 메타데이터가
    // 없으면 그래프가 edge 를 만들지 않고, 그러면 표시도 관계선도 없어야 한다.
    const diagram = schemaGraphToMermaid(shopSnapshot({ constraints: {} }));

    expect(diagram).toContain("        integer user_id\n");
    expect(diagram).not.toContain("FK");
    expect(diagram).not.toContain("}o--");
  });

  // Reason: 모듈 상단 주석이 "SQLite 합성 FK 는 그대로 실린다" 고 주장하는데 그
  // 경로를 도는 fixture 가 없었다 — 라벨에 내부 이름이 찍히는 것도 함께 고정한다
  // (라운드 1 non-blocking 5, 2026-08-02)
  it("draws foreign keys synthesised from column flags, internal constraint name and all", () => {
    expect(schemaGraphToMermaid(sqliteLikeSnapshot())).toContain(
      '    "main.orders" }o--|o "main.users" : "__synthetic_foreign_key_user_id"',
    );
  });

  // Reason: 라운드 1 blocking ② — 실제 파서가 거부한 네 입력을 고정한다.
  // `%` `\` 는 따옴표 문자열 토큰이, 선행 숫자와 `@` 는 단어 토큰이 거부한다 (2026-08-02)
  it("neutralises every character the mermaid lexer rejects", () => {
    expect(schemaGraphToMermaid(hostileSnapshot())).toBe(
      [
        "erDiagram",
        '    "public.we_ird_a_b tbl" {',
        "        boolean x_2fa_enabled",
        "        integer a_b",
        "        character_varying(255) full_name",
        "    }",
        "",
      ].join("\n"),
    );
  });

  // Reason: 이름이 통째로 비면 빈 따옴표 / 빈 단어가 나가 파싱이 깨진다 (2026-08-02)
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

  // Reason: 컬럼이 아직 안 올라온 테이블도 다이어그램에는 남아야 한다 — mermaid 는
  // 빈 엔티티 블록을 받는다 (라운드 1 blocking ① 의 짝, 2026-08-02)
  it("keeps a column-less table as an empty entity block", () => {
    expect(schemaGraphToMermaid(columnlessSnapshot())).toBe(
      ["erDiagram", '    "public.orders" {', "    }", ""].join("\n"),
    );
  });

  // Reason: 양끝 공백이 두 포맷에서 다르게 나가지 않도록 (라운드 1 non-blocking 13, 2026-08-02)
  it("trims surrounding whitespace from an entity name", () => {
    expect(schemaGraphToMermaid(paddedNameSnapshot())).toContain(
      '    "public.spaced" {',
    );
  });

  // Reason: 테이블 0개 입력에서도 유효한 헤더가 나가야 한다 (2026-08-01)
  it("returns a header-only diagram for an empty catalog", () => {
    expect(schemaGraphToMermaid(emptySnapshot())).toBe("erDiagram\n");
  });

  // Reason: 스냅샷과 그래프 입력이 같은 산출물을 내야 두 호출 경로가 갈라지지 않는다 (2026-08-01)
  it("produces the same text for a SchemaGraph and for the snapshot it came from", () => {
    expect(schemaGraphToMermaid(extractSchemaGraph(shopSnapshot()))).toBe(
      schemaGraphToMermaid(shopSnapshot()),
    );
  });
});

// Purpose: DBML 산출물이 `@dbml/core` 문법을 벗어나지 않는지 고정 — issue #1661
// (2026-08-01, 라운드 1 반영 2026-08-02)
describe("schemaGraphToDbml", () => {
  // Reason: 테이블 블록·컬럼 세팅·Ref 의 전체 산출 형태를 한 번에 못 박는다 (2026-08-01)
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

  // Reason: 복합 FK 는 괄호 목록이어야 한다 (2026-08-01)
  it("writes composite foreign keys as parenthesised column lists", () => {
    expect(schemaGraphToDbml(compositeSnapshot())).toContain(
      'Ref: "public"."order_items".("order_id", "tenant_id") > "public"."orders".("id", "tenant_id")',
    );
  });

  // Reason: 라운드 1 blocking ① — 본문 없는 `Table` 블록 하나가 `@dbml/core` 에서
  // 문서 전체를 무효로 만든다. 카탈로그가 컬럼을 비동기로 채우므로 흔한 상태다 (2026-08-02)
  it("replaces a column-less table with a comment instead of an empty block", () => {
    const dbml = schemaGraphToDbml(columnlessSnapshot());

    expect(dbml).toBe(
      '// skipped table "public"."orders": no columns available\n',
    );
    expect(dbml).not.toContain("{");
  });

  // Reason: 생략한 테이블을 가리키는 `Ref:` 가 남으면 문서 전체가 다시 무효가 된다
  // (라운드 1 blocking ① 의 두 번째 절반, 2026-08-02)
  it("drops a Ref whose endpoint table was skipped for having no columns", () => {
    const dbml = schemaGraphToDbml(shopSnapshot({ columnsForUsers: [] }));

    expect(dbml).toContain(
      '// skipped table "public"."users": no columns available',
    );
    expect(dbml).not.toContain("Ref:");
    expect(dbml).toContain('Table "public"."orders" {');
  });

  // Reason: 그래프에 없는 테이블을 가리키는 edge 도 같은 이유로 빠져야 한다 (2026-08-02)
  it("drops a Ref whose endpoint table is absent from the graph", () => {
    const dbml = schemaGraphToDbml(handBuiltGraph());

    expect(dbml).not.toContain("dangling");
    expect(dbml.match(/^Ref: /gm)).toHaveLength(1);
  });

  // Reason: 따옴표 식별자의 backslash escape — 리뷰어 변조가 이 escape 를 지우고
  // 생존했다 (라운드 1 non-blocking 1, 2026-08-02)
  it("escapes backslashes and quotes inside quoted identifiers", () => {
    expect(schemaGraphToDbml(hostileSnapshot())).toBe(
      [
        'Table "public"."we\\"ird\\\\a%b tbl" {',
        '  "2fa_enabled" boolean',
        '  "a@b" integer',
        '  "full name" "character varying(255)"',
        "}",
        "",
      ].join("\n"),
    );
  });

  // Reason: 빈 타입이 따옴표 없이 나가면 파싱이 깨진다 (2026-08-02)
  it("falls back to a placeholder type when the catalog type is blank", () => {
    expect(schemaGraphToDbml(blankNameSnapshot())).toBe(
      [
        'Table "public"."blanks" {',
        '  "" "unknown"',
        '  "ok_column" "unknown"',
        "}",
        "",
      ].join("\n"),
    );
  });

  // Reason: mermaid 와 같은 기준으로 양끝 공백을 턴다 (라운드 1 non-blocking 13, 2026-08-02)
  it("trims surrounding whitespace from quoted identifiers", () => {
    expect(schemaGraphToDbml(paddedNameSnapshot())).toContain(
      'Table "public"."spaced" {',
    );
  });

  // Reason: 테이블 0개 입력에서 빈 문자열이어야 파일이 안 만들어진다 (2026-08-01)
  it("returns an empty string for an empty catalog", () => {
    expect(schemaGraphToDbml(emptySnapshot())).toBe("");
  });

  // Reason: 스냅샷과 그래프 입력이 같은 산출물을 내야 두 호출 경로가 갈라지지 않는다 (2026-08-01)
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

/** 제약 카탈로그가 없어 컬럼 플래그에서 FK 가 합성되는 SQLite 형 입력. */
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
 * 스냅샷 경로로는 못 만드는 그래프. `extractSchemaGraph` 는 컬럼 노드 없는 FK 나
 * 없는 테이블을 가리키는 edge 를 만들지 않지만, 이 모듈의 공개 입력 타입은
 * `SchemaGraph` 직접 주입을 허용한다.
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
        // FK 소스 컬럼(`user_id`)은 일부러 노드를 두지 않는다. 테이블 자체는
        // 컬럼이 있어야 DBML 블록으로 나가고, 그래야 Ref 필터를 볼 수 있다.
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
        // 소스 컬럼 노드가 없는 FK — nullability 미상이라 optional 로 그려야 한다.
        id: "edge:foreign-key-table:orders->users",
        kind: "foreign-key-table",
        from: ordersId,
        to: usersId,
        constraintId: `${ordersId}.constraint:orders_user_id_fkey`,
        foreignKey: relationship("users", ["user_id"], "orders_user_id_fkey"),
      },
      {
        // 대상 테이블 노드가 없는 FK — 선도 Ref 도 나가면 안 된다.
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
