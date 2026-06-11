import { describe, it, expect } from "vitest";
import { generateSql, type CoerceError } from "./sqlGenerator";
import {
  BASE_DATA,
  JSONB_ARRAY_DATA,
  JSONB_DATA,
} from "./sqlGenerator.fixtures";
import type { TableData } from "@/types/schema";

// ---------------------------------------------------------------------------
// Sprint 343 (2026-05-15) — inline JSON tree edits: jsonb + Postgres ARRAY.
// Locks the path-key parser + per-cell dispatch so the inline tree (Mongo's
// DocumentTreePanel mounted in the RDB grid) can edit / delete leaves through
// `:dot.path` pendingEdit keys without the SQL generator collapsing them to
// invalid statements. 작성 이유: Sprint 343 V1 — RDB 가 마침내 nested
// edit 을 받아들임. 회귀 가드: 일반 cell-edit 동작 (no `:path`) 은 영향 X.
// ---------------------------------------------------------------------------

describe("generateSql — JSONB nested edits (Sprint 343)", () => {
  // Sprint 344 (2026-05-15) — AC-344-E-07: 모든 jsonb_set 호출이 4-arg
  // form (`, true`) 으로 통일되었다. Sprint 343 의 6개 assertion 을 갱신.
  // create_missing=true 는 기존 leaf-set 의미를 깨지 않으며 (이미 존재하는
  // key 는 그대로 덮어쓰기), 신규 add-key 가 동작하도록 확장만 한다.
  it("emits jsonb_set for a single nested string leaf", () => {
    const edits = new Map<string, string | null>([["0-1:role", "admin"]]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(meta, '{"role"}', '"admin"'::jsonb, true) WHERE id = 1;`,
    );
  });

  it("recognises numeric / boolean / null leaves as raw JSON (not quoted strings)", () => {
    const edits = new Map<string, string | null>([
      ["0-1:age", "42"],
      ["0-1:active", "true"],
      ["0-1:nickname", "null"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    // Sprint 344 — 4-arg form. create_missing=true 가 모든 jsonb_set 에 추가됨.
    expect(statements[0]).toContain(
      `jsonb_set(meta, '{"age"}', '42'::jsonb, true)`,
    );
    expect(statements[0]).toContain(`'{"active"}', 'true'::jsonb, true)`);
    expect(statements[0]).toContain(`'{"nickname"}', 'null'::jsonb, true)`);
  });

  it("chains multiple nested edits into a single UPDATE", () => {
    const edits = new Map<string, string | null>([
      ["0-1:role", "admin"],
      ["0-1:dept", "eng"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    // Inner-to-outer reading: jsonb_set wraps the previous jsonb_set
    // so the second call sees the first's output as its base.
    // Sprint 344 — both calls now carry `, true`.
    expect(statements[0]).toMatch(
      /UPDATE public\.users SET meta = jsonb_set\(jsonb_set\(meta, '\{"role"\}', '"admin"'::jsonb, true\), '\{"dept"\}', '"eng"'::jsonb, true\) WHERE id = 1;/,
    );
  });

  it("routes __op__:unset into a `#-` (jsonb path delete)", () => {
    const edits = new Map<string, string | null>([
      ["0-1:legacyField", "__op__:unset"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    // `#-` (path-delete) is unaffected by Sprint 344's 4-arg change — only
    // jsonb_set acquires the create_missing flag.
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = meta #- '{"legacyField"}' WHERE id = 1;`,
    );
  });

  it("expands bracket-index segments into separate path components", () => {
    // `tags[0].name` → `'{"tags","0","name"}'` (jsonb path components are
    // text — Postgres accepts the numeric-looking element either way).
    const edits = new Map<string, string | null>([
      ["0-1:friends[0].name", "Marie"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    // Sprint 344 — 4-arg form on the chained jsonb_set output.
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(meta, '{"friends","0","name"}', '"Marie"'::jsonb, true) WHERE id = 1;`,
    );
  });

  it("top-level cell edit on the same jsonb cell shadows any nested edits", () => {
    const errors: CoerceError[] = [];
    const edits = new Map<string, string | null>([
      ["0-1", `{"replaced":true}`],
      ["0-1:role", "admin"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
      { onCoerceError: (e) => errors.push(e) },
    );
    expect(statements).toHaveLength(1);
    // Top-level wins → emits whatever coerceToSqlLiteral produces for the
    // raw jsonb input (textual fallback, single-quote escaped).
    expect(statements[0]).toContain("UPDATE public.users SET meta =");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ key: "0-1:role" });
  });
});

describe("generateSql — Postgres ARRAY nested edits (Sprint 343)", () => {
  it("reassigns the whole array on a single index edit (1-based out → 0-based in)", () => {
    const edits = new Map<string, string | null>([["0-2:[1]", "BETA"]]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['alpha', 'BETA', 'gamma']::text[] WHERE id = 1;`,
    );
  });

  it("splices out an element on __op__:unset", () => {
    const edits = new Map<string, string | null>([["0-2:[1]", "__op__:unset"]]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['alpha', 'gamma']::text[] WHERE id = 1;`,
    );
  });

  it("combines edits and deletes by index in one UPDATE", () => {
    const edits = new Map<string, string | null>([
      ["0-2:[0]", "ALPHA"],
      ["0-2:[1]", "__op__:unset"],
      ["0-2:[2]", "GAMMA"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['ALPHA', 'GAMMA']::text[] WHERE id = 1;`,
    );
  });

  it("rejects non-index ARRAY paths (e.g. `meta.role` on a text[] column)", () => {
    const errors: CoerceError[] = [];
    const edits = new Map<string, string | null>([["0-2:meta.role", "admin"]]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
      { onCoerceError: (e) => errors.push(e) },
    );
    expect(statements).toEqual([]);
    expect(errors[0]?.message).toMatch(/single-index ARRAY paths/);
  });

  it("rejects nested edits on a non-structural column (e.g. text)", () => {
    const errors: CoerceError[] = [];
    const edits = new Map<string, string | null>([
      ["0-2:foo", "bar"], // would be valid on jsonb, but tags is text[] ARRAY
    ]);
    // Use the BASE_DATA shape where `name` is plain text.
    const baseTextEdits = new Map<string, string | null>([["0-1:foo", "bar"]]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      baseTextEdits,
      new Set(),
      [],
      { onCoerceError: (e) => errors.push(e) },
    );
    expect(statements).toEqual([]);
    expect(errors[0]?.message).toMatch(
      /only supported on jsonb or Postgres ARRAY/,
    );
    // sanity: the array-specific path rejection still fires through the
    // ARRAY dispatch when invoked on tags column.
    expect(edits).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Sprint 344 (2026-05-15) — Slice E — Generator dispatch for inline-tree
// `+ key` / `+ item` adds (`pendingByPath` 의 새 path commit). 작성 이유:
// Slice B/C 가 새 key/item 을 commit 했을 때 sqlGenerator 가 올바른
// SQL 로 변환해야 한다.
//  - AC-344-E-01: jsonb create-missing key — 기존 key 옆에 새 key 추가.
//  - AC-344-E-02: jsonb null base — SQL NULL 셀에 add 시 COALESCE wrap.
//  - AC-344-E-03: ARRAY push past end (regression lock — 이미 동작).
//  - AC-344-E-04: 비-structural (text) 컬럼 nested-add reject (regression).
//  - AC-344-E-07 의 4-arg form universal 확인은 위 Sprint 343 block 의
//    기존 6 assertion 갱신으로 cover.
// ---------------------------------------------------------------------------

describe("generateSql — Slice E add-key / add-item dispatch (Sprint 344)", () => {
  it("AC-344-E-01: jsonb create-missing key — existing key 옆에 새 key add", () => {
    // pendingEdits Map { "0-1:newKey" => "42" } on jsonb cell `{existing:"foo"}`
    // → jsonb_set(meta, '{"newKey"}', '42'::jsonb, true) 가 emit 된다.
    // create_missing=true 가 없으면 (Sprint 343 동작) 새 key 가 만들어지지 않음.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, { existing: "foo" }, []]],
    };
    const edits = new Map<string, string | null>([["0-1:newKey", "42"]]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(meta, '{"newKey"}', '42'::jsonb, true) WHERE id = 1;`,
    );
  });

  it("AC-344-E-02: jsonb null base — cell SQL null + add → COALESCE wrap", () => {
    // Row 의 meta 가 SQL NULL 인 경우. jsonb_set(NULL, ...) 은 NULL 을
    // 반환하므로 add 가 사실상 no-op. Sprint 344 generator 는 base 를
    // COALESCE(meta, '{}'::jsonb) 로 wrap 해서 empty object 위에 key 를
    // 생성한다. 한 번만 wrap 되고 chained jsonb_set 가 그 결과를 재사용.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, null, []]],
    };
    const edits = new Map<string, string | null>([["0-1:newKey", "42"]]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{"newKey"}', '42'::jsonb, true) WHERE id = 1;`,
    );
  });

  it("AC-344-E-02 follow-up: jsonb null base + chained adds 가 한 번만 COALESCE wrap", () => {
    // 같은 cell 에 두 개의 nested add. 첫 jsonb_set 는 COALESCE 위에 적용,
    // 두 번째는 첫 jsonb_set 의 결과를 그대로 base 로 사용한다 — 두 번
    // COALESCE 가 들어가면 SQL 이 깨진다.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, null, []]],
    };
    const edits = new Map<string, string | null>([
      ["0-1:role", "admin"],
      ["0-1:dept", "eng"],
    ]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(jsonb_set(COALESCE(meta, '{}'::jsonb), '{"role"}', '"admin"'::jsonb, true), '{"dept"}', '"eng"'::jsonb, true) WHERE id = 1;`,
    );
  });

  it("AC-344-E-03: ARRAY push past end — current cell `[a,b]` + `[2]` => append", () => {
    // 이미 emitArrayUpdate 의 `extraIndexes` 분기로 동작 — 회귀 가드만.
    // pending `"0-2:[2]" => "c"` 가 `cellValue.length === 2` 보다 큰 인덱스이므로
    // 새 원소로 append. text[] element type 가 textual 이므로 'c' 로 quote.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, {}, ["a", "b"]]],
    };
    const edits = new Map<string, string | null>([["0-2:[2]", "c"]]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['a', 'b', 'c']::text[] WHERE id = 1;`,
    );
  });

  it("AC-344-E-03 follow-up: ARRAY 두 인덱스 sequential push (`[N]` + `[N+1]`)", () => {
    // Slice C 의 두 번 연속 + item commit 회귀 가드 — 두 새 인덱스가
    // 모두 append 되어 ARRAY['a','b','c','d'] 가 emit 된다.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, {}, ["a", "b"]]],
    };
    const edits = new Map<string, string | null>([
      ["0-2:[2]", "c"],
      ["0-2:[3]", "d"],
    ]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['a', 'b', 'c', 'd']::text[] WHERE id = 1;`,
    );
  });

  it("AC-344-E-04: 비-structural (text) 컬럼 nested-add → onCoerceError, no SQL", () => {
    // BASE_DATA 의 `name` 은 text — nested edit 자체가 부적절. 기존
    // Sprint 343 의 "only supported on jsonb or Postgres ARRAY" 메시지가
    // 그대로 fire. Slice E 는 새 동작을 추가하지 않으며 regression-lock 만.
    const errors: CoerceError[] = [];
    const edits = new Map<string, string | null>([["0-1:newKey", "v"]]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
      { onCoerceError: (e) => errors.push(e) },
    );
    expect(statements).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.key).toBe("0-1:newKey");
    expect(errors[0]?.message).toMatch(
      /only supported on jsonb or Postgres ARRAY/,
    );
  });

  it("AC-344-E-01 edge: add + edit + unset mixed on same jsonb cell", () => {
    // 같은 jsonb 컬럼에 (a) 기존 key edit (b) 새 key add (c) 다른 key unset
    // 세 가지가 한 번에 — 모두 4-arg jsonb_set + `#-` chain 으로 통합.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, { existing: "foo", legacy: "bar" }, []]],
    };
    const edits = new Map<string, string | null>([
      ["0-1:existing", "renamed"],
      ["0-1:newKey", "42"],
      ["0-1:legacy", "__op__:unset"],
    ]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    // Insertion order: existing → newKey → legacy. existing 와 newKey 모두
    // 4-arg jsonb_set, legacy 는 `#-` path-delete.
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(jsonb_set(meta, '{"existing"}', '"renamed"'::jsonb, true), '{"newKey"}', '42'::jsonb, true) #- '{"legacy"}' WHERE id = 1;`,
    );
  });

  it("AC-344-E-03 edge: empty array + first item push (`[0]`)", () => {
    // 빈 array 셀에 첫 item 을 push. base length=0 이므로 `[0]` 이
    // extraIndexes 로 분류되어 append.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, {}, []]],
    };
    const edits = new Map<string, string | null>([["0-2:[0]", "first"]]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['first']::text[] WHERE id = 1;`,
    );
  });
});

// Sprint 348 (2026-05-15) — jsonb[] inner-path edit. Sprint 343 deferred
// the element edit on jsonb[] / json[] columns; the path syntax for an
// inner edit is `[N].inner.path`. The emit reassigns the whole array
// (ARRAY[...]::jsonb[]) with edited slots wrapped in jsonb_set / #- and
// untouched slots referencing `col[i+1]` (Postgres 1-indexed).

describe("generateSql — jsonb[] inner-path edit (Sprint 348)", () => {
  it("emits ARRAY[...] with jsonb_set on the edited slot", () => {
    const edits = new Map<string, string | null>([["0-1:[1].b", "20"]]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.t SET items = ARRAY[items[1], jsonb_set(items[2], '{"b"}', '20'::jsonb, true), items[3]]::jsonb[] WHERE id = 1;`,
    );
  });

  it("inner-path delete uses #-", () => {
    const edits = new Map<string, string | null>([
      ["0-1:[0].a", "__op__:unset"],
    ]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toBe(
      `UPDATE public.t SET items = ARRAY[items[1] #- '{"a"}', items[2], items[3]]::jsonb[] WHERE id = 1;`,
    );
  });

  it("whole-element delete drops the slot", () => {
    const edits = new Map<string, string | null>([["0-1:[1]", "__op__:unset"]]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toBe(
      `UPDATE public.t SET items = ARRAY[items[1], items[3]]::jsonb[] WHERE id = 1;`,
    );
  });

  it("whole-element replace emits jsonb literal in that slot", () => {
    const edits = new Map<string, string | null>([
      ["0-1:[1]", '{"replaced":true}'],
    ]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    // safeStringifyCell on a JSON-text string still re-encodes once — the
    // resulting jsonb literal carries the inner string verbatim (callers
    // who want a parsed-object replace must commit the structural value
    // via the tree's coerce helper which produces a JS object, not a JSON
    // text).
    expect(statements[0]).toContain("items[1]");
    expect(statements[0]).toContain("'::jsonb");
    expect(statements[0]).toContain("items[3]");
  });

  it("two inner edits on the same element chain jsonb_set", () => {
    const edits = new Map<string, string | null>([
      ["0-1:[0].a", "10"],
      ["0-1:[0].b", "20"],
    ]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toBe(
      `UPDATE public.t SET items = ARRAY[jsonb_set(jsonb_set(items[1], '{"a"}', '10'::jsonb, true), '{"b"}', '20'::jsonb, true), items[2], items[3]]::jsonb[] WHERE id = 1;`,
    );
  });

  it("inner-path edit on missing index rejects", () => {
    const edits = new Map<string, string | null>([["0-1:[10].x", "1"]]);
    const errors: string[] = [];
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
      { onCoerceError: (e) => errors.push(e.message) },
    );
    expect(statements).toHaveLength(0);
    expect(errors[0]).toMatch(/add the element first/);
  });

  it("push past end of array (whole-element)", () => {
    const edits = new Map<string, string | null>([["0-1:[3]", '{"new":1}']]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toContain("items[1], items[2], items[3]");
    expect(statements[0]).toContain("::jsonb[]");
  });
});
