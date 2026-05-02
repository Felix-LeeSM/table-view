// AC-192-01 — `generateMigrationDDL` 단위 테스트. dialect 별 quoting,
// PK inline / 복합, secondary index, FK constraint 의 4 축을 커버.
// Sprint 192 의 lib pure 책임을 격리해 회귀 가드 — useMigrationExport
// hook 이나 SchemaTree 진입점이 변해도 본 lib 의 출력은 안정.
// date 2026-05-02.
import { describe, it, expect } from "vitest";
import {
  generateMigrationDDL,
  buildSequenceResets,
  type DdlExportTable,
} from "./ddlGenerator";
import type { ColumnInfo, IndexInfo, ConstraintInfo } from "@/types/schema";

const FIXED_DATE = new Date("2026-05-02T12:00:00.000Z");

function col(
  opts: Partial<ColumnInfo> & Pick<ColumnInfo, "name" | "data_type">,
): ColumnInfo {
  return {
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
    ...opts,
  };
}

function table(
  name: string,
  columns: ColumnInfo[],
  opts: { indexes?: IndexInfo[]; constraints?: ConstraintInfo[] } = {},
): DdlExportTable {
  return {
    name,
    columns,
    indexes: opts.indexes ?? [],
    constraints: opts.constraints ?? [],
  };
}

describe("generateMigrationDDL", () => {
  // [AC-192-01-1] PG, 단일 테이블, PK 없음. 헤더 + 컬럼 NOT NULL /
  // DEFAULT 가 정확히 emit 되는지.
  // date 2026-05-02
  it("[AC-192-01-1] PG single table without PK", () => {
    const sql = generateMigrationDDL({
      dialect: "postgresql",
      schema: "public",
      tables: [
        table("events", [
          col({ name: "name", data_type: "text", nullable: false }),
          col({
            name: "occurred_at",
            data_type: "timestamptz",
            nullable: false,
            default_value: "now()",
          }),
        ]),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(sql).toContain("-- table-view migration export v1");
    expect(sql).toContain("-- dialect: postgresql");
    expect(sql).toContain("-- schema:  public");
    expect(sql).toContain("-- tables:  1");
    expect(sql).toContain('CREATE TABLE "public"."events"');
    expect(sql).toContain('"name" text NOT NULL');
    expect(sql).toContain('"occurred_at" timestamptz NOT NULL DEFAULT now()');
    expect(sql).not.toContain("PRIMARY KEY");
  });

  // [AC-192-01-2] PG, inline PK + nullable 컬럼 + DEFAULT. 단일 PK 컬럼은
  // column line 안에 PRIMARY KEY 가 inline 되어야 한다.
  // date 2026-05-02
  it("[AC-192-01-2] PG inline PK with nullable + default columns", () => {
    const sql = generateMigrationDDL({
      dialect: "postgresql",
      schema: "public",
      tables: [
        table("users", [
          col({
            name: "id",
            data_type: "uuid",
            nullable: false,
            is_primary_key: true,
          }),
          col({
            name: "email",
            data_type: "text",
            nullable: false,
          }),
          col({
            name: "nickname",
            data_type: "text",
            nullable: true,
            default_value: "'anon'",
          }),
        ]),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(sql).toContain('"id" uuid NOT NULL PRIMARY KEY');
    expect(sql).toContain('"email" text NOT NULL');
    expect(sql).toContain(`"nickname" text DEFAULT 'anon'`);
    // 복합 PK line 은 없어야 한다.
    expect(sql).not.toContain("PRIMARY KEY (");
  });

  // [AC-192-01-3] PG, 복합 PK. 단일 PK 컬럼이 둘이면 column line 의
  // inline PRIMARY KEY 대신 테이블 라인으로 emit 되어야 한다.
  // date 2026-05-02
  it("[AC-192-01-3] PG composite PK uses table-level PRIMARY KEY line", () => {
    const sql = generateMigrationDDL({
      dialect: "postgresql",
      schema: "public",
      tables: [
        table("user_role", [
          col({
            name: "user_id",
            data_type: "uuid",
            nullable: false,
            is_primary_key: true,
          }),
          col({
            name: "role_id",
            data_type: "uuid",
            nullable: false,
            is_primary_key: true,
          }),
        ]),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(sql).toContain('PRIMARY KEY ("user_id", "role_id")');
    // inline PRIMARY KEY 은 사용하지 않는다.
    expect(sql).not.toMatch(/"user_id" uuid NOT NULL PRIMARY KEY/);
  });

  // [AC-192-01-4] secondary unique index — primary 인덱스는 skip,
  // is_unique 면 CREATE UNIQUE INDEX 로 emit.
  // date 2026-05-02
  it("[AC-192-01-4] secondary unique index emits CREATE UNIQUE INDEX, primary index skipped", () => {
    const sql = generateMigrationDDL({
      dialect: "postgresql",
      schema: "public",
      tables: [
        table(
          "users",
          [
            col({
              name: "id",
              data_type: "uuid",
              nullable: false,
              is_primary_key: true,
            }),
            col({ name: "email", data_type: "text", nullable: false }),
          ],
          {
            indexes: [
              {
                name: "users_pkey",
                columns: ["id"],
                index_type: "btree",
                is_unique: true,
                is_primary: true,
              },
              {
                name: "users_email_uniq",
                columns: ["email"],
                index_type: "btree",
                is_unique: true,
                is_primary: false,
              },
            ],
          },
        ),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "users_email_uniq" ON "public"."users" ("email");',
    );
    // primary index 는 emit 되지 않는다.
    expect(sql).not.toContain("users_pkey");
  });

  // [AC-192-01-5] FK constraint — CREATE TABLE 에는 FK 가 없고, 모든
  // 테이블 정의 뒤 ALTER TABLE ADD CONSTRAINT 로 emit. 두 테이블 정의
  // 순서가 어떻든 동작 (FK 가 마지막 단계라 forward reference 무관).
  // date 2026-05-02
  it("[AC-192-01-5] FK constraint emits at end via ALTER TABLE", () => {
    const sql = generateMigrationDDL({
      dialect: "postgresql",
      schema: "public",
      tables: [
        table(
          "posts",
          [
            col({
              name: "id",
              data_type: "uuid",
              nullable: false,
              is_primary_key: true,
            }),
            col({
              name: "author_id",
              data_type: "uuid",
              nullable: false,
              is_foreign_key: true,
              fk_reference: "users.id",
            }),
          ],
          {
            constraints: [
              {
                name: "posts_author_fk",
                constraint_type: "fk",
                columns: ["author_id"],
                reference_table: "users",
                reference_columns: ["id"],
              },
            ],
          },
        ),
        table("users", [
          col({
            name: "id",
            data_type: "uuid",
            nullable: false,
            is_primary_key: true,
          }),
        ]),
      ],
      generatedAt: FIXED_DATE,
    });
    // CREATE TABLE 안에는 FK 표현이 없다.
    const createTablePosts = sql.slice(
      sql.indexOf('CREATE TABLE "public"."posts"'),
      sql.indexOf("CREATE TABLE", sql.indexOf("posts") + 10),
    );
    expect(createTablePosts).not.toContain("FOREIGN KEY");
    // 마지막 단계의 ALTER TABLE 이 존재.
    expect(sql).toContain("-- Foreign keys");
    expect(sql).toContain('ALTER TABLE "public"."posts"');
    expect(sql).toContain('ADD CONSTRAINT "posts_author_fk"');
    expect(sql).toContain(
      'FOREIGN KEY ("author_id") REFERENCES "public"."users" ("id");',
    );
  });

  // [AC-192-01-6] MySQL identifier quoting (backtick). schema = database
  // 으로 취급, qualified name 도 backtick.
  // date 2026-05-02
  it("[AC-192-01-6] MySQL uses backtick quoting", () => {
    const sql = generateMigrationDDL({
      dialect: "mysql",
      schema: "shop",
      tables: [
        table("orders", [
          col({
            name: "id",
            data_type: "BIGINT",
            nullable: false,
            is_primary_key: true,
          }),
          col({
            name: "customer name",
            data_type: "VARCHAR(255)",
            nullable: false,
          }),
        ]),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(sql).toContain("CREATE TABLE `shop`.`orders`");
    expect(sql).toContain("`id` BIGINT NOT NULL PRIMARY KEY");
    // identifier 안의 공백도 그대로 quoted.
    expect(sql).toContain("`customer name` VARCHAR(255) NOT NULL");
  });

  // [AC-192-01-7] SQLite 은 schema 개념 없이 unqualified table 이름.
  // identifier 는 PG 와 동일 ANSI double-quote.
  // date 2026-05-02
  it("[AC-192-01-7] SQLite uses unqualified ANSI quoting", () => {
    const sql = generateMigrationDDL({
      dialect: "sqlite",
      schema: "main",
      tables: [
        table("notes", [
          col({
            name: "id",
            data_type: "INTEGER",
            nullable: false,
            is_primary_key: true,
          }),
          col({ name: "body", data_type: "TEXT" }),
        ]),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(sql).toContain('CREATE TABLE "notes"');
    // schema name 은 헤더에는 적히지만 statement 에는 없다.
    expect(sql).toContain("-- schema:  main");
    expect(sql).not.toContain('"main"."notes"');
  });

  // [AC-192-01-8] embedded quote 가 들어간 identifier 도 안전하게 escape.
  // " 는 "" 로, ` 는 `` 로. SQL injection 회귀 방지 가드.
  // date 2026-05-02
  it("[AC-192-01-8] embedded quote characters in identifiers are escaped", () => {
    const pg = generateMigrationDDL({
      dialect: "postgresql",
      schema: "pub",
      tables: [table('weird"name', [col({ name: "ok", data_type: "text" })])],
      generatedAt: FIXED_DATE,
    });
    expect(pg).toContain('"weird""name"');

    const my = generateMigrationDDL({
      dialect: "mysql",
      schema: "db",
      tables: [table("weird`name", [col({ name: "ok", data_type: "text" })])],
      generatedAt: FIXED_DATE,
    });
    expect(my).toContain("`weird``name`");
  });

  // [AC-192-09] PG `nextval(...)` default 는 BIGSERIAL/SERIAL/SMALLSERIAL
  // syntactic sugar 로 정규화한다. 이 변환이 없으면 import 시 referenced
  // sequence 가 미생성이라 fail. 정규화 후 PG 가 sequence + nextval
  // default 를 자동 emit. NOT NULL/PK 도 같이 보존되는지 확인.
  // date 2026-05-02
  it("[AC-192-09-1] PG bigint + nextval default → BIGSERIAL", () => {
    const sql = generateMigrationDDL({
      dialect: "postgresql",
      schema: "public",
      tables: [
        table("payment_accounts", [
          col({
            name: "id",
            data_type: "bigint",
            nullable: false,
            is_primary_key: true,
            default_value: "nextval('payment_accounts_id_seq'::regclass)",
          }),
          col({ name: "name", data_type: "text", nullable: false }),
        ]),
      ],
      generatedAt: FIXED_DATE,
    });
    // BIGSERIAL + PRIMARY KEY 만 — DEFAULT 라인 / NOT NULL 모두 제거.
    expect(sql).toContain('"id" BIGSERIAL PRIMARY KEY');
    expect(sql).not.toContain("nextval(");
    // 비-serial column 은 그대로.
    expect(sql).toContain('"name" text NOT NULL');
  });

  it("[AC-192-09-2] PG integer + nextval default → SERIAL", () => {
    const sql = generateMigrationDDL({
      dialect: "postgresql",
      schema: "public",
      tables: [
        table("t", [
          col({
            name: "id",
            data_type: "integer",
            nullable: false,
            is_primary_key: true,
            default_value: "nextval('t_id_seq'::regclass)",
          }),
        ]),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(sql).toContain('"id" SERIAL PRIMARY KEY');
  });

  it("[AC-192-09-3] PG smallint + nextval default → SMALLSERIAL", () => {
    const sql = generateMigrationDDL({
      dialect: "postgresql",
      schema: "public",
      tables: [
        table("t", [
          col({
            name: "id",
            data_type: "smallint",
            nullable: false,
            is_primary_key: true,
            default_value: "nextval('t_id_seq'::regclass)",
          }),
        ]),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(sql).toContain('"id" SMALLSERIAL PRIMARY KEY');
  });

  // [AC-192-09-4] 비-nextval default 는 정상 보존 — 회귀 가드. 가령
  // CURRENT_TIMESTAMP 같은 일반 default 가 SERIAL 로 잘못 변환되지
  // 않는지.
  it("[AC-192-09-4] non-nextval bigint default is preserved verbatim", () => {
    const sql = generateMigrationDDL({
      dialect: "postgresql",
      schema: "public",
      tables: [
        table("t", [
          col({
            name: "n",
            data_type: "bigint",
            nullable: false,
            default_value: "0",
          }),
        ]),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(sql).toContain('"n" bigint NOT NULL DEFAULT 0');
    expect(sql).not.toContain("BIGSERIAL");
  });

  // [AC-192-09-5] buildSequenceResets — BIGSERIAL 화된 column 마다
  // setval 줄 emit. table 이 비어있어도 COALESCE 로 idempotent.
  it("[AC-192-09-5] buildSequenceResets emits setval for nextval columns", () => {
    const lines = buildSequenceResets("postgresql", "public", [
      table("payment_accounts", [
        col({
          name: "id",
          data_type: "bigint",
          nullable: false,
          is_primary_key: true,
          default_value: "nextval('payment_accounts_id_seq'::regclass)",
        }),
        col({ name: "name", data_type: "text" }),
      ]),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("pg_get_serial_sequence");
    expect(lines[0]).toContain('"public"."payment_accounts"');
    expect(lines[0]).toContain("'id'");
    expect(lines[0]).toContain('SELECT MAX("id")');
  });

  // [AC-192-09-6] 다른 dialect (mysql/sqlite) 는 setval 발생 안 함.
  // 미래에 dialect 별 reset semantics 가 추가되면 본 케이스 갱신.
  it("[AC-192-09-6] buildSequenceResets returns empty for non-PG dialects", () => {
    const cols = [
      col({
        name: "id",
        data_type: "bigint",
        nullable: false,
        is_primary_key: true,
        default_value: "nextval('t_id_seq'::regclass)",
      }),
    ];
    expect(buildSequenceResets("mysql", "db", [table("t", cols)])).toHaveLength(
      0,
    );
    expect(
      buildSequenceResets("sqlite", "main", [table("t", cols)]),
    ).toHaveLength(0);
  });
});
