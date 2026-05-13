import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import {
  sql as sqlLanguage,
  StandardSQL,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { cteColumnCompletionSource } from "./cteColumnCompletion";

/**
 * Sprint 295 (2026-05-14) — Slice B — CTE / derived subquery column source.
 *
 * 작성 이유
 * --------
 * Slice A 의 8 RED (sqlCompletionLevel3.test.ts) 모두 lang-sql / sprint-292 /
 * sprint-294 합산만으로는 CTE / derived subquery 의 가상 컬럼을 풀지 못함을
 * 측정으로 확정. 이 source 는 그 gap 을 paren-depth 추적 mini-parser 로 메운다.
 *
 *   - `WITH t AS (SELECT id, name FROM users) SELECT t.<cursor>` → [id, name]
 *   - `SELECT s.<cursor> FROM (SELECT id FROM users) AS s` → [id]
 *
 * 본 파일은 source 자체의 단위 시나리오만 — happy path 4 (CTE single, CTE
 * multi, derived simple, derived AS) + guard 4 (점 앞, String 안, unknown
 * alias, getSchema undefined). Slice A 의 8 baseline 시나리오는
 * sqlCompletionLevel3.test.ts 에서 별도로 GREEN 검증 (`callAll` 합산).
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
  // 단일 CTE — `t` 의 가상 컬럼은 inner SELECT 의 projection [id, name].
  // mini-parser 가 `WITH t AS (SELECT id, name FROM users)` 패턴을 인식하고
  // paren-depth 로 inner SELECT 의 projection list 를 추출해야 함.
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
  // `WITH a AS (...), b AS (...) SELECT a.<cursor>` — 다중 CTE.
  // 첫 번째 alias 의 가상 컬럼이 추출되어야 함.
  it("CTE multi — WITH a AS (...), b AS (...) SELECT a.<cursor> → [id]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc =
      "WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
    // b 의 컬럼 (total) 는 alias `a` 의 후보에 섞이지 않아야 함.
    expect(labels).not.toContain("total");
  });

  // ── (3) Derived simple ──────────────────────────────────────────────
  // `SELECT sub.<cursor> FROM (SELECT id, total FROM orders) sub` — derived
  // subquery (no `AS` 키워드).
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
  // `SELECT s.<cursor> FROM (SELECT id FROM users) AS s` — derived subquery
  // + 명시적 `AS` keyword.
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

describe("cteColumnCompletionSource — Sprint 295 Slice B guards", () => {
  // ── guard (1) cursor 가 점 앞 → null ────────────────────────────────
  // 사용자가 alias 자체를 작성 중. column popup 이 뜨면 alias 입력을 방해.
  // sprint-292 / 294 의 가드 패턴 동일.
  it("guard: cursor 가 점 앞 (alias 작성 중) → null", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH t AS (SELECT id FROM users) SELECT t";
    const ctx = makeContext(doc, doc.length);
    expect(source(ctx)).toBeNull();
  });

  // ── guard (2) cursor 가 String literal 안 → null ─────────────────────
  // String literal 안의 `'t.x'` 같은 텍스트로 false positive 가 나면 안 됨.
  it("guard: cursor 가 String literal 안 → null", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH t AS (SELECT id FROM users) SELECT 't.' FROM users";
    // cursor 를 `'t.` 의 dot 다음 (String literal 안) 으로.
    const ctx = makeContext(
      doc,
      "WITH t AS (SELECT id FROM users) SELECT 't.".length,
    );
    expect(source(ctx)).toBeNull();
  });

  // ── guard (3) unknown virtual alias → null ──────────────────────────
  // alias dot 위치이지만 virtual table map 에 없음. 다른 source 가 처리할
  // 케이스이므로 본 source 는 false positive 회피.
  it("guard: unknown virtual alias (`xyz.` — CTE / derived 정의 없음) → null", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH t AS (SELECT id FROM users) SELECT xyz.";
    const ctx = makeContext(doc);
    expect(source(ctx)).toBeNull();
  });

  // ── guard (4) getSchema() undefined → null ──────────────────────────
  // sprint-292 / 294 패턴 복제 — namespace 미준비 / 레거시 flat list 시 null.
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
