// #2591 — a JSON key may contain an apostrophe, and the PostgreSQL jsonb path
// literal is a single-quoted SQL string, so each segment's `'` must be doubled
// or the literal closes early and the tail is executed as SQL.
import { describe, expect, it } from "vitest";
import { emitArrayUpdate, emitJsonbUpdate } from "./structuralSqlEdit";

describe("jsonb path literal — apostrophe doubling (#2591)", () => {
  it("[jsonb-path-single-quote] emitJsonbUpdate doubles an apostrophe in the path literal", () => {
    expect(
      emitJsonbUpdate("meta", {}, [{ key: "k", path: "it's", value: "v" }]),
    ).toEqual({
      kind: "expr",
      expr: `jsonb_set(meta, '{"it''s"}', '"v"'::jsonb, true)`,
    });
  });

  it("[jsonb-path-single-quote] jsonb[] inner path doubles an apostrophe too", () => {
    expect(
      emitArrayUpdate(
        "meta",
        "jsonb[]",
        [{ other: 1 }],
        [{ key: "k", path: "[0].it's", value: "v" }],
      ),
    ).toEqual({
      kind: "expr",
      expr: `ARRAY[jsonb_set(meta[1], '{"it''s"}', '"v"'::jsonb, true)]::jsonb[]`,
    });
  });
});
