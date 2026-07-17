import { describe, it, expect } from "vitest";
import { deriveMongoExplainSpec } from "./queryHelpers";

// Purpose: `deriveMongoExplainSpec` — derive the Mongo explain find-spec from a
// mongosh find statement — Issue #1619 E3 (2026-07-17).
//
// Explain is backed by `runCommand({explain:{find,...}})`, so it is find-only.
// #1619 narrows the cursor-chain fallback: a malformed cursor argument makes
// the REAL find dispatch error out and never run, so a filter-only fallback
// plan would diverge from execution — the spec must be `null` instead.
describe("deriveMongoExplainSpec", () => {
  // Reason: normal-path regression guard — a find with a valid cursor chain
  // yields a spec carrying the same filter/projection/sort/limit/skip the real
  // find executes (2026-07-17).
  it("derives a find spec with the full cursor chain applied", () => {
    const spec = deriveMongoExplainSpec(
      "db.users.find({ active: true }, { name: 1 }).sort({ name: 1 }).limit(10).skip(5)",
      "shop",
    );
    expect(spec).toEqual({
      database: "shop",
      collection: "users",
      body: {
        filter: { active: true },
        projection: { name: 1 },
        sort: { name: 1 },
        limit: 10,
        skip: 5,
      },
    });
  });

  // Reason: a bare find (no cursor chain) still derives a filter/projection
  // spec (2026-07-17).
  it("derives a find spec for a filter-only query", () => {
    const spec = deriveMongoExplainSpec(
      "db.users.find({ active: true })",
      "shop",
    );
    expect(spec).toEqual({
      database: "shop",
      collection: "users",
      body: { filter: { active: true } },
    });
  });

  // Reason: #1619 E3 — a malformed cursor argument (sort given a number, limit
  // given a string) makes `mongoQueryExecution` error out and refuse to run, so
  // explain must NOT silently fall back to a filter-only plan that diverges
  // from execution. Return null instead. RED before the narrowing (returned a
  // filter-only spec); GREEN after (2026-07-17).
  it("returns null when a cursor argument is malformed (no filter-only fallback)", () => {
    expect(
      deriveMongoExplainSpec("db.users.find({ active: true }).sort(1)", "shop"),
    ).toBeNull();
    expect(
      deriveMongoExplainSpec('db.users.find({}).limit("oops")', "shop"),
    ).toBeNull();
  });

  // Reason: non-find statements (aggregate / write / admin) have no find spec
  // and return null — explain is find-only, #1041 (2026-07-17).
  it("returns null for a non-find statement", () => {
    expect(
      deriveMongoExplainSpec(
        "db.events.aggregate([{ $match: { x: 1 } }])",
        "shop",
      ),
    ).toBeNull();
  });

  // Reason: an undefined database falls back to an empty string in the spec so
  // the backend validator surfaces the empty-db error uniformly (2026-07-17).
  it("uses an empty database string when database is undefined", () => {
    const spec = deriveMongoExplainSpec("db.users.find({})", undefined);
    expect(spec?.database).toBe("");
  });
});
