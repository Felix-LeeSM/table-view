import { describe, expect, it } from "vitest";
import {
  generateMqlPreview,
  type MqlGenerateInput,
  type MqlGridColumn,
} from "./mqlGenerator";

const HEX_A = "507f1f77bcf86cd799439011";
const HEX_B = "507f1f77bcf86cd799439022";
const HEX_C = "507f1f77bcf86cd799439033";

const COLUMNS: MqlGridColumn[] = [
  { name: "_id", data_type: "objectId", is_primary_key: true },
  { name: "name", data_type: "string", is_primary_key: false },
  { name: "age", data_type: "int", is_primary_key: false },
];

function makeInput(
  overrides: Partial<MqlGenerateInput> = {},
): MqlGenerateInput {
  return {
    database: "app",
    collection: "users",
    columns: COLUMNS,
    rows: [
      [{ $oid: HEX_A }, "Ada", 36],
      [{ $oid: HEX_B }, "Grace", 55],
    ],
    page: 1,
    pendingEdits: new Map(),
    pendingDeletedRowKeys: new Set(),
    pendingNewRows: [],
    ...overrides,
  };
}

describe("generateMqlPreview — happy paths", () => {
  it("generates a single updateOne from a pendingEdits entry", () => {
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map([["0-1", "Ada Lovelace"]]),
      }),
    );
    expect(errors).toEqual([]);
    expect(previewLines).toEqual([
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { name: "Ada Lovelace" } })`,
    ]);
    expect(commands).toEqual([
      {
        kind: "updateOne",
        database: "app",
        collection: "users",
        documentId: { objectId: HEX_A },
        patch: { $set: { name: "Ada Lovelace" } },
      },
    ]);
  });

  it("groups multi-cell edits on the same row into one updateOne with merged $set", () => {
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map<string, unknown>([
          ["0-1", "Ada L."],
          ["0-2", 37],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(previewLines).toHaveLength(1);
    expect(previewLines[0]).toBe(
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { name: "Ada L.", age: 37 } })`,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      kind: "updateOne",
      patch: { $set: { name: "Ada L.", age: 37 } },
    });
  });

  it("generates a deleteOne from pendingDeletedRowKeys", () => {
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        pendingDeletedRowKeys: new Set(["row-1-1"]),
      }),
    );
    expect(errors).toEqual([]);
    expect(previewLines).toEqual([
      `db.users.deleteOne({ _id: ObjectId("${HEX_B}") })`,
    ]);
    expect(commands).toEqual([
      {
        kind: "deleteOne",
        database: "app",
        collection: "users",
        documentId: { objectId: HEX_B },
      },
    ]);
  });

  it("generates insertOne commands from pendingNewRows", () => {
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        pendingNewRows: [{ name: "Marie", age: 66 }],
      }),
    );
    expect(errors).toEqual([]);
    expect(previewLines).toEqual([
      `db.users.insertOne({ name: "Marie", age: 66 })`,
    ]);
    expect(commands).toEqual([
      {
        kind: "insertOne",
        database: "app",
        collection: "users",
        document: { name: "Marie", age: 66 },
      },
    ]);
  });

  it("orders insertOne → updateOne → deleteOne in both previewLines and commands", () => {
    const { previewLines, commands } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map([["0-1", "Ada L."]]),
        pendingDeletedRowKeys: new Set(["row-1-1"]),
        pendingNewRows: [{ name: "Marie" }],
      }),
    );
    expect(previewLines).toHaveLength(3);
    expect(previewLines[0]!.startsWith("db.users.insertOne")).toBe(true);
    expect(previewLines[1]!.startsWith("db.users.updateOne")).toBe(true);
    expect(previewLines[2]!.startsWith("db.users.deleteOne")).toBe(true);
    expect(commands.map((c) => c.kind)).toEqual([
      "insertOne",
      "updateOne",
      "deleteOne",
    ]);
  });

  it("emits sources index-aligned with commands for partial-commit pruning (#1440)", () => {
    // Reason: issue #1440 — a partially-applied bulk commit must map each
    // applied command back to its pending-state origin (edit keys / delete
    // key / new-row index) so the facade can prune exactly those entries
    // before a re-commit. Date 2026-07-10.
    const { commands, sources } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map<string, unknown>([
          ["0-1", "Ada L."],
          ["0-2", 37],
        ]),
        pendingDeletedRowKeys: new Set(["row-1-1"]),
        pendingNewRows: [{ name: "Marie" }],
      }),
    );
    expect(sources).toHaveLength(commands.length);
    expect(sources[0]).toEqual({ kind: "insert", newRowIndex: 0 });
    expect(sources[1]).toEqual({ kind: "update", editKeys: ["0-1", "0-2"] });
    expect(sources[2]).toEqual({ kind: "delete", deleteKey: "row-1-1" });
  });

  it("sources skip errored rows so alignment with commands survives (#1440)", () => {
    // Reason: issue #1440 — an errored (skipped) new row must not shift the
    // source index of the rows that DID emit commands; pruning the wrong
    // pendingNewRows index would drop a live edit. Date 2026-07-10.
    const { commands, sources, errors } = generateMqlPreview(
      makeInput({ pendingNewRows: [{}, { name: "Marie" }] }),
    );
    expect(errors).toHaveLength(1);
    expect(commands).toHaveLength(1);
    expect(sources).toEqual([{ kind: "insert", newRowIndex: 1 }]);
  });
});

describe("generateMqlPreview — error guards", () => {
  it("reports id-in-patch and drops the row when _id is part of the patch", () => {
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map<string, unknown>([
          ["0-0", { $oid: HEX_C }],
          ["0-1", "Ada"],
        ]),
      }),
    );
    expect(previewLines).toEqual([]);
    expect(commands).toEqual([]);
    expect(errors).toEqual([{ kind: "id-in-patch", rowIdx: 0, column: "_id" }]);
  });

  it("reports sentinel-edit for `{...}` and `[N items]` cells", () => {
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        rows: [[{ $oid: HEX_A }, "{...}", "[3 items]"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", "{...}"],
          ["0-2", "[3 items]"],
        ]),
      }),
    );
    expect(previewLines).toEqual([]);
    expect(commands).toEqual([]);
    expect(errors).toEqual(
      expect.arrayContaining([
        { kind: "sentinel-edit", rowIdx: 0, column: "name" },
        { kind: "sentinel-edit", rowIdx: 0, column: "age" },
      ]),
    );
    expect(errors).toHaveLength(2);
  });

  it("reports missing-id when the row's _id cannot be lifted", () => {
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        rows: [[null, "Ada", 36]],
        pendingEdits: new Map([["0-1", "Ada L."]]),
      }),
    );
    expect(previewLines).toEqual([]);
    expect(commands).toEqual([]);
    expect(errors).toEqual([{ kind: "missing-id", rowIdx: 0 }]);
  });

  it("reports invalid-new-row for a pending new row with no fields", () => {
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        pendingNewRows: [{}],
      }),
    );
    expect(previewLines).toEqual([]);
    expect(commands).toEqual([]);
    expect(errors).toEqual([
      {
        kind: "invalid-new-row",
        rowIdx: 0,
        reason: "new row has no fields",
      },
    ]);
  });

  it("preserves valid rows while flagging invalid ones in the same batch", () => {
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        rows: [
          [{ $oid: HEX_A }, "Ada", 36],
          [null, "Grace", 55],
        ],
        pendingEdits: new Map<string, unknown>([
          ["0-1", "Ada L."],
          ["1-1", "Grace H."],
        ]),
      }),
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      kind: "updateOne",
      documentId: { objectId: HEX_A },
    });
    expect(previewLines).toHaveLength(1);
    expect(errors).toEqual([{ kind: "missing-id", rowIdx: 1 }]);
  });
});

describe("generateMqlPreview — edge cases", () => {
  it("returns empty preview/commands/errors for an empty diff", () => {
    const { previewLines, commands, errors } = generateMqlPreview(makeInput());
    expect(previewLines).toEqual([]);
    expect(commands).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("handles string-keyed _id by lifting the plain hex into ObjectId", () => {
    const { previewLines, commands } = generateMqlPreview(
      makeInput({
        rows: [[HEX_A, "Ada", 36]],
        pendingEdits: new Map([["0-1", "Ada L."]]),
      }),
    );
    expect(previewLines).toEqual([
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { name: "Ada L." } })`,
    ]);
    expect(commands[0]).toMatchObject({
      documentId: { objectId: HEX_A },
    });
  });

  it("handles numeric _id and renders it without quotes in the preview", () => {
    const input = makeInput({
      rows: [[7, "Ada", 36]],
      pendingEdits: new Map([["0-1", "Ada L."]]),
    });
    const { previewLines, commands } = generateMqlPreview(input);
    expect(previewLines).toEqual([
      `db.users.updateOne({ _id: 7 }, { $set: { name: "Ada L." } })`,
    ]);
    expect(commands[0]).toMatchObject({
      documentId: { number: 7 },
    });
  });

  // Slice F.2: dot-notation nested edits.
  it("emits dot-notation $set for a single nested edit", () => {
    const { previewLines, commands } = generateMqlPreview(
      makeInput({
        // top-level `meta` column is a sentinel ({...}) in the row but the
        // edit targets `meta.verified`, which is allowed.
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([["0-1:verified", true]]),
      }),
    );
    expect(previewLines).toEqual([
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { "meta.verified": true } })`,
    ]);
    expect(commands[0]).toMatchObject({
      patch: { $set: { "meta.verified": true } },
    });
  });

  it("merges a nested edit and a top-level edit into one updateOne", () => {
    const { previewLines } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "name", data_type: "string", is_primary_key: false },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "Ada", "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", "Ada L."],
          ["0-2:role", "admin"],
        ]),
      }),
    );
    expect(previewLines).toHaveLength(1);
    expect(previewLines[0]).toBe(
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { name: "Ada L.", "meta.role": "admin" } })`,
    );
  });

  it("emits dot-notation for a deep path (path with multiple segments)", () => {
    const { previewLines } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1:profile.avatar", "https://example.com/a.png"],
        ]),
      }),
    );
    expect(previewLines[0]).toBe(
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { "meta.profile.avatar": "https://example.com/a.png" } })`,
    );
  });

  // DocumentTreePanel's delete action stores the `__op__:unset` sentinel
  // against a field path. The generator must route that into a `$unset`
  // operator (and let it coexist with `$set` on the same row so one click
  // of Save covers overwrite + delete).
  // Reason: the earlier `$set`-only patch could not express inline-tree
  // leaf deletion (e.g. `meta.legacyField`).
  it("routes __op__:unset sentinel into a $unset patch", () => {
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1:legacyField", "__op__:unset"],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(previewLines).toEqual([
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $unset: { "meta.legacyField": "" } })`,
    ]);
    expect(commands[0]).toMatchObject({
      patch: { $unset: { "meta.legacyField": "" } },
    });
  });

  it("combines $set and $unset for the same row in one updateOne", () => {
    const { previewLines, commands } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1:role", "admin"],
          ["0-1:legacyField", "__op__:unset"],
        ]),
      }),
    );
    expect(previewLines).toHaveLength(1);
    expect(previewLines[0]).toBe(
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { "meta.role": "admin" }, $unset: { "meta.legacyField": "" } })`,
    );
    expect(commands[0]).toMatchObject({
      patch: {
        $set: { "meta.role": "admin" },
        $unset: { "meta.legacyField": "" },
      },
    });
  });

  it("rejects a nested edit under _id with id-in-patch error", () => {
    const { previewLines, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "name", data_type: "string", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "Ada"]],
        // hypothetical: user tries to $set _id.foo — must drop the row.
        pendingEdits: new Map<string, unknown>([["0-0:foo", "bar"]]),
      }),
    );
    expect(previewLines).toEqual([]);
    expect(errors).toEqual([
      { kind: "id-in-patch", rowIdx: 0, column: "_id.foo" },
    ]);
  });

  it("allows nested edit when the top-level sentinel cell remains read-only", () => {
    // The sentinel-edit guard targets *top-level* sentinel edits only.
    // Nested paths into that sentinel are permitted, by construction.
    const { previewLines, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([["0-1:tag", "hot"]]),
      }),
    );
    expect(errors).toEqual([]);
    expect(previewLines).toHaveLength(1);
  });

  it("escapes double quotes inside string patch values", () => {
    const { previewLines } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map([["0-1", 'Say "Hi"']]),
      }),
    );
    expect(previewLines[0]).toContain('{ name: "Say \\"Hi\\"" }');
  });
});

// Slice G.2: regression guard for the path where the canonical EJSON BSON
// wrapper is printed as a mongosh literal. The G.1 helper builds the
// wrapper shape, and mqlGenerator renders that shape in user-friendly
// mongosh notation (ObjectId("..."), ISODate("..."), etc).
describe("generateMqlPreview — BSON literal (Sprint 324 G.2)", () => {
  it('formats $oid wrapper as ObjectId("...") in the preview', () => {
    const { previewLines } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map<string, unknown>([
          ["0-1", { $oid: "65abcdef0123456789abcdef" }],
        ]),
      }),
    );
    expect(previewLines[0]).toContain(
      '{ name: ObjectId("65abcdef0123456789abcdef") }',
    );
  });

  it('formats $date wrapper as ISODate("...")', () => {
    const { previewLines } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map<string, unknown>([
          ["0-1", { $date: "2026-05-15T12:00:00.000Z" }],
        ]),
      }),
    );
    expect(previewLines[0]).toContain(
      '{ name: ISODate("2026-05-15T12:00:00.000Z") }',
    );
  });

  it('formats $numberDecimal wrapper as NumberDecimal("...")', () => {
    const { previewLines } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map<string, unknown>([
          ["0-2", { $numberDecimal: "1234.5678" }],
        ]),
      }),
    );
    expect(previewLines[0]).toContain('{ age: NumberDecimal("1234.5678") }');
  });

  it('formats $binary wrapper as BinData(<subType-int>, "<base64>")', () => {
    const { previewLines } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map<string, unknown>([
          ["0-1", { $binary: { base64: "QUJDRA==", subType: "00" } }],
        ]),
      }),
    );
    expect(previewLines[0]).toContain('{ name: BinData(0, "QUJDRA==") }');
  });

  it("renders nested-dot edit + BSON wrapper together in a single $set", () => {
    const { previewLines } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map<string, unknown>([
          // Nested dot-path edit on a *different* column than the bare edit —
          // sharing a column (`name` + `name.meta.id`) is a genuine parent/child
          // prefix overlap that now collapses (code 40 guard, see
          // mqlGenerator.collapse.test.ts); this test only pins mixed
          // BSON-literal + plain rendering, so keep the paths disjoint.
          ["0-2:meta.id", { $oid: "65abcdef0123456789abcdef" }],
          ["0-1", "Ada"],
        ]),
      }),
    );
    // The dot-path BSON literal is quoted as "age.meta.id" and renders
    // ObjectId(...); the bare top-level edit renders as plain string.
    // (Insertion order of pendingEdits drives the patch ordering.)
    expect(previewLines[0]).toContain(
      '"age.meta.id": ObjectId("65abcdef0123456789abcdef")',
    );
    expect(previewLines[0]).toContain('name: "Ada"');
  });

  it("leaves multi-key objects (not canonical BSON) as plain JSON", () => {
    const { previewLines } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map<string, unknown>([
          ["0-1", { $oid: "abc", extra: 1 }],
        ]),
      }),
    );
    // No mongosh literal for the patch value — falls back to
    // safeStringifyCell. The `_id` filter still renders as ObjectId(...).
    expect(previewLines[0]).toContain('"$oid":"abc"');
    expect(previewLines[0]).toContain('"extra":1');
  });
});

// ---------------------------------------------------------------------------
// Slice E — Generator dispatch for inline-tree `+ key` adds on Mongo grid.
// mqlGenerator itself needs no code change: it handles dot-paths natively —
// `$set` auto-creates the missing path. This regression guard locks two
// things:
//  - AC-344-E-05: adding `meta.role` to a `meta = {}` cell → exactly one
//    updateOne emits `$set: { "meta.role": "admin" }`.
//  - AC-344-E-06: a nested-only path edit (no top-level edit) does not
//    trigger the sentinel-edit guard — the guard fires only when
//    path === null.
// ---------------------------------------------------------------------------

describe("generateMqlPreview — Slice E add-key dispatch (Sprint 344)", () => {
  it("AC-344-E-05: nested $set 가 missing path 를 native 로 생성 (resulting patch key = 'meta.role')", () => {
    // When the Slice B/C + key affordance commits `role` to the meta column
    // (colIdx=1), pendingEdits stores `"0-1:role" => "admin"`. mqlGenerator
    // dot-joins col.name (meta) + path (role) into the patch field path
    // `meta.role` → MongoDB's `$set` natively creates the missing key
    // (`role`) on top of `meta = {}`. Exactly one updateOne is emitted.
    // Reason: AC-344-E-05 generator dispatch lock.
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        // cell value is an empty object (`{}`) — not a sentinel string.
        // the sentinel-edit guard does not fire on nested paths
        // (path !== null).
        rows: [[{ $oid: HEX_A }, {}]],
        pendingEdits: new Map<string, unknown>([["0-1:role", "admin"]]),
      }),
    );
    expect(errors).toEqual([]);
    expect(previewLines).toHaveLength(1);
    expect(previewLines[0]).toBe(
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { "meta.role": "admin" } })`,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      kind: "updateOne",
      patch: { $set: { "meta.role": "admin" } },
    });
  });

  it("AC-344-E-06: sentinel cell `{}` + nested-only newKey — guard 미발동", () => {
    // When the Slice B + key commits newKey to a sentinel cell `{...}`.
    // pendingEdits Map { "0-1:newKey" => "alpha" } only — no top-level edit.
    // The sentinel-edit guard fires only when path === null (top-level), so
    // this nested-only path is emitted as-is via $set. The column name and
    // path are dot-joined into the `<col>.<newKey>` patch field path.
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        // sentinel string "{...}" — top-level edits must stay blocked, nested allowed.
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([["0-1:newKey", "alpha"]]),
      }),
    );
    expect(errors).toEqual([]);
    expect(previewLines).toHaveLength(1);
    expect(previewLines[0]).toBe(
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { "meta.newKey": "alpha" } })`,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      kind: "updateOne",
      patch: { $set: { "meta.newKey": "alpha" } },
    });
  });

  it("AC-344-E-06 contrast: top-level sentinel edit STILL blocked (guard fires only on top-level)", () => {
    // Regression guard — the sentinel-edit guard must still work when a
    // top-level (path === null) edit value is a sentinel string. This is
    // the contrapositive of the nested bypass invariant (top-level is
    // blocked).
    // Reason: AC-344-E-06 only locks the sentinel guard's nested bypass, so
    // this covers the top-level sentinel guard separately in one line.
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "{...}"]],
        // the top-level edit's value is itself a sentinel — the guard must fire.
        pendingEdits: new Map<string, unknown>([["0-1", "{...}"]]),
      }),
    );
    expect(previewLines).toEqual([]);
    expect(commands).toEqual([]);
    expect(errors).toEqual([
      { kind: "sentinel-edit", rowIdx: 0, column: "meta" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Purpose: regression guard for the MongoDB nested array-element $set path
// + scalar unwrap — user report 2026-07-18. Adding key `a`=3 to `items[0]`
// from DocumentTreePanel sent `$set: { "items.[0].a": "__bson__:3" }` and
// MongoDB rejected it with WriteError code 28 (Cannot create field '[0]').
// Two defects:
//   1) An array element's subfield must use dot-index notation
//      (`items.0.a`), but the bracket segment (`[0]`) of the tree path was
//      appended verbatim.
//   2) A scalar added from the tree (number/boolean/null) is tagged with
//      `__bson__:` by the grid and passes through string-typed
//      pendingEdits, but the generator's unwrap guard only unwrapped
//      objects, so it committed the literal `"__bson__:3"` string.
// ---------------------------------------------------------------------------
describe("generateMqlPreview — nested array-element $set (user report 2026-07-18)", () => {
  it("normalizes bracket array indices to Mongo dot-index and unwraps the scalar (exact repro)", () => {
    // Reason: user report 2026-07-18 — commit failed when adding `a`=3 to
    // `items[0]`. The array element path `[0].a` must come out as
    // `items.0.a`, and the `__bson__:3`-tagged scalar must go out as the
    // real number 3. Also locks that the bracket-free object path
    // (`meta.verified`) on the same row is not a normalization target
    // (regression prevention).
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "items", data_type: "array", is_primary_key: false },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "[2 items]", "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1:[0].a", "__bson__:3"],
          ["0-2:verified", true],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(previewLines).toEqual([
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { "items.0.a": 3, "meta.verified": true } })`,
    ]);
    expect(commands[0]).toMatchObject({
      patch: { $set: { "items.0.a": 3, "meta.verified": true } },
    });
  });

  it("normalizes a mid-path bracket index (foo[2].bar) and a bare index ([0])", () => {
    // Reason: user report 2026-07-18 — locks that normalization turns
    // leading / mid / trailing brackets all into dot-index (without a
    // stray leading `.`).
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "data", data_type: "document", is_primary_key: false },
          { name: "items", data_type: "array", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "{...}", "[1 items]"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1:foo[2].bar", "x"],
          ["0-2:[0]", "y"],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({
      patch: { $set: { "data.foo.2.bar": "x", "items.0": "y" } },
    });
  });

  it.each([
    { tagged: "__bson__:3", expected: 3 },
    { tagged: "__bson__:true", expected: true },
    { tagged: "__bson__:null", expected: null },
    {
      tagged: `__bson__:${JSON.stringify({ $oid: HEX_A })}`,
      expected: { $oid: HEX_A },
    },
  ])(
    "unwraps a tree-added value $tagged into its real type in the update patch (not the literal tag string)",
    ({ tagged, expected }) => {
      // Reason: user report 2026-07-18 — a `+ key` scalar add is tagged
      // `__bson__:<json>` by the grid and passes through string-typed
      // pendingEdits. The unwrap must be a JSON round-trip symmetric with
      // the wrap — unwrapping not only objects but also
      // number/boolean/null, while the existing BSON wrapper object unwrap
      // stays regression-free (the last case is that guard).
      const { commands, errors } = generateMqlPreview(
        makeInput({
          columns: [
            { name: "_id", data_type: "objectId", is_primary_key: true },
            { name: "meta", data_type: "document", is_primary_key: false },
          ],
          rows: [[{ $oid: HEX_A }, "{...}"]],
          pendingEdits: new Map<string, unknown>([["0-1:score", tagged]]),
        }),
      );
      expect(errors).toEqual([]);
      expect(commands[0]).toMatchObject({
        patch: { $set: { "meta.score": expected } },
      });
    },
  );
});
