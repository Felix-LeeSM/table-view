// AC-144-1, AC-144-4, AC-144-5 — Mongo completion module assertions.
import { describe, it, expect } from "vitest";
import {
  dbMethodCandidates,
  createDbMethodCompletionSource,
  createMongoCompletionSource,
} from "./mongo";

describe("mongo.dbMethodCandidates", () => {
  it("is non-empty", () => {
    expect(dbMethodCandidates.length).toBeGreaterThan(0);
  });

  it("includes find / aggregate / insertOne", () => {
    const labels = dbMethodCandidates.map((c) => c.label);
    expect(labels).toContain("find");
    expect(labels).toContain("aggregate");
    expect(labels).toContain("insertOne");
  });

  it("never includes SELECT", () => {
    const labels = dbMethodCandidates.map((c) => c.label);
    expect(labels).not.toContain("SELECT");
  });
});

describe("mongo.createDbMethodCompletionSource", () => {
  it("returns a completion source whose dbType is 'mongodb'", () => {
    const source = createDbMethodCompletionSource();
    expect(source.dbType).toBe("mongodb");
  });

  it("returns find / aggregate / insertOne after 'db.'", () => {
    const source = createDbMethodCompletionSource();
    const result = source({ text: "db.", cursor: 3, prefix: "" });
    const labels = result.candidates.map((c) => c.label);
    expect(labels).toEqual(
      expect.arrayContaining(["find", "aggregate", "insertOne"]),
    );
  });

  it("never returns SELECT regardless of cursor position", () => {
    const source = createDbMethodCompletionSource();
    const result = source({ text: "db.", cursor: 3, prefix: "" });
    expect(result.candidates.some((c) => c.label === "SELECT")).toBe(false);
  });

  it("filters by prefix on db.<prefix>", () => {
    const source = createDbMethodCompletionSource();
    const result = source({ text: "db.fi", cursor: 5, prefix: "fi" });
    const labels = result.candidates.map((c) => c.label);
    expect(labels).toContain("find");
    expect(labels).not.toContain("aggregate");
  });

  it("returns no candidates when text doesn't start with db.", () => {
    const source = createDbMethodCompletionSource();
    const result = source({ text: "SELECT * FROM x", cursor: 15, prefix: "x" });
    expect(result.candidates).toEqual([]);
  });
});

describe("mongo.createMongoCompletionSource (CodeMirror façade)", () => {
  it("re-exports the existing MQL completion source factory", () => {
    const fn = createMongoCompletionSource({ queryMode: "find" });
    expect(typeof fn).toBe("function");
  });
});
