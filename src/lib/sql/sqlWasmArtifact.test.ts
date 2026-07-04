/**
 * Sprint 432 — checked-in SQL WASM artifact regression.
 *
 * `sqlAst.test.ts` intentionally mocks the wasm-pack module to keep facade
 * tests small. This file loads the real checked-in `.wasm` bytes, so Rust
 * parser changes that forget to refresh `src/lib/sql/wasm/` fail in Vitest.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetSqlWasmModuleForTests,
  parseSql,
  parseSqlPreloaded,
  preloadSqlWasm,
} from "./sqlAst";
import initSqlParserCore, {
  complete_sql as completeSqlFromWasm,
} from "./wasm/sql_parser_core.js";

vi.mock("./wasm/sql_parser_core.js", async () => {
  const actual = await vi.importActual<
    typeof import("./wasm/sql_parser_core.js")
  >("./wasm/sql_parser_core.js");
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const wasmUrl = new URL("./wasm/sql_parser_core_bg.wasm", import.meta.url);
  const rootFlagIndex = process.argv.indexOf("--root");
  const testRoot =
    process.argv.find((arg) => arg.startsWith("--root="))?.slice(7) ??
    (rootFlagIndex >= 0 ? process.argv[rootFlagIndex + 1] : undefined) ??
    process.env.PWD ??
    process.cwd();
  const servedPath = decodeURIComponent(wasmUrl.pathname);
  const wasmPath =
    wasmUrl.protocol === "file:"
      ? fileURLToPath(wasmUrl)
      : servedPath.startsWith("/@fs/")
        ? servedPath.replace(/^\/@fs\//, "/")
        : resolve(testRoot, servedPath.replace(/^\//, ""));
  const wasm = readFileSync(wasmPath);
  const wasmBytes = wasm.buffer.slice(
    wasm.byteOffset,
    wasm.byteOffset + wasm.byteLength,
  );

  return {
    ...actual,
    default: vi.fn(async () => {
      actual.initSync({ module: wasmBytes });
      return undefined;
    }),
  };
});

describe("checked-in SQL WASM artifact", () => {
  beforeEach(() => {
    __resetSqlWasmModuleForTests();
  });

  it("[AC-432-W01] parseSql accepts MySQL LIMIT offset,count through real WASM", async () => {
    const result = await parseSql("SELECT a FROM x LIMIT 10, 20");

    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.limit).toEqual({
      count: { kind: "literal", value: { kind: "integer", value: 20 } },
      offset: { kind: "literal", value: { kind: "integer", value: 10 } },
    });
  });

  it("[AC-432-W02] parseSqlPreloaded uses the refreshed real WASM artifact", async () => {
    await preloadSqlWasm();

    const result = parseSqlPreloaded("SELECT a FROM x LIMIT 10, 20");

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.kind).toBe("select");
  });

  it("[AC-512-W01] parseSql accepts SELECT TOP with bracket identifiers through real WASM", async () => {
    const result = await parseSql("SELECT TOP (10) [id] FROM [dbo].[users]");

    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.from[0]).toMatchObject({ schema: "dbo", table: "users" });
    expect(result.limit).toEqual({
      count: { kind: "literal", value: { kind: "integer", value: 10 } },
      offset: null,
    });
  });

  it("[AC-512-W02] parseSql rejects unsupported T-SQL admin verbs through real WASM", async () => {
    const result = await parseSql("DBCC CHECKDB ([app])");

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.error_kind).toBe("unsupported-statement");
  });

  it("[AC-1119-W01] real parser still rejects writable CTE bodies — sentinel for issue #1119", async () => {
    // The safe-mode CTE mapper (statementAnalysisFromAst, sqlSafety.ts) now
    // analyzes `ctes[]` bodies defensively, but the safety invariant it backs
    // up is that the real grammar restricts CTE bodies to SELECT — so a
    // PostgreSQL writable CTE fails to parse and the regex fallback
    // (analyzeDmlCte) still guards it. When the parser is widened to accept
    // writable CTEs this assertion fails, summoning issue #1119 so the AST
    // path's ctes[] traversal gets end-to-end (real-parser) coverage.
    const result = await parseSql(
      "WITH d AS (DELETE FROM users RETURNING id) SELECT * FROM d",
    );
    expect(result.kind).toBe("error");
  });

  it("[AC-512-W03] TOP remains contextual through real WASM", async () => {
    const result = await parseSql("SELECT top FROM users");

    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.columns).toEqual({ kind: "named", names: ["top"] });
    expect(result.limit).toBeNull();
  });

  it("[AC-434-W01] parseSql accepts MySQL ON DUPLICATE KEY UPDATE through real WASM", async () => {
    const result = await parseSql(
      "INSERT INTO users (id, name) VALUES (1, 'a') ON DUPLICATE KEY UPDATE name = VALUES(name), id = ?",
    );

    expect(result.kind).toBe("insert");
    if (result.kind !== "insert") return;
    expect(result.on_conflict ?? null).toBeNull();
    expect(result.on_duplicate_key_update?.assignments).toEqual([
      {
        column: "name",
        value: { kind: "values-column", column: "name" },
      },
      {
        column: "id",
        value: { kind: "placeholder", name: "" },
      },
    ]);
  });

  it("[AC-434-W02] parseSql accepts DEFAULT RHS in ON DUPLICATE KEY UPDATE through real WASM", async () => {
    const result = await parseSql(
      "INSERT INTO users (id, name) VALUES (1, 'a') ON DUPLICATE KEY UPDATE name = DEFAULT",
    );

    expect(result.kind).toBe("insert");
    if (result.kind !== "insert") return;
    expect(result.on_duplicate_key_update?.assignments).toEqual([
      {
        column: "name",
        value: { kind: "default" },
      },
    ]);
  });

  it("[AC-439-W01] parseSql accepts MySQL CALL through real WASM", async () => {
    const result = await parseSql(
      "CALL reporting.refresh_user_stats(?, 'x', 1)",
    );

    expect(result.kind).toBe("call");
    if (result.kind !== "call") return;
    expect(result.procedure).toEqual({
      schema: "reporting",
      name: "refresh_user_stats",
    });
    expect(result.arguments).toEqual([
      { kind: "placeholder", name: "" },
      { kind: "literal", value: { kind: "string", value: "x" } },
      { kind: "literal", value: { kind: "integer", value: 1 } },
    ]);
  });

  it("[AC-439-W02] parseSql emits schema null for bare CALL through real WASM", async () => {
    const result = await parseSql("CALL refresh_user_stats()");

    expect(result.kind).toBe("call");
    if (result.kind !== "call") return;
    expect(result.procedure).toEqual({
      schema: null,
      name: "refresh_user_stats",
    });
    expect(result.arguments).toEqual([]);
  });

  it("[AC-448-W01] parseSql accepts bounded MySQL user-variable CALL arguments through real WASM", async () => {
    const result = await parseSql("CALL refresh_user_stats(@user_id)");

    expect(result.kind).toBe("call");
    if (result.kind !== "call") return;
    expect(result.arguments).toEqual([
      { kind: "user-variable", name: "user_id" },
    ]);
  });

  it("parseSql accepts bounded Oracle scalar DDL types through real WASM", async () => {
    const result = await parseSql(
      "CREATE TABLE accounts (id NUMBER(10), name VARCHAR2(80), body CLOB, payload BLOB)",
    );

    expect(result.kind).toBe("create-table");
    if (result.kind !== "create-table") return;
    expect(result.columns.map((column) => column.data_type)).toEqual([
      { kind: "number", precision: 10, scale: null },
      { kind: "varchar2", length: 80 },
      { kind: "clob" },
      { kind: "blob" },
    ]);
  });

  it.each([
    ["function call", "CALL refresh_user_stats(NOW())"],
    ["arithmetic", "CALL refresh_user_stats(1 + 2)"],
    ["subquery", "CALL refresh_user_stats((SELECT id FROM users))"],
    ["bare identifier", "CALL refresh_user_stats(user_id)"],
    ["system variable", "CALL refresh_user_stats(@@session_sql_mode)"],
  ])(
    "[AC-448-W02] rejects unsupported CALL argument form: %s",
    async (_label, sql) => {
      const result = await parseSql(sql);

      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(["syntax-error", "lex-error"]).toContain(result.error_kind);
    },
  );

  it("[AC-454-W01] complete_sql gates MariaDB RETURNING through real WASM", async () => {
    await initSqlParserCore();

    expect(mariaDbCompletionLabels("10.0.4-MariaDB")).not.toContain(
      "RETURNING",
    );
    expect(mariaDbCompletionLabels("10.0.5-MariaDB")).toContain("RETURNING");
    expect(mariaDbCompletionLabels("10.4.34-MariaDB")).toContain("RETURNING");
  });

  it("[AC-461-W01] complete_sql marks SQLite dot commands non-executable through real WASM", async () => {
    await initSqlParserCore();

    const result = completeSqlFromWasm(
      ".s",
      2,
      2,
      "sqlite",
      "sqlite-cli",
      "",
      "rev-sqlite",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ) as {
      items: Array<{
        label: string;
        kind: string;
        detail?: string;
        runtimeExecutable?: boolean;
      }>;
    };
    const schemaCommand = result.items.find((item) => item.label === ".schema");

    expect(schemaCommand).toMatchObject({
      kind: "meta-command",
      runtimeExecutable: false,
      detail: "sqlite-cli command; not executable by Table View",
    });
  });

  it("complete_sql exposes Oracle keyword, package, and bind vocabulary through real WASM", async () => {
    await initSqlParserCore();

    expect(oracleCompletionLabels("CONNECT")).toContain("CONNECT BY");
    expect(oracleCompletionLabels("DBMS_OUTPUT")).toContain(
      "DBMS_OUTPUT.PUT_LINE",
    );

    const bindResult = completeSqlFromWasm(
      "SELECT :ST",
      10,
      10,
      "oracle",
      "none",
      "",
      "rev-oracle",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ) as {
      items: Array<{
        label: string;
        kind: string;
        apply?: string;
        runtimeExecutable?: boolean;
      }>;
      replaceRange: {
        from: { utf16: number; utf8: number };
        to: { utf16: number; utf8: number };
      };
    };
    const bind = bindResult.items.find((item) => item.label === ":START_DATE");

    expect(bind).toMatchObject({
      kind: "variable",
      apply: ":START_DATE",
      runtimeExecutable: false,
    });
    expect(bindResult.replaceRange).toEqual({
      from: { utf16: 7, utf8: 7 },
      to: { utf16: 10, utf8: 10 },
    });
    expect(oracleCompletionLabels("DECL")).not.toContain("DECLARE");
  });

  it("complete_sql returns Oracle catalog-aware candidates through real WASM", async () => {
    await initSqlParserCore();

    const schemaResult = oracleCatalogCompletion("SELECT * FROM FREEPDB1.");
    expect(schemaResult.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "APP",
          kind: "schema",
          detail: "FREEPDB1",
        }),
      ]),
    );

    const tableResult = oracleCatalogCompletion("SELECT * FROM APP.ORD");
    expect(tableResult.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "ORDERS",
          kind: "table",
          detail: "APP",
        }),
      ]),
    );

    const viewResult = oracleCatalogCompletion("SELECT * FROM APP.ACTIVE");
    expect(viewResult.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "ACTIVE_ORACLE_USERS",
          kind: "view",
          detail: "APP",
        }),
      ]),
    );

    const columnResult = oracleCatalogCompletion("SELECT APP.ORDERS.ORD");
    expect(columnResult.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "ORDER_ID",
          kind: "column",
          detail: "APP.ORDERS",
        }),
      ]),
    );

    const packageResult = oracleCatalogCompletion("SELECT CATALOG");
    expect(packageResult.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "CATALOG_API",
          kind: "package",
          detail: "APP.CATALOG_API",
        }),
      ]),
    );

    const sequenceResult = oracleCatalogCompletion("SELECT ORDER_");
    expect(sequenceResult.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "ORDER_SEQ",
          kind: "sequence",
          detail: "APP.ORDER_SEQ -> next 101",
        }),
      ]),
    );

    const synonymResult = oracleCatalogCompletion("SELECT * FROM ACTIVE_");
    expect(synonymResult.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "ACTIVE_USERS_ALIAS",
          kind: "synonym",
          detail: "APP.ACTIVE_USERS_ALIAS -> APP.ACTIVE_ORACLE_USERS",
        }),
      ]),
    );
  });

  it("complete_sql returns Oracle NEXTVAL/CURRVAL only for catalog sequences through real WASM", async () => {
    await initSqlParserCore();

    const sequenceMembers = oracleCatalogCompletion("SELECT APP.ORDER_SEQ.");
    expect(sequenceMembers.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "NEXTVAL",
          kind: "keyword",
          detail: "Oracle sequence member",
        }),
        expect.objectContaining({
          label: "CURRVAL",
          kind: "keyword",
          detail: "Oracle sequence member",
        }),
      ]),
    );

    const tableMembers = oracleCatalogCompletion("SELECT APP.ORDERS.");
    expect(tableMembers.items.map((item) => item.label)).not.toContain(
      "NEXTVAL",
    );
    expect(tableMembers.items.map((item) => item.label)).not.toContain(
      "CURRVAL",
    );
  });

  it("complete_sql returns no Oracle catalog candidates for an empty catalog through real WASM", async () => {
    await initSqlParserCore();

    expect(
      oracleCatalogCompletion("SELECT * FROM APP.", {
        catalogDatabases: "",
        catalogSchemas: "",
        catalogObjects: "",
        catalogColumns: "",
        catalogFunctions: "",
      }).items,
    ).toEqual([]);
    expect(
      oracleCatalogCompletion("SELECT APP.ORDERS.", {
        catalogDatabases: "",
        catalogSchemas: "",
        catalogObjects: "",
        catalogColumns: "",
        catalogFunctions: "",
      }).items,
    ).toEqual([]);
    expect(
      oracleCatalogCompletion("SELECT APP.ORDER_SEQ.", {
        catalogDatabases: "",
        catalogSchemas: "",
        catalogObjects: "",
        catalogColumns: "",
        catalogFunctions: "",
      }).items.map((item) => item.label),
    ).not.toEqual(expect.arrayContaining(["NEXTVAL", "CURRVAL"]));
  });

  it("complete_sql returns relation catalog candidates, not psql commands, after FROM through real WASM", async () => {
    await initSqlParserCore();

    const result = completeSqlFromWasm(
      "SELECT * FROM ",
      14,
      14,
      "postgresql",
      "psql",
      "",
      "rev-catalog",
      "",
      "",
      "",
      "public\nanalytics",
      [
        "table\tpublic\tusers\tpublic.users",
        "view\tanalytics\tactive_users\tanalytics.active_users",
      ].join("\n"),
      "public\tusers\temail\tpublic.users",
      "public\tslugify\tpublic.slugify\ttext\ttext",
      "",
    ) as {
      items: Array<{
        label: string;
        kind: string;
        apply?: string;
        detail?: string;
      }>;
    };

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "public",
          kind: "schema",
          apply: "public",
        }),
        expect.objectContaining({
          label: "users",
          kind: "table",
          detail: "public",
        }),
        expect.objectContaining({
          label: "active_users",
          kind: "view",
          detail: "analytics",
        }),
      ]),
    );
    expect(result.items.map((item) => item.kind)).not.toContain("meta-command");
    expect(result.items.map((item) => item.kind)).not.toContain("column");
    expect(result.items.map((item) => item.kind)).not.toContain("function");
    expect(result.items.map((item) => item.kind)).not.toContain("keyword");
  });

  it("complete_sql returns empty relation completions for an empty catalog through real WASM", async () => {
    await initSqlParserCore();

    const result = completeSqlFromWasm(
      "SELECT * FROM ",
      14,
      14,
      "postgresql",
      "psql",
      "",
      "rev-empty-catalog",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ) as {
      items: Array<{
        label: string;
        kind: string;
      }>;
    };

    expect(result.items).toEqual([]);
  });
});

function mariaDbCompletionLabels(serverVersion: string): string[] {
  const result = completeSqlFromWasm(
    "RET",
    3,
    3,
    "mariadb",
    "mysql-client",
    serverVersion,
    "rev-mariadb",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ) as { items: Array<{ label: string }> };
  return result.items.map((item) => item.label);
}

function oracleCompletionLabels(prefix: string): string[] {
  const result = completeSqlFromWasm(
    prefix,
    prefix.length,
    prefix.length,
    "oracle",
    "none",
    "",
    "rev-oracle",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ) as { items: Array<{ label: string }> };
  return result.items.map((item) => item.label);
}

function oracleCatalogCompletion(
  text: string,
  catalog: {
    catalogDatabases?: string;
    catalogSchemas?: string;
    catalogObjects?: string;
    catalogColumns?: string;
    catalogFunctions?: string;
  } = {},
): {
  items: Array<{
    label: string;
    kind: string;
    detail?: string;
  }>;
} {
  return completeSqlFromWasm(
    text,
    text.length,
    text.length,
    "oracle",
    "none",
    "23ai",
    "rev-oracle-catalog",
    "",
    "",
    catalog.catalogDatabases ?? "FREEPDB1",
    catalog.catalogSchemas ?? "APP\tFREEPDB1",
    catalog.catalogObjects ??
      [
        "table\tAPP\tORDERS\tAPP.ORDERS\tFREEPDB1",
        "view\tAPP\tACTIVE_ORACLE_USERS\tAPP.ACTIVE_ORACLE_USERS\tFREEPDB1",
      ].join("\n"),
    catalog.catalogColumns ?? "APP\tORDERS\tORDER_ID\tAPP.ORDERS\tFREEPDB1",
    catalog.catalogFunctions ??
      [
        "APP\tCATALOG_API\tAPP.CATALOG_API\t\t\tFREEPDB1\tpackage\tPL/SQL",
        "APP\tORDER_SEQ\tAPP.ORDER_SEQ\tincrement 1, cache 20\tnext 101\tFREEPDB1\tsequence\tOracle sequence",
        "APP\tACTIVE_USERS_ALIAS\tAPP.ACTIVE_USERS_ALIAS\tAPP.ACTIVE_ORACLE_USERS\tAPP.ACTIVE_ORACLE_USERS\tFREEPDB1\tsynonym\tOracle synonym",
      ].join("\n"),
    "",
  ) as {
    items: Array<{
      label: string;
      kind: string;
      detail?: string;
    }>;
  };
}
