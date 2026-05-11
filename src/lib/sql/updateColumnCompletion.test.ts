import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import {
  sql as sqlLanguage,
  StandardSQL,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { updateColumnCompletionSource } from "./updateColumnCompletion";

// 2026-05-11 — 신규 source. UPDATE / INSERT INTO 의 SET / 컬럼 리스트
// 컨텍스트에서 컬럼 완성이 끊기던 버그(2026-05-11 user report) 의
// 회귀 가드. lang-sql 의 built-in `getAliases` 는 `FROM` 키워드만
// 인식하므로 별도 source 가 syntax tree 를 검사해 target table 을
// 직접 추출한다.

const TEST_SCHEMA: SQLNamespace = {
  users: { id: {}, name: {}, email: {}, age: {} },
  orders: { id: {}, user_id: {}, total: {} },
  "public.users": { id: {}, name: {}, email: {}, age: {} },
  // Quoted alias shape (matches what `useSqlAutocomplete` emits for
  // mixed-case identifiers).
  '"Users"': {
    self: { label: '"Users"', type: "type" },
    children: { id: {}, "Full Name": {} },
  },
};

function makeContext(doc: string, cursor?: number) {
  const pos = cursor ?? doc.length;
  const state = EditorState.create({
    doc,
    extensions: [sqlLanguage({ dialect: StandardSQL, schema: TEST_SCHEMA })],
  });
  return new CompletionContext(state, pos, /* explicit */ true);
}

describe("updateColumnCompletionSource", () => {
  it("offers column candidates inside UPDATE … SET <cursor>", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    const ctx = makeContext("UPDATE users SET ");
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  it("offers columns mid-identifier in UPDATE … SET na<cursor>", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "UPDATE users SET na";
    const ctx = makeContext(doc, doc.length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    // `from` should anchor at the start of `na`, not at the cursor,
    // so the user's partial identifier is replaced — not appended to.
    expect(result!.from).toBe(doc.length - 2);
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("name");
  });

  it("offers columns after WHERE in UPDATE statements", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    const ctx = makeContext("UPDATE users SET age = 30 WHERE ");
    const result = source(ctx);
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("id");
  });

  it("does NOT fire while typing the target table itself", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    // Cursor inside `users` — user is still picking the table.
    const ctx = makeContext("UPDATE use", 10);
    expect(source(ctx)).toBeNull();
  });

  it("does NOT fire inside string literals (value position)", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    const ctx = makeContext("UPDATE users SET name = 'al", 25);
    expect(source(ctx)).toBeNull();
  });

  it("does NOT fire for SELECT statements (default source handles)", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    const ctx = makeContext("SELECT  FROM users", 7);
    expect(source(ctx)).toBeNull();
  });

  it("resolves schema-qualified target table (UPDATE public.users SET …)", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    const ctx = makeContext("UPDATE public.users SET ");
    const result = source(ctx);
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("email");
  });

  it("resolves quoted mixed-case target table", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    const ctx = makeContext('UPDATE "Users" SET ');
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id", "Full Name"]));
  });

  it("offers column candidates inside INSERT INTO users (<cursor>)", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    const ctx = makeContext("INSERT INTO users (", 19);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  it("does NOT fire in the VALUES parens of INSERT", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    // Cursor inside the VALUES parens.
    const doc = "INSERT INTO users (id, name) VALUES (";
    const ctx = makeContext(doc, doc.length);
    expect(source(ctx)).toBeNull();
  });

  it("returns null when schema lookup misses the table", () => {
    const source = updateColumnCompletionSource(() => TEST_SCHEMA);
    const ctx = makeContext("UPDATE nonexistent_table SET ");
    expect(source(ctx)).toBeNull();
  });

  it("returns null when getSchema returns undefined (no schema loaded yet)", () => {
    const source = updateColumnCompletionSource(() => undefined);
    const ctx = makeContext("UPDATE users SET ");
    expect(source(ctx)).toBeNull();
  });

  it("returns null when getSchema returns an array (legacy flat completion list)", () => {
    const source = updateColumnCompletionSource(() => [
      { label: "users", type: "type" },
    ]);
    const ctx = makeContext("UPDATE users SET ");
    expect(source(ctx)).toBeNull();
  });
});
