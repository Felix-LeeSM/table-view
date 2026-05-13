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

describe("Sprint 295 Slice D edge cases", () => {
  /**
   * Sprint 295 (2026-05-14) — Slice D edge cases.
   *
   * 작성 이유
   * --------
   * Slice B 의 mini-parser 는 happy path 4 + guard 4 만 GREEN. 외부 IDE
   * (DataGrip / TablePlus) parity 를 위해 다음 7 변형이 실전에서 자주 등장:
   *   D1. inner SELECT * — 그 컬럼은 inner FROM 의 base table 의 컬럼이 되어야.
   *   D2. inner SELECT 안의 JOIN — alias-prefixed `u.id` 의 컬럼 이름만 추출.
   *   D3. 명시적 `AS` in projection — Slice B 에서 이미 처리, 단언 추가.
   *   D4. schema-qualified inner table — sprint-294 의 dotted-identifier
   *       coalescing 재사용.
   *   D5. WITH RECURSIVE — `name(col, ...)` explicit column list 인식.
   *   D6. alias 충돌 — CTE / derived wins.
   *   D7. CTE 체이닝 1단계 — b 가 a 를 참조하면 a 의 컬럼 inherit.
   * 본 describe 는 그 7 변형을 한 곳에서 회귀 가드한다 (each → 단일 단언).
   */

  // ── D1 SELECT * 폴백 ────────────────────────────────────────────────
  // inner SELECT 의 projection 이 `*` 단일 토큰 → mini-parser 가 inner
  // FROM 의 base table 을 namespace 로 fallback lookup 해서 해당 컬럼을
  // 가상 컬럼으로 채택. namespace 에 users={id,name,email,age} 가 있으므로
  // `t` 의 가상 컬럼은 그 4 개.
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

  // ── D2 CTE 안의 JOIN — alias-prefixed projection ────────────────────
  // `SELECT u.id, o.total FROM users u JOIN orders o ON ...` 형태에서
  // projection 의 `u.id` → `id`, `o.total` → `total` 만 추출 (alias prefix
  // 는 가상 컬럼에 포함되지 않음). Slice B 의 projectionItemName 이
  // 이미 마지막 identifier 를 채택하지만 JOIN 패턴 회귀 가드를 명시.
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

  // ── D3 명시적 AS in projection ──────────────────────────────────────
  // Slice B 의 projectionItemName 이 이미 `<expr> AS <alias>` → `alias`
  // 처리. 단언만 추가해서 edge 그룹에 회귀 가드.
  it("D3 explicit AS — WITH t AS (SELECT id AS uid, name AS uname FROM users) SELECT t.<cursor> → [uid, uname]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc =
      "WITH t AS (SELECT id AS uid, name AS uname FROM users) SELECT t.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["uid", "uname"]));
    // 원본 컬럼명 (id / name) 은 가상 alias 의 후보에 포함되면 안 됨.
    expect(labels).not.toContain("id");
    expect(labels).not.toContain("name");
  });

  // ── D4 schema-qualified inner table ─────────────────────────────────
  // SELECT * 폴백 시 inner FROM 의 dotted identifier `public.users` 도
  // sprint-294 coalescing 으로 정상 인식되어야 함. namespace 의 `users`
  // 키와 lookup 시 마지막 segment (`users`) 를 사용해 매칭.
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
  // PostgreSQL 의 `WITH RECURSIVE n(x) AS (...)` 패턴 — explicit column
  // list `(x)` 가 가상 컬럼을 결정. SELECT 본문 (UNION ALL 의 set-op
  // chain) 은 본 Sprint 의 범위 밖이지만 explicit list 가 있으면 안전.
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

  // ── D6 alias 충돌 — CTE wins ─────────────────────────────────────────
  // namespace 에 base table `users` 가 있음. 동시에 CTE 도 `users` 라는
  // 이름으로 정의. cursor 가 `SELECT users.<cursor>` 일 때 본 source 가
  // CTE 의 가상 컬럼 (orders.id) 을 emit 해야 함 (base table 의 컬럼이
  // 아니라). 본 source 가 우선 emit 하면 popup 의 dedup 결과는 CTE wins.
  it("D6 alias conflict — WITH users AS (SELECT id FROM orders) SELECT users.<cursor> → CTE 의 [id]", () => {
    const source = cteColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "WITH users AS (SELECT id FROM orders) SELECT users.";
    const ctx = makeContext(doc);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
    // base table users 의 다른 컬럼 (name, email, age) 은 CTE 의
    // projection 에 없으므로 가상 컬럼에 섞이면 안 됨.
    expect(labels).not.toContain("name");
    expect(labels).not.toContain("email");
    expect(labels).not.toContain("age");
  });

  // ── D7 CTE 체이닝 1단계 — b 가 a 참조 → a 컬럼 inherit ────────────────
  // `WITH a AS (SELECT id FROM users), b AS (SELECT * FROM a) SELECT b.<cursor>`
  // b 의 inner SELECT * 는 b 가 a 를 참조하므로 a 의 가상 컬럼을 그대로
  // 물려받아야 함. 단일 단계만 지원 — 더 깊은 재귀는 안전한 null (out of
  // scope of sprint-295).
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
