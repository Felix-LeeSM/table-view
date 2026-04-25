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
        patch: { name: "Ada Lovelace" },
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
      patch: { name: "Ada L.", age: 37 },
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

  it("escapes double quotes inside string patch values", () => {
    const { previewLines } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map([["0-1", 'Say "Hi"']]),
      }),
    );
    expect(previewLines[0]).toContain('{ name: "Say \\"Hi\\"" }');
  });
});
