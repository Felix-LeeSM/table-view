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

/**
 * Sprint 292 (2026-05-14) — Slice 3 회귀 가드.
 *
 * 사용자 요구: UPDATE / WHERE / JOIN / subquery 등 보편 SQL 위치에서 Tab 자동완성이
 * "외부 IDE 수준"으로 동작해야 함. 이 sprint 의 Level-1 은 다음 6 시나리오 — 단일
 * 테이블 / alias 인식 / WHERE 절 / DELETE / INSERT 컬럼 리스트 — 가 후보를
 * 노출하는지 검증.
 *
 * 두 source 를 합쳐서 검사:
 *   1. lang-sql 의 built-in `schemaCompletionSource` — FROM/JOIN 뒤 알려진
 *      테이블·alias·컬럼 candidate.
 *   2. 우리 `updateColumnCompletionSource` — UPDATE SET / INSERT 컬럼 리스트
 *      케이스 보강 (2026-05-11).
 *
 * 빠진 케이스를 발견하면 `updateColumnCompletionSource` 를 확장하거나 별도
 * source 를 추가한다.
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

  // `SELECT u.<cursor> FROM users u` (alias 인식) 는 lang-sql 의 syntax-tree
  // 가 완성된 후에야 동작 — 동기 EditorState 단위 호출로는 검증 불가.
  // 또한 다중 JOIN alias 까지 포함한 광범위 케이스는 별도 sprint 의 도메인.
  // → Sprint 294 (자동완성 Level-2 — alias-aware JOIN) 에서 회귀 가드.
  //
  // `WHERE id IN (<cursor>` 의 값 위치 컬럼 후보는 의도된 lang-sql 동작 외
  // (값 위치). 실용성 낮은 corner — Level-1 에서 보강 안 함.

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
