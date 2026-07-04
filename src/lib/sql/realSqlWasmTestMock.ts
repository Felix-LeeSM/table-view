import { vi } from "vitest";

/**
 * Vitest mock factory for the wasm-pack-generated `sql_parser_core.js`
 * module that loads the REAL checked-in `.wasm` bytes via `initSync`.
 *
 * jsdom / node can't fetch the `new URL(..., import.meta.url)` `.wasm` path
 * the wasm-pack `--target web` glue uses, so tests whose subject drives the
 * parser through `parseSqlPreloaded` (e.g. the raw-result editability gate,
 * issue #1297) mock the module with this factory. Mirrors the inline mock in
 * `sqlWasmArtifact.test.ts`; extracted so multiple test files share one copy.
 *
 * Usage (the dynamic import keeps the factory hoist-safe):
 *
 *   vi.mock("@lib/sql/wasm/sql_parser_core.js", async () =>
 *     (await import("@lib/sql/realSqlWasmTestMock")).realSqlWasmModuleMock(),
 *   );
 *
 * `import.meta.url` resolves relative to THIS file (src/lib/sql/), so the
 * `.wasm` path is correct no matter where the importing test lives.
 */
export async function realSqlWasmModuleMock() {
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
}
