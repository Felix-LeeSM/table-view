import { describe, expect, it } from "vitest";
import type { DatabaseType } from "@/types/connection";
import type { TableInfo } from "@/types/schema";
import {
  buildSqlCompletionContext,
  type SqlCompletionCatalogStoreSnapshot,
} from "./sqlCompletionContext";
import { buildSqlCompletionRequest } from "./sqlCompletionRequest";

const emptySnapshot = (): SqlCompletionCatalogStoreSnapshot => ({
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  tableColumnsCache: {},
});

const table = (schema: string, name: string): TableInfo => ({
  schema,
  name,
  row_count: null,
});

function requestFor(dbType: DatabaseType) {
  const snapshot = emptySnapshot();
  snapshot.tables.conn1 = {
    app: {
      main: [table("main", "users")],
    },
  };
  const ctx = buildSqlCompletionContext({
    ...snapshot,
    connectionId: "conn1",
    database: "app",
    dbType,
    serverVersion: "test-version",
    catalogRevision: `${dbType}-rev`,
  });
  return buildSqlCompletionRequest(
    "select 한😀 from users",
    "select 한😀".length,
    ctx,
  );
}

describe("buildSqlCompletionRequest", () => {
  it.each([
    ["postgresql", "postgres", "psql"],
    ["mysql", "mysql", "mysql-client"],
    ["mariadb", "mysql", "mysql-client"],
    ["sqlite", "sqlite", "sqlite-cli"],
  ] as const)(
    "builds one WASM-ready request shape for %s",
    (dbType, family, shell) => {
      const req = requestFor(dbType);

      expect(req).toMatchObject({
        language: "sql",
        dialect: dbType,
        family,
        shell,
        serverVersion: "test-version",
      });
      expect(req.cursor).toEqual({ utf16: 10, utf8: 14 });
      expect(req.catalog.revision).toBe(`${dbType}-rev`);
      expect(req.catalog.objects).toEqual([
        {
          kind: "table",
          schema: "main",
          name: "users",
          qualifiedName: "main.users",
          rowCount: null,
        },
      ]);
      expect(req.shellProfile.id).toBe(shell);
    },
  );

  it("keeps dialect capabilities and vocabulary on the request boundary", () => {
    const pg = requestFor("postgresql");
    const mysql = requestFor("mysql");
    const mariadb = requestFor("mariadb");
    const sqlite = requestFor("sqlite");

    expect(pg.capabilities.returning).toBe(true);
    expect(pg.capabilities.ilike).toBe(true);
    expect(pg.vocabulary.functions).toContain("DATE_TRUNC");

    expect(mysql.capabilities.limitOffsetComma).toBe(true);
    expect(mysql.capabilities.ilike).toBe(false);
    expect(mysql.capabilities.returning).toBe(false);
    expect(mysql.vocabulary.functions).toContain("JSON_EXTRACT");
    expect(mysql.vocabulary.functions).not.toContain("DATE_TRUNC");
    expect(mysql.vocabulary.keywords).not.toContain("RETURNING");

    expect(mariadb.capabilities.returning).toBe(true);
    expect(mariadb.capabilities.ilike).toBe(false);
    expect(mariadb.vocabulary.keywords).toContain("RETURNING");

    expect(sqlite.capabilities.onConflict).toBe(true);
    expect(sqlite.vocabulary.keywords).toContain("PRAGMA");
    expect(sqlite.shellProfile.commands).toContain(".tables");
  });

  it("preserves cache state so future providers can schedule background prefetch", () => {
    const req = requestFor("postgresql");

    expect(req.cacheState).toMatchObject({
      schemasLoaded: false,
      objectsLoaded: true,
      tablesLoaded: true,
      viewsLoaded: false,
      columnsLoaded: false,
      functionsLoaded: false,
    });
  });
});
