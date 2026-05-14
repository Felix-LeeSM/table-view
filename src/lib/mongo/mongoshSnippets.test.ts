// Sprint 310 (2026-05-14) — Phase 28 Slice A4 snippet data lock.
//
// 검증 대상:
// - Methods 13 개가 `MONGOSH_METHOD_WHITELIST` 와 1:1 매칭 (Query 6 +
//   Mutation 7 분할이 single source 로부터 derived 인지).
// - Operators 13 개가 contract 가 명시한 frequency 순서 (Q7 order) 를
//   따르는지.
// - Stages 14 개가 spec 의 핵심 set 을 모두 cover 하는지.
// - 모든 snippet 의 `insertText` 가 `<placeholder>` 문법 (D-06) 을 사용
//   하는지 + operator/stage 가 wrapped fragment (D-08) 인지.

import { describe, it, expect } from "vitest";
import { MONGOSH_METHOD_WHITELIST } from "@/lib/mongo/mongoshParser";
import {
  MONGOSH_QUERY_METHOD_SNIPPETS,
  MONGOSH_MUTATION_METHOD_SNIPPETS,
  MONGOSH_OPERATOR_SNIPPETS,
  MONGOSH_STAGE_SNIPPETS,
  ALL_MONGOSH_SNIPPETS,
  type MongoshSnippet,
} from "./mongoshSnippets";

describe("mongoshSnippets — Query methods (6)", () => {
  it("lists exactly the 6 read methods in canonical order", () => {
    expect(MONGOSH_QUERY_METHOD_SNIPPETS.map((s) => s.label)).toEqual([
      "find",
      "findOne",
      "aggregate",
      "countDocuments",
      "estimatedDocumentCount",
      "distinct",
    ]);
  });

  it("every Query method label is a member of MONGOSH_METHOD_WHITELIST (single source)", () => {
    const whitelist = new Set<string>(MONGOSH_METHOD_WHITELIST);
    for (const s of MONGOSH_QUERY_METHOD_SNIPPETS) {
      expect(whitelist.has(s.label)).toBe(true);
    }
  });

  it("uses <placeholder> syntax (D-06) — every template contains at least one <...> marker", () => {
    for (const s of MONGOSH_QUERY_METHOD_SNIPPETS) {
      expect(s.insertText).toMatch(/<[a-zA-Z0-9_]+>/);
    }
  });

  it("templates start with the db.<collection>.<method>( shape", () => {
    for (const s of MONGOSH_QUERY_METHOD_SNIPPETS) {
      expect(s.insertText).toContain(`db.<collection>.${s.label}(`);
    }
  });
});

describe("mongoshSnippets — Mutation methods (7)", () => {
  it("lists exactly the 7 write methods in canonical order", () => {
    expect(MONGOSH_MUTATION_METHOD_SNIPPETS.map((s) => s.label)).toEqual([
      "insertOne",
      "insertMany",
      "updateOne",
      "updateMany",
      "deleteOne",
      "deleteMany",
      "bulkWrite",
    ]);
  });

  it("every Mutation method label is a member of MONGOSH_METHOD_WHITELIST (single source)", () => {
    const whitelist = new Set<string>(MONGOSH_METHOD_WHITELIST);
    for (const s of MONGOSH_MUTATION_METHOD_SNIPPETS) {
      expect(whitelist.has(s.label)).toBe(true);
    }
  });

  it("uses <placeholder> syntax (D-06)", () => {
    for (const s of MONGOSH_MUTATION_METHOD_SNIPPETS) {
      expect(s.insertText).toMatch(/<[a-zA-Z0-9_]+>/);
    }
  });
});

describe("mongoshSnippets — single source partition (13 = 6 + 7)", () => {
  it("Query + Mutation snippets exactly partition the 13-method whitelist", () => {
    const partition = [
      ...MONGOSH_QUERY_METHOD_SNIPPETS,
      ...MONGOSH_MUTATION_METHOD_SNIPPETS,
    ].map((s) => s.label);
    expect(new Set(partition)).toEqual(new Set(MONGOSH_METHOD_WHITELIST));
    expect(partition.length).toBe(MONGOSH_METHOD_WHITELIST.length);
  });
});

describe("mongoshSnippets — Operators (13, Q7 order)", () => {
  it("renders the 13 filter operators in the contract's Q7 order", () => {
    // Contract sprint-310 §AC-03: `$eq $ne $gt $gte $lt $lte $in $nin $exists $regex $or $and $not`
    expect(MONGOSH_OPERATOR_SNIPPETS.map((s) => s.label)).toEqual([
      "$eq",
      "$ne",
      "$gt",
      "$gte",
      "$lt",
      "$lte",
      "$in",
      "$nin",
      "$exists",
      "$regex",
      "$or",
      "$and",
      "$not",
    ]);
  });

  it("each operator template is a wrapped fragment `{ $op: <value> }` (D-08)", () => {
    for (const s of MONGOSH_OPERATOR_SNIPPETS) {
      expect(s.insertText).toMatch(/^\{\s*\$/);
      expect(s.insertText.endsWith("}")).toBe(true);
      expect(s.insertText).toContain(s.label);
      expect(s.insertText).toMatch(/<[a-zA-Z0-9_]+>/);
    }
  });
});

describe("mongoshSnippets — Stages (14)", () => {
  it("renders at least 14 aggregate stages drawn from MONGO_AGGREGATE_STAGES", () => {
    expect(MONGOSH_STAGE_SNIPPETS.length).toBeGreaterThanOrEqual(14);
    const labels = MONGOSH_STAGE_SNIPPETS.map((s) => s.label);
    // Spec sprint-307 A4 §3 — 14 core stages must be present.
    for (const required of [
      "$match",
      "$project",
      "$group",
      "$sort",
      "$limit",
      "$skip",
      "$unwind",
      "$lookup",
      "$count",
      "$addFields",
      "$replaceRoot",
      "$facet",
      "$out",
      "$merge",
    ]) {
      expect(labels).toContain(required);
    }
  });

  it("each stage template is a wrapped fragment (D-08)", () => {
    for (const s of MONGOSH_STAGE_SNIPPETS) {
      expect(s.insertText).toMatch(/^\{\s*\$/);
      expect(s.insertText.endsWith("}")).toBe(true);
      expect(s.insertText).toContain(s.label);
    }
  });
});

describe("mongoshSnippets — ALL_MONGOSH_SNIPPETS aggregate", () => {
  it("preserves section ordering and is non-empty", () => {
    expect(ALL_MONGOSH_SNIPPETS).toEqual([
      { label: "Query methods", entries: MONGOSH_QUERY_METHOD_SNIPPETS },
      { label: "Mutation methods", entries: MONGOSH_MUTATION_METHOD_SNIPPETS },
      { label: "Operators", entries: MONGOSH_OPERATOR_SNIPPETS },
      { label: "Stages", entries: MONGOSH_STAGE_SNIPPETS },
    ]);
  });

  it("MongoshSnippet shape: { label, insertText, description? }", () => {
    const samples: readonly MongoshSnippet[] = MONGOSH_QUERY_METHOD_SNIPPETS;
    for (const s of samples) {
      expect(typeof s.label).toBe("string");
      expect(typeof s.insertText).toBe("string");
      // description is optional but if present must be a string.
      if (s.description !== undefined) {
        expect(typeof s.description).toBe("string");
      }
    }
  });
});
