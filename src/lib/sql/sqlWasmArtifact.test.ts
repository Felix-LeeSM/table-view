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
});
