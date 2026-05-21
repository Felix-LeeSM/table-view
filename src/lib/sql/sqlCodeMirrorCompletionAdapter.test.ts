import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import {
  buildSqlCompletionContext,
  type SqlCompletionCatalogStoreSnapshot,
} from "./sqlCompletionContext";
import {
  buildSqlCompletionRequestFromCodeMirror,
  sqlCompletionShadowSource,
} from "./sqlCodeMirrorCompletionAdapter";

const emptySnapshot = (): SqlCompletionCatalogStoreSnapshot => ({
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  tableColumnsCache: {},
});

function contextFor(text: string, pos = text.length): CompletionContext {
  return new CompletionContext(EditorState.create({ doc: text }), pos, true);
}

describe("sql CodeMirror completion adapter", () => {
  it("builds the WASM-ready SQL request from a CodeMirror context", () => {
    const completionContext = buildSqlCompletionContext({
      ...emptySnapshot(),
      connectionId: "conn1",
      database: "app",
      dbType: "postgresql",
      catalogRevision: "rev-1",
    });
    const text = "select 한😀 from users";
    const request = buildSqlCompletionRequestFromCodeMirror(
      contextFor(text, "select 한😀".length),
      completionContext,
    );

    expect(request).toMatchObject({
      language: "sql",
      dialect: "postgresql",
      text,
      cursor: { utf16: 10, utf8: 14 },
    });
    expect(request.catalog.revision).toBe("rev-1");
  });

  it("emits a shadow request without adding completion candidates", () => {
    const completionContext = buildSqlCompletionContext({
      ...emptySnapshot(),
      connectionId: "conn1",
      database: "app",
      dbType: "sqlite",
      catalogRevision: "sqlite-rev",
    });
    const onRequest = vi.fn();
    const source = sqlCompletionShadowSource({
      getCompletionContext: () => completionContext,
      onRequest,
    });

    const result = source(contextFor("select * from users where "));

    expect(result).toBeNull();
    expect(onRequest).toHaveBeenCalledOnce();
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        dialect: "sqlite",
        shell: "sqlite-cli",
        text: "select * from users where ",
      }),
    );
  });

  it("stays dormant until a completion context is available", () => {
    const onRequest = vi.fn();
    const source = sqlCompletionShadowSource({
      getCompletionContext: () => undefined,
      onRequest,
    });

    expect(source(contextFor("select "))).toBeNull();
    expect(onRequest).not.toHaveBeenCalled();
  });
});
