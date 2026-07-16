import { describe, it, expect } from "vitest";
import { extractPlaceholders, substitutePlaceholders } from "./snippetTemplate";

describe("extractPlaceholders", () => {
  it("returns the unique placeholder names in a body", () => {
    expect(
      extractPlaceholders("SELECT * FROM {{table}} WHERE id = {{id}}"),
    ).toEqual(["table", "id"]);
  });

  it("dedups a name used more than once", () => {
    expect(extractPlaceholders("{{col}} = {{col}} AND x = {{col}}")).toEqual([
      "col",
    ]);
  });

  it("tolerates inner whitespace", () => {
    expect(extractPlaceholders("{{ table }}")).toEqual(["table"]);
  });

  it("returns an empty array when there are no placeholders", () => {
    expect(extractPlaceholders("SELECT 1")).toEqual([]);
  });
});

describe("substitutePlaceholders", () => {
  it("replaces provided placeholders with their values", () => {
    expect(
      substitutePlaceholders("SELECT * FROM {{table}} WHERE id = {{id}}", {
        table: "users",
        id: "42",
      }),
    ).toBe("SELECT * FROM users WHERE id = 42");
  });

  it("leaves an unprovided placeholder intact rather than emptying it", () => {
    expect(
      substitutePlaceholders("SELECT {{col}} FROM {{table}}", {
        col: "name",
      }),
    ).toBe("SELECT name FROM {{table}}");
  });

  it("inserts a value containing $-sequences literally (no replace() special-casing)", () => {
    // String.prototype.replace treats `$&`, `$1`, `$$` specially in a
    // replacement *string*; the replacer *function* path must not.
    expect(
      substitutePlaceholders("WHERE note = {{note}}", {
        note: "$& $1 $$ cost",
      }),
    ).toBe("WHERE note = $& $1 $$ cost");
  });

  it("inserts a value containing backslashes and braces literally", () => {
    expect(
      substitutePlaceholders("SET path = {{p}}", {
        p: "C:\\tmp\\{{x}}",
      }),
    ).toBe("SET path = C:\\tmp\\{{x}}");
  });
});
