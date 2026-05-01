import { describe, it, expect } from "vitest";
import { tokenizeMongo } from "./mongoTokenize";
import { MONGO_ALL_OPERATORS } from "@lib/mongo/mongoAutocomplete";

describe("tokenizeMongo", () => {
  it("returns an empty array for empty input", () => {
    expect(tokenizeMongo("")).toEqual([]);
  });

  it("tokenises a simple find filter object", () => {
    const src = '{"status":"active"}';
    const tokens = tokenizeMongo(src);
    // No $-prefixed operator → no `operator` tokens.
    expect(tokens.some((t) => t.kind === "operator")).toBe(false);
    // Structural punctuation and two string tokens (key + value).
    expect(tokens.filter((t) => t.kind === "string")).toHaveLength(2);
    // Round-trips.
    expect(tokens.map((t) => t.text).join("")).toBe(src);
  });

  it("tags $-prefixed operator keys inside an aggregate pipeline", () => {
    const src =
      '[{"$match":{"x":1}},{"$group":{"_id":"$dept","n":{"$sum":1}}}]';
    const tokens = tokenizeMongo(src);
    const operatorTexts = tokens
      .filter((t) => t.kind === "operator")
      .map((t) => t.text);
    expect(operatorTexts).toContain('"$match"');
    expect(operatorTexts).toContain('"$group"');
    expect(operatorTexts).toContain('"$sum"');
    // `$dept` is a field-reference string literal in value position. It is
    // NOT a registered operator name so it stays a plain `string`.
    expect(operatorTexts).not.toContain('"$dept"');
    // Round-trip preservation so the preview renders the original bytes.
    expect(tokens.map((t) => t.text).join("")).toBe(src);
  });

  it("detects every operator from the Sprint 83 vocabulary", () => {
    for (const op of MONGO_ALL_OPERATORS) {
      const src = `{${JSON.stringify(op)}: 1}`;
      const tokens = tokenizeMongo(src);
      const opToken = tokens.find((t) => t.kind === "operator");
      expect(opToken, `expected operator token for ${op}`).toBeDefined();
      expect(opToken!.text).toBe(`"${op}"`);
    }
  });

  it("does not flag $-prefixed strings whose inner name is not a known operator", () => {
    const src = '{"$unknownStage":1}';
    const tokens = tokenizeMongo(src);
    expect(tokens.some((t) => t.kind === "operator")).toBe(false);
    const stringTokens = tokens.filter((t) => t.kind === "string");
    expect(stringTokens.map((t) => t.text)).toContain('"$unknownStage"');
  });

  it("handles invalid / truncated JSON without throwing", () => {
    const truncated = '{"$match":{';
    expect(() => tokenizeMongo(truncated)).not.toThrow();
    const tokens = tokenizeMongo(truncated);
    // `$match` still earns the operator tag — partial tokenisation stops
    // at the dangling `{` but earlier tokens are honoured.
    expect(tokens.some((t) => t.kind === "operator")).toBe(true);
    // Output is non-empty and round-trips the source (best-effort).
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.map((t) => t.text).join("")).toBe(truncated);
  });

  it("tolerates arbitrary non-JSON text by emitting identifier + punct tokens", () => {
    const src = "abc xyz!";
    const tokens = tokenizeMongo(src);
    expect(() => tokenizeMongo(src)).not.toThrow();
    // At least one identifier and one punct-like fallback token.
    expect(tokens.some((t) => t.kind === "identifier")).toBe(true);
    expect(tokens.map((t) => t.text).join("")).toBe(src);
  });

  it("treats unterminated strings as plain strings (non-operator)", () => {
    // Unterminated `"$match` — no closing quote. The tokeniser still
    // consumes the fragment as a string but refuses to promote it to
    // `operator` because the quoted form isn't fully closed.
    const src = '{"$match';
    const tokens = tokenizeMongo(src);
    expect(() => tokenizeMongo(src)).not.toThrow();
    expect(tokens.some((t) => t.kind === "operator")).toBe(false);
    expect(tokens.map((t) => t.text).join("")).toBe(src);
  });

  it("recognises booleans, null, and numbers", () => {
    const src = '{"a":true,"b":false,"c":null,"d":-1.5,"e":2e3}';
    const tokens = tokenizeMongo(src);
    expect(tokens.some((t) => t.kind === "boolean" && t.text === "true")).toBe(
      true,
    );
    expect(tokens.some((t) => t.kind === "boolean" && t.text === "false")).toBe(
      true,
    );
    expect(tokens.some((t) => t.kind === "null" && t.text === "null")).toBe(
      true,
    );
    const numberTexts = tokens
      .filter((t) => t.kind === "number")
      .map((t) => t.text);
    expect(numberTexts).toContain("-1.5");
    expect(numberTexts).toContain("2e3");
    expect(tokens.map((t) => t.text).join("")).toBe(src);
  });

  it("preserves whitespace as dedicated tokens so the preview keeps original spacing", () => {
    const src = '{ "$match" : {} }';
    const tokens = tokenizeMongo(src);
    expect(tokens.some((t) => t.kind === "whitespace")).toBe(true);
    expect(tokens.some((t) => t.kind === "operator")).toBe(true);
    expect(tokens.map((t) => t.text).join("")).toBe(src);
  });
});
