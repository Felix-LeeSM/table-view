import {
  CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  sql as sqlLanguage,
  StandardSQL,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import type { CompletionResult as CoreCompletionResult } from "@/lib/completion/coreContract";
import {
  buildSqlCompletionContext,
  type SqlCompletionCatalogStoreSnapshot,
} from "./sqlCompletionContext";
import { createSqlHybridCompletionSource } from "./sqlHybridCompletionSource";

const TEST_SCHEMA: SQLNamespace = {
  users: { id: {}, name: {}, email: {} },
};

const emptySnapshot = (): SqlCompletionCatalogStoreSnapshot => ({
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  tableColumnsCache: {},
});

function completionContext(
  dbType: "postgresql" | "mysql" | "sqlite" = "postgresql",
) {
  return buildSqlCompletionContext({
    ...emptySnapshot(),
    connectionId: "conn1",
    database: "app",
    dbType,
    catalogRevision: "rev-1",
  });
}

function codeMirrorContext(text: string, pos = text.length): CompletionContext {
  return new CompletionContext(
    EditorState.create({
      doc: text,
      extensions: [sqlLanguage({ dialect: StandardSQL })],
    }),
    pos,
    true,
  );
}

describe("createSqlHybridCompletionSource", () => {
  it("uses WASM candidates first when the core has parity output", async () => {
    const wasmResult: CoreCompletionResult = {
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
    const legacySource = vi.fn<CompletionSource>().mockReturnValue({
      from: 0,
      options: [{ label: "legacy", type: "keyword" }],
    });
    const completeWithPreloadedWasm = vi.fn().mockReturnValue(wasmResult);
    const completeWithWasm = vi.fn();

    const source = createSqlHybridCompletionSource({
      dialect: StandardSQL,
      getNamespace: () => TEST_SCHEMA,
      getCompletionContext: () => completionContext(),
      completeWithPreloadedWasm,
      completeWithWasm,
      legacySources: [legacySource],
    });

    await expect(source(codeMirrorContext("SEL"))).resolves.toMatchObject({
      from: 0,
      to: 3,
      options: [{ label: "SELECT", type: "keyword", apply: "SELECT" }],
    });
    expect(completeWithPreloadedWasm).toHaveBeenCalledOnce();
    expect(completeWithWasm).not.toHaveBeenCalled();
    expect(legacySource).not.toHaveBeenCalled();
  });

  it("keeps operator completions valid while typing operator prefixes", async () => {
    const wasmResult: CoreCompletionResult = {
      items: [{ label: "<->", kind: "operator", apply: "<->" }],
      replaceRange: {
        from: { utf16: 17, utf8: 17 },
        to: { utf16: 18, utf8: 18 },
      },
      incomplete: false,
      metadata: {
        engine: "wasm",
        dialect: "postgresql",
        shell: "psql",
        catalogRevision: "rev-1",
      },
    };
    const source = createSqlHybridCompletionSource({
      dialect: StandardSQL,
      getNamespace: () => TEST_SCHEMA,
      getCompletionContext: () => completionContext(),
      completeWithPreloadedWasm: vi.fn().mockReturnValue(wasmResult),
      completeWithWasm: vi.fn(),
    });

    const result = await source(codeMirrorContext("SELECT embedding <"));

    expect(result?.validFor).toBeInstanceOf(RegExp);
    const validFor = result?.validFor as RegExp;
    expect(validFor.test("<")).toBe(true);
    expect(validFor.test("<-")).toBe(true);
    expect(validFor.test("%")).toBe(true);
  });

  it("keeps MySQL backtick catalog completions valid while typing quoted identifiers", async () => {
    const wasmResult: CoreCompletionResult = {
      items: [
        { label: "UserAccounts", kind: "table", apply: "`UserAccounts`" },
      ],
      replaceRange: {
        from: { utf16: 14, utf8: 14 },
        to: { utf16: 19, utf8: 19 },
      },
      incomplete: false,
      metadata: {
        engine: "wasm",
        dialect: "mysql",
        shell: "mysql-client",
        catalogRevision: "rev-1",
      },
    };
    const source = createSqlHybridCompletionSource({
      dialect: StandardSQL,
      getNamespace: () => TEST_SCHEMA,
      getCompletionContext: () => completionContext("mysql"),
      completeWithPreloadedWasm: vi.fn().mockReturnValue(wasmResult),
      completeWithWasm: vi.fn(),
    });

    const result = await source(codeMirrorContext("SELECT * FROM `User"));

    expect(result?.validFor).toBeInstanceOf(RegExp);
    const validFor = result?.validFor as RegExp;
    expect(validFor.test("`User")).toBe(true);
    expect(validFor.test("`UserAccounts`")).toBe(true);
  });

  it("falls back to legacy TypeScript sources when WASM has no candidates", async () => {
    const emptyWasmResult: CoreCompletionResult = {
      items: [],
      replaceRange: {
        from: { utf16: 14, utf8: 14 },
        to: { utf16: 14, utf8: 14 },
      },
      incomplete: false,
      metadata: {
        engine: "wasm",
        dialect: "mysql",
        shell: "mysql-client",
        catalogRevision: "rev-1",
      },
    };
    const legacySource = vi.fn<CompletionSource>().mockReturnValue({
      from: 14,
      options: [{ label: "users", type: "type" }],
    });

    const source = createSqlHybridCompletionSource({
      dialect: StandardSQL,
      getNamespace: () => TEST_SCHEMA,
      getCompletionContext: () => completionContext("mysql"),
      completeWithPreloadedWasm: () => null,
      completeWithWasm: vi.fn().mockResolvedValue(emptyWasmResult),
      legacySources: [legacySource],
    });

    await expect(
      source(codeMirrorContext("SELECT * FROM ")),
    ).resolves.toMatchObject({
      from: 14,
      options: [{ label: "users", type: "type" }],
    });
    expect(legacySource).toHaveBeenCalledOnce();
  });

  it("keeps the legacy path when completion context has not loaded", async () => {
    const legacySource = vi.fn<CompletionSource>().mockReturnValue({
      from: 0,
      options: [{ label: "SELECT", type: "keyword" }],
    });
    const completeWithPreloadedWasm = vi.fn();

    const source = createSqlHybridCompletionSource({
      dialect: StandardSQL,
      getNamespace: () => TEST_SCHEMA,
      getCompletionContext: () => undefined,
      completeWithPreloadedWasm,
      legacySources: [legacySource],
    });

    await expect(source(codeMirrorContext("SEL"))).resolves.toMatchObject({
      options: [{ label: "SELECT", type: "keyword" }],
    });
    expect(completeWithPreloadedWasm).not.toHaveBeenCalled();
    expect(legacySource).toHaveBeenCalledOnce();
  });
});
