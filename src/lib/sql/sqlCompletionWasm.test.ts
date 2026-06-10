import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletionResult } from "@/lib/completion/coreContract";
import {
  buildSqlCompletionContext,
  buildSqlCompletionRequest,
  type SqlCompletionRequest,
  type SqlCompletionCatalogStoreSnapshot,
} from "@features/completion";
import {
  __resetSqlCompletionWasmModuleForTests,
  completeSqlWithPreloadedWasm,
  completeSqlWithWasm,
  preloadSqlCompletionWasm,
} from "./sqlCompletionWasm";

const completeSqlMock = vi.fn();

vi.mock("./wasm/sql_parser_core.js", () => {
  return {
    default: vi.fn().mockResolvedValue(undefined),
    complete_sql: completeSqlMock,
  };
});

const emptySnapshot = (): SqlCompletionCatalogStoreSnapshot => ({
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  tableColumnsCache: {},
});

function request() {
  const ctx = buildSqlCompletionContext({
    ...emptySnapshot(),
    connectionId: "conn1",
    database: "app",
    dbType: "postgresql",
    catalogRevision: "rev-1",
  });
  return buildSqlCompletionRequest("SEL", 3, ctx);
}

function requestWithExtension() {
  const snapshot = emptySnapshot();
  snapshot.postgresExtensions = {
    conn1: {
      app: [
        {
          schema: "public",
          name: "pgcrypto",
          version: "1.3",
          comment: null,
        },
      ],
    },
  };
  const ctx = buildSqlCompletionContext({
    ...snapshot,
    connectionId: "conn1",
    database: "app",
    dbType: "postgresql",
    catalogRevision: "rev-ext",
  });
  return buildSqlCompletionRequest("GEN_RANDOM", 10, ctx);
}

function requestWithMysqlSchemas() {
  const snapshot = emptySnapshot();
  snapshot.schemas.conn1 = {
    app: [{ name: "app" }, { name: "archive" }],
  };
  const ctx = buildSqlCompletionContext({
    ...snapshot,
    connectionId: "conn1",
    database: "app",
    dbType: "mysql",
    catalogRevision: "rev-mysql",
  });
  return buildSqlCompletionRequest("USE ap", 6, ctx);
}

function requestWithMssqlCatalog() {
  const snapshot = emptySnapshot();
  snapshot.databases = {
    conn1: [{ name: "MssqlApp" }, { name: "ArchiveDb" }],
  };
  snapshot.schemas.conn1 = {
    MssqlApp: [{ name: "dbo" }, { name: "sales" }],
  };
  snapshot.tables.conn1 = {
    MssqlApp: {
      sales: [{ schema: "sales", name: "Order Details", row_count: null }],
    },
  };
  snapshot.functions.conn1 = {
    MssqlApp: {
      dbo: [
        {
          schema: "dbo",
          name: "usp_RebuildLeaderboard",
          arguments: "@season int",
          returnType: null,
          language: null,
          source: null,
          kind: "procedure",
        },
      ],
    },
  };
  snapshot.tableColumnsCache.conn1 = {
    MssqlApp: {
      sales: {
        "Order Details": [
          {
            name: "Ship Date",
            data_type: "datetime2",
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
  };
  const ctx = buildSqlCompletionContext({
    ...snapshot,
    connectionId: "conn1",
    database: "MssqlApp",
    dbType: "mssql",
    catalogRevision: "rev-mssql",
  });
  return buildSqlCompletionRequest("SELECT * FROM MssqlApp.sales.", 29, ctx);
}

function requestWithOracleCatalog() {
  const snapshot = emptySnapshot();
  snapshot.schemas.conn1 = {
    FREEPDB1: [{ name: "APP" }],
  };
  snapshot.tables.conn1 = {
    FREEPDB1: {
      APP: [{ schema: "APP", name: "ORDERS", row_count: null }],
    },
  };
  snapshot.functions.conn1 = {
    FREEPDB1: {
      APP: [
        {
          schema: "APP",
          name: "ORDER_SEQ",
          arguments: "increment 1, cache 20",
          returnType: "next 101",
          language: "Oracle sequence",
          source: null,
          kind: "sequence",
        },
        {
          schema: "APP",
          name: "ACTIVE_USERS_ALIAS",
          arguments: "APP.ACTIVE_ORACLE_USERS",
          returnType: "APP.ACTIVE_ORACLE_USERS",
          language: "Oracle synonym",
          source: null,
          kind: "synonym",
        },
      ],
    },
  };
  snapshot.tableColumnsCache.conn1 = {
    FREEPDB1: {
      APP: {
        ORDERS: [
          {
            name: "ORDER_ID",
            data_type: "NUMBER",
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
  };
  const ctx = buildSqlCompletionContext({
    ...snapshot,
    connectionId: "conn1",
    database: "FREEPDB1",
    dbType: "oracle",
    catalogRevision: "rev-oracle-catalog",
  });
  return buildSqlCompletionRequest("SELECT APP.ORDER_SEQ.", 21, ctx);
}

function requestWithMariaDbVersion(serverVersion: string) {
  const ctx = buildSqlCompletionContext({
    ...emptySnapshot(),
    connectionId: "conn1",
    database: "app",
    dbType: "mariadb",
    serverVersion,
    catalogRevision: "rev-mariadb",
  });
  return buildSqlCompletionRequest("RET", 3, ctx);
}

function rustCompactArgsFor(request: SqlCompletionRequest): unknown[] {
  return [
    request.text,
    request.cursor.utf16,
    request.cursor.utf8,
    request.dialect,
    request.shell,
    request.serverVersion ?? "",
    request.catalog.revision,
    request.vocabulary.keywords.join("\n"),
    request.vocabulary.functions.join("\n"),
    request.catalog.databases.map((database) => database.name).join("\n"),
    request.catalog.schemas
      .map((schema) => [schema.name, schema.database].join("\t"))
      .join("\n"),
    request.catalog.objects
      .map((object) =>
        [
          object.kind,
          object.schema,
          object.name,
          object.qualifiedName,
          object.database,
        ].join("\t"),
      )
      .join("\n"),
    request.catalog.columns
      .map((column) =>
        [
          column.schema,
          column.table,
          column.name,
          column.qualifiedTableName,
          column.database,
        ].join("\t"),
      )
      .join("\n"),
    request.catalog.functions
      .map((fn) =>
        [
          fn.schema,
          fn.name,
          fn.qualifiedName,
          fn.arguments ?? "",
          fn.returnType ?? "",
          fn.database,
          fn.kind,
          fn.language ?? "",
        ].join("\t"),
      )
      .join("\n"),
    request.catalog.extensions
      .map((extension) =>
        [extension.schema, extension.name, extension.version].join("\t"),
      )
      .join("\n"),
  ];
}

describe("sqlCompletionWasm", () => {
  beforeEach(() => {
    __resetSqlCompletionWasmModuleForTests();
    completeSqlMock.mockReset();
  });

  it("returns the WASM completion result", async () => {
    const result: CompletionResult = {
      items: [{ label: "SELECT", kind: "keyword", apply: "SELECT" }],
      replaceRange: {
        from: { utf16: 0, utf8: 0 },
        to: { utf16: 3, utf8: 3 },
      },
      incomplete: false,
      metadata: {
        engine: "wasm",
        dialect: "postgresql",
        shell: "psql",
        catalogRevision: "rev-1",
      },
    };
    completeSqlMock.mockReturnValue(result);

    await expect(completeSqlWithWasm(request())).resolves.toEqual(result);
    expect(completeSqlMock).toHaveBeenCalledWith(
      "SEL",
      3,
      3,
      "postgresql",
      "psql",
      "",
      "rev-1",
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it("keeps the TS request wrapper compatible with Rust complete_sql compact ABI", async () => {
    completeSqlMock.mockReturnValue(null);
    const req = requestWithMssqlCatalog();

    await completeSqlWithWasm(req);

    const expectedArgs = rustCompactArgsFor(req);
    expect(expectedArgs).toHaveLength(15);
    expect(expectedArgs.slice(0, 7)).toEqual([
      "SELECT * FROM MssqlApp.sales.",
      29,
      29,
      "mssql",
      "none",
      "",
      "rev-mssql",
    ]);
    expect(expectedArgs[8]).not.toContain("usp_RebuildLeaderboard");
    expect(expectedArgs[9]).toBe("ArchiveDb\nMssqlApp");
    expect(expectedArgs[10]).toBe("dbo\tMssqlApp\nsales\tMssqlApp");
    expect(expectedArgs[11]).toContain(
      "table\tsales\tOrder Details\tsales.Order Details\tMssqlApp",
    );
    expect(expectedArgs[12]).toContain(
      "sales\tOrder Details\tShip Date\tsales.Order Details\tMssqlApp",
    );
    expect(expectedArgs[13]).toContain(
      "dbo\tusp_RebuildLeaderboard\tdbo.usp_RebuildLeaderboard\t@season int\t\tMssqlApp\tprocedure\t",
    );
    expect(expectedArgs[14]).toBe("");
    expect(completeSqlMock).toHaveBeenCalledWith(...expectedArgs);
  });

  it("serializes installed extension inventory across the WASM bridge", async () => {
    completeSqlMock.mockReturnValue(null);

    await completeSqlWithWasm(requestWithExtension());

    expect(completeSqlMock).toHaveBeenCalledWith(
      "GEN_RANDOM",
      10,
      10,
      "postgresql",
      "psql",
      "",
      "rev-ext",
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "public\tpgcrypto\t1.3",
    );
  });

  it("serializes current MySQL schema inventory across the WASM bridge", async () => {
    completeSqlMock.mockReturnValue(null);

    await completeSqlWithWasm(requestWithMysqlSchemas());

    expect(completeSqlMock).toHaveBeenCalledWith(
      "USE ap",
      6,
      6,
      "mysql",
      "mysql-client",
      "",
      "rev-mysql",
      expect.any(String),
      expect.any(String),
      "",
      "app\tapp\narchive\tapp",
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it("serializes current MSSQL database-owned catalog across the WASM bridge", async () => {
    completeSqlMock.mockReturnValue(null);

    await completeSqlWithWasm(requestWithMssqlCatalog());

    const call = completeSqlMock.mock.calls[0]!;
    expect(call[9]).toBe("ArchiveDb\nMssqlApp");
    expect(call[10]).toBe("dbo\tMssqlApp\nsales\tMssqlApp");
    expect(call[11]).toContain(
      "table\tsales\tOrder Details\tsales.Order Details\tMssqlApp",
    );
    expect(call[12]).toContain(
      "sales\tOrder Details\tShip Date\tsales.Order Details\tMssqlApp",
    );
    expect(call[13]).toContain(
      "dbo\tusp_RebuildLeaderboard\tdbo.usp_RebuildLeaderboard\t@season int\t\tMssqlApp",
    );
  });

  it("serializes Oracle catalog metadata kinds across the WASM bridge", async () => {
    completeSqlMock.mockReturnValue(null);

    await completeSqlWithWasm(requestWithOracleCatalog());

    const call = completeSqlMock.mock.calls[0]!;
    expect(call[10]).toBe("APP\tFREEPDB1");
    expect(call[11]).toContain("table\tAPP\tORDERS\tAPP.ORDERS\tFREEPDB1");
    expect(call[12]).toContain("APP\tORDERS\tORDER_ID\tAPP.ORDERS\tFREEPDB1");
    expect(call[13]).toContain(
      "APP\tORDER_SEQ\tAPP.ORDER_SEQ\tincrement 1, cache 20\tnext 101\tFREEPDB1\tsequence\tOracle sequence",
    );
    expect(call[13]).toContain(
      "APP\tACTIVE_USERS_ALIAS\tAPP.ACTIVE_USERS_ALIAS\tAPP.ACTIVE_ORACLE_USERS\tAPP.ACTIVE_ORACLE_USERS\tFREEPDB1\tsynonym\tOracle synonym",
    );
  });

  it("serializes MariaDB server version and filtered vocabulary across the WASM bridge", async () => {
    completeSqlMock.mockReturnValue(null);

    await completeSqlWithWasm(requestWithMariaDbVersion("10.0.4-MariaDB"));

    expect(completeSqlMock).toHaveBeenCalledWith(
      "RET",
      3,
      3,
      "mariadb",
      "mysql-client",
      "10.0.4-MariaDB",
      "rev-mariadb",
      expect.not.stringContaining("RETURNING"),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it("keeps MariaDB RETURNING vocabulary for keyword-supported versions", async () => {
    completeSqlMock.mockReturnValue(null);

    await completeSqlWithWasm(requestWithMariaDbVersion("10.4.34-MariaDB"));

    expect(completeSqlMock).toHaveBeenCalledWith(
      "RET",
      3,
      3,
      "mariadb",
      "mysql-client",
      "10.4.34-MariaDB",
      "rev-mariadb",
      expect.stringContaining("RETURNING"),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it("supports a synchronous preloaded path", async () => {
    const result: CompletionResult = {
      items: [],
      replaceRange: {
        from: { utf16: 3, utf8: 3 },
        to: { utf16: 3, utf8: 3 },
      },
      incomplete: false,
      metadata: { engine: "wasm" },
    };
    completeSqlMock.mockReturnValue(result);

    expect(completeSqlWithPreloadedWasm(request())).toBeNull();
    await preloadSqlCompletionWasm();
    expect(completeSqlWithPreloadedWasm(request())).toEqual(result);
  });

  it("falls back to an empty result when the bridge returns an invalid shape", async () => {
    completeSqlMock.mockReturnValue(null);

    await expect(completeSqlWithWasm(request())).resolves.toMatchObject({
      items: [],
      replaceRange: {
        from: { utf16: 3, utf8: 3 },
        to: { utf16: 3, utf8: 3 },
      },
      metadata: {
        engine: "wasm",
        dialect: "postgresql",
        shell: "psql",
        catalogRevision: "rev-1",
      },
    });
  });
});
