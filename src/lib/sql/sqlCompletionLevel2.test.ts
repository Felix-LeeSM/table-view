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

/**
 * Sprint 294 (2026-05-14) — Level-2 alias-aware JOIN baseline.
 *
 * Slice A 의 목적은 **측정**. lang-sql 의 built-in `schemaCompletionSource` +
 * sprint-292 `updateColumnCompletionSource` 만으로 `<alias>.<cursor>` 케이스가
 * 어디까지 풀리는지 코드로 캡처해, Slice B 가 채워야 하는 진짜 gap 을 RED 로
 * 못박는다.
 *
 * 이 파일이 회귀 가드인 이유 — Slice B 의 새 source 가 추가될 때:
 *   1. 이미 GREEN 인 시나리오 (lang-sql 단독으로 처리 가능한 케이스) 가
 *      깨지지 않는지 (중복 후보 / null 반환 / 잘못된 from 위치 등) 검증.
 *   2. RED 였던 시나리오가 GREEN 으로 정확히 전이하는지 확인.
 *
 * 6 baseline 시나리오 — spec.md 의 Slice A AC 와 1:1 매핑:
 *   (a) `SELECT u.<cursor> FROM users u`
 *   (b) `SELECT u.<cursor> FROM users u WHERE …`
 *   (c) `FROM users u JOIN orders o ON o.<cursor>`
 *   (d) `FROM users u JOIN orders o ON u.<cursor>`
 *   (e) `SELECT o.<cursor> FROM users u JOIN orders o ON …`
 *   (f) `SELECT u.<cursor>, o.<cursor> FROM users u JOIN orders o ON …`
 *
 * 측정 결과 (2026-05-14 기준 @codemirror/lang-sql 동작):
 *   - 6 시나리오 모두 cursor 와 후속 텍스트 사이에 공백이 있는 표준 케이스는
 *     lang-sql 의 `getAliases` 가 statement 의 FROM/JOIN 절을 스캔해 alias
 *     맵을 채워주므로 → **모두 GREEN**.
 *   - 그러나 사용자의 실제 mid-typing 흐름 — `SELECT u.<cursor>` 만 입력된
 *     상태 (아직 FROM 안 옴) — 에서는 alias 맵이 비어 후보가 0 개. 이게
 *     Slice B 가 채울 진짜 gap (현장 사용자가 Tab 을 눌렀을 때 인접 FROM
 *     없이도 alias 추적이 가능해야 외부 IDE 수준).
 *
 * 따라서 6 spec 시나리오는 통과 it 으로, 그 위에 mid-typing RED 1 건을
 * `it.fails(...)` 로 추가해 Slice B 의 표적을 코드로 명시했다.
 *
 * `callAll` 헬퍼는 sprint-292 의 `sqlCompletionLevel1.test.ts` 패턴을
 * **그대로 복제** — `languageDataAt<CompletionSource>("autocomplete")` 로
 * lang-sql built-in source 를 수집하고 `updateColumnCompletionSource` 를
 * 합산.
 *
 * Sprint 294 Slice B (2026-05-14) 업데이트: `aliasColumnCompletionSource`
 * 가 추가됨에 따라 mid-typing 시나리오가 GREEN 으로 전이. `callAll` 에
 * `aliasSource` 합산을 추가하고, 마지막 it.fails 는 GREEN 회귀 가드 it 으로
 * 전이. Slice C 가 wire 한 뒤에는 본 source 가 dialect data 로 자동 호출
 * 되지만, 여기서는 단위 테스트 격리를 위해 명시 호출.
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
  // sprint-292 callAll 패턴 그대로:
  //   1. lang-sql 의 built-in source 들을 `languageDataAt` 로 수집.
  //   2. sprint-292 의 `updateColumnCompletionSource` 합산.
  //   3. 모든 source 의 `options.label` 을 Set 에 dedup 해서 반환.
  // Slice A 는 baseline 측정이라 추가 source 호출 없음.
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
  // 단순 단일 테이블 alias. doc 가 fully-formed (FROM 절 포함) 이면 lang-sql
  // 이 statement 의 alias 맵을 완성해 users 컬럼 후보를 돌려준다.
  // 측정 결과 GREEN.
  it("(a) SELECT u.<cursor> FROM users u → users 컬럼 노출", async () => {
    const doc = "SELECT u. FROM users u";
    const labels = await callAll(doc, "SELECT u.".length);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // (b) `SELECT u.<cursor> FROM users u WHERE …`
  //
  // WHERE 절이 뒤따라도 alias 맵은 동일. 측정 결과 GREEN.
  it("(b) SELECT u.<cursor> FROM users u WHERE id = 1 → users 컬럼 노출", async () => {
    const doc = "SELECT u. FROM users u WHERE id = 1";
    const labels = await callAll(doc, "SELECT u.".length);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // (c) `FROM users u JOIN orders o ON o.<cursor>`
  //
  // JOIN ON 절에서 두 번째 alias prefix. cursor 가 statement 끝이라
  // syntax-tree 가 안정. 측정 결과 GREEN.
  it("(c) FROM users u JOIN orders o ON o.<cursor> → orders 컬럼 노출", async () => {
    const doc = "SELECT * FROM users u JOIN orders o ON o.";
    const labels = await callAll(doc);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "user_id", "total", "created_at"]),
    );
  });

  // (d) `FROM users u JOIN orders o ON u.<cursor>`
  //
  // 같은 ON 절에서 첫 번째 alias prefix — lang-sql 이 두 alias 모두 등록.
  // 측정 결과 GREEN.
  it("(d) FROM users u JOIN orders o ON u.<cursor> → users 컬럼 노출", async () => {
    const doc = "SELECT * FROM users u JOIN orders o ON u.";
    const labels = await callAll(doc);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // (e) `SELECT o.<cursor> FROM users u JOIN orders o ON …`
  //
  // SELECT 절 안의 alias prefix. Sprint 292 의 코멘트가 이 케이스를
  // sprint-294 도메인으로 명시했으나 실제 측정에서는 doc 의 후속 텍스트가
  // FROM 절을 가지면 lang-sql 이 alias 맵을 채워 GREEN.
  // 측정 결과 GREEN.
  it("(e) SELECT o.<cursor> FROM users u JOIN orders o ON o.user_id = u.id → orders 컬럼 노출", async () => {
    const doc = "SELECT o. FROM users u JOIN orders o ON o.user_id = u.id";
    const labels = await callAll(doc, "SELECT o.".length);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "user_id", "total", "created_at"]),
    );
  });

  // (f) `SELECT u.<cursor>, o.<cursor> FROM users u JOIN orders o ON …`
  //
  // 같은 SELECT 절에 두 alias 모두 사용. fully-formed doc 에서는 두 alias
  // 모두 등록. 첫 cursor 위치 (`SELECT u.`) 에서 users 컬럼 노출.
  // 측정 결과 GREEN.
  it("(f) SELECT u.<cursor>, o.… FROM users u JOIN orders o ON … → users 컬럼 노출", async () => {
    const doc =
      "SELECT u., o.total FROM users u JOIN orders o ON o.user_id = u.id";
    const labels = await callAll(doc, "SELECT u.".length);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Slice B 표적 — mid-typing flow (Sprint 294 Slice B 보강으로 GREEN 전이).
  //
  // 위 6 baseline 은 doc 가 FROM 절을 이미 포함해야 lang-sql 의 alias 맵이
  // 완성되는 한계를 보여준다. 실제 사용자 흐름은:
  //   1. `SELECT ` 까지 입력 → 컬럼 후보 보고 싶음.
  //   2. 테이블이 여러 개라 prefix 가 필요해 `SELECT u.` 입력.
  //   3. 이 시점에 Tab 을 누르면 (FROM 아직 미입력) lang-sql 은 `u` 가
  //      어떤 테이블인지 모르므로 후보 0 개.
  //
  // Slice B 의 `aliasColumnCompletionSource` 는 doc 안 어디든 (위 또는 아래)
  // `FROM users u` 가 있으면 alias 맵을 구성해 mid-typing 흐름에서도 후보를
  // 돌려준다. 이 it 은 (a) Slice A 시점의 RED 표적을 (b) Slice B 가 정확히
  // GREEN 으로 전이시켰는지 검증하는 회귀 가드.
  //
  // Slice B 의 contract Done Criteria #2: `it.fails` → `it` 전이.
  it("[Slice B GREEN] SELECT u.<cursor> (FROM 미입력 mid-typing) → users 컬럼 노출", async () => {
    // 두 statement: 첫 번째는 mid-typing, 두 번째에 alias 선언이 있음.
    // anywhere-scan 으로 alias map 을 구성해야 후보가 풀린다.
    const doc = "SELECT u.\n;\nSELECT * FROM users u";
    const labels = await callAll(doc, "SELECT u.".length);
    expect(labels).toEqual(
      expect.arrayContaining(["id", "name", "email", "age"]),
    );
  });
});
