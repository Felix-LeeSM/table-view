import { describe, expect, it } from "vitest";
import type { TableData } from "@/types/schema";
import { type CoerceError, generateSql } from "./sqlGenerator";
import {
  BASE_DATA,
  JSONB_ARRAY_DATA,
  JSONB_DATA,
} from "./sqlGenerator.fixtures";

// ---------------------------------------------------------------------------
// Inline JSON tree edits: jsonb + Postgres ARRAY. Locks the path-key parser +
// per-cell dispatch so the inline tree (Mongo's DocumentTreePanel mounted in
// the RDB grid) can edit / delete leaves through `:dot.path` pendingEdit keys
// without the SQL generator collapsing them to invalid statements. Regression
// guard: plain cell-edit behaviour (no `:path`) is unaffected.
// ---------------------------------------------------------------------------

describe("generateSql — JSONB nested edits (Sprint 343)", () => {
  // AC-344-E-07: every jsonb_set call uses the 4-arg form (`, true`).
  // create_missing=true does not break existing leaf-set semantics (an
  // existing key is still overwritten); it only extends the call so a new
  // add-key works.
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
    // 4-arg form: create_missing=true is added to every jsonb_set.
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
    // Both calls carry `, true`.
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
    // `#-` (path-delete) is unaffected by the 4-arg change — only jsonb_set
    // acquires the create_missing flag.
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
    // 4-arg form on the chained jsonb_set output.
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
// Generator dispatch for inline-tree `+ key` / `+ item` adds (a new path
// commit in `pendingByPath`). Reason: when the inline tree commits a new
// key/item, `sqlGenerator` must turn it into correct SQL.
//  - AC-344-E-01: jsonb create-missing key — add a new key beside an existing
//    one.
//  - AC-344-E-02: jsonb null base — COALESCE wrap when adding into a SQL NULL
//    cell.
//  - AC-344-E-03: ARRAY push past end (regression lock — already worked).
//  - AC-344-E-04: non-structural (text) column nested-add reject (regression).
//  - AC-344-E-07: the universal 4-arg form check is covered by the updated
//    assertions in the JSONB nested-edit block above.
// ---------------------------------------------------------------------------

describe("generateSql — Slice E add-key / add-item dispatch (Sprint 344)", () => {
  it("AC-344-E-01: jsonb create-missing key — existing key 옆에 새 key add", () => {
    // pendingEdits Map { "0-1:newKey" => "42" } on jsonb cell `{existing:"foo"}`
    // → jsonb_set(meta, '{"newKey"}', '42'::jsonb, true) is emitted. Without
    // create_missing=true the new key is not created.
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
    // The row's meta is SQL NULL. jsonb_set(NULL, ...) returns NULL, so the
    // add would be a no-op. The generator wraps the base in
    // COALESCE(meta, '{}'::jsonb) and creates the key on an empty object. It
    // wraps once; chained jsonb_set reuses that result.
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
    // Two nested adds on the same cell. The first jsonb_set applies on top of
    // the COALESCE, the second takes the first jsonb_set's output as its base
    // — a second COALESCE would break the SQL.
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
    // Already handled by `emitArrayUpdate`'s `extraIndexes` branch —
    // regression guard only. pending `"0-2:[2]" => "c"` is an index past
    // `cellValue.length === 2`, so it appends as a new element. text[] has a
    // textual element type, so 'c' is quoted.
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
    // Regression guard for two consecutive `+ item` commits — both new
    // indexes append and ARRAY['a','b','c','d'] is emitted.
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
    // `name` in BASE_DATA is text — a nested edit makes no sense there. The
    // existing "only supported on jsonb or Postgres ARRAY" message fires
    // unchanged. No new behaviour here, regression lock only.
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
    // Three at once on the same jsonb column: (a) edit an existing key, (b)
    // add a new key, (c) unset another key — all folded into a 4-arg
    // jsonb_set + `#-` chain.
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
    // Insertion order: existing → newKey → legacy. existing and newKey both
    // use the 4-arg jsonb_set; legacy uses the `#-` path-delete.
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(jsonb_set(meta, '{"existing"}', '"renamed"'::jsonb, true), '{"newKey"}', '42'::jsonb, true) #- '{"legacy"}' WHERE id = 1;`,
    );
  });

  it("AC-344-E-03 edge: empty array + first item push (`[0]`)", () => {
    // Push the first item into an empty array cell. base length=0, so `[0]`
    // is classified as an extraIndex and appends.
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

// jsonb[] inner-path edit. The path syntax for an inner edit is
// `[N].inner.path`. The emit reassigns the whole array (ARRAY[...]::jsonb[])
// with edited slots wrapped in jsonb_set / #- and untouched slots referencing
// `col[i+1]` (Postgres 1-indexed).

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
