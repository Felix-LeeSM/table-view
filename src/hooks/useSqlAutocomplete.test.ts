// useSqlAutocomplete — namespace builder for CodeMirror SQL completions.
// Sprint 263 (2026-05-12) — schemaStore caches now nest by `(connId, db)`,
// so the hook signature is `(connectionId, db, arg?)` and store seeds use
// `{ conn1: { db1: { schema: [...] } } }`.
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { MySQL, PostgreSQL, SQLite } from "@codemirror/lang-sql";
import { useSqlAutocomplete } from "./useSqlAutocomplete";
import { useSchemaStore } from "@stores/schemaStore";

describe("useSqlAutocomplete", () => {
  beforeEach(() => {
    useSchemaStore.setState({
      tables: {},
      views: {},
      tableColumnsCache: {},
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

  // -- Sprint 263 regression: db-scoped exclusion -----------------------
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

  // -- Sprint 37: Enhanced SQL Autocomplete --

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

  // -- Sprint 60 / S60-5: cached columns + views --

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

  // ── Sprint 82: dialect-aware identifier quoting ─────────────────────────

  // AC-04: MySQL dialect must surface a backtick-quoted label for
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

  // AC-04: Postgres dialect → double-quote identifier quoting.
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

  // AC-04: SQLite dialect → first identifier quote char (backtick per
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

  // AC-07: without a dialect, the legacy namespace shape is preserved.
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

  // Views follow the same quoting rule as tables (covers AC-04 view branch).
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

  // AC-04 regression: the legacy `tableColumns` record arg still works even
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
  // CodeMirror's `nameCompletion`. 본래는 ns 에 keyword 를 `{ self,
  // children }` 형태로 직접 inject 해 quote 우회를 강제했었다.
  //
  // Sprint 302 갱신 (2026-05-14): keyword 의 책임을 lang-sql 의 자체
  // `keywordCompletionSource` (line 691-693, dialect.dialect.words 기반,
  // `defaultKeyword = (label, type) => ({ label, type, boost: -1 })`
  // 라서 quote 발생 안 함) 로 일원화. ns 에 keyword 를 또 inject 하면
  // 두 source 가 같은 라벨을 popup 으로 흘려보내 사용자에게 "SELECT 가
  // 2번 뜨는" 회귀를 만든다 (CodeMirror autocomplete 는 source 간
  // dedup 을 하지 않음). 따라서 ns 는 더 이상 keyword 를 노출하지 않는다.
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

  // ── Sprint 233 — UPDATE SET column autocomplete (PG/SQLite) ─────────────
  // 작성 일자: 2026-05-07. 작성 이유: 사용자 보고 (2026-05-07) — bottom strip
  // 에 보이는 `"public"."brief_news_tasks"` 형태로 UPDATE 를 작성할 때
  // CodeMirror SQL 자동완성이 컬럼을 surface 하지 못함. 원인은
  // useSqlAutocomplete 가 `ns["public.brief_news_tasks"]` (도트 split path)
  // 와 `ns["brief_news_tasks"]` (bare) 까지만 등록하고, 사용자가 종종 직접
  // 사용하는 fully-quoted form `"public"."brief_news_tasks"` 는 등록되지
  // 않아 CodeMirror 의 `addNamespaceObject` (lang-sql:507-523) 가 동일
  // children 까지 도달하지 못함. PG / SQLite double-quote dialect 에서
  // 이 키도 emit 해야 함.

  // AC-233-01 — PG dialect 에서 fully-quoted schema-qualified key 가
  // namespace 에 emit 되며, columns map 을 children 으로 가진다.
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
  // case described in the orchestrator brief (hypothesis C).
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

  // ── Sprint 264 — cross-DB isolation audit ─────────────────────────────
  // Sprint 263 분리 후 회귀 가드. 같은 connection 의 다른 DB 가 활성
  // namespace 로 누설되지 않는지 6 corner case 로 잠근다.

  // AC-264-01 #1 — 동일 table 이름이 두 DB 에서 서로 다른 컬럼을 가질
  // 때, 활성 DB 의 컬럼만 surface.
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

  // AC-264-01 #2 — inactive DB 의 columnsCache 만 채워져 있는 (table 등록
  // 없는) "ghost" 항목이 활성 namespace 로 새지 않는다.
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

  // AC-264-01 #3 — db 인자가 변경되면 useMemo 가 재빌드해 새 DB 의
  // namespace 로 교체된다.
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

  // AC-264-01 #4 — schema-qualified key (`public.users`) 도 활성 DB 의
  // 컬럼만 따른다.
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

  // AC-264-01 #5 — PG dialect 의 fully-quoted key
  // (`"public"."users"`) 도 활성 DB 의 컬럼만 노출한다.
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

  // ── Sprint 268 (2026-05-13) — intra-DB schema collision ─────────────────
  // 작성 이유: Sprint 264 OoS #1 — 같은 `(connId, db)` 안에서 두 schema 가
  // 동일한 table 이름을 가질 때 (예: `public.users`, `auth.users`),
  // 기존 `cachedColumnsByName[bareName] = colNs` last-writer-wins 가
  // schema-qualified lookup 까지 오염시켰음. Cache shape 을
  // schema-preserving 으로 바꾼 뒤에도 회귀가 없는지 4 case 로 잠근다.
  //
  // 채택한 ambiguity policy: Policy A — bare key `ns["users"]` 는 모든
  // candidate schema 의 컬럼을 column-name 기준 dedupe 한 union 으로
  // 노출한다. Rationale: silently dropping a candidate column is a worse
  // failure mode than offering a superset; 사용자는 어차피
  // `qualifiedName` 으로 좁힐 수 있다.

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
  // identical to pre-Sprint-268 behaviour.
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

  // AC-264-01 #6 — views axis 도 동일 격리.
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
