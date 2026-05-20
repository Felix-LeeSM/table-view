import { describe, expect, it } from "vitest";
import { stripSqlComments } from "./stripSqlComments";

describe("stripSqlComments", () => {
  it("removes line and block comments before empty-statement checks", () => {
    expect(stripSqlComments("-- only comment\n/* block */")).toBe("\n");
  });

  it("preserves uncommented SQL text", () => {
    expect(stripSqlComments("select 1;\nselect 2")).toBe("select 1;\nselect 2");
  });
});
