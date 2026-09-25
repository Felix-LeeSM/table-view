import { CompletionContext } from "@codemirror/autocomplete";
import {
  type SQLNamespace,
  StandardSQL,
  sql as sqlLanguage,
} from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { cteColumnCompletionSource } from "./cteColumnCompletion";

/**
 * Slice B — CTE / derived subquery column source.
 *
 * Reason
 * ------
 * All 8 REDs of Slice A (sqlCompletionLevel3.test.ts) confirmed by
 * measurement that the lang-sql / Level-1 / Level-2 sum alone cannot resolve
 * the virtual columns of a CTE / derived subquery. This source fills that gap
 * with a paren-depth tracking mini-parser.
 *
 *   - `WITH t AS (SELECT id, name FROM users) SELECT t.<cursor>` → [id, name]
 *   - `SELECT s.<cursor> FROM (SELECT id FROM users) AS s` → [id]
 *
 * This file holds only the source's own unit scenarios — 4 happy paths (CTE
 * single, CTE multi, derived simple, derived AS) + 4 guards (before the dot,
 * inside a String, unknown alias, getSchema undefined). Slice A's 8 baseline
 * scenarios are verified GREEN separately in sqlCompletionLevel3.test.ts
 * (`callAll` sum).
 */

const TEST_SCHEMA: SQLNamespace = {
  users: { id: {}, name: {}, email: {}, age: {} },
  orders: { id: {}, user_id: {}, total: {}, created_at: {} },
};

function makeContext(doc: string, cursor?: number, explicit = true) {
  const pos = cursor ?? doc.length;
  const state = EditorState.create({
    doc,
    extensions: [sqlLanguage({ dialect: StandardSQL, schema: TEST_SCHEMA })],
  });
  return new CompletionContext(state, pos, explicit);
}

describe("cteColumnCompletionSource — Sprint 295 Slice B happy paths", () => {
  // ── (1) CTE single ──────────────────────────────────────────────────
  // Single CTE — `t`'s virtual columns are the inner SELECT's projection
  // [id, name]. The mini-parser must recognize the
  // `WITH t AS (SELECT id, name FROM users)` pattern and extract the inner
  // SELECT's projection list by paren-depth.
  it("CTE single — WITH t AS (SELECT id, name FROM users) SELECT t.<cursor> → [id, name]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH t AS (SELECT id, name FROM users) SELECT t.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id", "name"]));
  });

  // ── (2) CTE multi (comma-separated) ─────────────────────────────────
  // `WITH a AS (...), b AS (...) SELECT a.<cursor>` — multiple CTEs. The
  // first alias's virtual columns must be extracted.
  it("CTE multi — WITH a AS (...), b AS (...) SELECT a.<cursor> → [id]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc =
      "WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
    // b's column (total) must not leak into alias `a`'s candidates.
    expect(labels).not.toContain("total");
  });

  // ── (3) Derived simple ──────────────────────────────────────────────
  // `SELECT sub.<cursor> FROM (SELECT id, total FROM orders) sub` — a derived
  // subquery (no `AS` keyword).
  it("Derived simple — SELECT sub.<cursor> FROM (SELECT id, total FROM orders) sub → [id, total]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT sub. FROM (SELECT id, total FROM orders) sub";
    const ctx = makeContext(doc, "SELECT sub.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id", "total"]));
  });

  // ── (4) Derived AS ───────────────────────────────────────────────────
  // `SELECT s.<cursor> FROM (SELECT id FROM users) AS s` — a derived subquery
  // + explicit `AS` keyword.
  it("Derived AS — SELECT s.<cursor> FROM (SELECT id FROM users) AS s → [id]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT s. FROM (SELECT id FROM users) AS s";
    const ctx = makeContext(doc, "SELECT s.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });
});

describe("Sprint 295 Slice D edge cases", () => {
  /**
   * Slice D edge cases.
   *
   * Reason
   * ------
   * Slice B's mini-parser is GREEN only for the 4 happy paths + 4 guards.
   * For parity with external IDEs (DataGrip / TablePlus), these 7 variants
   * come up often in practice:
   *   D1. inner SELECT * — its columns must become the columns of the inner
   *       FROM's base table.
   *   D2. a JOIN inside the inner SELECT — extract only the column name of an
   *       alias-prefixed `u.id`.
   *   D3. explicit `AS` in the projection — already handled in Slice B; adds
   *       an assertion.
   *   D4. schema-qualified inner table — reuses the dotted-identifier
   *       coalescing of the alias source.
   *   D5. WITH RECURSIVE — recognize the `name(col, ...)` explicit column
   *       list.
   *   D6. alias conflict — CTE / derived wins.
   *   D7. one step of CTE chaining — when b references a, b inherits a's
   *       columns.
   * This describe guards those 7 variants in one place (each → a single
   * assertion).
   */

  // ── D1 SELECT * fallback ────────────────────────────────────────────
  // The inner SELECT's projection is the single token `*` → the mini-parser
  // falls back to looking up the inner FROM's base table in the namespace and
  // adopts those columns as virtual columns. The namespace has
  // users={id,name,email,age}, so `t`'s virtual columns are those 4.
  it("D1 SELECT * — WITH t AS (SELECT * FROM users) SELECT t.<cursor> → users 의 모든 컬럼", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH t AS (SELECT * FROM users) SELECT t.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // ── D2 JOIN inside a CTE — alias-prefixed projection ────────────────
  // In the shape `SELECT u.id, o.total FROM users u JOIN orders o ON ...`,
  // extract only `u.id` → `id` and `o.total` → `total` from the projection
  // (the alias prefix is not part of the virtual column). Slice B's
  // projectionItemName already adopts the last identifier; this pins the JOIN
  // pattern against regression.
  it("D2 CTE inner JOIN — projection 의 tbl.col 에서 col 만 추출", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc =
      "WITH t AS (SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id) SELECT t.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id", "total"]));
  });

  // ── D3 explicit AS in projection ────────────────────────────────────
  // Slice B's projectionItemName already handles `<expr> AS <alias>` →
  // `alias`. Only the assertion is added, guarding the edge group.
  it("D3 explicit AS — WITH t AS (SELECT id AS uid, name AS uname FROM users) SELECT t.<cursor> → [uid, uname]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc =
      "WITH t AS (SELECT id AS uid, name AS uname FROM users) SELECT t.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["uid", "uname"]));
    // The original column names (id / name) must not appear among the
    // virtual aliases' candidates.
    expect(labels).not.toContain("id");
    expect(labels).not.toContain("name");
  });

  // ── D4 schema-qualified inner table ─────────────────────────────────
  // On the SELECT * fallback, the inner FROM's dotted identifier
  // `public.users` must also be recognized through the alias source's
  // coalescing. Match against the namespace's `users` key by using the last
  // segment (`users`) at lookup.
  it("D4 schema-qualified inner table — WITH t AS (SELECT * FROM public.users) SELECT t.<cursor> → users 컬럼", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH t AS (SELECT * FROM public.users) SELECT t.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id", "name"]));
  });

  // ── D5 WITH RECURSIVE explicit column list ─────────────────────────
  // PostgreSQL's `WITH RECURSIVE n(x) AS (...)` pattern — the explicit
  // column list `(x)` decides the virtual columns. The SELECT body (the
  // UNION ALL set-op chain) is out of scope here, but with an explicit list
  // present the result is safe.
  it("D5 WITH RECURSIVE — explicit column list `n(x)` 인식 → [x]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc =
      "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 10) SELECT n.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["x"]));
  });

  // ── D6 alias conflict — CTE wins ────────────────────────────────────
  // The namespace has the base table `users`, and a CTE is also defined
  // named `users`. When the cursor is at `SELECT users.<cursor>`, this source
  // must emit the CTE's virtual column (orders.id), not the base table's
  // columns. Since this source emits first, the popup's dedup outcome is CTE
  // wins.
  it("D6 alias conflict — WITH users AS (SELECT id FROM orders) SELECT users.<cursor> → CTE 의 [id]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH users AS (SELECT id FROM orders) SELECT users.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
    // The base table users' other columns (name, email, age) are not in the
    // CTE's projection, so they must not mix into the virtual columns.
    expect(labels).not.toContain("name");
    expect(labels).not.toContain("email");
    expect(labels).not.toContain("age");
  });

  // ── D7 one step of CTE chaining — b references a → inherits a's columns ──
  // `WITH a AS (SELECT id FROM users), b AS (SELECT * FROM a) SELECT b.<cursor>`
  // b's inner SELECT * references a, so b must inherit a's virtual columns
  // as-is. Only a single step is supported — deeper recursion yields a safe
  // null (out of scope here).
  it("D7 CTE 체이닝 — WITH a AS (SELECT id FROM users), b AS (SELECT * FROM a) SELECT b.<cursor> → [id]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc =
      "WITH a AS (SELECT id FROM users), b AS (SELECT * FROM a) SELECT b.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });
});

describe("cteColumnCompletionSource — Sprint 295 Slice B guards", () => {
  // ── guard (1) cursor before the dot → null ──────────────────────────
  // The user is still writing the alias itself. A column popup would
  // interfere with typing the alias. Same guard pattern as the Level-1 /
  // Level-2 sources.
  it("guard: cursor 가 점 앞 (alias 작성 중) → null", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH t AS (SELECT id FROM users) SELECT t";
    const ctx = makeContext(doc, doc.length);
    expect(source(ctx)).toBeNull();
  });

  // ── guard (2) cursor inside a String literal → null ─────────────────
  // Text like `'t.x'` inside a string literal must not produce a false
  // positive.
  it("guard: cursor 가 String literal 안 → null", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH t AS (SELECT id FROM users) SELECT 't.' FROM users";
    // Cursor after the dot of `'t.` (inside the String literal).
    const ctx = makeContext(
      doc,
      "WITH t AS (SELECT id FROM users) SELECT 't.".length,
    );
    expect(source(ctx)).toBeNull();
  });

  // ── guard (3) unknown virtual alias → null ──────────────────────────
  // The cursor is at an alias dot, but the virtual table map has no entry.
  // Other sources handle that case, so this source avoids a false
  // positive.
  it("guard: unknown virtual alias (`xyz.` — CTE / derived 정의 없음) → null", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH t AS (SELECT id FROM users) SELECT xyz.";
    const ctx = makeContext(doc);
    expect(source(ctx)).toBeNull();
  });

  // ── guard (4) getSchema() undefined → null ──────────────────────────
  // Same pattern as the Level-1 / Level-2 sources — null when the namespace
  // is not ready or is a legacy flat list.
  it("guard: getSchema() undefined → null", () => {
    const source = cteColumnCompletionSource(() => undefined);
    const doc = "WITH t AS (SELECT id FROM users) SELECT t.";
    const ctx = makeContext(doc);
    expect(source(ctx)).toBeNull();
  });

  it("guard: getSchema() 가 배열 (legacy flat list) → null", () => {
    const source = cteColumnCompletionSource(() => [
      { label: "users", type: "type" },
    ]);
    const doc = "WITH t AS (SELECT id FROM users) SELECT t.";
    const ctx = makeContext(doc);
    expect(source(ctx)).toBeNull();
  });
});
