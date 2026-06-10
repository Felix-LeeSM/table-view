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
        database: "app",
        schema: "auth",
        name: "sessions",
        qualifiedName: "auth.sessions",
        rowCount: 4,
      },
      {
        kind: "view",
        database: "app",
        schema: "public",
        name: "active_users",
        qualifiedName: "public.active_users",
        rowCount: null,
      },
      {
        kind: "table",
        database: "app",
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
        database: "app",
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
    expect(ctx.catalog.schemas).toEqual([
      { database: "db1", name: "analytics" },
    ]);
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

    expect(ctx.catalog.schemas).toEqual([{ database: "app", name: "app" }]);
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

  it("threads cached MSSQL databases and catalog owners into the WASM-ready context", () => {
    const snapshot = emptySnapshot();
    snapshot.databases = {
      conn1: [{ name: "MssqlApp" }, { name: "ArchiveDb" }],
    };
    snapshot.schemas.conn1 = {
      MssqlApp: [schema("dbo"), schema("sales")],
    };
    snapshot.tables.conn1 = {
      MssqlApp: {
        sales: [table("sales", "Order Details")],
      },
    };
    snapshot.views.conn1 = {
      MssqlApp: {
        dbo: [view("dbo", "SalesSummary")],
      },
    };
    snapshot.functions.conn1 = {
      MssqlApp: {
        dbo: [fnInfo("dbo", "usp_RebuildLeaderboard", "procedure")],
      },
    };
    snapshot.tableColumnsCache.conn1 = {
      MssqlApp: {
        sales: {
          "Order Details": [column("Ship Date", "datetime2")],
        },
      },
    };

    const ctx = buildSqlCompletionContext({
      ...snapshot,
      connectionId: "conn1",
      database: "MssqlApp",
      dbType: "mssql",
    });

    expect(ctx.catalog.databases).toEqual([
      { name: "ArchiveDb" },
      { name: "MssqlApp" },
    ]);
    expect(ctx.catalog.schemas).toEqual([
      { database: "MssqlApp", name: "dbo" },
      { database: "MssqlApp", name: "sales" },
    ]);
    expect(ctx.catalog.objects).toEqual([
      expect.objectContaining({
        kind: "view",
        database: "MssqlApp",
        schema: "dbo",
        name: "SalesSummary",
      }),
      expect.objectContaining({
        kind: "table",
        database: "MssqlApp",
        schema: "sales",
        name: "Order Details",
      }),
    ]);
    expect(ctx.catalog.columns).toEqual([
      expect.objectContaining({
        database: "MssqlApp",
        schema: "sales",
        table: "Order Details",
        name: "Ship Date",
      }),
    ]);
    expect(ctx.catalog.functions).toEqual([
      expect.objectContaining({
        database: "MssqlApp",
        schema: "dbo",
        name: "usp_RebuildLeaderboard",
        kind: "procedure",
      }),
    ]);
    expect(ctx.cacheState.databasesLoaded).toBe(true);
  });

  it("threads Oracle package sequence and synonym metadata into the WASM-ready context", () => {
    const snapshot = emptySnapshot();
    snapshot.schemas.conn1 = {
      FREEPDB1: [schema("APP")],
    };
    snapshot.tables.conn1 = {
      FREEPDB1: {
        APP: [table("APP", "ORDERS")],
      },
    };
    snapshot.views.conn1 = {
      FREEPDB1: {
        APP: [view("APP", "ACTIVE_ORACLE_USERS")],
      },
    };
    snapshot.functions.conn1 = {
      FREEPDB1: {
        APP: [
          fnInfo("APP", "CATALOG_API", "package"),
          fnInfo("APP", "ORDER_SEQ", "sequence"),
          fnInfo("APP", "ACTIVE_USERS_ALIAS", "synonym"),
        ],
      },
    };
    snapshot.tableColumnsCache.conn1 = {
      FREEPDB1: {
        APP: {
          ORDERS: [column("ORDER_ID", "NUMBER", { is_primary_key: true })],
        },
      },
    };

    const ctx = buildSqlCompletionContext({
      ...snapshot,
      connectionId: "conn1",
      database: "FREEPDB1",
      dbType: "oracle",
      serverVersion: "23ai",
    });

    expect(ctx).toMatchObject({
      dialect: "oracle",
      family: "oracle",
      shell: "none",
      serverVersion: "23ai",
      cacheState: {
        schemasLoaded: true,
        objectsLoaded: true,
        columnsLoaded: true,
        functionsLoaded: true,
      },
    });
    expect(ctx.catalog.objects).toEqual([
      expect.objectContaining({
        kind: "view",
        database: "FREEPDB1",
        schema: "APP",
        name: "ACTIVE_ORACLE_USERS",
      }),
      expect.objectContaining({
        kind: "table",
        database: "FREEPDB1",
        schema: "APP",
        name: "ORDERS",
      }),
    ]);
    expect(ctx.catalog.columns).toEqual([
      expect.objectContaining({
        database: "FREEPDB1",
        schema: "APP",
        table: "ORDERS",
        name: "ORDER_ID",
      }),
    ]);
    expect(ctx.catalog.functions.map((fn) => [fn.name, fn.kind])).toEqual([
      ["ACTIVE_USERS_ALIAS", "synonym"],
      ["CATALOG_API", "package"],
      ["ORDER_SEQ", "sequence"],
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
    expect(usersCtx.catalog.revision).toMatch(/^conn1:db1:0:1:1:0:0:/);
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

  it("keeps backend completion metadata fetch state explicit for empty results", () => {
    const missing = buildSqlCompletionContext({
      ...emptySnapshot(),
      connectionId: "conn1",
      database: "app",
      dbType: "postgresql",
    });
    expect(missing.catalog).toMatchObject({
      databases: [],
      schemas: [],
      objects: [],
      columns: [],
      functions: [],
      extensions: [],
    });
    expect(missing.cacheState).toEqual({
      databasesLoaded: false,
      schemasLoaded: false,
      objectsLoaded: false,
      tablesLoaded: false,
      viewsLoaded: false,
      columnsLoaded: false,
      functionsLoaded: false,
      extensionsLoaded: false,
    });

    const loadedEmpty = emptySnapshot();
    loadedEmpty.databases = { conn1: [] };
    loadedEmpty.schemas.conn1 = { app: [] };
    loadedEmpty.tables.conn1 = { app: {} };
    loadedEmpty.views.conn1 = { app: {} };
    loadedEmpty.functions.conn1 = { app: {} };
    loadedEmpty.tableColumnsCache.conn1 = { app: {} };
    loadedEmpty.postgresExtensions = { conn1: { app: [] } };

    const loaded = buildSqlCompletionContext({
      ...loadedEmpty,
      connectionId: "conn1",
      database: "app",
      dbType: "postgresql",
    });

    expect(loaded.catalog).toMatchObject({
      databases: [],
      schemas: [],
      objects: [],
      columns: [],
      functions: [],
      extensions: [],
    });
    expect(loaded.cacheState).toEqual({
      databasesLoaded: true,
      schemasLoaded: true,
      objectsLoaded: true,
      tablesLoaded: true,
      viewsLoaded: true,
      columnsLoaded: true,
      functionsLoaded: true,
      extensionsLoaded: true,
    });
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
