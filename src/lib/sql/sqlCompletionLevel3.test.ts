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
import { aliasColumnCompletionSource } from "./aliasColumnCompletion";
import { cteColumnCompletionSource } from "./cteColumnCompletion";
import { updateColumnCompletionSource } from "./updateColumnCompletion";

/**
 * Slice A — Level-3 baseline (CTE / derived subquery alias).
 *
 * Reason
 * ------
 * Opens the last external-IDE parity layer on top of Level-1 (single-table)
 * → Level-2 (alias-aware JOIN). DataGrip / TablePlus keep showing the virtual
 * columns of a virtual table (the projection list of a CTE, the projection
 * list of a derived subquery) in the Tab popup even after that virtual table
 * is introduced, as in `WITH t AS (SELECT id, name FROM users) SELECT
 * t.<cursor>` or `SELECT s.<cursor> FROM (SELECT id FROM users) s`. Users
 * expect the same flow.
 *
 * Why this file is a regression guard — when Slice B's new source (CTE /
 * derived) is added:
 *   1. Verify the already-GREEN scenarios (the ones the lang-sql built-ins +
 *      Level-1 + Level-2 sources already solve) do not break.
 *   2. Verify the scenarios that were RED until now transition exactly to
 *      GREEN.
 *
 * 8 baseline scenarios — 1:1 mapping to spec.md's Slice A AC #3:
 *   (a) `WITH t AS (SELECT id, name FROM users) SELECT t.<cursor>` → [id, name]
 *   (b) `WITH t AS (SELECT id, name FROM users) SELECT * FROM t WHERE t.<cursor>` → [id, name]
 *   (c) `WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.<cursor>` → [id]
 *   (d) same doc, `SELECT b.<cursor>` → [total]
 *   (e) `SELECT sub.<cursor> FROM (SELECT id, total FROM orders) sub` → [id, total]
 *   (f) `SELECT s.<cursor> FROM (SELECT id FROM users) AS s` → [id]
 *   (g) CTE + derived mix — `WITH t AS (SELECT id FROM users) SELECT t.<cursor> FROM t JOIN (SELECT total FROM orders) sub` → [id]
 *   (h) Derived nested — `SELECT outer.<cursor> FROM (SELECT id FROM (SELECT id FROM users) inner) outer` → [id]
 *
 * Measurement (as of 2026-05-14, lang-sql + Level-1 + Level-2 sources):
 *   - lang-sql's built-in `schemaCompletionSource` does not recognize the
 *     virtual tables and virtual columns of a CTE / derived subquery
 *     (real-schema lookup only).
 *   - `aliasColumnCompletionSource` handles only the case where the
 *     `<table>` of `FROM <table> [AS] <alias>` is a **base table** — cases
 *     that bring in a subquery, like `FROM (...) sub`, are not filtered by
 *     `parseFromContext`. The `WITH t AS (...)` of a CTE is likewise unknown.
 *   - All 8 scenarios are therefore **RED right now**. Each is marked
 *     explicitly with `it.fails(...)` → when Slice B introduces the new
 *     source (CTE / derived recognition), transition `it.fails` to `it`.
 *
 * `callAll` helper pattern
 * ------------------------
 * Copied **verbatim** from the `sqlCompletionLevel2.test.ts` pattern —
 * collect lang-sql's built-in sources with
 * `languageDataAt<CompletionSource>("autocomplete")` and add
 * `updateColumnCompletionSource` plus `aliasColumnCompletionSource`. Slice A
 * is a baseline measurement, so no extra source is called (Slice B introduces
 * the new source, and Slice C adds it to the `callAll` sum).
 */

const TEST_SCHEMA: SQLNamespace = {
  users: { id: {}, name: {}, email: {}, age: {} },
  orders: { id: {}, user_id: {}, total: {}, created_at: {} },
};

const updateSource = updateColumnCompletionSource(() => TEST_SCHEMA);
const aliasSource = aliasColumnCompletionSource(() => TEST_SCHEMA);
const cteSource = cteColumnCompletionSource(() => TEST_SCHEMA);

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
  // Same callAll pattern as sqlCompletionLevel2.test.ts:
  //   1. Collect lang-sql's built-in sources with `languageDataAt`.
  //   2. Add `updateColumnCompletionSource`.
  //   3. Add `aliasColumnCompletionSource`.
  //   4. Dedup every source's `options.label` into a Set and return it.
  // Slice A is a baseline measurement, so no extra source is called. Once
  // Slice C wires them, these sources are invoked automatically through the
  // dialect data, but here they are called explicitly for unit-test
  // isolation.
  const fromLang = ctx.state.languageDataAt<CompletionSource>(
    "autocomplete",
    ctx.pos,
  );
  const labels = new Set<string>();
  for (const source of [...fromLang, updateSource, aliasSource, cteSource]) {
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

describe("SQL Level-3 자동완성 — CTE / derived subquery baseline (Slice A 측정)", () => {
  // ──────────────────────────────────────────────────────────────────────
  // (a) `WITH t AS (SELECT id, name FROM users) SELECT t.<cursor>`
  //
  // Single CTE — `t` is a virtual table holding the columns (id, name). The
  // cursor at `SELECT t.` must emit those virtual columns.
  // Measurement: lang-sql's schemaCompletionSource does not recognize that
  // `t` is a CTE, so 0 candidates. The alias source also fails to find `t`'s
  // source table (the CTE definition does not match `parseFromContext`'s
  // `FROM <table> <alias>` pattern). → RED.
  it("(a) WITH t AS (SELECT id, name FROM users) SELECT t.<cursor> → [id, name]", async () => {
    const doc = "WITH t AS (SELECT id, name FROM users) SELECT t.";
    const labels = await callAll(doc);
    expect(labels).toEqual(expect.arrayContaining(["id", "name"]));
  });

  // (b) `WITH t AS (SELECT id, name FROM users) SELECT * FROM t WHERE t.<cursor>`
  //
  // The CTE's virtual table referenced in FROM, then an alias prefix in
  // WHERE. The alias source sees `FROM t` and tries `t` as a base table, but
  // `t` is not in the schema, so 0 candidates. → RED.
  it("(b) WITH t AS (...) SELECT * FROM t WHERE t.<cursor> → [id, name]", async () => {
    const doc =
      "WITH t AS (SELECT id, name FROM users) SELECT * FROM t WHERE t.";
    const labels = await callAll(doc);
    expect(labels).toEqual(expect.arrayContaining(["id", "name"]));
  });

  // (c) Multiple CTEs — `a` and `b` each derived from a different base table.
  //
  // `WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.<cursor>`
  // Measurement: neither CTE definition is picked up by the alias source. → RED.
  it("(c) WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.<cursor> → [id]", async () => {
    const doc =
      "WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.";
    const labels = await callAll(doc);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });

  // (d) Same doc, different cursor — `SELECT b.<cursor>` → orders's total.
  //
  // Verifies that the second CTE's virtual columns are emitted among several
  // CTE definitions.
  // Measurement: same reason → RED.
  it("(d) WITH a AS (...), b AS (SELECT total FROM orders) SELECT b.<cursor> → [total]", async () => {
    const doc =
      "WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT b.";
    const labels = await callAll(doc);
    expect(labels).toEqual(expect.arrayContaining(["total"]));
  });

  // (e) `SELECT sub.<cursor> FROM (SELECT id, total FROM orders) sub`
  //
  // Derived subquery (no CTE) — FROM takes a parenthesized SELECT followed
  // by an alias. Measurement: lang-sql's alias map does register `sub`, but
  // the table is unknown (a subquery), so there are no column candidates. The
  // alias source also fails, because `parseFromContext` does not recognize a
  // token starting with a paren as a base table. → RED.
  it("(e) SELECT sub.<cursor> FROM (SELECT id, total FROM orders) sub → [id, total]", async () => {
    const doc = "SELECT sub. FROM (SELECT id, total FROM orders) sub";
    const labels = await callAll(doc, "SELECT sub.".length);
    expect(labels).toEqual(expect.arrayContaining(["id", "total"]));
  });

  // (f) `SELECT s.<cursor> FROM (SELECT id FROM users) AS s`
  //
  // Derived subquery + explicit `AS` keyword. Same reason as (e) → RED.
  it("(f) SELECT s.<cursor> FROM (SELECT id FROM users) AS s → [id]", async () => {
    const doc = "SELECT s. FROM (SELECT id FROM users) AS s";
    const labels = await callAll(doc, "SELECT s.".length);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });

  // (g) CTE + derived mix.
  //
  // `WITH t AS (SELECT id FROM users) SELECT t.<cursor> FROM t JOIN (SELECT total FROM orders) sub`
  // The cursor sits at `SELECT t.` — the CTE `t`'s virtual column `id` should
  // come back.
  // Measurement: the CTE is not recognized → RED.
  it("(g) CTE + derived mix — WITH t AS (...) SELECT t.<cursor> FROM t JOIN (SELECT total FROM orders) sub → [id]", async () => {
    const doc =
      "WITH t AS (SELECT id FROM users) SELECT t. FROM t JOIN (SELECT total FROM orders) sub";
    const labels = await callAll(
      doc,
      "WITH t AS (SELECT id FROM users) SELECT t.".length,
    );
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });

  // (h) Derived nested.
  //
  // `SELECT outer.<cursor> FROM (SELECT id FROM (SELECT id FROM users) inner) outer`
  // The outermost derived subquery projects the single column `id`. Knowing
  // that the innermost source of the nesting is `users` requires paren-depth
  // tracking.
  // Measurement: the outermost alias `outer` also fails base-table matching → RED.
  it("(h) Derived nested — SELECT outer.<cursor> FROM (SELECT id FROM (SELECT id FROM users) inner) outer → [id]", async () => {
    const doc =
      "SELECT outer. FROM (SELECT id FROM (SELECT id FROM users) inner) outer";
    const labels = await callAll(doc, "SELECT outer.".length);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });
});

/**
 * Slice E — Cross-source dedup regression guard.
 *
 * Reason:
 *   When the 4 sources (lang-sql built-in + Level-1 + Level-2 + CTE /
 *   derived) are called at the same cursor position, a column label must not
 *   appear twice in the popup (`callAll`'s Set dedup absorbs this naturally).
 *   Also, when a CTE name collides with a real base table name, CTE / derived
 *   wins, so the base table's columns surface only once under the same label
 *   (CTE-wins policy).
 */
describe("SQL Level-3 자동완성 — Slice E cross-source dedup", () => {
  it("CTE 이름 = base table 이름 — popup dedup 후에도 라벨 셋이 unique", async () => {
    // `users` is a base table in the namespace. When a CTE of the same name
    // is introduced on top of it, lang-sql's built-in source also emits the
    // base table columns (name/email/age), so virtual + base columns surface
    // merged under the same prefix — that is lang-sql's intended behavior and
    // not something our sources can block. Our deliverables are (1) unique
    // labels after `callAll`'s Set dedup + (2) the CTE's virtual column
    // (`id`) not missing from the candidates.
    const doc =
      "WITH users AS (SELECT id FROM orders) SELECT users. FROM users";
    const labels = await callAll(
      doc,
      "WITH users AS (SELECT id FROM orders) SELECT users.".length,
    );
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });
});
