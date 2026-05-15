// AC-188-01 — `analyzeMongoPipeline` unit tests. Pin the cases that the
// Sprint 188 contract enumerates so the danger taxonomy stays in sync with
// what `useSafeModeGate` will block / confirm. date 2026-05-01.
//
// Sprint 254 (2026-05-09) — Mongo classifier 도 SQL paradigm 과 동일한 3-tier
// severity (`info` / `warn` / `danger`) 로 split. read-only aggregate /
// find → INFO, write *-many (non-empty filter) → WARN, *-all / $out / $merge /
// drop → DANGER. ADR 0023 grill Q2-(a).
import { describe, it, expect } from "vitest";
import {
  analyzeMongoOperation,
  analyzeMongoPipeline,
  isInfoMongoOperation,
} from "./mongoSafety";

describe("analyzeMongoPipeline", () => {
  it("[AC-188-01a] empty pipeline → info (Sprint 254: read-only)", () => {
    const a = analyzeMongoPipeline([]);
    expect(a.severity).toBe("info");
    expect(a.kind).toBe("mongo-other");
    expect(a.reasons).toEqual([]);
  });

  it("[AC-188-01b] read-only stages ($match / $sort / $project) → info (Sprint 254)", () => {
    const a = analyzeMongoPipeline([
      { $match: { status: "active" } },
      { $sort: { name: 1 } },
      { $project: { _id: 0, name: 1 } },
    ]);
    expect(a.severity).toBe("info");
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

  it("[AC-188-01h] non-object stages (string, null, array) are ignored → info (Sprint 254)", () => {
    const a = analyzeMongoPipeline(["$match", null, [{ $out: "x" }]]);
    expect(a.severity).toBe("info");
  });

  it("[AC-188-01i] empty object stage → info (Sprint 254, no first key)", () => {
    const a = analyzeMongoPipeline([{}, { $match: {} }]);
    expect(a.severity).toBe("info");
  });

  it("[AC-188-01j] $unset / $addFields / $group → info (write-shape but in-pipeline only, Sprint 254)", () => {
    const a = analyzeMongoPipeline([
      { $addFields: { ts: new Date() } },
      { $unset: ["temp"] },
      { $group: { _id: "$category", n: { $sum: 1 } } },
    ]);
    expect(a.severity).toBe("info");
  });
});

// AC-198-03 — `analyzeMongoOperation` unit tests. date 2026-05-02.
//
// Sprint 254 (2026-05-09) — non-empty filter `*-many` 는 WARN (was safe).
// 빈 filter `*-all` 은 DANGER 그대로.
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

  it("[AC-198-03d] deleteMany with non-empty filter → warn / mongo-delete-many (Sprint 254)", () => {
    const a = analyzeMongoOperation({
      kind: "deleteMany",
      filter: { _id: "abc" },
    });
    // Sprint 254 — bounded *-many is WARN (was safe).
    expect(a.severity).toBe("warn");
    expect(a.kind).toBe("mongo-delete-many");
    expect(a.reasons).toEqual([]);
  });

  it("[AC-198-03e] updateMany with non-empty filter → warn / mongo-update-many (Sprint 254)", () => {
    const a = analyzeMongoOperation({
      kind: "updateMany",
      filter: { archived: false },
      patch: { reviewed: true },
    });
    expect(a.severity).toBe("warn");
    expect(a.kind).toBe("mongo-update-many");
  });

  // Sprint 312 (Phase 28 Slice A6) — `MongoOperation` widened with the 5
  // remaining write methods so the Run-dispatch table can classify every
  // mongosh write. Single-doc methods are INFO; bulkWrite escalates to
  // the worst sub-op severity (empty-filter *-many wins).

  it("[AC-312-safe-01] insertOne → info / mongo-other", () => {
    const a = analyzeMongoOperation({ kind: "insertOne" });
    expect(a.severity).toBe("info");
    expect(a.kind).toBe("mongo-other");
  });

  it("[AC-312-safe-02] insertMany → info / mongo-other", () => {
    const a = analyzeMongoOperation({ kind: "insertMany", count: 50 });
    expect(a.severity).toBe("info");
    expect(a.kind).toBe("mongo-other");
  });

  it("[AC-312-safe-03] updateOne (any filter) → info / mongo-other", () => {
    const a = analyzeMongoOperation({
      kind: "updateOne",
      filter: { _id: "x" },
    });
    expect(a.severity).toBe("info");
    expect(a.kind).toBe("mongo-other");
  });

  it("[AC-312-safe-04] deleteOne (any filter) → info / mongo-other", () => {
    const a = analyzeMongoOperation({
      kind: "deleteOne",
      filter: { active: true },
    });
    expect(a.severity).toBe("info");
  });

  it("[AC-312-safe-05] bulkWrite all-info sub-ops → info", () => {
    const a = analyzeMongoOperation({
      kind: "bulkWrite",
      ops: [
        { op: "insertOne", document: { x: 1 } },
        { op: "updateOne", filter: { _id: "y" }, update: { $set: { x: 2 } } },
        { op: "deleteOne", filter: { _id: "z" } },
      ],
    });
    expect(a.severity).toBe("info");
  });

  it("[AC-312-safe-06] bulkWrite with non-empty deleteMany sub-op → warn", () => {
    const a = analyzeMongoOperation({
      kind: "bulkWrite",
      ops: [
        { op: "insertOne", document: { x: 1 } },
        { op: "deleteMany", filter: { archived: true } },
      ],
    });
    expect(a.severity).toBe("warn");
  });

  it("[AC-312-safe-07] bulkWrite with empty-filter deleteMany → danger (STOP)", () => {
    const a = analyzeMongoOperation({
      kind: "bulkWrite",
      ops: [
        { op: "insertOne", document: { x: 1 } },
        { op: "deleteMany", filter: {} },
      ],
    });
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("mongo-delete-all");
  });

  it("[AC-312-safe-08] bulkWrite with empty-filter updateMany → danger (STOP)", () => {
    const a = analyzeMongoOperation({
      kind: "bulkWrite",
      ops: [{ op: "updateMany", filter: {}, update: { $set: { x: 1 } } }],
    });
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("mongo-update-all");
  });

  it("[AC-312-safe-09] bulkWrite empty ops array → info", () => {
    const a = analyzeMongoOperation({ kind: "bulkWrite", ops: [] });
    expect(a.severity).toBe("info");
  });
});

// Sprint 255 (2026-05-09) — `isInfoMongoOperation` 휴리스틱은 raw editor 의
// WARN dialog mount 직전에 read-only Mongo aggregate 을 식별해 dialog skip.
//
// Sprint 254 (2026-05-09) — 본문이 `severity === "info"` 단일 비교로 단순화
// 됐지만 매핑은 동일.
describe("isInfoMongoOperation (Sprint 255)", () => {
  it("[AC-255-02a] empty pipeline → INFO (no stages = read-only)", () => {
    expect(isInfoMongoOperation(analyzeMongoPipeline([]))).toBe(true);
  });

  it("[AC-255-02b] read-only pipeline ($match / $sort / $project) → INFO", () => {
    const a = analyzeMongoPipeline([
      { $match: { active: true } },
      { $sort: { name: 1 } },
      { $project: { _id: 0, name: 1 } },
    ]);
    expect(isInfoMongoOperation(a)).toBe(true);
  });

  it("[AC-255-02c] $group / $addFields / $unset (in-pipeline transformations) → INFO", () => {
    const a = analyzeMongoPipeline([
      { $addFields: { ts: 1 } },
      { $unset: ["temp"] },
      { $group: { _id: "$category", n: { $sum: 1 } } },
    ]);
    expect(isInfoMongoOperation(a)).toBe(true);
  });

  it("[AC-255-02d] $out → NOT INFO (danger / mongo-out)", () => {
    const a = analyzeMongoPipeline([{ $out: "snapshot" }]);
    expect(isInfoMongoOperation(a)).toBe(false);
  });

  it("[AC-255-02e] $merge → NOT INFO (danger / mongo-merge)", () => {
    const a = analyzeMongoPipeline([
      { $merge: { into: "target", whenMatched: "replace" } },
    ]);
    expect(isInfoMongoOperation(a)).toBe(false);
  });

  it("[AC-255-02f] dropCollection (operation, not pipeline) → NOT INFO", () => {
    const a = analyzeMongoOperation({ kind: "dropCollection" });
    expect(isInfoMongoOperation(a)).toBe(false);
  });

  it("[AC-255-02g] deleteMany WHERE (non-empty filter) → NOT INFO (WARN candidate, Sprint 254)", () => {
    const a = analyzeMongoOperation({
      kind: "deleteMany",
      filter: { _id: "abc" },
    });
    expect(isInfoMongoOperation(a)).toBe(false);
  });

  it("[AC-255-02h] updateMany WHERE (non-empty filter) → NOT INFO (WARN candidate, Sprint 254)", () => {
    const a = analyzeMongoOperation({
      kind: "updateMany",
      filter: { archived: false },
      patch: { reviewed: true },
    });
    expect(isInfoMongoOperation(a)).toBe(false);
  });
});
