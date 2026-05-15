// Sprint 341 (2026-05-15) — jsonTree util tests.
// Locks the tree-walk + stats contract so DocumentTreePanel stays stable
// when buildTreeNodes is reordered (e.g., depth-first vs breadth-first
// changes would break path order assertions in the UI).

import { describe, it, expect } from "vitest";
import {
  buildTreeNodes,
  computeTreeStats,
  renderLeafValue,
  filterTreeNodes,
} from "./jsonTree";

const GLOSSARY = {
  glossary: {
    title: "example glossary",
    GlossDiv: {
      title: "S",
      GlossList: {
        GlossEntry: {
          ID: "SGML",
          Acronym: "SGML",
          GlossDef: {
            para: "A meta-markup language",
            GlossSeeAlso: ["GML", "XML"],
          },
        },
      },
    },
  },
};

describe("computeTreeStats", () => {
  it("matches the jsoncrack reference counts for the canonical glossary doc", () => {
    const stats = computeTreeStats(GLOSSARY);
    // root + glossary + title + GlossDiv + title + GlossList +
    // GlossEntry + ID + Acronym + GlossDef + para + GlossSeeAlso
    // + 2 array items = 14 nodes.
    expect(stats.nodes).toBe(14);
    expect(stats.objects).toBe(6);
    expect(stats.arrays).toBe(1);
    expect(stats.maxArray).toBe(2);
    expect(stats.depth).toBeGreaterThanOrEqual(7);
  });

  it("handles scalar root", () => {
    expect(computeTreeStats(42)).toEqual({
      nodes: 1,
      keys: 0,
      depth: 0,
      objects: 0,
      arrays: 0,
      maxArray: 0,
    });
  });

  it("treats __bson__ wrapper strings as leaves, not objects", () => {
    const value = {
      _id: '__bson__:{"$oid":"6679abcdcdef012345678901"}',
      created: '__bson__:{"$date":"2026-05-15T00:00:00Z"}',
    };
    const stats = computeTreeStats(value);
    expect(stats.objects).toBe(1); // only the outer obj
    expect(stats.nodes).toBe(3); // outer + 2 leaves
  });
});

describe("buildTreeNodes", () => {
  it("emits nodes in render order (parent before children)", () => {
    const nodes = buildTreeNodes({ a: { b: 1 } });
    expect(nodes.map((n) => n.path)).toEqual(["", "a", "a.b"]);
  });

  it("uses [i] bracket notation for array children", () => {
    const nodes = buildTreeNodes({ tags: ["x", "y"] });
    expect(nodes.map((n) => n.path)).toEqual([
      "",
      "tags",
      "tags[0]",
      "tags[1]",
    ]);
  });

  it("tags BSON wrapper leaves with isBson + leafType=bson", () => {
    const nodes = buildTreeNodes({
      _id: '__bson__:{"$oid":"6679abcdcdef012345678901"}',
    });
    const leaf = nodes.find((n) => n.path === "_id");
    expect(leaf?.kind).toBe("leaf");
    expect(leaf?.isBson).toBe(true);
    expect(leaf?.leafType).toBe("bson");
  });

  it("distinguishes null vs undefined leaves", () => {
    const nodes = buildTreeNodes({ a: null });
    expect(nodes.find((n) => n.path === "a")?.leafType).toBe("null");
  });
});

describe("renderLeafValue", () => {
  it("wraps strings in quotes", () => {
    const nodes = buildTreeNodes({ name: "Felix" });
    const leaf = nodes[1]!;
    expect(renderLeafValue(leaf)).toBe('"Felix"');
  });

  it("strips __bson__: prefix so the EJSON shows raw", () => {
    const nodes = buildTreeNodes({
      _id: '__bson__:{"$oid":"abc"}',
    });
    const leaf = nodes[1]!;
    expect(renderLeafValue(leaf)).toBe('{"$oid":"abc"}');
  });
});

describe("filterTreeNodes", () => {
  it("returns null when query is empty (no filtering)", () => {
    const nodes = buildTreeNodes(GLOSSARY);
    expect(filterTreeNodes(nodes, "  ")).toBeNull();
  });

  it("matches on key substring and keeps ancestors visible", () => {
    const nodes = buildTreeNodes(GLOSSARY);
    const visible = filterTreeNodes(nodes, "GlossSeeAlso");
    expect(visible).not.toBeNull();
    // The match itself + every ancestor up to root must be present.
    const expected = [
      "",
      "glossary",
      "glossary.GlossDiv",
      "glossary.GlossDiv.GlossList",
      "glossary.GlossDiv.GlossList.GlossEntry",
      "glossary.GlossDiv.GlossList.GlossEntry.GlossDef",
      "glossary.GlossDiv.GlossList.GlossEntry.GlossDef.GlossSeeAlso",
    ];
    for (const path of expected) {
      expect(visible!.has(path)).toBe(true);
    }
  });

  it("matches on leaf value substring", () => {
    const nodes = buildTreeNodes(GLOSSARY);
    const visible = filterTreeNodes(nodes, "meta-markup");
    expect(visible).not.toBeNull();
    expect(
      visible!.has("glossary.GlossDiv.GlossList.GlossEntry.GlossDef.para"),
    ).toBe(true);
  });
});
