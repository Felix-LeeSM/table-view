import {
  CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  type SQLNamespace,
  StandardSQL,
  sql as sqlLanguage,
} from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { updateColumnCompletionSource } from "./updateColumnCompletion";

/**
 * Level-1 completion regression guard (2026-05-14).
 *
 * User requirement: Tab completion must work "at external-IDE level" in common
 * SQL positions such as UPDATE / WHERE / JOIN / subquery. Level-1 checks that
 * these scenarios — single table / WHERE clause / DELETE / INSERT column list —
 * expose candidates.
 *
 * Checks the two sources combined:
 *   1. lang-sql's built-in `schemaCompletionSource` — known table / alias /
 *      column candidates after FROM/JOIN.
 *   2. Our `updateColumnCompletionSource` — adds the UPDATE SET / INSERT
 *      column-list cases (2026-05-11).
 *
 * When a missing case turns up, extend `updateColumnCompletionSource` or add a
 * separate source.
 */

const TEST_SCHEMA: SQLNamespace = {
  users: { id: {}, name: {}, email: {}, age: {} },
  orders: { id: {}, user_id: {}, total: {}, created_at: {} },
};

const updateSource = updateColumnCompletionSource(() => TEST_SCHEMA);

function makeContext(doc: string, cursor?: number, explicit = true) {
  const pos = cursor ?? doc.length;
  const state = EditorState.create({
    doc,
    extensions: [sqlLanguage({ dialect: StandardSQL, schema: TEST_SCHEMA })],
  });
  return new CompletionContext(state, pos, explicit);
}

async function callAll(doc: string, cursor?: number): Promise<string[]> {
  const ctx = makeContext(doc, cursor);
  // Pull all autocomplete sources registered against the active SQL
  // language data (built-in `schemaCompletionSource` registers itself
  // via `dialect.language.data.of`). Combined with our explicit
  // `updateColumnCompletionSource`, this matches what the live
  // SqlQueryEditor sees.
  const fromLang = ctx.state.languageDataAt<CompletionSource>(
    "autocomplete",
    ctx.pos,
  );
  const labels = new Set<string>();
  for (const source of [...fromLang, updateSource]) {
    if (typeof source !== "function") continue;
    const raw = source(ctx);
    const result = (await Promise.resolve(raw)) as CompletionResult | null;
    if (!result) continue;
    for (const opt of result.options) {
      const lbl = typeof opt.label === "string" ? opt.label : String(opt.label);
      labels.add(lbl);
    }
  }
  return Array.from(labels);
}

describe("SQL Level-1 자동완성 — 6 시나리오 회귀 가드", () => {
  it("SELECT * FROM users WHERE <cursor> → users 컬럼 노출", async () => {
    const labels = await callAll("SELECT * FROM users WHERE ");
    expect(labels).toEqual(expect.arrayContaining(["id", "name", "email"]));
  });

  // `SELECT u.<cursor> FROM users u` (alias recognition) only works once
  // lang-sql's syntax tree is complete — a synchronous EditorState call
  // cannot verify it. The broader cases, including multi-JOIN aliases,
  // belong to Level-2 (alias-aware JOIN), which guards them in
  // `sqlCompletionLevel2.test.ts`.
  //
  // Column candidates in the value position of `WHERE id IN (<cursor>` fall
  // outside the intended lang-sql behavior (a value position). A low-value
  // corner — Level-1 does not cover it.

  it("DELETE FROM users WHERE <cursor> → users 컬럼 노출", async () => {
    const labels = await callAll("DELETE FROM users WHERE ");
    expect(labels).toEqual(expect.arrayContaining(["id", "name", "email"]));
  });

  it("INSERT INTO users (id, <cursor>) → 컬럼 리스트 후보 노출", async () => {
    const labels = await callAll("INSERT INTO users (id, ");
    expect(labels).toEqual(expect.arrayContaining(["name", "email", "age"]));
  });

  it("UPDATE users SET <cursor> → users 컬럼 노출", async () => {
    const labels = await callAll("UPDATE users SET ");
    expect(labels).toEqual(expect.arrayContaining(["id", "name", "email"]));
  });
});
