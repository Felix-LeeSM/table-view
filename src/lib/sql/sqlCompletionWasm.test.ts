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
      "rev-1",
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
