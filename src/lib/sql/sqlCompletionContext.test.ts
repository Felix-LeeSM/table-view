import { describe, expect, it } from "vitest";
import type {
  ColumnInfo,
  FunctionInfo,
  SchemaInfo,
  TableInfo,
  ViewInfo,
} from "@/types/schema";
import {
  buildSqlCompletionContext,
  isSqlShellCompatible,
  resolveSqlShell,
  type SqlCompletionCatalogStoreSnapshot,
} from "./sqlCompletionContext";

const emptySnapshot = (): SqlCompletionCatalogStoreSnapshot => ({
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  tableColumnsCache: {},
});

const schema = (name: string): SchemaInfo => ({ name });

const table = (
  schemaName: string,
  name: string,
  rowCount: number | null = null,
): TableInfo => ({
  schema: schemaName,
  name,
  row_count: rowCount,
});

const view = (schemaName: string, name: string): ViewInfo => ({
  schema: schemaName,
  name,
  definition: null,
});

const column = (
  name: string,
  dataType = "text",
  overrides: Partial<ColumnInfo> = {},
): ColumnInfo => ({
  name,
  data_type: dataType,
  nullable: true,
  default_value: null,
  is_primary_key: false,
  is_foreign_key: false,
  fk_reference: null,
  comment: null,
  ...overrides,
});

const fnInfo = (
  schemaName: string,
  name: string,
  kind = "function",
): FunctionInfo => ({
  schema: schemaName,
  name,
  arguments: "integer",
  returnType: "integer",
  language: "sql",
  source: null,
  kind,
});

const pgExtension = (name: string, schemaName = "public") => ({
  name,
  schema: schemaName,
  version: "1.0",
  comment: null,
});

describe("buildSqlCompletionContext", () => {
  it("normalizes a PostgreSQL schemaStore snapshot into a flat WASM-ready context", () => {
    const snapshot = emptySnapshot();
    snapshot.schemas.conn1 = { app: [schema("public"), schema("auth")] };
    snapshot.tables.conn1 = {
      app: {
        public: [table("public", "users", 2)],
        auth: [table("auth", "sessions", 4)],
      },
    };
    snapshot.views.conn1 = {
      app: {
        public: [view("public", "active_users")],
      },
    };
    snapshot.functions.conn1 = {
      app: {
        public: [fnInfo("public", "normalize_email")],
      },
    };
    snapshot.tableColumnsCache.conn1 = {
      app: {
        public: {
          users: [
            column("id", "uuid", { nullable: false, is_primary_key: true }),
            column("email"),
          ],
        },
        auth: {
          sessions: [column("user_id", "uuid", { is_foreign_key: true })],
        },
      },
    };

    const ctx = buildSqlCompletionContext({
      ...snapshot,
      connectionId: "conn1",
      database: "app",
      dbType: "postgresql",
      serverVersion: "16.3",
    });

    expect(ctx).toMatchObject({
      connectionId: "conn1",
      database: "app",
      dialect: "postgresql",
      family: "postgres",
      shell: "psql",
      serverVersion: "16.3",
      defaultSchema: "public",
      searchPath: ["public", "auth"],
      cacheState: {
        schemasLoaded: true,
        objectsLoaded: true,
        tablesLoaded: true,
        viewsLoaded: true,
        columnsLoaded: true,
        functionsLoaded: true,
      },
    });
    expect(ctx.catalog.schemas.map((s) => s.name)).toEqual(["auth", "public"]);
    expect(ctx.catalog.objects).toEqual([
      {
        kind: "table",
        schema: "auth",
        name: "sessions",
        qualifiedName: "auth.sessions",
        rowCount: 4,
      },
      {
        kind: "view",
        schema: "public",
        name: "active_users",
        qualifiedName: "public.active_users",
        rowCount: null,
      },
      {
        kind: "table",
        schema: "public",
        name: "users",
        qualifiedName: "public.users",
        rowCount: 2,
      },
    ]);
    expect(ctx.catalog.columns.map((c) => c.qualifiedName)).toEqual([
      "auth.sessions.user_id",
      "public.users.email",
      "public.users.id",
    ]);
    expect(ctx.catalog.functions).toEqual([
      {
        schema: "public",
        name: "normalize_email",
        qualifiedName: "public.normalize_email",
        arguments: "integer",
        returnType: "integer",
        language: "sql",
        kind: "function",
      },
    ]);
  });

  it("infers schemas from loaded objects when explicit schema list is missing", () => {
    const snapshot = emptySnapshot();
    snapshot.tables.conn1 = {
      db1: {
        analytics: [table("analytics", "events")],
      },
    };
    snapshot.tableColumnsCache.conn1 = {
      db1: {
        analytics: {
          events: [column("created_at", "timestamp")],
        },
      },
    };

    const ctx = buildSqlCompletionContext({
      ...snapshot,
      connectionId: "conn1",
      database: "db1",
      dbType: "mysql",
    });

    expect(ctx.dialect).toBe("mysql");
    expect(ctx.family).toBe("mysql");
    expect(ctx.shell).toBe("mysql-client");
    expect(ctx.catalog.schemas).toEqual([{ name: "analytics" }]);
    expect(ctx.defaultSchema).toBe("analytics");
    expect(ctx.cacheState).toMatchObject({
      schemasLoaded: false,
      objectsLoaded: true,
      tablesLoaded: true,
      viewsLoaded: false,
      columnsLoaded: true,
    });
  });

  it("scopes MySQL catalog context to the active connection and database", () => {
    const snapshot = emptySnapshot();
    snapshot.schemas.conn1 = {
      app: [schema("app")],
      other: [schema("other")],
    };
    snapshot.schemas.conn2 = {
      app: [schema("foreign")],
    };
    snapshot.tables.conn1 = {
      app: {
        app: [table("app", "UserAccounts")],
      },
      other: {
        other: [table("other", "OtherUsers")],
      },
    };
    snapshot.tables.conn2 = {
      app: {
        foreign: [table("foreign", "ForeignUsers")],
      },
    };
    snapshot.functions.conn1 = {
      app: {
        app: [fnInfo("app", "normalize_email")],
      },
      other: {
        other: [fnInfo("other", "normalize_other")],
      },
    };
    snapshot.tableColumnsCache.conn1 = {
      app: {
        app: {
          UserAccounts: [column("EmailAddress")],
        },
      },
      other: {
        other: {
          OtherUsers: [column("other_email")],
        },
      },
    };

    const ctx = buildSqlCompletionContext({
      ...snapshot,
      connectionId: "conn1",
      database: "app",
      dbType: "mysql",
    });

    expect(ctx.catalog.schemas).toEqual([{ name: "app" }]);
    expect(ctx.catalog.objects.map((object) => object.qualifiedName)).toEqual([
      "app.UserAccounts",
    ]);
    expect(ctx.catalog.columns.map((column) => column.qualifiedName)).toEqual([
      "app.UserAccounts.EmailAddress",
    ]);
    expect(ctx.catalog.functions.map((fn) => fn.qualifiedName)).toEqual([
      "app.normalize_email",
    ]);
  });

  it("changes the default revision when same-count catalog content changes", () => {
    const buildWithTable = (name: string) => {
      const snapshot = emptySnapshot();
      snapshot.tables.conn1 = {
        db1: {
          public: [table("public", name)],
        },
      };
      return buildSqlCompletionContext({
        ...snapshot,
        connectionId: "conn1",
        database: "db1",
        dbType: "postgresql",
      });
    };

    const usersCtx = buildWithTable("users");
    const ordersCtx = buildWithTable("orders");

    expect(usersCtx.catalog.revision).not.toBe(ordersCtx.catalog.revision);
    expect(usersCtx.catalog.revision).toMatch(/^conn1:db1:1:1:0:0:/);
  });

  it("threads installed PostgreSQL extensions into the WASM-ready catalog", () => {
    const snapshot = emptySnapshot();
    snapshot.postgresExtensions = {
      conn1: {
        app: [pgExtension("pgcrypto"), pgExtension("uuid-ossp", "extensions")],
      },
    };

    const ctx = buildSqlCompletionContext({
      ...snapshot,
      connectionId: "conn1",
      database: "app",
      dbType: "postgresql",
    });

    expect(ctx.catalog.extensions).toEqual([
      {
        schema: "public",
        name: "pgcrypto",
        version: "1.0",
        comment: null,
      },
      {
        schema: "extensions",
        name: "uuid-ossp",
        version: "1.0",
        comment: null,
      },
    ]);
    expect(ctx.cacheState.extensionsLoaded).toBe(true);
  });

  it("builds SQLite catalog context without extension inventory overclaim", () => {
    const snapshot = emptySnapshot();
    snapshot.tables.conn1 = {
      "/tmp/app.sqlite": {
        main: [table("main", "users", 2)],
      },
    };
    snapshot.tableColumnsCache.conn1 = {
      "/tmp/app.sqlite": {
        main: {
          users: [
            column("id", "integer", {
              nullable: false,
              is_primary_key: true,
            }),
            column("email"),
          ],
        },
      },
    };
    snapshot.postgresExtensions = {
      conn1: {
        "/tmp/app.sqlite": [pgExtension("fts5"), pgExtension("rtree")],
      },
    };

    const ctx = buildSqlCompletionContext({
      ...snapshot,
      connectionId: "conn1",
      database: "/tmp/app.sqlite",
      dbType: "sqlite",
      catalogRevision: "sqlite-rev",
    });

    expect(ctx).toMatchObject({
      dialect: "sqlite",
      family: "sqlite",
      shell: "sqlite-cli",
      defaultSchema: "main",
      searchPath: ["main"],
      cacheState: {
        tablesLoaded: true,
        columnsLoaded: true,
        extensionsLoaded: false,
      },
    });
    expect(ctx.catalog.objects.map((object) => object.qualifiedName)).toEqual([
      "main.users",
    ]);
    expect(ctx.catalog.columns.map((column) => column.qualifiedName)).toEqual([
      "main.users.email",
      "main.users.id",
    ]);
    expect(ctx.catalog.extensions).toEqual([]);
  });

  it("keeps MariaDB distinct while reusing the MySQL completion family", () => {
    const ctx = buildSqlCompletionContext({
      ...emptySnapshot(),
      connectionId: "conn1",
      database: "mysql",
      dbType: "mariadb",
    });

    expect(ctx.dialect).toBe("mariadb");
    expect(ctx.family).toBe("mysql");
    expect(ctx.shell).toBe("mysql-client");
  });

  it("falls back to ansi and no shell for non-SQL or missing dbType", () => {
    const mongoCtx = buildSqlCompletionContext({
      ...emptySnapshot(),
      connectionId: "conn1",
      database: "admin",
      dbType: "mongodb",
    });
    const missingCtx = buildSqlCompletionContext({
      ...emptySnapshot(),
      connectionId: "conn1",
      database: "",
    });

    expect(mongoCtx.dialect).toBe("ansi");
    expect(mongoCtx.shell).toBe("none");
    expect(missingCtx.dialect).toBe("ansi");
    expect(missingCtx.shell).toBe("none");
  });

  it("resolves shell overrides only when compatible with the SQL dialect", () => {
    expect(isSqlShellCompatible("psql", "postgresql")).toBe(true);
    expect(isSqlShellCompatible("psql", "mysql")).toBe(false);
    expect(resolveSqlShell("postgresql", "none")).toBe("none");
    expect(resolveSqlShell("postgresql", "mysql-client")).toBe("psql");
    expect(resolveSqlShell("sqlite", "sqlite-cli")).toBe("sqlite-cli");
  });

  it("accepts caller-supplied revision, default schema, and search path", () => {
    const ctx = buildSqlCompletionContext({
      ...emptySnapshot(),
      connectionId: "conn1",
      database: "db1",
      dbType: "postgresql",
      catalogRevision: 42,
      defaultSchema: "tenant_a",
      searchPath: ["tenant_a", "public"],
    });

    expect(ctx.catalog.revision).toBe("42");
    expect(ctx.defaultSchema).toBe("tenant_a");
    expect(ctx.searchPath).toEqual(["tenant_a", "public"]);
  });
});
