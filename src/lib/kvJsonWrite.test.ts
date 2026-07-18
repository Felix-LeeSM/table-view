import { describe, it, expect } from "vitest";
import { applyTreeEdits, parseTreePath } from "./kvJsonWrite";
import { UNSET_OP } from "@/components/document/DocumentTreePanel/types";

// Purpose: `applyTreeEdits` is the write core of the KV JSON tree editor —
// PR3 (2026-07-18). It takes the original parsed value + the panel's per-path
// pending edits and returns the full re-serialized value for a single Redis
// overwrite (`SET` / `JSON.SET`). These tests pin the properties the write path
// depends on: correct nested placement, untouched siblings, and — the
// data-safety crux — JSON type preservation.

const pending = (entries: Record<string, string | Record<string, unknown>>) =>
  new Map(Object.entries(entries));

describe("parseTreePath", () => {
  it("tokenizes object keys, array indices, and nested mixes", () => {
    expect(parseTreePath("name")).toEqual(["name"]);
    expect(parseTreePath("meta.verified")).toEqual(["meta", "verified"]);
    expect(parseTreePath("tags[2]")).toEqual(["tags", 2]);
    expect(parseTreePath("[0]")).toEqual([0]);
    expect(parseTreePath("meta.tags[2].name")).toEqual([
      "meta",
      "tags",
      2,
      "name",
    ]);
    expect(parseTreePath("")).toEqual([]);
  });
});

describe("applyTreeEdits", () => {
  it("edits a top-level scalar leaf and leaves siblings untouched", () => {
    const original = { name: "Ada", age: 30 };
    const { value, json } = applyTreeEdits(original, pending({ name: "Bob" }));
    expect(value).toEqual({ name: "Bob", age: 30 });
    expect(json).toBe('{"name":"Bob","age":30}');
    // original is not mutated.
    expect(original).toEqual({ name: "Ada", age: 30 });
  });

  it("edits a nested object leaf without disturbing other branches", () => {
    const original = { meta: { verified: false, role: "owner" }, id: 1 };
    const { value } = applyTreeEdits(
      original,
      pending({ "meta.verified": "true" }),
    );
    expect(value).toEqual({
      meta: { verified: true, role: "owner" },
      id: 1,
    });
  });

  it("edits an array element in place", () => {
    const original = { tags: [10, 20, 30] };
    const { value } = applyTreeEdits(original, pending({ "tags[1]": "99" }));
    expect(value).toEqual({ tags: [10, 99, 30] });
  });

  it("edits an element of a root-level array", () => {
    const { value } = applyTreeEdits([1, 2, 3], pending({ "[1]": "9" }));
    expect(value).toEqual([1, 9, 3]);
  });

  it("preserves each JSON scalar type through an edit", () => {
    const original = { s: "x", n: 1, b: false, z: null };
    const { value } = applyTreeEdits(
      original,
      pending({ s: "y", n: "2", b: "true", z: "5" }),
    );
    expect(value).toEqual({ s: "y", n: 2, b: true, z: 5 });
    const v = value as Record<string, unknown>;
    expect(typeof v.s).toBe("string");
    expect(typeof v.n).toBe("number");
    expect(typeof v.b).toBe("boolean");
    expect(typeof v.z).toBe("number");
  });

  // The data-safety crux: a string leaf whose content parses as JSON (a numeric
  // or boolean-looking string) must NOT be silently retyped. commitDraft strips
  // the outer quotes, so the pending value looks like a bare number — but the
  // original was a string, so it stays one.
  it("keeps a numeric-looking string a string (no silent retype)", () => {
    const original = { code: "42", flag: "true" };
    const { value, json } = applyTreeEdits(
      original,
      pending({ code: "99", flag: "false" }),
    );
    expect(value).toEqual({ code: "99", flag: "false" });
    expect(json).toBe('{"code":"99","flag":"false"}');
    const v = value as Record<string, unknown>;
    expect(typeof v.code).toBe("string");
    expect(typeof v.flag).toBe("string");
  });

  it("preserves large integers as they were parsed (JSON round-trip)", () => {
    // The read path already parsed the value, so applyTreeEdits works with a
    // JS number — it re-serializes exactly what it received for the untouched
    // leaf and coerces the edited one to a number.
    const original = { keep: 1000, edit: 5 };
    const { json } = applyTreeEdits(original, pending({ edit: "1000" }));
    expect(json).toBe('{"keep":1000,"edit":1000}');
  });

  it("applies multiple edits across nesting levels in one pass", () => {
    const original = {
      user: { name: "Ada", scores: [1, 2] },
      active: true,
    };
    const { value } = applyTreeEdits(
      original,
      pending({
        "user.name": "Bob",
        "user.scores[0]": "10",
        active: "false",
      }),
    );
    expect(value).toEqual({
      user: { name: "Bob", scores: [10, 2] },
      active: false,
    });
  });

  it("adds a new object key using the tree-coerced value verbatim", () => {
    const original = { a: 1 };
    // `+ key` adds pass an already-coerced value (number here) from the hooks.
    const { value } = applyTreeEdits(
      original,
      new Map<string, string | Record<string, unknown>>([["b", 2 as never]]),
    );
    expect(value).toEqual({ a: 1, b: 2 });
  });

  it("applies a parent add before a child edit even when out of order", () => {
    // A child edit whose entry precedes its parent add in the map would be
    // dropped without the shallow-first ordering (the parent doesn't exist yet
    // when the child is applied). Depth-sort makes the parent land first.
    const original = { a: 1 };
    const map = new Map<string, string | Record<string, unknown>>([
      ["meta.role", "admin"],
      ["meta", { role: "owner" }],
    ]);
    const { value } = applyTreeEdits(original, map);
    expect(value).toEqual({ a: 1, meta: { role: "admin" } });
  });

  it("removes an object key on UNSET_OP", () => {
    const original = { a: 1, b: 2 };
    const { value } = applyTreeEdits(original, pending({ b: UNSET_OP }));
    expect(value).toEqual({ a: 1 });
  });

  it("removes array elements without index-shift corruption", () => {
    const original = { tags: ["a", "b", "c", "d"] };
    const { value } = applyTreeEdits(
      original,
      pending({ "tags[1]": UNSET_OP, "tags[3]": UNSET_OP }),
    );
    // b (idx 1) and d (idx 3) gone; a and c remain in order.
    expect(value).toEqual({ tags: ["a", "c"] });
  });

  it("ignores a pending path whose parent no longer resolves", () => {
    const original = { a: { b: 1 } };
    const { value } = applyTreeEdits(original, pending({ "x.y.z": "1" }));
    expect(value).toEqual({ a: { b: 1 } });
  });
});
