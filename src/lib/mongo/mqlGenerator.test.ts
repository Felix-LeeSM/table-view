import { describe, it, expect } from "vitest";
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
        documentId: { ObjectId: HEX_A },
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
        documentId: { ObjectId: HEX_B },
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
      documentId: { ObjectId: HEX_A },
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
      documentId: { ObjectId: HEX_A },
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
      documentId: { Number: 7 },
    });
  });

  // Sprint 322 — Slice F.2: dot-notation nested edits.
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

  // Sprint 342 V2 (2026-05-15) — DocumentTreePanel's delete action stores
  // the `__op__:unset` sentinel against a field path. The generator must
  // route that into a `$unset` operator (and let it coexist with `$set`
  // on the same row so one click of Save covers overwrite + delete).
  // 작성 이유: 기존 sprint 322 의 `$set` 단독 patch 가 inline-tree 의 leaf
  // 삭제 (예: `meta.legacyField`) 를 표현할 수 없었다.
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

// Sprint 324 (2026-05-15) — Slice G.2: canonical EJSON BSON wrapper 가
// mongosh literal 로 출력되는 경로의 회귀 가드. G.1 helper 가 wrapper
// shape 을 만들고, mqlGenerator 는 그 shape 을 사용자에게 친숙한 mongosh
// 표기 (ObjectId("..."), ISODate("...") 등) 로 표시한다.
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
          ["0-1:meta.id", { $oid: "65abcdef0123456789abcdef" }],
          ["0-1", "Ada"],
        ]),
      }),
    );
    // The dot-path BSON literal is quoted as "name.meta.id" and renders
    // ObjectId(...); the bare top-level edit renders as plain string.
    // (Insertion order of pendingEdits drives the patch ordering.)
    expect(previewLines[0]).toContain(
      '"name.meta.id": ObjectId("65abcdef0123456789abcdef")',
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
// Sprint 344 (2026-05-15) — Slice E — Generator dispatch for inline-tree
// `+ key` adds on Mongo grid. mqlGenerator 자체는 코드 변경 없이 dot-path
// 를 native 로 처리 — `$set` 가 missing path 를 자동 생성한다. 본 회귀
// 가드는 두 가지를 잠근다:
//  - AC-344-E-05: cell `meta = {}` 에 `meta.role` add → 정확히 1개의
//    updateOne 이 `$set: { "meta.role": "admin" }` 를 emit.
//  - AC-344-E-06: nested-only path edit (top-level edit 없음) 가 sentinel-edit
//    guard 를 발동시키지 않음 — guard 는 path === null 일 때만 fire.
// ---------------------------------------------------------------------------

describe("generateMqlPreview — Slice E add-key dispatch (Sprint 344)", () => {
  it("AC-344-E-05: nested $set 가 missing path 를 native 로 생성 (resulting patch key = 'meta.role')", () => {
    // Slice B/C 의 + key affordance 가 `role` 을 meta 컬럼 (colIdx=1) 에
    // commit 했을 때 pendingEdits 는 `"0-1:role" => "admin"` 으로 저장된다.
    // mqlGenerator 는 col.name (meta) + path (role) 을 dot-join 해서
    // patch field path `meta.role` 을 만든다 → MongoDB 의 `$set` 가
    // native 로 missing key (`role`) 를 `meta = {}` 위에 생성한다. 한 개의
    // updateOne 만 emit. 작성 이유: AC-344-E-05 generator dispatch lock.
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        // cell value 가 empty object (`{}`) — sentinel string 이 아니다.
        // sentinel-edit guard 는 nested path 에 발동하지 않는다 (path !== null).
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
    // Slice B 의 + key 가 sentinel cell `{...}` 에 newKey 를 commit 했을 때.
    // pendingEdits Map { "0-1:newKey" => "alpha" } only — top-level edit 없음.
    // sentinel-edit guard 는 path === null (top-level) 일 때만 fire 하므로
    // 이 nested-only path 는 그대로 $set 로 emit 된다. column name 과 path 가
    // dot-join 되어 `<col>.<newKey>` 가 patch field path.
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        // sentinel string "{...}" — top-level edit 는 막혀야 하지만 nested 는 허용.
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
    // 회귀 가드 — sentinel-edit guard 는 top-level (path === null) 의
    // edit value 가 sentinel 문자열일 때 정상 동작해야 한다. nested 는
    // 우회한다는 invariant 의 contrapositive (top-level 은 blocked).
    // 작성 이유: AC-344-E-06 가 sentinel guard 의 nested 우회만 잠그므로,
    // top-level sentinel guard 의 회귀를 별도로 한 줄로 같이 cover.
    const { previewLines, commands, errors } = generateMqlPreview(
      makeInput({
        columns: [
          { name: "_id", data_type: "objectId", is_primary_key: true },
          { name: "meta", data_type: "document", is_primary_key: false },
        ],
        rows: [[{ $oid: HEX_A }, "{...}"]],
        // top-level edit 의 value 자체가 sentinel — guard 가 fire 해야 함.
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
