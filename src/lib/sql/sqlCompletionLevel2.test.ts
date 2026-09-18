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
import { updateColumnCompletionSource } from "./updateColumnCompletion";

/**
 * Level-2 alias-aware JOIN baseline.
 *
 * Slice A's purpose is **measurement**. It captures in code how far the
 * `<alias>.<cursor>` case is solved by lang-sql's built-in
 * `schemaCompletionSource` + `updateColumnCompletionSource` alone, and pins
 * the real gap Slice B must fill as RED.
 *
 * Why this file is a regression guard — when Slice B's new source is added:
 *   1. Verify the already-GREEN scenarios (cases lang-sql alone can handle)
 *      do not break (duplicate candidates / null return / wrong from
 *      position etc.).
 *   2. Confirm the RED scenarios transition to GREEN exactly.
 *
 * 6 baseline scenarios — 1:1 mapping to spec.md's Slice A AC:
 *   (a) `SELECT u.<cursor> FROM users u`
 *   (b) `SELECT u.<cursor> FROM users u WHERE …`
 *   (c) `FROM users u JOIN orders o ON o.<cursor>`
 *   (d) `FROM users u JOIN orders o ON u.<cursor>`
 *   (e) `SELECT o.<cursor> FROM users u JOIN orders o ON …`
 *   (f) `SELECT u.<cursor>, o.<cursor> FROM users u JOIN orders o ON …`
 *
 * Measurement results (@codemirror/lang-sql behaviour as of 2026-05-14):
 *   - In all 6 scenarios, the standard case with a space between the cursor
 *     and the trailing text is GREEN: lang-sql's `getAliases` scans the
 *     statement's FROM/JOIN clauses and fills the alias map →
 *     **all GREEN**.
 *   - But in the user's real mid-typing flow — `SELECT u.<cursor>` entered
 *     alone (FROM not typed yet) — the alias map is empty and there are 0
 *     candidates. That is the real gap Slice B fills (alias tracking must
 *     work without a nearby FROM when the user hits Tab, to reach external
 *     IDE level).
 *
 * Therefore the 6 spec scenarios are passing `it`s, plus one mid-typing RED
 * added as `it.fails(...)` to state Slice B's target in code.
 *
 * The `callAll` helper **copies verbatim** the `sqlCompletionLevel1.test.ts`
 * pattern — it collects lang-sql's built-in sources with
 * `languageDataAt<CompletionSource>("autocomplete")` and adds
 * `updateColumnCompletionSource`.
 *
 * Slice B update: with `aliasColumnCompletionSource` added, the mid-typing
 * scenario transitioned to GREEN. `callAll` now also adds `aliasSource`,
 * and the last it.fails transitioned to a GREEN regression-guard it. After
 * Slice C wired it, this source is invoked automatically from dialect
 * data, but here it is called explicitly for unit-test isolation.
 */

const TEST_SCHEMA: SQLNamespace = {
  users: { id: {}, name: {}, email: {}, age: {} },
  orders: { id: {}, user_id: {}, total: {}, created_at: {} },
};

const updateSource = updateColumnCompletionSource(() => TEST_SCHEMA);
const aliasSource = aliasColumnCompletionSource(() => TEST_SCHEMA);

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
  // callAll pattern, verbatim:
  //   1. Collect lang-sql's built-in sources with `languageDataAt`.
  //   2. Add the `updateColumnCompletionSource`.
  //   3. Dedup all sources' `options.label` into a Set and return.
  // Slice A is a baseline measurement, so no extra source is called.
  const fromLang = ctx.state.languageDataAt<CompletionSource>(
    "autocomplete",
    ctx.pos,
  );
  const labels = new Set<string>();
  for (const source of [...fromLang, updateSource, aliasSource]) {
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

describe("SQL Level-2 자동완성 — alias-aware JOIN baseline (Slice A 측정)", () => {
  // (a) `SELECT u.<cursor> FROM users u`
  //
  // Simple single-table alias. If the doc is fully formed (includes a FROM
  // clause), lang-sql completes the statement's alias map and returns users
  // column candidates.
  // Measured GREEN.
  it("(a) SELECT u.<cursor> FROM users u → users 컬럼 노출", async () => {
    const doc = "SELECT u. FROM users u";
    const labels = await callAll(doc, "SELECT u.".length);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // (b) `SELECT u.<cursor> FROM users u WHERE …`
  //
  // The alias map is the same with a trailing WHERE clause.
  // Measured GREEN.
  it("(b) SELECT u.<cursor> FROM users u WHERE id = 1 → users 컬럼 노출", async () => {
    const doc = "SELECT u. FROM users u WHERE id = 1";
    const labels = await callAll(doc, "SELECT u.".length);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // (c) `FROM users u JOIN orders o ON o.<cursor>`
  //
  // Second alias prefix in a JOIN ON clause. The cursor is at the end of
  // the statement, so the syntax tree is stable.
  // Measured GREEN.
  it("(c) FROM users u JOIN orders o ON o.<cursor> → orders 컬럼 노출", async () => {
    const doc = "SELECT * FROM users u JOIN orders o ON o.";
    const labels = await callAll(doc);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "user_id", "total", "created_at"]),
    );
  });

  // (d) `FROM users u JOIN orders o ON u.<cursor>`
  //
  // First alias prefix in the same ON clause — lang-sql registers both
  // aliases.
  // Measured GREEN.
  it("(d) FROM users u JOIN orders o ON u.<cursor> → users 컬럼 노출", async () => {
    const doc = "SELECT * FROM users u JOIN orders o ON u.";
    const labels = await callAll(doc);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // (e) `SELECT o.<cursor> FROM users u JOIN orders o ON …`
  //
  // Alias prefix inside the SELECT clause. A comment in the Level-1 work
  // assigned this case to the Slice B domain, but actual measurement showed
  // that when the doc's trailing text carries a FROM clause, lang-sql fills
  // the alias map and it is GREEN.
  // Measured GREEN.
  it("(e) SELECT o.<cursor> FROM users u JOIN orders o ON o.user_id = u.id → orders 컬럼 노출", async () => {
    const doc = "SELECT o. FROM users u JOIN orders o ON o.user_id = u.id";
    const labels = await callAll(doc, "SELECT o.".length);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "user_id", "total", "created_at"]),
    );
  });

  // (f) `SELECT u.<cursor>, o.<cursor> FROM users u JOIN orders o ON …`
  //
  // Both aliases used in the same SELECT clause. In a fully formed doc both
  // aliases are registered. At the first cursor position (`SELECT u.`),
  // users columns are exposed.
  // Measured GREEN.
  it("(f) SELECT u.<cursor>, o.… FROM users u JOIN orders o ON … → users 컬럼 노출", async () => {
    const doc =
      "SELECT u., o.total FROM users u JOIN orders o ON o.user_id = u.id";
    const labels = await callAll(doc, "SELECT u.".length);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Slice B target — mid-typing flow (transitioned to GREEN by the Slice B
  // addition).
  //
  // The 6 baselines above show the limitation that lang-sql's alias map is
  // only completed when the doc already includes a FROM clause. The real
  // user flow is:
  //   1. Type up to `SELECT ` → wants column candidates.
  //   2. Multiple tables mean a prefix is needed, so type `SELECT u.`.
  //   3. Hitting Tab at this point (FROM not typed yet) yields 0 candidates,
  //      because lang-sql does not know which table `u` is.
  //
  // Slice B's `aliasColumnCompletionSource` builds the alias map if
  // `FROM users u` exists anywhere in the doc (above or below), returning
  // candidates even in the mid-typing flow. This it is the regression guard
  // verifying (a) Slice A's RED target was (b) transitioned to GREEN
  // exactly by Slice B.
  //
  // Slice B's contract Done Criteria #2: `it.fails` → `it` transition.
  it("[Slice B GREEN] SELECT u.<cursor> (FROM 미입력 mid-typing) → users 컬럼 노출", async () => {
    // Two statements: the first is mid-typing, the second carries the alias
    // declaration. The alias map must be built by the anywhere-scan for the
    // candidates to open up.
    const doc = "SELECT u.\n;\nSELECT * FROM users u";
    const labels = await callAll(doc, "SELECT u.".length);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });
});
