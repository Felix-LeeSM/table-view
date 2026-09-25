// useSqlAutocomplete — namespace builder for CodeMirror SQL completions.
// 2026-05-12 — schemaStore caches now nest by `(connId, db)`,
// so the hook signature is `(connectionId, db, arg?)` and store seeds use
// `{ conn1: { db1: { schema: [...] } } }`.

import { MySQL, PostgreSQL, SQLite } from "@codemirror/lang-sql";
import { useSchemaStore } from "@stores/schemaStore";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSqlAutocomplete } from "./useSqlAutocomplete";

describe("useSqlAutocomplete", () => {
  beforeEach(() => {
    useSchemaStore.setState({
      tables: {},
      views: {},
      tableColumnsCache: {},
      fileAnalyticsSources: {},
    });
  });

  it("returns namespace with functions but no tables when no tables loaded", () => {
    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    expect(result.current).toHaveProperty("COUNT");
    expect(result.current).not.toHaveProperty("users");
  });

  it("includes table names for the given connection", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [
              { name: "users", schema: "public", row_count: 100 },
              { name: "orders", schema: "public", row_count: 50 },
            ],
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    expect(result.current).toHaveProperty("users");
    expect(result.current).toHaveProperty("orders");
  });

  it("includes schema-qualified names", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 100 }],
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    expect(result.current).toHaveProperty("users");
    expect(result.current).toHaveProperty("public.users");
  });

  it("excludes tables from other connections", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 100 }],
          },
        },
        conn2: {
          db1: {
            public: [{ name: "products", schema: "public", row_count: 200 }],
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    expect(result.current).toHaveProperty("users");
    expect(result.current).not.toHaveProperty("products");
  });

  it("updates when tables change", () => {
    const { result, rerender } = renderHook(
      ({ connId, db }) => useSqlAutocomplete(connId, db),
      { initialProps: { connId: "conn1", db: "db1" } },
    );

    expect(result.current).not.toHaveProperty("users");

    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 100 }],
          },
        },
      },
    });

    rerender({ connId: "conn1", db: "db1" });
    expect(result.current).toHaveProperty("users");
  });

  // -- Regression: db-scoped exclusion ----------------------------------
  // The same connection can hold multiple databases. Autocomplete must
  // only surface tables for the active db.
  it("excludes tables from other databases on the same connection", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 1 }],
          },
          db2: {
            public: [{ name: "audit_log", schema: "public", row_count: 9 }],
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    expect(result.current).toHaveProperty("users");
    expect(result.current).not.toHaveProperty("audit_log");
  });

  // -- Enhanced SQL Autocomplete --

  it("includes common SQL functions in namespace", () => {
    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));

    const ns = result.current;
    expect(ns).toHaveProperty("COUNT");
    expect(ns).toHaveProperty("SUM");
    expect(ns).toHaveProperty("AVG");
    expect(ns).toHaveProperty("MIN");
    expect(ns).toHaveProperty("MAX");
    expect(ns).toHaveProperty("COALESCE");
    expect(ns).toHaveProperty("NULLIF");
    expect(ns).toHaveProperty("CAST");
    expect(ns).toHaveProperty("CONCAT");
    expect(ns).toHaveProperty("LENGTH");
    expect(ns).toHaveProperty("UPPER");
    expect(ns).toHaveProperty("LOWER");
    expect(ns).toHaveProperty("TRIM");
    expect(ns).toHaveProperty("SUBSTRING");
    expect(ns).toHaveProperty("EXTRACT");
    expect(ns).toHaveProperty("DATE_TRUNC");
    expect(ns).toHaveProperty("NOW");
    expect(ns).toHaveProperty("CURRENT_TIMESTAMP");
  });

  it("adds MySQL-specific scalar, date, JSON, and session functions when dbType is mysql", () => {
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", {
        dialect: MySQL,
        dbType: "mysql",
      }),
    );

    const ns = result.current as Record<
      string,
      { self?: { apply?: string; type?: string } }
    >;
    for (const fn of [
      "IFNULL",
      "DATE_FORMAT",
      "STR_TO_DATE",
      "CURDATE",
      "CURTIME",
      "UTC_TIMESTAMP",
      "GROUP_CONCAT",
      "JSON_EXTRACT",
      "JSON_UNQUOTE",
      "JSON_OBJECT",
      "JSON_ARRAY",
      "UUID",
      "LAST_INSERT_ID",
      "DATABASE",
      "USER",
      "VERSION",
    ]) {
      expect(ns).toHaveProperty(fn);
      expect(ns[fn]?.self?.apply).toBe(fn);
      expect(ns[fn]?.self?.type).toBe("function");
    }
  });

  it("keeps PostgreSQL-only function candidates out of the MySQL function surface", () => {
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", {
        dialect: MySQL,
        dbType: "mysql",
      }),
    );

    expect(result.current).not.toHaveProperty("DATE_TRUNC");
    expect(result.current).not.toHaveProperty("TO_CHAR");
    expect(result.current).not.toHaveProperty("JSONB_BUILD_OBJECT");
  });

  it("includes table columns when tableColumns provided", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 100 }],
          },
        },
      },
    });

    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", { users: ["id", "name", "email"] }),
    );

    const ns = result.current;
    expect(ns).toHaveProperty("users");
    expect(
      (ns as Record<string, Record<string, unknown>>).users,
    ).toHaveProperty("id");
    expect(
      (ns as Record<string, Record<string, unknown>>).users,
    ).toHaveProperty("name");
    expect(
      (ns as Record<string, Record<string, unknown>>).users,
    ).toHaveProperty("email");
  });

  it("handles empty tableColumns gracefully", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 100 }],
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1", {}));

    const ns = result.current;
    expect(ns).toHaveProperty("users");
    expect((ns as Record<string, Record<string, unknown>>).users).toEqual({});
  });

  // -- Cached columns + views --

  it("uses tableColumnsCache when no explicit override is supplied", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 1 }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              users: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "email",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns.users).toHaveProperty("id");
    expect(ns.users).toHaveProperty("email");
    expect(ns["public.users"]).toHaveProperty("id");
  });

  it("ignores cached columns from other connections", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 1 }],
          },
        },
      },
      tableColumnsCache: {
        conn2: {
          db1: {
            public: {
              users: [
                {
                  name: "secret",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns.users).toBeDefined();
    expect(ns.users).not.toHaveProperty("secret");
  });

  it("explicit tableColumns override beats cache", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 1 }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              users: [
                {
                  name: "cached_col",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", { users: ["override_col"] }),
    );
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns.users).toHaveProperty("override_col");
    expect(ns.users).not.toHaveProperty("cached_col");
  });

  it("includes view names with cached columns", () => {
    useSchemaStore.setState({
      views: {
        conn1: {
          db1: {
            public: [
              { name: "active_users", schema: "public", definition: null },
            ],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              active_users: [
                {
                  name: "user_id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns.active_users).toBeDefined();
    expect(ns.active_users).toHaveProperty("user_id");
    expect(ns["public.active_users"]).toHaveProperty("user_id");
  });

  it("includes DuckDB registered file source aliases with metadata columns", () => {
    useSchemaStore.setState({
      fileAnalyticsSources: {
        conn1: [
          {
            source: {
              id: "source-1",
              alias: "sales_csv",
              fileName: "sales.csv",
              kind: "csv",
              sizeBytes: 128,
            },
            columns: [
              { name: "order_id", dataType: "BIGINT" },
              { name: "amount", dataType: "DOUBLE" },
            ],
            previewSql: "SELECT * FROM sales_csv LIMIT 100",
          },
        ],
      },
    });

    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "main", { dbType: "duckdb" }),
    );

    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns).toHaveProperty("sales_csv");
    expect(ns.sales_csv).toHaveProperty("order_id");
    expect(ns.sales_csv).toHaveProperty("amount");
    expect(ns["main.sales_csv"]).toHaveProperty("order_id");
  });

  // ── Dialect-aware identifier quoting ────────────────────────────────────

  // MySQL dialect must surface a backtick-quoted label for
  // mixed-case identifiers so the autocomplete popup inserts `Users`.
  it("emits a backtick-quoted alias for mixed-case MySQL tables", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "Users", schema: "public", row_count: 1 }],
          },
        },
      },
    });
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", { dialect: MySQL }),
    );
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty("Users");
    expect(ns).toHaveProperty("`Users`");
    const aliased = (ns as Record<string, { self?: { apply?: string } }>)[
      "`Users`"
    ];
    expect(aliased?.self?.apply).toBe("`Users`");
  });

  it("emits a fully-backtick-quoted schema-qualified key for MySQL dialect", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            sales: [{ name: "Orders", schema: "sales", row_count: 1 }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            sales: {
              Orders: [
                {
                  name: "order_id",
                  data_type: "bigint",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", {
        dialect: MySQL,
        dbType: "mysql",
      }),
    );

    const ns = result.current as Record<
      string,
      { children?: Record<string, unknown> }
    >;
    expect(ns).toHaveProperty("`sales`.`Orders`");
    expect(ns["`sales`.`Orders`"]?.children).toHaveProperty("order_id");
  });

  // Postgres dialect → double-quote identifier quoting.
  it("emits a double-quoted alias for mixed-case Postgres tables", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "Users", schema: "public", row_count: 1 }],
          },
        },
      },
    });
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", { dialect: PostgreSQL }),
    );
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty('"Users"');
    const aliased = (ns as Record<string, { self?: { apply?: string } }>)[
      '"Users"'
    ];
    expect(aliased?.self?.apply).toBe('"Users"');
  });

  // SQLite dialect → first identifier quote char (backtick per
  // CodeMirror's SQLite spec) is used.
  it("emits a quoted alias for mixed-case SQLite tables", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "MyTable", schema: "public", row_count: 1 }],
          },
        },
      },
    });
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", { dialect: SQLite }),
    );
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty("`MyTable`");
  });

  // Lowercase identifiers do not need quoting — the hook must NOT emit a
  // spurious `` `users` `` alias that would duplicate the bare label.
  it("does not emit a quoted alias for already-lowercase MySQL identifiers", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 1 }],
          },
        },
      },
    });
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", { dialect: MySQL }),
    );
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty("users");
    expect(ns).not.toHaveProperty("`users`");
  });

  // Without a dialect, the legacy namespace shape is preserved.
  it("omits quoted aliases entirely when no dialect is supplied", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "Users", schema: "public", row_count: 1 }],
          },
        },
      },
    });
    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty("Users");
    expect(ns).not.toHaveProperty("`Users`");
    expect(ns).not.toHaveProperty('"Users"');
  });

  // Views follow the same quoting rule as tables (covers the view branch).
  it("emits a quoted alias for mixed-case MySQL views", () => {
    useSchemaStore.setState({
      views: {
        conn1: {
          db1: {
            public: [
              { name: "ActiveUsers", schema: "public", definition: null },
            ],
          },
        },
      },
    });
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", { dialect: MySQL }),
    );
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty("ActiveUsers");
    expect(ns).toHaveProperty("`ActiveUsers`");
  });

  // Regression: the legacy `tableColumns` record arg still works even
  // though the hook now also accepts the options-object shape.
  it("keeps pre-Sprint-82 tableColumns record arg working", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 1 }],
          },
        },
      },
    });
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", { users: ["id", "email"] }),
    );
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns.users).toHaveProperty("id");
    expect(ns.users).toHaveProperty("email");
  });

  // 2026-04-30 regression: SQL keywords MUST NOT be auto-quoted by
  // CodeMirror's `nameCompletion`. The namespace used to inject keywords
  // directly in the `{ self, children }` shape to force the quote bypass.
  //
  // Updated 2026-05-14: keyword completion moved to lang-sql's own
  // `keywordCompletionSource` (lang-sql:691-693), so the namespace no longer
  // exposes keywords — see the note at the top of
  // `src/hooks/useSqlAutocomplete.ts`.
  it("ns 는 keyword 를 inject 하지 않는다 — lang-sql 의 자체 keyword source 책임", () => {
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", {
        dialect: PostgreSQL,
        dbType: "postgresql",
      }),
    );
    const ns = result.current as Record<string, unknown>;
    expect(ns).not.toHaveProperty("SELECT");
    expect(ns).not.toHaveProperty("FROM");
    expect(ns).not.toHaveProperty("WHERE");
    expect(ns).not.toHaveProperty("RETURNING"); // PG-specific
  });

  it("does NOT auto-quote uppercase SQL function names", () => {
    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<
      string,
      { self?: { label?: string; apply?: string; type?: string } }
    >;
    expect(ns).toHaveProperty("COUNT");
    expect(ns.COUNT?.self?.apply).toBe("COUNT");
    expect(ns.COUNT?.self?.type).toBe("function");
  });

  // ── UPDATE SET column autocomplete (PG/SQLite) ──────────────────────────
  // Written 2026-05-07. Reason: user report (2026-05-07) — when writing an
  // UPDATE against the `"public"."brief_news_tasks"` form shown in the
  // bottom strip, CodeMirror SQL autocomplete did not surface the columns.
  // The cause: useSqlAutocomplete registered only
  // `ns["public.brief_news_tasks"]` (the dot-split path) and
  // `ns["brief_news_tasks"]` (bare), not the fully-quoted form
  // `"public"."brief_news_tasks"` users often type directly, so CodeMirror's
  // `addNamespaceObject` (lang-sql:507-523) could not reach the same
  // children. The PG / SQLite dialects must emit this key too.

  // AC-233-01 — under the PG dialect, the fully-quoted schema-qualified key
  // is emitted into the namespace with the columns map as its children.
  it("emits a fully-quoted schema-qualified key for PG dialect (AC-233-01)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [
              { name: "brief_news_tasks", schema: "public", row_count: 1 },
            ],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              brief_news_tasks: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "title",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", {
        dialect: PostgreSQL,
        dbType: "postgresql",
      }),
    );
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty('"public"."brief_news_tasks"');
    const node = (ns as Record<string, { children?: Record<string, unknown> }>)[
      '"public"."brief_news_tasks"'
    ];
    expect(node?.children).toBeDefined();
    expect(node?.children).toHaveProperty("id");
    expect(node?.children).toHaveProperty("title");
  });

  // AC-233-02 — SQLite dialect uses backtick (per CodeMirror identifier
  // quote spec). The fully-quoted key reflects that quote char.
  it("emits a fully-quoted schema-qualified key for SQLite dialect (AC-233-02)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            main: [{ name: "events", schema: "main", row_count: 0 }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            main: {
              events: [
                {
                  name: "ts",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", { dialect: SQLite, dbType: "sqlite" }),
    );
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty("`main`.`events`");
    const node = (ns as Record<string, { children?: Record<string, unknown> }>)[
      "`main`.`events`"
    ];
    expect(node?.children).toHaveProperty("ts");
  });

  // AC-233-03 — Cache miss path: the fully-quoted key still registers
  // (with empty children) so when the cache later populates, the next
  // useMemo re-render will surface columns. This guards against the
  // "user typed UPDATE before expanding the table in the SchemaTree"
  // case.
  it("registers fully-quoted key with empty children when columns are not cached (AC-233-03)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [
              { name: "brief_news_tasks", schema: "public", row_count: 0 },
            ],
          },
        },
      },
    });
    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", {
        dialect: PostgreSQL,
        dbType: "postgresql",
      }),
    );
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty('"public"."brief_news_tasks"');
    const node = (ns as Record<string, { children?: Record<string, unknown> }>)[
      '"public"."brief_news_tasks"'
    ];
    expect(node?.children).toEqual({});
  });

  // ── Cross-DB isolation audit ──────────────────────────────────────────
  // Regression guard after the `(connId, db)` cache split. Six corner cases
  // lock that another DB on the same connection does not leak into the
  // active namespace.

  // AC-264-01 #1 — when the same table name has different columns in two
  // DBs, surface only the active DB's columns.
  it("isolates same-table-name across DBs — columns reflect active DB only (AC-264-01)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
          db2: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              users: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "name",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
          db2: {
            public: {
              users: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "email",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns.users).toHaveProperty("id");
    expect(ns.users).toHaveProperty("name");
    expect(ns.users).not.toHaveProperty("email");
  });

  // AC-264-01 #2 — "ghost" entries present only in an inactive DB's
  // columnsCache (no registered table) do not leak into the active namespace.
  it("inactive-DB columnsCache ghost entries don't surface for active DB (AC-264-01)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db2: {
            public: {
              ghost_table: [
                {
                  name: "secret",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty("users");
    expect(ns).not.toHaveProperty("ghost_table");
    expect(ns).not.toHaveProperty("public.ghost_table");
  });

  // AC-264-01 #3 — when the db argument changes, useMemo rebuilds and swaps
  // in the new DB's namespace.
  it("rerender with new db rebuilds the namespace (AC-264-01)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "alpha", schema: "public", row_count: null }],
          },
          db2: {
            public: [{ name: "beta", schema: "public", row_count: null }],
          },
        },
      },
    });

    const { result, rerender } = renderHook(
      ({ db }) => useSqlAutocomplete("conn1", db),
      { initialProps: { db: "db1" } },
    );
    expect(result.current).toHaveProperty("alpha");
    expect(result.current).not.toHaveProperty("beta");

    rerender({ db: "db2" });
    expect(result.current).toHaveProperty("beta");
    expect(result.current).not.toHaveProperty("alpha");
  });

  // AC-264-01 #4 — the schema-qualified key (`public.users`) also follows
  // only the active DB's columns.
  it("schema-qualified path isolates per active DB (AC-264-01)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
          db2: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              users: [
                {
                  name: "db1_only",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
          db2: {
            public: {
              users: [
                {
                  name: "db2_only",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns["public.users"]).toHaveProperty("db1_only");
    expect(ns["public.users"]).not.toHaveProperty("db2_only");
  });

  // AC-264-01 #5 — the PG dialect's fully-quoted key
  // (`"public"."users"`) also exposes only the active DB's columns.
  it("fully-quoted PG key isolates per active DB (AC-264-01)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
          db2: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              users: [
                {
                  name: "db1_col",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
          db2: {
            public: {
              users: [
                {
                  name: "db2_col",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", {
        dialect: PostgreSQL,
        dbType: "postgresql",
      }),
    );
    const ns = result.current as Record<string, unknown>;
    expect(ns).toHaveProperty('"public"."users"');
    const node = (ns as Record<string, { children?: Record<string, unknown> }>)[
      '"public"."users"'
    ];
    expect(node?.children).toHaveProperty("db1_col");
    expect(node?.children).not.toHaveProperty("db2_col");
  });

  // ── Intra-DB schema collision (2026-05-13) ──────────────────────────────
  // Reason: when two schemas in the same `(connId, db)` hold a table of the
  // same name (e.g. `public.users`, `auth.users`), the old
  // `cachedColumnsByName[bareName] = colNs` last-writer-wins polluted even
  // the schema-qualified lookup. Four cases lock that nothing regresses
  // after the cache shape became schema-preserving.
  //
  // Adopted ambiguity policy: Policy A (the bare key `ns["users"]` exposes
  // the union of the candidate schemas' columns, deduped by column name) —
  // see the policy note above `pickBareColumns` in
  // `src/hooks/useSqlAutocomplete.ts`.

  // AC-268-01 — Same-DB schema collision: qualified lookup MUST return
  // the schema-correct column set, not the cross-schema overwrite.
  it("schema-qualified lookup returns schema-correct columns under intra-DB collision (AC-268-01)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: null }],
            auth: [{ name: "users", schema: "auth", row_count: null }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              users: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "name",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
            auth: {
              users: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "login_ip",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns["public.users"]).toHaveProperty("id");
    expect(ns["public.users"]).toHaveProperty("name");
    expect(ns["public.users"]).not.toHaveProperty("login_ip");

    expect(ns["auth.users"]).toHaveProperty("id");
    expect(ns["auth.users"]).toHaveProperty("login_ip");
    expect(ns["auth.users"]).not.toHaveProperty("name");
  });

  // AC-268-02 — Bare-key ambiguity policy is Policy A (union deduped by
  // column name). With public.users {id, name} + auth.users
  // {id, login_ip}, ns["users"] exposes {id, name, login_ip}. The
  // single-writer-wins pre-fix behaviour must NOT survive.
  it("bare key under multi-schema collision exposes the union of candidate columns (AC-268-02)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: null }],
            auth: [{ name: "users", schema: "auth", row_count: null }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              users: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "name",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
            auth: {
              users: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "login_ip",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns.users).toHaveProperty("id");
    expect(ns.users).toHaveProperty("name");
    expect(ns.users).toHaveProperty("login_ip");
    // dedupe: id appears in both schemas but only once
    expect(Object.keys(ns.users!)).toHaveLength(3);
  });

  // AC-268-03 — Single-schema parity: when only one schema holds the
  // table, both bare and schema-qualified lookup expose the same set,
  // identical to the pre-fix behaviour.
  it("single-schema parity — ns.users and ns['public.users'] match the cache (AC-268-03)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              users: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "name",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns.users).toHaveProperty("id");
    expect(ns.users).toHaveProperty("name");
    expect(Object.keys(ns.users!)).toHaveLength(2);
    expect(ns["public.users"]).toHaveProperty("id");
    expect(ns["public.users"]).toHaveProperty("name");
    expect(Object.keys(ns["public.users"]!)).toHaveLength(2);
  });

  // AC-268-04 — PG fully-quoted path: same intra-DB collision rule
  // applies to `"public"."users"` vs `"auth"."users"`.
  it("fully-quoted PG keys return schema-correct columns under intra-DB collision (AC-268-04)", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: null }],
            auth: [{ name: "users", schema: "auth", row_count: null }],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              users: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "name",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
            auth: {
              users: [
                {
                  name: "id",
                  data_type: "integer",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "login_ip",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() =>
      useSqlAutocomplete("conn1", "db1", {
        dialect: PostgreSQL,
        dbType: "postgresql",
      }),
    );
    const ns = result.current as Record<
      string,
      { children?: Record<string, unknown> }
    >;
    expect(ns).toHaveProperty('"public"."users"');
    expect(ns).toHaveProperty('"auth"."users"');
    expect(ns['"public"."users"']?.children).toHaveProperty("id");
    expect(ns['"public"."users"']?.children).toHaveProperty("name");
    expect(ns['"public"."users"']?.children).not.toHaveProperty("login_ip");

    expect(ns['"auth"."users"']?.children).toHaveProperty("id");
    expect(ns['"auth"."users"']?.children).toHaveProperty("login_ip");
    expect(ns['"auth"."users"']?.children).not.toHaveProperty("name");
  });

  // AC-264-01 #6 — the views axis is isolated the same way.
  it("views isolate same-name across DBs (AC-264-01)", () => {
    useSchemaStore.setState({
      views: {
        conn1: {
          db1: {
            public: [
              { name: "active_users", schema: "public", definition: "X1" },
            ],
          },
          db2: {
            public: [
              { name: "active_users", schema: "public", definition: "X2" },
            ],
          },
        },
      },
      tableColumnsCache: {
        conn1: {
          db1: {
            public: {
              active_users: [
                {
                  name: "v1_col",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
          db2: {
            public: {
              active_users: [
                {
                  name: "v2_col",
                  data_type: "text",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useSqlAutocomplete("conn1", "db1"));
    const ns = result.current as Record<string, Record<string, unknown>>;
    expect(ns.active_users).toHaveProperty("v1_col");
    expect(ns.active_users).not.toHaveProperty("v2_col");
  });
});
