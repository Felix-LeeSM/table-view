// AC-188-01 — `analyzeMongoPipeline` unit tests. Pin the cases that the
// Sprint 188 contract enumerates so the danger taxonomy stays in sync with
// what `useSafeModeGate` will block / confirm. Cases cover safe pipelines,
// the two cover-stages ($out / $merge), positional irrelevance, multiple
// violations (first wins), and malformed input shapes that the JSON parser
// in QueryTab might let through. date 2026-05-01.
import { describe, it, expect } from "vitest";
import { analyzeMongoOperation, analyzeMongoPipeline } from "./mongoSafety";

describe("analyzeMongoPipeline", () => {
  it("[AC-188-01a] empty pipeline → safe", () => {
    const a = analyzeMongoPipeline([]);
    expect(a.severity).toBe("safe");
    expect(a.kind).toBe("mongo-other");
    expect(a.reasons).toEqual([]);
  });

  it("[AC-188-01b] read-only stages ($match / $sort / $project) → safe", () => {
    const a = analyzeMongoPipeline([
      { $match: { status: "active" } },
      { $sort: { name: 1 } },
      { $project: { _id: 0, name: 1 } },
    ]);
    expect(a.severity).toBe("safe");
    expect(a.kind).toBe("mongo-other");
  });

  it("[AC-188-01c] $out at end of pipeline → danger / mongo-out", () => {
    const a = analyzeMongoPipeline([
      { $match: { active: true } },
      { $out: "snapshot" },
    ]);
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("mongo-out");
    expect(a.reasons[0]).toMatch(/\$out/);
  });

  it("[AC-188-01d] $out at start of pipeline → still danger (positional irrelevance)", () => {
    const a = analyzeMongoPipeline([{ $out: "x" }, { $match: {} }]);
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("mongo-out");
  });

  it("[AC-188-01e] $merge → danger / mongo-merge", () => {
    const a = analyzeMongoPipeline([
      { $match: {} },
      { $merge: { into: "target", whenMatched: "replace" } },
    ]);
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("mongo-merge");
    expect(a.reasons[0]).toMatch(/\$merge/);
  });

  it("[AC-188-01f] $out + $merge mixed → first violation wins (mongo-out here)", () => {
    const a = analyzeMongoPipeline([{ $out: "a" }, { $merge: "b" }]);
    expect(a.kind).toBe("mongo-out");
  });

  it("[AC-188-01g] $merge before $out → mongo-merge wins", () => {
    const a = analyzeMongoPipeline([{ $merge: "a" }, { $out: "b" }]);
    expect(a.kind).toBe("mongo-merge");
  });

  it("[AC-188-01h] non-object stages (string, null, array) are ignored → safe", () => {
    const a = analyzeMongoPipeline(["$match", null, [{ $out: "x" }]]);
    expect(a.severity).toBe("safe");
  });

  it("[AC-188-01i] empty object stage → safe (no first key)", () => {
    const a = analyzeMongoPipeline([{}, { $match: {} }]);
    expect(a.severity).toBe("safe");
  });

  it("[AC-188-01j] $unset / $addFields / $group → safe (write-shape but in-pipeline only)", () => {
    const a = analyzeMongoPipeline([
      { $addFields: { ts: new Date() } },
      { $unset: ["temp"] },
      { $group: { _id: "$category", n: { $sum: 1 } } },
    ]);
    expect(a.severity).toBe("safe");
  });
});

// AC-198-03 — `analyzeMongoOperation` unit tests. Sprint 198 ships 3 bulk-write
// commands (deleteMany / updateMany / dropCollection) — each must be classified
// before the Tauri shim ever fires so `useSafeModeGate.decide` can block / warn
// the same way it does for RDB DELETE-without-WHERE. Cases mirror the contract:
// drop is always danger, empty-filter many-ops are danger, non-empty filter is
// safe. date 2026-05-02.
describe("analyzeMongoOperation", () => {
  it("[AC-198-03a] dropCollection → danger / mongo-drop", () => {
    const a = analyzeMongoOperation({ kind: "dropCollection" });
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("mongo-drop");
    expect(a.reasons[0]).toMatch(/dropCollection/);
  });

  it("[AC-198-03b] deleteMany with empty filter → danger / mongo-delete-all", () => {
    const a = analyzeMongoOperation({ kind: "deleteMany", filter: {} });
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("mongo-delete-all");
    expect(a.reasons[0]).toMatch(/deleteMany without filter/);
  });

  it("[AC-198-03c] updateMany with empty filter → danger / mongo-update-all", () => {
    const a = analyzeMongoOperation({
      kind: "updateMany",
      filter: {},
      patch: { status: "x" },
    });
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("mongo-update-all");
    expect(a.reasons[0]).toMatch(/updateMany without filter/);
  });

  it("[AC-198-03d] deleteMany with non-empty filter → safe / mongo-delete-many", () => {
    const a = analyzeMongoOperation({
      kind: "deleteMany",
      filter: { _id: "abc" },
    });
    expect(a.severity).toBe("safe");
    expect(a.kind).toBe("mongo-delete-many");
    expect(a.reasons).toEqual([]);
  });

  it("[AC-198-03e] updateMany with non-empty filter → safe / mongo-update-many", () => {
    const a = analyzeMongoOperation({
      kind: "updateMany",
      filter: { archived: false },
      patch: { reviewed: true },
    });
    expect(a.severity).toBe("safe");
    expect(a.kind).toBe("mongo-update-many");
  });
});
