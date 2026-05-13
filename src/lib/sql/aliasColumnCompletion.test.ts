import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import {
  sql as sqlLanguage,
  StandardSQL,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { aliasColumnCompletionSource } from "./aliasColumnCompletion";

/**
 * Sprint 294 (2026-05-14) — Slice B — alias-aware mid-typing column source.
 *
 * 작성 이유:
 *   Slice A 의 findings (`docs/sprints/sprint-294/slice-A-findings.md`) 가
 *   확정한 진짜 gap — 사용자가 `SELECT u.` 까지만 입력한 시점 (FROM 절 아직
 *   미입력) — 에서는 lang-sql 의 `getAliases` 가 alias 를 바인딩할 source 가
 *   없어 후보 0 개. DataGrip / TablePlus 는 buffer 어딘가의 `FROM <table>
 *   <alias>` 패턴을 anywhere-scan 으로 풀어 mid-typing 흐름에서도 컬럼
 *   후보를 노출한다.
 *
 *   이 source 는 sprint-292 의 `updateColumnCompletionSource` 가드 패턴을
 *   복제 — cursor 가 String/Number/LineComment/BlockComment 안이면 `null`,
 *   `getSchema()` 가 undefined/배열이면 `null`, cursor 가 `<alias>.<partial>`
 *   위치가 아니면 `null`. cursor 의 Statement 안에서 FROM/JOIN <table> <alias>
 *   매칭 시도 후, 없으면 buffer 의 다른 Statement 로 anywhere-scan 확장.
 *
 *   6 가드 it (Slice B Done Criteria #3–#6 + happy path + dot-prefix-but-
 *   unknown-alias):
 *     1. happy path mid-typing — `SELECT u.` (FROM 미입력) 인데 buffer 다른
 *        statement 에 `FROM users u` 있음 → users 컬럼 노출. 단일 statement
 *        시나리오인 `SELECT u. FROM users u` 도 같은 source 가 처리.
 *     2. cursor 가 alias dot 직전 (점 앞) → `null`.
 *     3. cursor 가 String 안 → `null`.
 *     4. cursor 가 LineComment 안 → `null`.
 *     5. unknown alias (`xyz.` 인데 어디에도 `FROM ... xyz` 없음) → `null`.
 *     6. `getSchema()` undefined / 배열 → `null`.
 */

const TEST_SCHEMA: SQLNamespace = {
  users: { id: {}, name: {}, email: {}, age: {} },
  orders: { id: {}, user_id: {}, total: {}, created_at: {} },
  order_items: { id: {}, order_id: {}, product_id: {}, qty: {} },
  // schema-qualified — sprint-268 의 Policy A (bare + qualified 둘 다 키)
  // 를 흉내. lookup 시 `public.users` / `users` 둘 다 시도해야 함.
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
  // 사용자가 `SELECT u.` 만 친 시점. lang-sql 은 alias 맵을 만들 source 가
  // 없어 0 후보. 이 source 는 같은 buffer 의 다른 statement (또는 같은
  // statement 의 미래 FROM) 에서 `FROM users u` 패턴을 찾아 alias 를
  // resolve. happy path 시나리오로 가장 단순한 case — buffer 의 같은
  // statement 안에 alias 가 이미 있음 (`SELECT u. FROM users u`) — 도
  // 동일 source 가 처리한다.
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

  // ── (2) cursor 가 alias dot 직전 (점 앞) → null ────────────────────
  // 사용자가 `SELECT u` 까지 입력 — alias 자체를 작성 중. column 후보를
  // 노출하면 alias 자체 완성을 방해. sprint-292 가 동일 가드 보유.
  it("guard: cursor 가 alias dot 직전 (점 앞) → null", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT u FROM users u";
    // cursor 가 `u` 바로 뒤 — 다음 char 는 공백, dot 아님.
    const ctx = makeContext(doc, "SELECT u".length);
    expect(source(ctx)).toBeNull();
  });

  // ── (3) cursor 가 String 안 → null ───────────────────────────────────
  // String literal 안에서 alias dot prefix 처럼 보이는 텍스트 (`'u.x'`)
  // 가 등장해도 column 후보가 나오면 안 됨.
  it("guard: cursor 가 String literal 안 → null", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT 'u.' FROM users u";
    // cursor 를 문자열 안 (`'u.` 의 dot 다음) 으로.
    const ctx = makeContext(doc, "SELECT 'u.".length);
    expect(source(ctx)).toBeNull();
  });

  // ── (4) cursor 가 LineComment 안 → null ──────────────────────────────
  // `-- u.` 처럼 코멘트 안 에서는 후보 X.
  it("guard: cursor 가 LineComment 안 → null", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "-- u.\nSELECT * FROM users u";
    const ctx = makeContext(doc, "-- u.".length);
    expect(source(ctx)).toBeNull();
  });

  // ── (5) unknown alias → null ─────────────────────────────────────────
  // buffer 안 어디에도 `FROM ... xyz` 가 없는 alias prefix → false positive
  // 회피 (Slice B Done Criteria #3).
  it("guard: unknown alias (xyz. — buffer 에 FROM xyz 없음) → null", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT xyz. FROM users u";
    const ctx = makeContext(doc, "SELECT xyz.".length);
    expect(source(ctx)).toBeNull();
  });

  // ── (6) getSchema() undefined / 배열 → null ──────────────────────────
  // sprint-292 패턴 복제 — namespace 가 아직 안 채워졌거나 (undefined),
  // 레거시 flat completion list (배열) 형태면 column 추출 불가.
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

  // ── (extra) mid-typing flow 의 진짜 표적 — FROM 절이 아직 buffer 에 없는
  // 시나리오. anywhere-scan 으로 buffer 다른 statement 의 alias 를 풀어야
  // 함. spec 의 Slice B 표적 (`SELECT u.` 만 입력) 과 1:1.
  it("mid-typing: SELECT u.<cursor> (단일 statement, FROM 미입력) — anywhere-scan 으로 풀려야", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    // 두 statement: 첫 번째는 mid-typing, 두 번째에 FROM ... u 가 있음.
    // cursor 가 첫 statement 안인데도 anywhere-scan 으로 alias 가 풀려야.
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
 * Sprint 294 (2026-05-14) — Slice D — edge case 단언.
 *
 * 작성 이유:
 *   사용자가 실제로 작성하는 SQL 은 단일 JOIN 단순 패턴을 넘어선다 — 3 개
 *   이상 JOIN, schema-qualified target (`public.users u`), 명시적 `AS`,
 *   같은 alias 가 중복 등장, quoted reserved-word alias. 각 케이스가 Slice B
 *   의 source 에서 어떻게 동작하는지 명시적으로 단언해서 회귀를 차단.
 */
describe("aliasColumnCompletionSource — Sprint 294 Slice D edge cases", () => {
  // ── (D1) 3 개 이상 JOIN ──────────────────────────────────────────────
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
  // `FROM public.users u` 에서 alias `u` → `users` 또는 `public.users`
  // namespace 키로 lookup. bare + qualified 둘 다 시도하는 sprint-268
  // Policy A 호환.
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

  // ── (D3) 명시적 AS ────────────────────────────────────────────────────
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

  // ── (D4) 동일 alias 중복 ──────────────────────────────────────────────
  // `FROM users u, orders u` — 같은 alias `u` 가 두 테이블에 바인딩.
  // crash 없이 어느 한쪽 컬럼은 노출. 정책은 parseFromContext 의 last-wins
  // (line 128 `aliases[aliasName] = tableName`) — 코드 코멘트로 명시.
  it("동일 alias 중복: FROM users u, orders u — crash 없이 어느 한쪽 컬럼 노출", () => {
    const source = aliasColumnCompletionSource(() => TEST_SCHEMA);
    const doc = "SELECT u. FROM users u, orders u";
    const ctx = makeContext(doc, "SELECT u.".length);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    // last-wins (parseFromContext 정책) — orders 컬럼이 노출.
    expect(labels).toEqual(
      expect.arrayContaining(["id", "user_id", "total", "created_at"]),
    );
  });

  // ── (D5) quoted reserved-word alias ──────────────────────────────────
  // `FROM users "from"` — alias 가 quoted reserved word. parseFromContext
  // 의 stripIdentifierQuotes 가 `"from"` 을 `from` 으로 unwrap → alias
  // map 에 등록. cursor 의 alias 인식도 quoted/unquoted 둘 다 시도.
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
