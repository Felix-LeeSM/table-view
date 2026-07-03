import { describe, it, expect } from "vitest";
import { tokenizeSql } from "./sqlTokenize";

describe("tokenizeSql", () => {
  it("returns an empty array for empty input", () => {
    expect(tokenizeSql("")).toEqual([]);
  });

  it("tags leading keyword and trailing identifier", () => {
    const tokens = tokenizeSql("SELECT name");
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toEqual(["keyword", "whitespace", "identifier"]);
  });

  it("recognises keywords case-insensitively", () => {
    const tokens = tokenizeSql("select FROM Where");
    const keywordTexts = tokens
      .filter((t) => t.kind === "keyword")
      .map((t) => t.text);
    expect(keywordTexts).toEqual(["select", "FROM", "Where"]);
  });

  it("tokenises a single-quoted string literal as one token", () => {
    const tokens = tokenizeSql("WHERE a = 'hello world'");
    const strings = tokens.filter((t) => t.kind === "string");
    expect(strings).toHaveLength(1);
    expect(strings[0]!.text).toBe("'hello world'");
  });

  it("preserves escaped single quotes inside string literals", () => {
    const tokens = tokenizeSql("VALUES ('it''s')");
    const strings = tokens.filter((t) => t.kind === "string");
    expect(strings).toHaveLength(1);
    expect(strings[0]!.text).toBe("'it''s'");
  });

  it("treats double-quoted identifiers as identifiers, not strings", () => {
    const tokens = tokenizeSql('FROM "public"."users"');
    const idents = tokens.filter((t) => t.kind === "identifier");
    expect(idents.map((t) => t.text)).toEqual(['"public"', '"users"']);
    expect(tokens.some((t) => t.kind === "string")).toBe(false);
  });

  it("tokenises numbers including decimals", () => {
    const tokens = tokenizeSql("LIMIT 100 OFFSET 12.5");
    const numbers = tokens.filter((t) => t.kind === "number");
    expect(numbers.map((t) => t.text)).toEqual(["100", "12.5"]);
  });

  it("tokenises line comments through end of line", () => {
    const tokens = tokenizeSql("SELECT 1 -- trailing\nFROM t");
    const comments = tokens.filter((t) => t.kind === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0]!.text).toBe("-- trailing");
  });

  it("tokenises block comments spanning multiple lines", () => {
    const tokens = tokenizeSql("SELECT /* hi\nthere */ 1");
    const comments = tokens.filter((t) => t.kind === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0]!.text).toBe("/* hi\nthere */");
  });

  it("joins all token text back to the original source", () => {
    const sql =
      'SELECT id, name FROM "public"."users" WHERE active = TRUE LIMIT 10';
    const tokens = tokenizeSql(sql);
    expect(tokens.map((t) => t.text).join("")).toBe(sql);
  });

  it("does not classify unknown words as keywords", () => {
    const tokens = tokenizeSql("SELECT myCol FROM myTbl");
    expect(tokens.find((t) => t.text === "myCol")!.kind).toBe("identifier");
    expect(tokens.find((t) => t.text === "myTbl")!.kind).toBe("identifier");
  });

  it("emits punctuation tokens for symbols", () => {
    const tokens = tokenizeSql("a = 1, b");
    const puncts = tokens.filter((t) => t.kind === "punct");
    expect(puncts.map((t) => t.text)).toEqual(["=", ","]);
  });

  // Issue #1234 — PG dollar-quoted strings ($$…$$ / $tag$…$tag$).
  it("tokenises a $$…$$ dollar-quoted body as a single string token", () => {
    const tokens = tokenizeSql("AS $$ BEGIN RETURN 1; END $$");
    const strings = tokens.filter((t) => t.kind === "string");
    expect(strings).toHaveLength(1);
    expect(strings[0]!.text).toBe("$$ BEGIN RETURN 1; END $$");
  });

  it("tokenises a $tag$…$tag$ body as one string and ignores an inner --", () => {
    const tokens = tokenizeSql("$fn$ a -- b ; c $fn$");
    const strings = tokens.filter((t) => t.kind === "string");
    expect(strings.map((t) => t.text)).toEqual(["$fn$ a -- b ; c $fn$"]);
    expect(tokens.some((t) => t.kind === "comment")).toBe(false);
  });

  it("does not treat a positional parameter ($1) as a dollar-quote string", () => {
    const tokens = tokenizeSql("WHERE id = $1");
    expect(tokens.some((t) => t.kind === "string")).toBe(false);
    expect(
      tokens.filter((t) => t.kind === "number").map((t) => t.text),
    ).toEqual(["1"]);
  });

  it("treats an unterminated dollar-quote as one string token through EOF", () => {
    const tokens = tokenizeSql("AS $$ BEGIN oops");
    const strings = tokens.filter((t) => t.kind === "string");
    expect(strings).toHaveLength(1);
    expect(strings[0]!.text).toBe("$$ BEGIN oops");
  });

  it("preserves the source when joining dollar-quote tokens back", () => {
    const sql = "CREATE FUNCTION f() AS $$ x; -- y\n$$ LANGUAGE plpgsql";
    expect(
      tokenizeSql(sql)
        .map((t) => t.text)
        .join(""),
    ).toBe(sql);
  });
});
