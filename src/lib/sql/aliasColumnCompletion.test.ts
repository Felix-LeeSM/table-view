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
