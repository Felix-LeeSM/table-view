import {
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  type SQLNamespace,
  StandardSQL,
  sql as sqlLanguage,
} from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { wrappedSchemaCompletionSource } from "./schemaCompletionWrapper";

async function resolveResult(
  value: CompletionResult | Promise<CompletionResult | null> | null | undefined,
): Promise<CompletionResult | null> {
  if (!value) return null;
  if (typeof (value as Promise<unknown>).then === "function") {
    return value as Promise<CompletionResult | null>;
  }
  return value as CompletionResult;
}

// Regression guard for the fix for column labels duplicated as table
// candidates (2026-05-14). For the background, see
// `wrappedSchemaCompletionSource` in `src/lib/sql/schemaCompletionWrapper.ts`.
// The wrapper removes type === "type" candidates when the cursor is at a
// column-only position.

const SCHEMA: SQLNamespace = {
  // Bare table name. lang-sql emits it with `type: "type"`.
  users: { id: {}, name: {}, email: {} },
  orders: { id: {}, user_id: {}, total: {} },
  // schema-qualified.
  "public.users": { id: {}, name: {}, email: {} },
};

function makeContext(doc: string, cursor?: number) {
  const pos = cursor ?? doc.length;
  const state = EditorState.create({
    doc,
    extensions: [sqlLanguage({ dialect: StandardSQL, schema: SCHEMA })],
  });
  return new CompletionContext(state, pos, /* explicit */ true);
}

describe("wrappedSchemaCompletionSource", () => {
  it("WHERE 자리에서 table 후보 (type=type) 제거", async () => {
    const source = wrappedSchemaCompletionSource(() => SCHEMA, StandardSQL);
    const ctx = makeContext("SELECT * FROM users WHERE ");
    const result = await resolveResult(source(ctx));
    expect(result).not.toBeNull();
    const typeOptions = result!.options.filter((o) => o.type === "type");
    expect(typeOptions).toEqual([]);
  });

  it("SET 자리 (UPDATE) 에서 table 후보 제거", async () => {
    const source = wrappedSchemaCompletionSource(() => SCHEMA, StandardSQL);
    const ctx = makeContext("UPDATE users SET ");
    const result = await resolveResult(source(ctx));
    if (result) {
      const typeOptions = result.options.filter((o) => o.type === "type");
      expect(typeOptions).toEqual([]);
    }
  });

  it("FROM 자리에서 table 후보 유지", async () => {
    const source = wrappedSchemaCompletionSource(() => SCHEMA, StandardSQL);
    const ctx = makeContext("SELECT * FROM ");
    const result = await resolveResult(source(ctx));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    // Table candidates surface unchanged
    expect(labels).toEqual(expect.arrayContaining(["users", "orders"]));
  });

  it("JOIN 자리에서 table 후보 유지", async () => {
    const source = wrappedSchemaCompletionSource(() => SCHEMA, StandardSQL);
    const ctx = makeContext("SELECT * FROM users JOIN ");
    const result = await resolveResult(source(ctx));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["users", "orders"]));
  });

  it("getSchema 가 undefined 면 null", async () => {
    const source = wrappedSchemaCompletionSource(() => undefined, StandardSQL);
    const ctx = makeContext("SELECT * FROM users WHERE ");
    const result = await resolveResult(source(ctx));
    expect(result).toBeNull();
  });
});
