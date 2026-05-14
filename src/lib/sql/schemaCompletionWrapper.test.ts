import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  sql as sqlLanguage,
  StandardSQL,
  type SQLNamespace,
} from "@codemirror/lang-sql";
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

// Sprint 304 (2026-05-14) — column = table dup 해소 회귀 가드. lang-sql
// 의 schemaCompletionSource 는 ns top-level (= table) 을 모든 컨텍스트에서
// emit. 사용자 보고: column 이 두 번씩 popup 에 노출 (t / □ 아이콘). 본
// wrapper 가 cursor 가 column-only 자리이면 type === "type" 후보를 제거.

const SCHEMA: SQLNamespace = {
  // bare table name. lang-sql 이 emit 할 때 `type: "type"`.
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
    // table 후보가 그대로 surface
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
