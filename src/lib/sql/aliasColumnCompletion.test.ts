import { CompletionContext } from "@codemirror/autocomplete";
import {
  type SQLNamespace,
  StandardSQL,
  sql as sqlLanguage,
} from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { aliasColumnCompletionSource } from "./aliasColumnCompletion";

/**
 * Slice B — alias-aware mid-typing column source.
 *
 * Reason:
 *   The real gap the Slice A findings established — at the point where the
 *   user has typed only `SELECT u.` (FROM not yet entered), lang-sql's
 *   `getAliases` has no source to bind aliases to, so 0 candidates. DataGrip /
 *   TablePlus resolve a `FROM <table> <alias>` pattern anywhere in the buffer
 *   with an anywhere-scan, and expose column candidates even mid-typing.
 *
 *   This source copies the `updateColumnCompletionSource` guard pattern —
 *   `null` when the cursor is inside String/Number/LineComment/BlockComment,
 *   `null` when `getSchema()` is undefined or an array, `null` when the
 *   cursor is not at an `<alias>.<partial>` position. It first tries to match
 *   FROM/JOIN <table> <alias> inside the cursor's Statement, then extends the
 *   anywhere-scan to the other Statements in the buffer.
 *
 *   6 guard its (Slice B Done Criteria #3–#6 + happy path + dot-prefix-but-
 *   unknown-alias):
 *     1. happy path mid-typing — `SELECT u.` (FROM not entered) while another
 *        statement in the buffer has `FROM users u` → users columns exposed.
 *        The single-statement scenario `SELECT u. FROM users u` is handled by
 *        the same source.
 *     2. cursor just before the alias dot (before the period) → `null`.
 *     3. cursor inside a String → `null`.
 *     4. cursor inside a LineComment → `null`.
 *     5. unknown alias (`xyz.` with no `FROM ... xyz` anywhere) → `null`.
 *     6. `getSchema()` undefined / array → `null`.
 */

const TEST_SCHEMA: SQLNamespace = {
  users: { id: {}, name: {}, email: {}, age: {} },
  orders: { id: {}, user_id: {}, total: {}, created_at: {} },
  order_items: { id: {}, order_id: {}, product_id: {}, qty: {} },
  // schema-qualified — mimics Policy A (both bare and qualified keys).
  // Lookup must try both `public.users` and `users`.
  "public.users": { id: {}, name: {}, email: {}, age: {} },
};

function makeContext(doc: string, cursor?: number, explicit = true) {
  const pos = cursor ?? doc.length;
  const state = EditorState.create({
    doc,
    extensions: [sqlLanguage({ dialect: StandardSQL, schema: TEST_SCHEMA })],
  });
  return new CompletionContext(state, pos, explicit);
}

describe("aliasColumnCompletionSource (Sprint 294 Slice B)", () => {
  // ── (1) happy path — mid-typing flow ─────────────────────────────────
  // The user has typed only `SELECT u.`. lang-sql has no source to build an
  // alias map from, so 0 candidates. This source resolves the alias by
  // finding the `FROM users u` pattern in another statement of the same
  // buffer (or a future FROM of the same statement). The simplest happy-path
  // case — the alias already inside the same statement of the buffer
  // (`SELECT u. FROM users u`) — is handled by the same source.
  it("mid-typing: SELECT u.<cursor> (FROM 절이 같은 statement 에 있음) → users 컬럼 노출", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT u. FROM users u";
    const ctx = makeContext(doc, "SELECT u.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // ── (2) cursor just before the alias dot (before the period) → null ──
  // The user has typed up to `SELECT u` — still writing the alias itself.
  // Exposing column candidates would interfere with completing the alias.
  // `updateColumnCompletionSource` holds the same guard.
  it("guard: cursor 가 alias dot 직전 (점 앞) → null", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT u FROM users u";
    // Cursor right after `u` — the next char is a space, not a dot.
    const ctx = makeContext(doc, "SELECT u".length);
    expect(source(ctx)).toBeNull();
  });

  // ── (3) cursor inside a String → null ────────────────────────────────
  // Text inside a string literal that looks like an alias dot prefix
  // (`'u.x'`) must not produce column candidates.
  it("guard: cursor 가 String literal 안 → null", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT 'u.' FROM users u";
    // Cursor inside the string (after the dot of `'u.`).
    const ctx = makeContext(doc, "SELECT 'u.".length);
    expect(source(ctx)).toBeNull();
  });

  // ── (4) cursor inside a LineComment → null ───────────────────────────
  // No candidates inside a comment such as `-- u.`.
  it("guard: cursor 가 LineComment 안 → null", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "-- u.\nSELECT * FROM users u";
    const ctx = makeContext(doc, "-- u.".length);
    expect(source(ctx)).toBeNull();
  });

  // ── (5) unknown alias → null ─────────────────────────────────────────
  // An alias prefix with no `FROM ... xyz` anywhere in the buffer → avoids a
  // false positive (Slice B Done Criteria #3).
  it("guard: unknown alias (xyz. — buffer 에 FROM xyz 없음) → null", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT xyz. FROM users u";
    const ctx = makeContext(doc, "SELECT xyz.".length);
    expect(source(ctx)).toBeNull();
  });

  // ── (6) getSchema() undefined / array → null ─────────────────────────
  // Same pattern as `updateColumnCompletionSource` — columns cannot be
  // extracted when the namespace is not filled yet (undefined) or is in the
  // legacy flat completion list (array) form.
  it("guard: getSchema() undefined → null", () => {
    const source = aliasColumnCompletionSource(() => undefined);
    const doc = "SELECT u. FROM users u";
    const ctx = makeContext(doc, "SELECT u.".length);
    expect(source(ctx)).toBeNull();
  });

  it("guard: getSchema() 가 배열(레거시 flat list) → null", () => {
    const source = aliasColumnCompletionSource(() => [
      { label: "users", type: "type" },
    ]);
    const doc = "SELECT u. FROM users u";
    const ctx = makeContext(doc, "SELECT u.".length);
    expect(source(ctx)).toBeNull();
  });

  // ── (extra) the real target of the mid-typing flow — the scenario where
  // the FROM clause is not in the buffer yet. The alias in another statement
  // of the buffer must be resolved by anywhere-scan. 1:1 with spec's Slice B
  // target (typing only `SELECT u.`).
  it("mid-typing: SELECT u.<cursor> (단일 statement, FROM 미입력) — anywhere-scan 으로 풀려야", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    // Two statements: the first is mid-typing, the second holds FROM ... u.
    // Even with the cursor inside the first statement, the alias must be
    // resolved by anywhere-scan.
    const doc = "SELECT u.\n;\nSELECT * FROM users u";
    const ctx = makeContext(doc, "SELECT u.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });
});

/**
 * Slice D — edge case assertions.
 *
 * Reason:
 *   SQL that users actually write goes beyond the single-JOIN simple pattern
 *   — 3+ JOINs, schema-qualified targets (`public.users u`), explicit `AS`,
 *   the same alias appearing twice, quoted reserved-word aliases. Assert
 *   explicitly how each case behaves in the Slice B source to block
 *   regressions.
 */
describe("aliasColumnCompletionSource — Sprint 294 Slice D edge cases", () => {
  // ── (D1) 3+ JOINs ───────────────────────────────────────────────────
  it("multi-join 3+: FROM users u JOIN orders o JOIN order_items oi ON oi.<cursor> → order_items 컬럼", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc =
      "SELECT oi. FROM users u JOIN orders o JOIN order_items oi ON oi.id = o.id";
    const ctx = makeContext(doc, "SELECT oi.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "order_id", "product_id", "qty"]),
    );
  });

  // ── (D2) schema-qualified target ─────────────────────────────────────
  // In `FROM public.users u` the alias `u` looks up the `users` or
  // `public.users` namespace key. Compatible with Policy A, which tries both
  // bare and qualified.
  it("schema-qualified: FROM public.users u WHERE u.<cursor> → users 컬럼", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT u. FROM public.users u";
    const ctx = makeContext(doc, "SELECT u.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // ── (D3) explicit AS ──────────────────────────────────────────────────
  it("명시적 AS: FROM users AS u JOIN orders AS o ON o.<cursor> → orders 컬럼", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc =
      "SELECT o. FROM users AS u JOIN orders AS o ON o.user_id = u.id";
    const ctx = makeContext(doc, "SELECT o.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "user_id", "total", "created_at"]),
    );
  });

  // ── (D4) duplicate alias ─────────────────────────────────────────────
  // `FROM users u, orders u` — the same alias `u` bound to two tables. One
  // side's columns are exposed without a crash. The policy is
  // parseFromContext's last-wins (line 128 `aliases[aliasName] = tableName`)
  // — stated in the code comment.
  it("동일 alias 중복: FROM users u, orders u — crash 없이 어느 한쪽 컬럼 노출", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT u. FROM users u, orders u";
    const ctx = makeContext(doc, "SELECT u.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    // last-wins (parseFromContext policy) — orders columns are exposed.
    expect(labels).toEqual(
      expect.arrayContaining(["id", "user_id", "total", "created_at"]),
    );
  });

  // ── (D5) quoted reserved-word alias ──────────────────────────────────
  // `FROM users "from"` — the alias is a quoted reserved word.
  // parseFromContext's stripIdentifierQuotes unwraps `"from"` to `from` and
  // registers it in the alias map. Cursor alias recognition also tries both
  // quoted and unquoted.
  it('quoted alias: FROM users "from" — "from".<cursor> → users 컬럼', () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = 'SELECT "from". FROM users "from"';
    const ctx = makeContext(doc, 'SELECT "from".'.length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });
});

/**
 * Slice E — dedup regression guard.
 *
 * Reason:
 *   The column candidate labels `aliasColumnCompletionSource` emits must be
 *   free of duplicates within one call. Even when merged with lang-sql's
 *   built-in alias source, it should add no extra burden to CodeMirror
 *   autocompletion's dedup.
 */
describe("aliasColumnCompletionSource — Sprint 294 Slice E dedup", () => {
  it("한 호출의 후보 label 셋이 unique", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT u. FROM users u";
    const ctx = makeContext(doc, "SELECT u.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });

  it("multi-join 의 후보 label 셋도 unique (target alias 한 개)", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc =
      "SELECT oi. FROM users u JOIN orders o JOIN order_items oi ON oi.id = o.id";
    const ctx = makeContext(doc, "SELECT oi.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});
