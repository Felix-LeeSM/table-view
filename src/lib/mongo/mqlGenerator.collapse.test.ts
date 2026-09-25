import { describe, expect, it } from "vitest";
import {
  generateMqlPreview,
  type MqlGenerateInput,
  type MqlGridColumn,
} from "./mqlGenerator";

// ---------------------------------------------------------------------------
// Purpose: regression guard for the MongoDB code 40 prefix-overlap conflict —
// user report 2026-07-18 (the second bug, after #1699). Adding a container
// and then filling it in one commit emits the parent path and the child path
// together in the same update patch
// (`$set: { "tags.1": {…}, "tags.1.test": 3 }`). MongoDB forbids modifying a
// parent and a child path in one update document → WriteError code 40
// ("Updating the path 'tags.1.test' would create a conflict at 'tags.1'").
// Fix: deep-merge the children into the parent's object value and emit only
// the parent path. No edit is silently dropped (the parent object's existing
// fields are preserved).
// Split out of mqlGenerator.test.ts to stay under the max-lines cap.
// ---------------------------------------------------------------------------

const HEX_A = "507f1f77bcf86cd799439011";

/** Minimal input builder — callers override columns/rows/pendingEdits per case. */
function makeInput(
  overrides: Partial<MqlGenerateInput> = {},
): MqlGenerateInput {
  return {
    database: "app",
    collection: "users",
    columns: [{ name: "_id", data_type: "objectId", is_primary_key: true }],
    rows: [[{ $oid: HEX_A }]],
    page: 1,
    pendingEdits: new Map(),
    pendingDeletedRowKeys: new Set(),
    pendingNewRows: [],
    ...overrides,
  };
}

const COLS_DOC: MqlGridColumn[] = [
  { name: "_id", data_type: "objectId", is_primary_key: true },
  { name: "a", data_type: "document", is_primary_key: false },
];
const COLS_ARR: MqlGridColumn[] = [
  { name: "_id", data_type: "objectId", is_primary_key: true },
  { name: "tags", data_type: "array", is_primary_key: false },
];

/** `commands[0].patch.$set` (narrowed past the `MqlCommand` union). */
function setOf(command: unknown): Record<string, unknown> {
  return (command as { patch: { $set: Record<string, unknown> } }).patch.$set;
}
function patchOf(command: unknown): Record<string, unknown> {
  return (command as { patch: Record<string, unknown> }).patch;
}

describe("generateMqlPreview — code 40 prefix-overlap collapse (user report 2026-07-18)", () => {
  // 1. Add an empty object, then fill it: `a` = {} and `a.b` = 3.
  it("merges a child into a freshly-added empty-object parent (a={} + a.b=3)", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", {}],
          ["0-1:b", 3],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    // No conflict: only the parent path is emitted, child folded into it.
    expect(commands[0]).toMatchObject({ patch: { $set: { a: { b: 3 } } } });
    expect(Object.keys(setOf(commands[0]))).toEqual(["a"]);
  });

  // 2. The parent object's existing fields must survive the merge.
  it("preserves existing parent fields when folding a child (a={x:1} + a.b=3)", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", { x: 1 }],
          ["0-1:b", 3],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({
      patch: { $set: { a: { x: 1, b: 3 } } },
    });
  });

  // 3. Array-element case (the user's actual symptom): `tags.1` = {…} +
  //    `tags.1.test` = 3. The grid tags non-string commit values with
  //    `__bson__:`, so they are unwrapped before the merge.
  it("merges a nested-array-element parent and its new key (tags.1 + tags.1.test)", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_ARR,
        rows: [[{ $oid: HEX_A }, "[2 items]"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1:[1]", `__bson__:${JSON.stringify({ name: "x" })}`],
          ["0-1:[1].test", "__bson__:3"],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({
      patch: { $set: { "tags.1": { name: "x", test: 3 } } },
    });
    expect(Object.keys(setOf(commands[0]))).toEqual(["tags.1"]);
  });

  // 4. Multi-level merge: `a`={} + `a.b`={} + `a.b.c`=3.
  it("merges across two nesting levels (a={} + a.b={} + a.b.c=3)", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", {}],
          ["0-1:b", {}],
          ["0-1:b.c", 3],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({
      patch: { $set: { a: { b: { c: 3 } } } },
    });
  });

  // 5. $unset child merge: deep-delete the child field from the parent
  //    $set object (avoids code 40).
  it("applies an $unset child by deep-deleting from the parent $set object", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", { x: 1, drop: 9 }],
          ["0-1:drop", "__op__:unset"],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ patch: { $set: { a: { x: 1 } } } });
    // The overlap is collapsed into $set only — no conflicting $unset key.
    expect(patchOf(commands[0])).not.toHaveProperty("$unset");
  });

  // 6. A parent $unset subsumes the child: deleting the whole parent
  //    absorbs the child edit.
  it("drops a child edit subsumed by an $unset of its parent", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1", "__op__:unset"],
          ["0-1:b", 3],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ patch: { $unset: { a: "" } } });
    expect(patchOf(commands[0])).not.toHaveProperty("$set");
  });

  // 7. Regression guard: child-only, parent-only, and distinct elements
  //    pass through unchanged, with no merge or conflict.
  it("leaves non-overlapping paths untouched (child-only, parent-only, sibling elements)", () => {
    const childOnly = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([["0-1:b", 3]]),
      }),
    );
    expect(childOnly.errors).toEqual([]);
    expect(childOnly.commands[0]).toMatchObject({
      patch: { $set: { "a.b": 3 } },
    });

    const parentOnly = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        pendingEdits: new Map<string, unknown>([["0-1", { y: 1 }]]),
      }),
    );
    expect(parentOnly.errors).toEqual([]);
    expect(parentOnly.commands[0]).toMatchObject({
      patch: { $set: { a: { y: 1 } } },
    });

    const siblings = generateMqlPreview(
      makeInput({
        columns: COLS_ARR,
        rows: [[{ $oid: HEX_A }, "[2 items]"]],
        pendingEdits: new Map<string, unknown>([
          ["0-1:[0].x", 1],
          ["0-1:[1].y", 2],
        ]),
      }),
    );
    expect(siblings.errors).toEqual([]);
    expect(siblings.commands[0]).toMatchObject({
      patch: { $set: { "tags.0.x": 1, "tags.1.y": 2 } },
    });
  });
});
