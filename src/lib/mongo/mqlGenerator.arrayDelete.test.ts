import { describe, it, expect } from "vitest";
import {
  generateMqlPreview,
  type MqlGenerateInput,
  type MqlGridColumn,
} from "./mqlGenerator";

// ---------------------------------------------------------------------------
// Purpose: MongoDB array-element deletion must REMOVE the element (with index
// shift), not leave a `null` hole — issue #1704. The tree panel's trash on an
// array element stores `__op__:unset` at the element path; the old generator
// turned that into `$unset: { "tags.N": "" }`, which MongoDB resolves to
// `null` (positional `$unset` nulls, never removes). This diverged from the
// Redis (ReJSON) path (`kvJsonWrite.applyTreeEdits`), which splices the element
// out. The fix reads the original array from `rawDocuments` and re-emits the
// whole array via `$set`, matching splice semantics: index-based removal that
// is duplicate-safe, shift-correct, and preserves legitimately-present nulls.
// Object numeric-string keys keep `$unset` (positional `$unset` is correct for
// object fields). Split into its own file to stay under the max-lines cap.
// ---------------------------------------------------------------------------

const HEX_A = "507f1f77bcf86cd799439011";

const COLS_ARR: MqlGridColumn[] = [
  { name: "_id", data_type: "objectId", is_primary_key: true },
  { name: "tags", data_type: "array", is_primary_key: false },
];
const COLS_DOC: MqlGridColumn[] = [
  { name: "_id", data_type: "objectId", is_primary_key: true },
  { name: "meta", data_type: "document", is_primary_key: false },
];

/** Minimal input builder; callers override columns/rows/pendingEdits/rawDocuments. */
function makeInput(
  overrides: Partial<MqlGenerateInput> = {},
): MqlGenerateInput {
  return {
    database: "app",
    collection: "users",
    columns: COLS_ARR,
    rows: [[{ $oid: HEX_A }, "[3 items]"]],
    page: 1,
    pendingEdits: new Map(),
    pendingDeletedRowKeys: new Set(),
    pendingNewRows: [],
    ...overrides,
  };
}

/** `commands[0].patch` narrowed past the `MqlCommand` union. */
function patchOf(command: unknown): Record<string, unknown> {
  return (command as { patch: Record<string, unknown> }).patch;
}

describe("generateMqlPreview — array-element removal (issue #1704)", () => {
  // Reason: #1704 — deleting a duplicate value at a specific index must remove
  // exactly that element (index-based), not every equal value. A `$pull` by
  // value would drop both "a"s; the whole-array `$set` keeps the other one.
  it("removes a duplicate value at a specific index without touching equal siblings", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        rawDocuments: [{ _id: { $oid: HEX_A }, tags: ["a", "a", "b"] }],
        pendingEdits: new Map<string, unknown>([["0-1:[0]", "__op__:unset"]]),
      }),
    );
    expect(errors).toEqual([]);
    expect(patchOf(commands[0])).toEqual({ $set: { tags: ["a", "b"] } });
    expect(patchOf(commands[0])).not.toHaveProperty("$unset");
  });

  // Reason: #1704 — multiple deletes on one array must shift indices like the
  // Redis splice path. Naive per-index `$unset` would null slots 1 and 3;
  // the whole-array `$set` yields the compacted [10, 30].
  it("removes multiple indices with correct shift (no null holes)", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        rawDocuments: [{ _id: { $oid: HEX_A }, tags: [10, 20, 30, 40] }],
        pendingEdits: new Map<string, unknown>([
          ["0-1:[1]", "__op__:unset"],
          ["0-1:[3]", "__op__:unset"],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(patchOf(commands[0])).toEqual({ $set: { tags: [10, 30] } });
  });

  // Reason: #1704 — a legitimately-present `null` element must survive removal
  // of a different index. A `$unset` + `$pull: { field: null }` two-step would
  // wrongly drop this null too; index-based splice keeps it.
  it("preserves a legitimately-present null when removing another index", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        rawDocuments: [{ _id: { $oid: HEX_A }, tags: [1, null, 3] }],
        pendingEdits: new Map<string, unknown>([["0-1:[0]", "__op__:unset"]]),
      }),
    );
    expect(errors).toEqual([]);
    expect(patchOf(commands[0])).toEqual({ $set: { tags: [null, 3] } });
  });

  // Reason: #1704 — removing a container (object) element works the same as a
  // scalar: the element is spliced out, not nulled.
  it("removes an object element from an array of documents", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        rawDocuments: [
          { _id: { $oid: HEX_A }, tags: [{ n: "x" }, { n: "y" }] },
        ],
        pendingEdits: new Map<string, unknown>([["0-1:[0]", "__op__:unset"]]),
      }),
    );
    expect(errors).toEqual([]);
    expect(patchOf(commands[0])).toEqual({ $set: { tags: [{ n: "y" }] } });
  });

  // Reason: #1704 — a nested array (array inside a document column) removes by
  // index too; the whole nested array is re-set at its dot-path.
  it("removes an element from a nested array by its dot-path", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        rawDocuments: [{ _id: { $oid: HEX_A }, meta: { items: [10, 20, 30] } }],
        pendingEdits: new Map<string, unknown>([
          ["0-1:items[1]", "__op__:unset"],
        ]),
      }),
    );
    expect(errors).toEqual([]);
    expect(patchOf(commands[0])).toEqual({ $set: { "meta.items": [10, 30] } });
  });

  // Reason: #1704 — deleting a NUMERIC-STRING object key (not an array index)
  // must stay `$unset`: positional `$unset` is correct for object fields and
  // there is no index to shift. The array-vs-object decision reads the raw
  // container's runtime shape.
  it("keeps $unset for a numeric-string object key (not an array index)", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        columns: COLS_DOC,
        rows: [[{ $oid: HEX_A }, "{...}"]],
        rawDocuments: [{ _id: { $oid: HEX_A }, meta: { "0": "x", "1": "y" } }],
        pendingEdits: new Map<string, unknown>([["0-1:1", "__op__:unset"]]),
      }),
    );
    expect(errors).toEqual([]);
    expect(patchOf(commands[0])).toEqual({ $unset: { "meta.1": "" } });
  });

  // Reason: #1704 — backward-compat / safety: with no `rawDocuments` the
  // generator can't know the container shape, so it must fall back to the old
  // `$unset` behaviour rather than guess (and never corrupt a mismatched doc).
  it("falls back to $unset when rawDocuments is absent", () => {
    const { commands, errors } = generateMqlPreview(
      makeInput({
        pendingEdits: new Map<string, unknown>([["0-1:[1]", "__op__:unset"]]),
      }),
    );
    expect(errors).toEqual([]);
    expect(patchOf(commands[0])).toEqual({ $unset: { "tags.1": "" } });
  });
});
