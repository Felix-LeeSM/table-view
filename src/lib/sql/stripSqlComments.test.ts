import { describe, expect, it } from "vitest";
import { stripSqlComments } from "./stripSqlComments";

// Purpose: stripSqlComments feeds prepareRdbStatements' "is this fragment
// comment-only?" check (#1118) that #1223 depends on; these lock its
// regex-based behaviour incl. its known string-literal quirk
// (2026-07-03, user directive: bulk test 보충).
describe("stripSqlComments", () => {
  it("removes line and block comments before empty-statement checks", () => {
    expect(stripSqlComments("-- only comment\n/* block */")).toBe("\n");
  });

  it("preserves uncommented SQL text", () => {
    expect(stripSqlComments("select 1;\nselect 2")).toBe("select 1;\nselect 2");
  });

  it("strips a trailing line comment to end of line", () => {
    expect(stripSqlComments("SELECT 1 -- c")).toBe("SELECT 1 ");
  });

  it("strips an inline block comment", () => {
    expect(stripSqlComments("SELECT /* c */ 1")).toBe("SELECT  1");
  });

  it("strips a block comment spanning multiple lines", () => {
    expect(stripSqlComments("SELECT 1 /* a\nb\nc */ + 2")).toBe(
      "SELECT 1  + 2",
    );
  });

  it("strips two block comments non-greedily", () => {
    expect(stripSqlComments("/* a */ x /* b */")).toBe(" x ");
  });

  // KNOWN LIMITATION: the regex is not string-literal aware, so a `--`
  // inside a single-quoted literal is treated as a comment start. Harmless
  // in the #1118 pipeline — the stripped fragment (`SELECT '`) is still
  // non-empty, so the statement is kept, not dropped. Pinned so a future
  // literal-aware rewrite is a conscious change, not a silent regression.
  it("over-strips a -- inside a string literal (documented limitation)", () => {
    expect(stripSqlComments("SELECT '--not a comment'")).toBe("SELECT '");
  });
});
