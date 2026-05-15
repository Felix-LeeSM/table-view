import { describe, it, expect } from "vitest";
import {
  buildMqlFilter,
  stringifyMqlFilter,
  type MqlCondition,
} from "./mqlFilterBuilder";

function condition(
  field: string,
  operator: MqlCondition["operator"],
  value: string,
): MqlCondition {
  return { id: `${field}-${operator}`, field, operator, value };
}

describe("buildMqlFilter", () => {
  it("returns an empty filter for an empty condition list", () => {
    expect(buildMqlFilter([])).toEqual({});
  });

  it("builds a $eq clause with numeric coercion when input parses as a number", () => {
    expect(buildMqlFilter([condition("age", "$eq", "36")])).toEqual({
      age: { $eq: 36 },
    });
  });

  it("keeps the $eq value as a string when it does not parse as a number", () => {
    expect(buildMqlFilter([condition("name", "$eq", "Ada")])).toEqual({
      name: { $eq: "Ada" },
    });
  });

  it("builds a $gt clause coerced to number for numeric strings", () => {
    expect(buildMqlFilter([condition("score", "$gt", "0.5")])).toEqual({
      score: { $gt: 0.5 },
    });
  });

  it("builds a $gte clause and merges multiple operators on the same field", () => {
    const result = buildMqlFilter([
      condition("age", "$gte", "18"),
      condition("age", "$lt", "65"),
    ]);
    expect(result).toEqual({ age: { $gte: 18, $lt: 65 } });
  });

  it("treats $regex values as raw strings (no numeric coercion)", () => {
    expect(buildMqlFilter([condition("email", "$regex", "^a")])).toEqual({
      email: { $regex: "^a" },
    });
    expect(buildMqlFilter([condition("zip", "$regex", "12345")])).toEqual({
      zip: { $regex: "12345" },
    });
  });

  it("coerces $exists value to boolean from 'true' / 'false' (case-insensitive)", () => {
    expect(buildMqlFilter([condition("nickname", "$exists", "true")])).toEqual({
      nickname: { $exists: true },
    });
    expect(buildMqlFilter([condition("nickname", "$exists", "False")])).toEqual(
      { nickname: { $exists: false } },
    );
    expect(buildMqlFilter([condition("nickname", "$exists", "")])).toEqual({
      nickname: { $exists: false },
    });
  });

  it("emits multiple top-level fields as an implicit $and", () => {
    const result = buildMqlFilter([
      condition("age", "$gte", "18"),
      condition("active", "$eq", "true"),
    ]);
    expect(result).toEqual({
      age: { $gte: 18 },
      active: { $eq: "true" },
    });
  });

  it("ignores conditions with an empty field name", () => {
    expect(
      buildMqlFilter([
        { id: "a", field: "", operator: "$eq", value: "1" },
        condition("kept", "$eq", "1"),
      ]),
    ).toEqual({ kept: { $eq: 1 } });
  });

  it("does not coerce blank-only numeric strings to 0", () => {
    expect(buildMqlFilter([condition("age", "$eq", "   ")])).toEqual({
      age: { $eq: "   " },
    });
  });

  // Sprint 313 (2026-05-14) — Slice B.1 introduces `$in` / `$nin`. The
  // form layer surfaces a single comma-separated input that the builder
  // splits, trims, and per-token coerces. Empty arrays are dropped (D-23)
  // because `$in: []` is almost always a typo.
  it("builds a $in clause with per-token numeric coercion from CSV input", () => {
    expect(buildMqlFilter([condition("age", "$in", "18, 19, 20")])).toEqual({
      age: { $in: [18, 19, 20] },
    });
  });

  it("builds a $in clause keeping non-numeric tokens as strings", () => {
    expect(buildMqlFilter([condition("name", "$in", "Ada, Linus")])).toEqual({
      name: { $in: ["Ada", "Linus"] },
    });
  });

  it("builds a $nin clause with mixed numeric and string tokens", () => {
    expect(buildMqlFilter([condition("tag", "$nin", "1, alpha, 2")])).toEqual({
      tag: { $nin: [1, "alpha", 2] },
    });
  });

  it("drops whitespace-only tokens from $in arrays", () => {
    expect(buildMqlFilter([condition("age", "$in", "1, , 3")])).toEqual({
      age: { $in: [1, 3] },
    });
  });

  it("skips a $in clause entirely when input parses to an empty array", () => {
    // D-23: `$in: []` matches nothing, almost always a typo, so the row
    // degrades to a no-op instead of silently zeroing the result set.
    expect(buildMqlFilter([condition("age", "$in", "")])).toEqual({});
    expect(buildMqlFilter([condition("age", "$in", ", , ")])).toEqual({});
  });

  it("skips a $nin clause when input parses to an empty array", () => {
    expect(buildMqlFilter([condition("age", "$nin", "")])).toEqual({});
  });

  it("merges $in with other operators on the same field", () => {
    const result = buildMqlFilter([
      condition("age", "$gte", "18"),
      condition("age", "$in", "21, 25, 30"),
    ]);
    expect(result).toEqual({ age: { $gte: 18, $in: [21, 25, 30] } });
  });
});

describe("stringifyMqlFilter", () => {
  it("renders the filter as pretty-printed JSON", () => {
    expect(stringifyMqlFilter({ age: { $gte: 18 } })).toBe(
      JSON.stringify({ age: { $gte: 18 } }, null, 2),
    );
  });
});
