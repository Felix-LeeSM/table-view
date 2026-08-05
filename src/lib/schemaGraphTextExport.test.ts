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

// Purpose: SchemaGraph → mermaid / DBML 텍스트 변환의 문법 정합성과 관계 의미론
// 고정 — issue #1661 1차 PR (2026-08-01, 개정 2026-08-02)
describe("schemaGraphToMermaid", () => {
  // Reason: 엔티티·컬럼·관계선의 전체 산출 형태를 한 번에 못 박는다 (2026-08-01)
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

  // Reason: #1661 blocking ⑥ — `pk` 로 **시작**하고 뒤에 ASCII 단어 문자가 아닌
  // 것이 오면 mermaid 렉서가 키 표시자를 떼어 내 문서 전체가 Parse error 다.
  // 구분자(`pk-id`)와 비ASCII 글자(`pk이름`)가 같은 한 규칙에서 나오므로 둘 다
  // 고정한다 — 이전 코드는 완전 일치만 봐서 둘 다 통과시켰다 (2026-08-03)
  it("keeps an attribute name that starts with a reserved key marker parseable", async () => {
    const diagram = schemaGraphToMermaid(reservedPrefixSnapshot());

    expect(diagram).toContain("        integer pk_id");
    expect(diagram).toContain("        integer _pk이름");
    await expect(mermaid.parse(diagram)).resolves.toMatchObject({
      diagramType: "er",
    });
  });

  // Reason: PR body 가 문법 위험으로 지목한 `PK, FK` 콤마 나열에 fixture 가 하나도
  // 없었다 — 리뷰어 변조가 구분자 교체로 생존했다 (2026-08-02)
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
  // (#1661, 2026-08-02)
  it("draws foreign keys synthesised from column flags, internal constraint name and all", () => {
    expect(schemaGraphToMermaid(sqliteLikeSnapshot())).toContain(
      '    "main.orders" }o--|o "main.users" : "__synthetic_foreign_key_user_id"',
    );
  });

  // Reason: #1661 blocking ② — 실제 파서가 거부한 네 입력을 고정한다.
  // `%` `\` 는 따옴표 문자열 토큰이, 선행 숫자와 `@` 는 단어 토큰이 거부한다 (2026-08-02)
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

  // Reason: #1661 blocking ④ — ASCII 밖을 전부 `_` 로 내리던 이전 코드는
  // 한 엔티티 안의 `이름`·`나이` 를 같은 토큰으로 접어 다이어그램이 가리키는
  // 대상을 소멸시켰다. mermaid 는 유니코드 식별자를 그대로 받는다 (2026-08-02)
  it("keeps non-ASCII identifiers intact and distinct", () => {
    const diagram = schemaGraphToMermaid(koreanSnapshot());

    expect(diagram).toContain("        문자열 이름");
    expect(diagram).toContain("        integer 나이");
    expect(diagram).toContain('    "public.사용자" {');
  });

  // Reason: 컬럼 순서는 id(퍼센트 인코딩) 순이 아니라 `ordinal` 순이어야 한다.
  // 한글 컬럼은 두 순서가 어긋나는 조합이라 정렬을 지워도 안 걸리던 구멍을 막는다
  // (#1661, 2026-08-02)
  it("orders columns by graph ordinal even when the encoded ids sort differently", () => {
    const columns = schemaGraphToMermaid(koreanSnapshot())
      .split("\n")
      .filter((line) => line.startsWith("        "))
      .map((line) => line.trim().split(" ")[1]);

    expect(columns).toEqual(["ab", "나이", "이름"]);
  });

  // Reason: #1661 — 정리 뒤 이름이 겹치면 mermaid 는 파싱은
  // 하지만 컬럼 둘이 한 줄로, 테이블 둘이 한 엔티티로 합쳐진다. DBML 과 같은
  // 규칙으로 가른다는 결정을 두 포맷 모두에서 고정한다 (2026-08-02)
  it("keeps sanitised attribute names unique inside an entity", () => {
    const diagram = schemaGraphToMermaid(collidingNameSnapshot());

    expect(diagram).toContain("        integer a_b\n");
    expect(diagram).toContain("        integer a_b_2\n");
  });

  // Reason: 엔티티 이름도 같은 이유로 갈라야 한다 — 합쳐지면 관계선이 엉뚱한
  // 테이블을 가리킨다 (2026-08-02)
  it("keeps sanitised entity names unique", () => {
    const diagram = schemaGraphToMermaid(collidingTableSnapshot());

    expect(diagram).toContain('    "public.a_b" {');
    expect(diagram).toContain('    "public.a_b_2" {');
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
  // 빈 엔티티 블록을 받는다 (#1661 blocking ① 의 짝, 2026-08-02)
  it("keeps a column-less table as an empty entity block", () => {
    expect(schemaGraphToMermaid(columnlessSnapshot())).toBe(
      ["erDiagram", '    "public.orders" {', "    }", ""].join("\n"),
    );
  });

  // Reason: 양끝 공백이 두 포맷에서 다르게 나가지 않도록 (#1661, 2026-08-02)
  it("trims surrounding whitespace from an entity name", () => {
    expect(schemaGraphToMermaid(paddedNameSnapshot())).toContain(
      '    "public.spaced" {',
    );
  });

  // Reason: 이름이 통째로 비면 `""` 가 나가고 mermaid 가 Parse error 다.
  // 이 fallback 을 지워도 25개가 전부 통과한 적이 있다 (2026-08-02)
  it("names an entity whose catalog name is empty", () => {
    expect(schemaGraphToMermaid(unnamedTableSnapshot())).toContain(
      '    "public.unnamed" {',
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
// (2026-08-01, 개정 2026-08-02)
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

  // Reason: #1661 blocking ① — 본문 없는 `Table` 블록 하나가 `@dbml/core` 에서
  // 문서 전체를 무효로 만든다. 카탈로그가 컬럼을 비동기로 채우므로 흔한 상태다 (2026-08-02)
  it("replaces a column-less table with a comment instead of an empty block", () => {
    const dbml = schemaGraphToDbml(columnlessSnapshot());

    expect(dbml).toBe(
      '// skipped table "public"."orders": no columns available\n',
    );
    expect(dbml).not.toContain("{");
  });

  // Reason: 생략한 테이블을 가리키는 `Ref:` 가 남으면 문서 전체가 다시 무효가 된다
  // (#1661 blocking ① 의 두 번째 절반, 2026-08-02)
  it("drops a Ref whose endpoint table was skipped for having no columns", () => {
    const dbml = schemaGraphToDbml(shopSnapshot({ columnsForUsers: [] }));

    expect(dbml).toContain(
      '// skipped table "public"."users": no columns available',
    );
    expect(dbml).not.toContain("Ref:");
    expect(dbml).toContain('Table "public"."orders" {');
  });

  // Reason: 선언 안 된 **컬럼**을 가리키는 `Ref:` 도 파서가 문서 전체를 거부한다
  // (`Can't find field "user_id" in table "orders"`). 이 그래프는 없는 테이블과
  // 없는 컬럼을 하나씩 담고, 둘 다 빠지고 개수가 주석에 남아야 한다 (2026-08-02)
  it("drops Refs to tables or columns that were never declared", () => {
    const dbml = schemaGraphToDbml(handBuiltGraph());

    expect(dbml).not.toContain("dangling");
    expect(dbml).not.toContain("Ref:");
    expect(dbml).toContain(
      "// omitted 2 reference(s) to tables or columns that are not declared above",
    );
  });

  // Reason: 정리 뒤 이름이 겹치면 파서가 `Field "a_b" existed in table` 로 문서를
  // 거부한다 — 서로 다른 원본은 산출물에서도 달라야 한다 (2026-08-02)
  it("keeps sanitised identifiers unique inside their scope", () => {
    const dbml = schemaGraphToDbml(collidingNameSnapshot());

    expect(dbml).toContain('  "a_b" integer');
    expect(dbml).toContain('  "a_b_2" integer');
  });

  // Reason: #1661 blocking ③ — DBML 식별자에는 escape 문법이 없다. `\"` 도
  // `""` 도 파서가 거부하므로 `"` 는 내리고 backslash 는 문자 그대로 둔다.
  // 이전 기대값은 파싱 불가능한 문자열을 정답으로 박아 뒀다 (2026-08-02)
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

  // Reason: #1661 blocking ③ — 빈 식별자 `""` 를 파서가 거부한다. 공백뿐인
  // 이름은 trim 뒤 비므로 placeholder 가 필요하다 (2026-08-02)
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

  // Reason: #1661 blocking ③ — 이름 전체가 비면 테이블 식별자도 비어 파서가
  // 거부한다. mermaid 쪽 placeholder 의 DBML 대응물 (2026-08-02)
  it("names a table whose catalog name is empty", () => {
    expect(schemaGraphToDbml(unnamedTableSnapshot())).toContain(
      'Table "public"."unnamed" {',
    );
  });

  // Reason: 완전히 같은 `Ref:` 두 줄을 @dbml/core 가 거부한다. 같은 컬럼쌍에
  // 이름만 다른 FK 제약이 둘이면 이 모듈은 이름을 안 실어 두 줄이 같아진다
  // (#1661 — 실측으로 승격, 2026-08-02)
  it("folds byte-identical Ref lines into one", () => {
    const dbml = schemaGraphToDbml(duplicateForeignKeySnapshot());

    expect(dbml.match(/^Ref: /gm)).toHaveLength(1);
  });

  // Reason: mermaid 와 같은 기준으로 양끝 공백을 턴다 (#1661, 2026-08-02)
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

/**
 * mermaid 의 ATTRIBUTE_KEY 규칙(`\b(PK|FK|UK)\b`)에 걸리는 이름들. `\b` 가 ASCII
 * 단어 경계라 `pk` 뒤에 오는 것이 구분자든 한글이든 결합기호든 똑같이 걸린다.
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

/**
 * 왕복 검증에 넣는 입력 전체. 문자열 단언이 고정하는 산출물이 **실제 파서를
 * 통과하는지**를 이 목록이 증명한다 — #1661 의 blocking 4건이 전부
 * 「추측한 문법으로 만든 텍스트」였고, 그때는 저장소에 파서가 없어 문자열 단언이
 * 무효 출력을 정답으로 고정할 수 있었다.
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
 * 입력 공간 스윕 — 예시가 아니라 공간을 쓴다. #1661 blocking ⑤(`pk`·`fk`·`uk`
 * 예약어)는 fixture 를 더 붙이는 방식으로는 안 잡혔고, 위험 문자와 예약어 후보를
 * 식별자 자리에 전수로 꽂아 두 파서에 먹이는 이 스윕이 집어냈다. 새 문자·낱말
 * 축이 생기면 여기에 토큰을 더해라 — fixture 하나를 더 만들 이유가 없다.
 *
 * 식별자는 이 목록의 토큰 **두 개를 이어 붙여** 만든다. #1661 blocking ⑥ 은
 * 토큰을 식별자 전체로만 꽂던 생성기가 `pk` + 구분자 모양을 아예 못 만들어
 * 통과했다 — 리뷰어가 쓴 케이스 모양을 생성기가 그대로 물려받아 사각까지 복제한
 * 것이 그 회고의 진단이었다. 쌍으로 만들면 접두(`pk` + `-`)·접미(`-` +
 * `pk`)·중위(`a-b` + `pk`)가 전부 나오고, 빈 문자열이 토큰에 있으므로 낱개 토큰
 * 케이스도 그대로 포함된다.
 */
const SWEEP_TOKENS: readonly string[] = [
  // 문자 축 — ASCII 기호 전수 + 공백
  ..."!\"#$%&'()*+,-./:;<=>?@[\\]^`{|}~ ".split(""),
  // 낱말 축 — 두 문법에서 뜻을 가질 만한 후보. 예약어 후보는 대소문자 조합을
  // 전부 싣는다 — 가드가 `/i` 라 지금은 안 걸리지만 목록이 비대칭이면 가드를
  // 대소문자 구분으로 좁혔을 때 스윕이 그 사실을 반만 말한다 (#1661)
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
  // 경계값 축
  "",
  " ",
  "2fa",
  "_",
  "이름",
  "日本語",
  "a-b",
  "a.b",
  // 정리가 통과시키는 유니코드 클래스 중 letter/digit 이 아닌 것 — 결합기호가
  // 선두에 오는 모양(`́` 단독)까지 이 축이 만든다
  "́",
  // `\p{L}`·`\p{N}` 은 받지만 문법의 `\u00C0-\uFFFF` 범위는 안 받는 구간(U+0080~U+00BF).
  // 유니코드 property 로 화이트리스트를 쓰면 이 둘이 그대로 새 나가 Parse error 다
  "²",
  "ª",
];

// `schema`·`table` 은 따옴표 문자열 토큰(`mermaidSafeText`), `column`·`type` 은
// 따옴표 못 쓰는 단어 토큰(`mermaidWord`), `constraint` 는 관계선 라벨이다.
// 다섯째 자리는 FK 를 걸어야 나오므로 그 자리를 쓸 때만 대상 테이블을 붙인다
// (#1661 — 자리 목록에 한 줄이 빠져 있었다).
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

// Purpose: exporter 산출물을 실제 파서에 먹여 문법 판단을 추측에서 실측으로
// 바꾼다 — devDependency `mermaid` · `@dbml/core` (2026-08-02, #1661 결정)
describe("exporter output parses with the real parsers", () => {
  // Reason: mermaid 가 산출물을 렌더 대상으로 받는지가 이 포맷의 유일한 합격
  // 기준이다. #1661 blocking ②④ 가 여기서 잡혔을 결함이다 (2026-08-02)
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

  // Reason: DBML 은 토큰 하나가 깨지면 문서 전체가 무효라 부분 통과가 없다.
  // #1661 blocking ① 과 blocking ③ 이 이 검사의 대상이다 (2026-08-02)
  it.each(ROUND_TRIP_INPUTS)("Parser.parse accepts %s", (_name, input) => {
    expect(() => Parser.parse(schemaGraphToDbml(input), "dbml")).not.toThrow();
  });

  // Reason: #1661 blocking ⑤ — 문자 클래스는 맞았는데 `pk`·`fk`·`uk` 라는 낱말
  // 축이 통째로 빠져 있었다. 예시 fixture 는 다음 예약어를 못 잡으므로 입력 공간을
  // 쓴다. #1661 blocking ⑥ 은 그 공간이 낱개 토큰뿐이라 `pk` + 구분자를 못
  // 만들어 통과했다 — 토큰 쌍을 이어 붙여 다섯 자리에 꽂는다 (2026-08-02)
  it("keeps every sweep token pair parseable in all five identifier positions", async () => {
    const failures: string[] = [];
    // 정리를 거치면 서로 다른 토큰 쌍이 같은 산출물이 된다 — ASCII 기호 32종이
    // 전부 `_` 로 내려가므로 대부분의 쌍이 이미 본 문서로 접힌다. 같은 문서를
    // 다시 먹여도 답이 같으니 처음 한 번만 파싱한다. 이 dedupe 가 없으면 파스
    // 호출이 여섯 자리로 늘어 10초 testTimeout 을 넘긴다.
    const parsed = new Set<string>();
    let cases = 0;

    for (const position of SWEEP_POSITIONS) {
      for (const head of SWEEP_TOKENS) {
        for (const tail of SWEEP_TOKENS) {
          const identifier = `${head}${tail}`;
          // 스냅샷을 그래프로 한 번만 편다 — 두 exporter 에 스냅샷을 각각 주면
          // 같은 추출을 두 번 돌린다. 두 입력이 같은 텍스트를 낸다는 것은
          // "produces the same text for a SchemaGraph and for the snapshot" 이
          // 두 포맷 모두에서 고정한다.
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
    // 이 스위트에서 제일 비싼 테스트다 — 이 머신 실측 33s 라 기본 testTimeout
    // (vite.config.ts 의 10s)을 넘긴다. 공간을 줄이는 쪽은 일부러 안 골랐다:
    // 이전 생성기는 "이 축은 안 중요하다"는 논증으로 좁혔다가 그 축에서
    // blocking 이 나왔다. 느린 러너를 감안해 4배를 준다.
  }, 120_000);

  // Reason: 파서가 이름을 되돌려 준다는 것까지 봐야 "파싱은 되는데 다른 것이
  // 됐다"(예: backslash 이중화)를 잡는다 (2026-08-02)
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

/** 한글 식별자 + id 정렬과 ordinal 정렬이 어긋나는 조합. */
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

/** 정리 뒤 같은 문자열로 접히는 테이블 둘. */
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

/** 정리 뒤 같은 문자열로 접히는 컬럼 둘 — DBML 은 같은 이름 필드 둘을 거부한다. */
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

/** 같은 컬럼쌍에 이름만 다른 FK 제약 둘 — 산출 `Ref:` 두 줄이 바이트 단위로 같다. */
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
