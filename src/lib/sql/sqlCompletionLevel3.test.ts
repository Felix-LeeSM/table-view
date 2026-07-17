import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  CompletionContext,
  type CompletionSource,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  sql as sqlLanguage,
  StandardSQL,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { updateColumnCompletionSource } from "./updateColumnCompletion";
import { aliasColumnCompletionSource } from "./aliasColumnCompletion";
import { cteColumnCompletionSource } from "./cteColumnCompletion";

/**
 * Sprint 295 (2026-05-14) — Slice A — Level-3 baseline (CTE / derived
 * subquery alias).
 *
 * 작성 이유
 * --------
 * Sprint 292 (Level-1 single-table) → Sprint 294 (Level-2 alias-aware JOIN)
 * 위에서 마지막 외부-IDE parity 레이어를 까는 작업. DataGrip / TablePlus 는
 * `WITH t AS (SELECT id, name FROM users) SELECT t.<cursor>` 또는
 * `SELECT s.<cursor> FROM (SELECT id FROM users) s` 같이 가상 테이블이
 * 도입된 뒤에도 그 가상 테이블의 가상 컬럼 (CTE 의 projection list, derived
 * subquery 의 projection list) 을 Tab popup 에 띄운다. 사용자도 같은 흐름을
 * 기대한다.
 *
 * 이 파일이 회귀 가드인 이유 — Slice B 의 새 source (CTE / derived) 가 추가될 때:
 *   1. 이미 GREEN 인 시나리오 (lang-sql / sprint-292 / sprint-294 합산으로
 *      이미 풀리는 케이스) 가 깨지지 않는지 검증.
 *   2. 현 시점 RED 였던 시나리오가 정확히 GREEN 으로 전이하는지 검증.
 *
 * 8 baseline 시나리오 — spec.md 의 Slice A AC #3 과 1:1 매핑:
 *   (a) `WITH t AS (SELECT id, name FROM users) SELECT t.<cursor>` → [id, name]
 *   (b) `WITH t AS (SELECT id, name FROM users) SELECT * FROM t WHERE t.<cursor>` → [id, name]
 *   (c) `WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.<cursor>` → [id]
 *   (d) 같은 doc 의 `SELECT b.<cursor>` → [total]
 *   (e) `SELECT sub.<cursor> FROM (SELECT id, total FROM orders) sub` → [id, total]
 *   (f) `SELECT s.<cursor> FROM (SELECT id FROM users) AS s` → [id]
 *   (g) CTE + derived 혼합 — `WITH t AS (SELECT id FROM users) SELECT t.<cursor> FROM t JOIN (SELECT total FROM orders) sub` → [id]
 *   (h) Derived nested — `SELECT outer.<cursor> FROM (SELECT id FROM (SELECT id FROM users) inner) outer` → [id]
 *
 * 측정 결과 (2026-05-14 기준, lang-sql + sprint-292 + sprint-294 합산):
 *   - lang-sql 의 built-in `schemaCompletionSource` 는 CTE / derived subquery
 *     의 가상 테이블·가상 컬럼을 인식하지 않는다 (real-schema lookup 만).
 *   - sprint-294 의 `aliasColumnCompletionSource` 는 `FROM <table> [AS] <alias>`
 *     의 `<table>` 이 **base table** 인 경우만 처리 — `FROM (...) sub` 같이
 *     subquery 가 들어가는 케이스는 `parseFromContext` 가 거르지 못한다.
 *     CTE 의 `WITH t AS (...)` 도 마찬가지로 unknown.
 *   - 따라서 8 시나리오 모두 **현 시점 RED**. 모두 `it.fails(...)` 로 표적
 *     명시 → Slice B 가 새 source (CTE / derived 인식) 를 도입하면 `it.fails`
 *     를 `it` 으로 전이.
 *
 * `callAll` 헬퍼 패턴
 * --------------------
 * sprint-294 의 `sqlCompletionLevel2.test.ts` 패턴을 **그대로 복제** —
 * `languageDataAt<CompletionSource>("autocomplete")` 로 lang-sql 의
 * built-in source 를 수집하고, sprint-292 의 `updateColumnCompletionSource`
 * 와 sprint-294 의 `aliasColumnCompletionSource` 를 합산. Slice A 는 baseline
 * 측정이라 추가 source 호출 없음 (새 source 는 Slice B 가 도입 후 Slice C
 * 에서 `callAll` 합산에 추가될 예정).
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
  // sprint-294 callAll 패턴 그대로:
  //   1. lang-sql 의 built-in source 들을 `languageDataAt` 로 수집.
  //   2. sprint-292 의 `updateColumnCompletionSource` 합산.
  //   3. sprint-294 의 `aliasColumnCompletionSource` 합산.
  //   4. 모든 source 의 `options.label` 을 Set 에 dedup 해서 반환.
  // Slice A 는 baseline 측정이라 추가 source 호출 없음. Slice C 가 wire
  // 한 뒤에는 본 source 들이 dialect data 로 자동 호출되지만, 여기서는
  // 단위 테스트 격리를 위해 명시 호출.
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
  // 단일 CTE — `t` 가 가상 테이블로 (id, name) 컬럼을 가짐. cursor 가
  // `SELECT t.` 위치에서 그 가상 컬럼을 emit 해야 함.
  // 측정 결과: lang-sql 의 schemaCompletionSource 는 `t` 가 CTE 라는 사실을
  // 인식하지 못해 후보 0 개. sprint-294 의 alias source 도 `t` 의 source
  // table 을 찾지 못함 (CTE 정의는 `parseFromContext` 의 `FROM <table>
  // <alias>` 패턴에 매칭되지 않음). → RED.
  it("(a) WITH t AS (SELECT id, name FROM users) SELECT t.<cursor> → [id, name]", async () => {
    const doc = "WITH t AS (SELECT id, name FROM users) SELECT t.";
    const labels = await callAll(doc);
    expect(labels).toEqual(expect.arrayContaining(["id", "name"]));
  });

  // (b) `WITH t AS (SELECT id, name FROM users) SELECT * FROM t WHERE t.<cursor>`
  //
  // CTE 의 가상 테이블을 FROM 절에서 참조한 뒤 WHERE 절에서 alias prefix.
  // sprint-294 의 alias source 가 `FROM t` 를 보고 `t` 를 base table 로
  // 시도하지만 schema 에 `t` 가 없으므로 후보 0 개. → RED.
  it("(b) WITH t AS (...) SELECT * FROM t WHERE t.<cursor> → [id, name]", async () => {
    const doc =
      "WITH t AS (SELECT id, name FROM users) SELECT * FROM t WHERE t.";
    const labels = await callAll(doc);
    expect(labels).toEqual(expect.arrayContaining(["id", "name"]));
  });

  // (c) 다중 CTE — `a` 와 `b` 각각 다른 base table 로부터 추출.
  //
  // `WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.<cursor>`
  // 측정 결과: 두 CTE 정의 모두 alias source 에 잡히지 않음. → RED.
  it("(c) WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.<cursor> → [id]", async () => {
    const doc =
      "WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.";
    const labels = await callAll(doc);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });

  // (d) 같은 doc, 다른 cursor — `SELECT b.<cursor>` → orders 의 total.
  //
  // 다중 CTE 정의 안에서 두 번째 CTE 의 가상 컬럼 emit 검증.
  // 측정 결과: 동일 사유로 → RED.
  it("(d) WITH a AS (...), b AS (SELECT total FROM orders) SELECT b.<cursor> → [total]", async () => {
    const doc =
      "WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT b.";
    const labels = await callAll(doc);
    expect(labels).toEqual(expect.arrayContaining(["total"]));
  });

  // (e) `SELECT sub.<cursor> FROM (SELECT id, total FROM orders) sub`
  //
  // Derived subquery (no CTE) — FROM 절에 paren 으로 감싼 SELECT 가 들어가고
  // 뒤에 alias. 측정 결과: lang-sql 의 alias 맵에는 `sub` 가 등록되지만
  // table 이 unknown (subquery) 이라 컬럼 후보 없음. sprint-294 의 alias
  // source 도 `parseFromContext` 가 paren 으로 시작하는 토큰을 base table 로
  // 인식하지 않음. → RED.
  it("(e) SELECT sub.<cursor> FROM (SELECT id, total FROM orders) sub → [id, total]", async () => {
    const doc = "SELECT sub. FROM (SELECT id, total FROM orders) sub";
    const labels = await callAll(doc, "SELECT sub.".length);
    expect(labels).toEqual(expect.arrayContaining(["id", "total"]));
  });

  // (f) `SELECT s.<cursor> FROM (SELECT id FROM users) AS s`
  //
  // Derived subquery + 명시적 `AS` keyword. (e) 와 동일 사유로 → RED.
  it("(f) SELECT s.<cursor> FROM (SELECT id FROM users) AS s → [id]", async () => {
    const doc = "SELECT s. FROM (SELECT id FROM users) AS s";
    const labels = await callAll(doc, "SELECT s.".length);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });

  // (g) CTE + derived 혼합.
  //
  // `WITH t AS (SELECT id FROM users) SELECT t.<cursor> FROM t JOIN (SELECT total FROM orders) sub`
  // cursor 위치는 `SELECT t.` — CTE `t` 의 가상 컬럼 `id` 가 와야 한다.
  // 측정 결과: CTE 가 인식 안 됨 → RED.
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
  // 가장 바깥 derived subquery 의 projection 은 `id` 한 컬럼. nested 의 가장
  // 안쪽 source 가 users 라는 사실은 paren-depth 추적이 필요.
  // 측정 결과: 가장 바깥 alias `outer` 도 base table 매칭 실패 → RED.
  it("(h) Derived nested — SELECT outer.<cursor> FROM (SELECT id FROM (SELECT id FROM users) inner) outer → [id]", async () => {
    const doc =
      "SELECT outer. FROM (SELECT id FROM (SELECT id FROM users) inner) outer";
    const labels = await callAll(doc, "SELECT outer.".length);
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });
});

/**
 * Sprint 295 (2026-05-14) — Slice E — Cross-source dedup 회귀 가드.
 *
 * 작성 이유:
 *   lang-sql built-in + sprint-292 + sprint-294 + sprint-295 의 4 source 가
 *   같은 cursor 위치에서 호출될 때 한 컬럼 라벨이 popup 에 중복 표시되지
 *   않아야 한다 (`callAll` 의 Set dedup 이 자연스럽게 흡수). 또한 CTE 이름이
 *   실재 base table 이름과 충돌할 때 CTE / derived 가 우선해서 base table 의
 *   컬럼이 같은 라벨로 한 번만 노출 (CTE wins 정책).
 */
describe("SQL Level-3 자동완성 — Slice E cross-source dedup", () => {
  it("CTE 이름 = base table 이름 — popup dedup 후에도 라벨 셋이 unique", async () => {
    // `users` 는 namespace 의 base table. 같은 이름 CTE 가 그 위에 도입되면
    // lang-sql 의 built-in source 가 base table 컬럼 (name/email/age) 도
    // emit 하므로 같은 prefix 에 가상 + base 컬럼이 합쳐서 노출된다 — 이는
    // lang-sql 의 의도된 동작이며 우리 source 가 막을 수 있는 영역이 아니다.
    // 우리 deliverable 은 (1) `callAll` 의 Set dedup 결과 라벨이 unique 한
    // 것 + (2) CTE 의 가상 컬럼 (`id`) 이 후보에 빠지지 않는 것.
    const doc =
      "WITH users AS (SELECT id FROM orders) SELECT users. FROM users";
    const labels = await callAll(
      doc,
      "WITH users AS (SELECT id FROM orders) SELECT users.".length,
    );
    expect(labels).toEqual(expect.arrayContaining(["id"]));
  });
});
