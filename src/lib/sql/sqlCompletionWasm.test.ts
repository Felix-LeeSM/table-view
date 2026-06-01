import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletionResult } from "@/lib/completion/coreContract";
import {
  buildSqlCompletionContext,
  type SqlCompletionCatalogStoreSnapshot,
} from "./sqlCompletionContext";
import { buildSqlCompletionRequest } from "./sqlCompletionRequest";
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
    );
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
      "app\narchive",
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it("serializes MariaDB server version and filtered vocabulary across the WASM bridge", async () => {
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
      expect.not.stringContaining("RETURNING"),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it("keeps MariaDB RETURNING vocabulary for supported versions", async () => {
    completeSqlMock.mockReturnValue(null);

    await completeSqlWithWasm(requestWithMariaDbVersion("10.5.0-MariaDB"));

    expect(completeSqlMock).toHaveBeenCalledWith(
      "RET",
      3,
      3,
      "mariadb",
      "mysql-client",
      "10.5.0-MariaDB",
      "rev-mariadb",
      expect.stringContaining("RETURNING"),
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
