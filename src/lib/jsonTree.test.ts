// Sprint 341 (2026-05-15) — jsonTree util tests.
// Locks the tree-walk + stats contract so DocumentTreePanel stays stable
// when buildTreeNodes is reordered (e.g., depth-first vs breadth-first
// changes would break path order assertions in the UI).

import { describe, it, expect } from "vitest";
import {
  buildTreeNodes,
  buildTreeNodesWithGhosts,
  coerceTreeAddValue,
  computeTreeStats,
  renderLeafValue,
  filterTreeNodes,
  MAX_TREE_DEPTH,
  MAX_TREE_NODES,
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

  // Sprint 342 V2 (2026-05-15) — regex mode lets users find e.g. `Gloss\w+`
  // patterns. Locking the option=true branch so a future refactor (e.g.
  // moving the matcher into a hook) can't silently revert it to substring.
  it("regex option matches by JS regex (case-insensitive)", () => {
    const nodes = buildTreeNodes(GLOSSARY);
    const visible = filterTreeNodes(nodes, "^Gloss(See|Def)", { regex: true });
    expect(visible).not.toBeNull();
    expect(
      visible!.has("glossary.GlossDiv.GlossList.GlossEntry.GlossDef"),
    ).toBe(true);
    expect(
      visible!.has(
        "glossary.GlossDiv.GlossList.GlossEntry.GlossDef.GlossSeeAlso",
      ),
    ).toBe(true);
    // `ID` doesn't match — should NOT be in the visible set on its own.
    // (It would only be there if it sat on the path to a match.)
  });

  // Sprint 342 V2 — invalid regex source (e.g. user typing "[" mid-flight)
  // must not blank the tree out; fall back to substring matching so the
  // search bar stays responsive instead of throwing.
  it("regex option falls back to substring when source is invalid", () => {
    const nodes = buildTreeNodes(GLOSSARY);
    const visible = filterTreeNodes(nodes, "Gloss[", { regex: true });
    // "Gloss[" doesn't appear anywhere as substring; visible should be
    // an empty (but non-null) set.
    expect(visible).not.toBeNull();
    expect(visible!.size).toBe(0);
  });
});

// Sprint 344 Slice A (2026-05-15) — `buildTreeNodesWithGhosts` extends
// the base traversal so paths present only in `pendingByPath` (= ghost
// adds) render alongside the real value. Required for `+ key` / `+ item`
// affordances (Slices B/C) — without ghost rendering, a freshly added
// key vanishes from the tree until the user hits Save.
describe("buildTreeNodesWithGhosts", () => {
  // AC-344-A-01 — root-level ghost: a brand-new key that isn't in `value`
  // appears in the tree with `isGhost = true`.
  it("renders a root-level ghost path as a leaf marked isGhost", () => {
    const value = { name: "Felix" };
    const pending = new Map<string, string>([["tag", "alpha"]]);
    const nodes = buildTreeNodesWithGhosts(value, pending);
    const tag = nodes.find((n) => n.path === "tag");
    expect(tag).toBeDefined();
    expect(tag?.kind).toBe("leaf");
    expect(tag?.isGhost).toBe(true);
    expect(tag?.leafValue).toBe("alpha");
    // existing key stays non-ghost.
    expect(nodes.find((n) => n.path === "name")?.isGhost).toBeFalsy();
  });

  // AC-344-A-02 — edit + add can coexist on the same parent. A pending
  // entry whose path already exists in `value` is NOT promoted to ghost
  // (it's an edit on an existing leaf); only the truly new path is ghost.
  it("does not promote pending paths that already exist in value to ghost", () => {
    const value = { name: "Felix" };
    const pending = new Map<string, string>([
      ["name", "Bob"],
      ["tag", "alpha"],
    ]);
    const nodes = buildTreeNodesWithGhosts(value, pending);
    expect(nodes.find((n) => n.path === "name")?.isGhost).toBeFalsy();
    expect(nodes.find((n) => n.path === "tag")?.isGhost).toBe(true);
    // both still render — no de-dup.
    expect(nodes.filter((n) => n.path === "name")).toHaveLength(1);
    expect(nodes.filter((n) => n.path === "tag")).toHaveLength(1);
  });

  // AC-344-A-03 — ghost rows must appear at the END of the parent's
  // child list, in the order they were inserted into `pendingByPath`
  // (Map insertion order). Locks the contract so a future refactor
  // (e.g. sort by key) can't silently reorder ghosts.
  it("preserves pendingByPath insertion order for sibling ghosts", () => {
    const value = { name: "Felix" };
    const pending = new Map<string, string>([
      ["zeta", "z"],
      ["alpha", "a"],
      ["mu", "m"],
    ]);
    const nodes = buildTreeNodesWithGhosts(value, pending);
    const rootChildren = nodes.filter((n) => n.depth === 1).map((n) => n.label);
    // `name` (real) first, then ghosts in insertion order.
    expect(rootChildren).toEqual(["name", "zeta", "alpha", "mu"]);
  });

  // AC-344-A-04 — a ghost whose raw value parses as JSON object/array
  // is expanded into nested ghost children. The inner leaves carry
  // `isGhost = true` too so the UI can render them with the same
  // affordance.
  it("expands a JSON-parseable ghost into a nested ghost subtree", () => {
    const value = { name: "Felix" };
    const pending = new Map<string, string>([["meta", '{"role":"owner"}']]);
    const nodes = buildTreeNodesWithGhosts(value, pending);
    const meta = nodes.find((n) => n.path === "meta");
    expect(meta?.kind).toBe("obj");
    expect(meta?.isGhost).toBe(true);
    const role = nodes.find((n) => n.path === "meta.role");
    expect(role).toBeDefined();
    expect(role?.kind).toBe("leaf");
    expect(role?.isGhost).toBe(true);
    expect(role?.leafValue).toBe("owner");
  });

  // AC-344-A-04 (cont.) — a ghost whose raw value is NOT valid JSON
  // falls back to a string leaf. No crash.
  it("falls back to a string leaf when the ghost value cannot be parsed", () => {
    const value = { name: "Felix" };
    const pending = new Map<string, string>([["raw", "not-json {"]]);
    expect(() => buildTreeNodesWithGhosts(value, pending)).not.toThrow();
    const raw = buildTreeNodesWithGhosts(value, pending).find(
      (n) => n.path === "raw",
    );
    expect(raw?.kind).toBe("leaf");
    expect(raw?.isGhost).toBe(true);
    expect(raw?.leafValue).toBe("not-json {");
    expect(raw?.leafType).toBe("string");
  });

  // AC-344-A-06 — pure helper invariance: empty pending Map yields the
  // exact same output as `buildTreeNodes`. Locks the regression-zero
  // baseline so existing callers (DocumentTreePanel) can swap in the
  // ghost-aware builder without behavior drift on the common path.
  it("matches buildTreeNodes when pendingByPath is empty", () => {
    const value = { a: { b: 1 }, c: [1, 2] };
    const base = buildTreeNodes(value);
    const ghosts = buildTreeNodesWithGhosts(value, new Map());
    expect(ghosts).toEqual(base);
  });

  // AC-344-A-04 (cont.) — nested ghost inside an EXISTING parent path:
  // pending key `meta.role` while `meta` already exists in `value` as an
  // object → only `role` becomes a ghost child, attached to the real
  // `meta` node. Locks the depth-N ghost insertion logic, not just
  // root-level.
  it("inserts a ghost child under an existing object parent", () => {
    const value = { meta: { name: "Felix" } };
    const pending = new Map<string, string>([["meta.role", "owner"]]);
    const nodes = buildTreeNodesWithGhosts(value, pending);
    const role = nodes.find((n) => n.path === "meta.role");
    expect(role).toBeDefined();
    expect(role?.isGhost).toBe(true);
    expect(role?.leafValue).toBe("owner");
    // The pre-existing `meta.name` is unaffected.
    expect(nodes.find((n) => n.path === "meta.name")?.isGhost).toBeFalsy();
    // `role` appears AFTER `meta.name` (end of parent's children).
    const metaIdx = nodes.findIndex((n) => n.path === "meta");
    const nameIdx = nodes.findIndex((n) => n.path === "meta.name");
    const roleIdx = nodes.findIndex((n) => n.path === "meta.role");
    expect(metaIdx).toBeLessThan(nameIdx);
    expect(nameIdx).toBeLessThan(roleIdx);
  });

  // AC-344-A-04 (cont.) — JSON-array ghost expands to ghost children
  // with `[i]` bracket-notation paths, mirroring base array rendering.
  it("expands a JSON-array ghost into bracket-notation ghost children", () => {
    const value = {};
    const pending = new Map<string, string>([["tags", '["x","y"]']]);
    const nodes = buildTreeNodesWithGhosts(value, pending);
    const tags = nodes.find((n) => n.path === "tags");
    expect(tags?.kind).toBe("arr");
    expect(tags?.isGhost).toBe(true);
    const first = nodes.find((n) => n.path === "tags[0]");
    expect(first?.isGhost).toBe(true);
    expect(first?.leafValue).toBe("x");
  });

  // AC-344-A-04 (cont.) — pending values can also be passed as already-
  // parsed Records (the BSON wrapper-object branch of the union). The
  // helper must treat those as structured input, not stringify-and-parse.
  it("accepts a record-typed pending value as a nested ghost object", () => {
    const value = { name: "Felix" };
    const pending = new Map<string, string | Record<string, unknown>>([
      ["meta", { role: "owner" } as Record<string, unknown>],
    ]);
    const nodes = buildTreeNodesWithGhosts(value, pending);
    const meta = nodes.find((n) => n.path === "meta");
    expect(meta?.kind).toBe("obj");
    expect(meta?.isGhost).toBe(true);
    const role = nodes.find((n) => n.path === "meta.role");
    expect(role?.leafValue).toBe("owner");
    expect(role?.isGhost).toBe(true);
  });

  // Edge — value is itself an empty object and ALL pending keys are
  // ghosts. The output should still walk root first, then the ghost
  // children. Guards against an off-by-one parent-lookup bug where an
  // empty value collapses the loop early.
  it("renders ghosts when the base value is an empty object", () => {
    const value = {};
    const pending = new Map<string, string>([
      ["a", "1"],
      ["b", "2"],
    ]);
    const nodes = buildTreeNodesWithGhosts(value, pending);
    expect(nodes.map((n) => n.path)).toEqual(["", "a", "b"]);
    expect(nodes.find((n) => n.path === "a")?.isGhost).toBe(true);
    expect(nodes.find((n) => n.path === "b")?.isGhost).toBe(true);
  });

  // Edge — `__op__:unset` sentinel must NOT be expanded as a nested
  // ghost (it parses fine as a string, so the leafValue stays the raw
  // sentinel; but more importantly the path was already in `value`
  // so it shouldn't be ghost at all). Locks the interaction with the
  // existing delete sentinel.
  it("does not turn an __op__:unset on an existing leaf into a ghost", () => {
    const value = { name: "Felix" };
    const pending = new Map<string, string>([["name", "__op__:unset"]]);
    const nodes = buildTreeNodesWithGhosts(value, pending);
    expect(nodes.find((n) => n.path === "name")?.isGhost).toBeFalsy();
  });
});

// #1445 (2026-07-15) — DoS defense layer. Tree data crosses the trust
// boundary (DB server), so a hostile/malfunctioning server can return
// pathologically deep nesting (stack-overflows the recursive walk) or an
// oversized document (freezes the tab building millions of nodes).
// `buildTreeNodes` / `computeTreeStats` cap BOTH depth and node count and
// flag the cut with a `truncated` marker so the panel shows "…truncated"
// instead of hanging. These tests use counts above the caps but well under
// the JS call-stack limit, so the assertions fail cleanly (not via crash)
// before the guards exist.
describe("tree DoS guards (#1445)", () => {
  const makeDeep = (levels: number): Record<string, unknown> => {
    let node: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < levels; i += 1) node = { nested: node };
    return node;
  };
  const makeWide = (count: number): Record<string, number> => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < count; i += 1) obj[`k${i}`] = i;
    return obj;
  };

  it("exposes MAX_TREE_DEPTH / MAX_TREE_NODES as positive constants", () => {
    expect(MAX_TREE_DEPTH).toBeGreaterThan(0);
    expect(MAX_TREE_NODES).toBeGreaterThan(0);
  });

  it("caps deeply nested input at MAX_TREE_DEPTH and flags truncation", () => {
    // 1000-deep (5x the cap) — the current unbounded walk still returns
    // (RED: no truncation, depth 1000), the guarded walk stops at the cap.
    const nodes = buildTreeNodes(makeDeep(1000));
    expect(nodes.some((n) => n.truncated)).toBe(true);
    expect(nodes.every((n) => n.depth <= MAX_TREE_DEPTH)).toBe(true);
  });

  it("caps oversized documents at MAX_TREE_NODES and flags truncation", () => {
    // 60k flat keys (> the node cap) — a fast build, no recursion depth.
    const nodes = buildTreeNodes(makeWide(60_000));
    expect(nodes.length).toBeLessThanOrEqual(MAX_TREE_NODES + 1);
    expect(nodes.some((n) => n.truncated)).toBe(true);
  });

  it("keeps computeTreeStats bounded on deep + wide hostile input", () => {
    expect(computeTreeStats(makeDeep(1000)).depth).toBeLessThanOrEqual(
      MAX_TREE_DEPTH,
    );
    expect(computeTreeStats(makeWide(60_000)).nodes).toBeLessThanOrEqual(
      MAX_TREE_NODES,
    );
  });

  it("does not truncate ordinary documents (regression-zero)", () => {
    const nodes = buildTreeNodes(GLOSSARY);
    expect(nodes.some((n) => n.truncated)).toBe(false);
  });

  it("guards buildTreeNodesWithGhosts against a deep ghost paste", () => {
    // A user pasting a deeply nested JSON blob into a `+ key` value must
    // not stack-overflow the ghost walk either.
    const pending = new Map<string, string>([
      ["blob", JSON.stringify(makeDeep(1000))],
    ]);
    expect(() => buildTreeNodesWithGhosts({}, pending)).not.toThrow();
    const nodes = buildTreeNodesWithGhosts({}, pending);
    expect(nodes.every((n) => n.depth <= MAX_TREE_DEPTH)).toBe(true);
  });
});

// Sprint 344 Slice D (2026-05-15) — `coerceTreeAddValue` turns a user-
// typed raw string (from the `+ key` / `+ item` inline inputs) into a
// JSON-typed commit payload. Outer-quotes rule: trim, try `JSON.parse`;
// success → parsed value (number/bool/null/object/array/quoted-string);
// failure → trimmed raw string. Pure / deterministic / never throws.
describe("coerceTreeAddValue", () => {
  // AC-344-D-02 (2026-05-15) — bare digits parse as number. The whole
  // "outer-quotes rule" hinges on this: a user typing `42` (no quotes)
  // must commit as a NUMBER token, not a string.
  it("returns number for bare numeric input (AC-344-D-02)", () => {
    expect(coerceTreeAddValue("42")).toBe(42);
  });

  // AC-344-D-01 (2026-05-15) — quoted digits parse as a JSON string
  // literal. JSON.parse('"42"') returns the string "42"; the outer
  // quotes flag the user's intent that the value is textual.
  it("returns string when input is a quoted JSON string literal (AC-344-D-01)", () => {
    expect(coerceTreeAddValue('"42"')).toBe("42");
  });

  // AC-344-D-07 (2026-05-15) — non-JSON free text falls back to the
  // raw trimmed string. JSON.parse throws on `hello world`; the catch
  // branch must return the input verbatim so the user sees what they
  // typed.
  it("returns raw string when JSON.parse fails on free text (AC-344-D-07)", () => {
    expect(coerceTreeAddValue("hello world")).toBe("hello world");
  });

  // AC-344-D-03 (2026-05-15) — lowercase `null` is a JSON primitive.
  // Must coerce to the JS `null` value (not the string "null").
  it("returns null for the bare token 'null' (AC-344-D-03)", () => {
    expect(coerceTreeAddValue("null")).toBeNull();
  });

  // AC-344-D-04 (2026-05-15) — lowercase `true` / `false` are JSON
  // booleans. Locks both branches so a future regex-based shortcut
  // can't accidentally drop one.
  it("returns boolean for 'true' / 'false' tokens (AC-344-D-04)", () => {
    expect(coerceTreeAddValue("true")).toBe(true);
    expect(coerceTreeAddValue("false")).toBe(false);
  });

  // AC-344-D-05 (2026-05-15) — JSON object literal expands to a
  // structured value. Slice A's ghost renderer relies on this to walk
  // a nested ghost subtree from a single `+ key` commit.
  it("returns parsed object for JSON object input (AC-344-D-05)", () => {
    expect(coerceTreeAddValue('{"a":1}')).toEqual({ a: 1 });
  });

  // AC-344-D-06 (2026-05-15) — JSON array literal expands the same
  // way. The mixed-type array `[1, "x"]` doubles as a guard that
  // inner string elements keep their type.
  it("returns parsed array for JSON array input (AC-344-D-06)", () => {
    expect(coerceTreeAddValue('[1,"x"]')).toEqual([1, "x"]);
  });

  // AC-344-D-08 (2026-05-15) — malformed JSON (`{broken`) must NOT
  // throw; it falls back to the raw trimmed string so the user can
  // keep typing without the panel exploding.
  it("returns raw string when JSON is malformed (AC-344-D-08)", () => {
    expect(coerceTreeAddValue("{broken")).toBe("{broken");
  });

  // AC-344-D-09 (2026-05-15) — empty string commit. `JSON.parse("")`
  // throws, so the contract specifies raw `""` is returned. The user
  // explicitly typed nothing; respect that as an empty string.
  it("returns empty string for empty input (AC-344-D-09)", () => {
    expect(coerceTreeAddValue("")).toBe("");
  });

  // AC-344-D-10 (2026-05-15) — leading/trailing whitespace is trimmed
  // BEFORE the parse attempt. `  42  ` must coerce to number 42, not
  // a string with padding. Locks the trim semantics.
  it("trims whitespace before parsing (AC-344-D-10)", () => {
    expect(coerceTreeAddValue("  42  ")).toBe(42);
  });

  // AC-344-D-11 (2026-05-15) — pure function check: 100 invocations
  // with the same input must produce strictly equal output. Guards
  // against any future caching/memo bug that returns a fresh object
  // reference and breaks `===` callers.
  it("is pure — 100 invocations of same input yield same output (AC-344-D-11)", () => {
    const inputs: Array<[string, unknown]> = [
      ["42", 42],
      ['"42"', "42"],
      ["null", null],
      ["true", true],
      ["false", false],
      ["hello world", "hello world"],
      ["", ""],
    ];
    for (const [input, expected] of inputs) {
      for (let i = 0; i < 100; i += 1) {
        expect(coerceTreeAddValue(input)).toBe(expected);
      }
    }
    // Deep-equal case for objects/arrays — same input must produce
    // structurally equal output across invocations.
    for (let i = 0; i < 100; i += 1) {
      expect(coerceTreeAddValue('{"a":1}')).toEqual({ a: 1 });
      expect(coerceTreeAddValue('[1,"x"]')).toEqual([1, "x"]);
    }
  });

  // Contract extra (2026-05-15) — negative numbers are valid JSON
  // numbers. Locks the sign branch so a future shortcut that only
  // checks digit characters can't break this.
  it("returns number for negative integers", () => {
    expect(coerceTreeAddValue("-5")).toBe(-5);
  });

  // Contract extra (2026-05-15) — very large numbers near the JSON
  // upper bound (1e308) still parse as numbers (not Infinity, not
  // strings). Guards against a poorly placed Number.isFinite check.
  it("returns number for very large numeric input", () => {
    expect(coerceTreeAddValue("1e308")).toBe(1e308);
  });

  // Contract extra (2026-05-15) — zero is a JSON number, not a
  // falsy-coerced string. Subtle case because empty-string also
  // coerces to 0 under `Number("")` — locks JSON.parse semantics.
  it("returns number 0 for '0' input (not empty-string fallback)", () => {
    expect(coerceTreeAddValue("0")).toBe(0);
  });

  // Contract extra (2026-05-15) — floating point numbers parse
  // correctly. Common case for users typing `3.14` into the value
  // input.
  it("returns number for floating point input", () => {
    expect(coerceTreeAddValue("3.14")).toBe(3.14);
  });

  // Contract extra (2026-05-15) — whitespace-only input is also
  // empty after trim and falls back to raw "" (the trimmed string).
  // JSON.parse("") throws, so the catch branch returns the trimmed
  // empty string — consistent with AC-344-D-09.
  it("returns empty string for whitespace-only input", () => {
    expect(coerceTreeAddValue("   ")).toBe("");
  });

  // Contract extra (2026-05-15) — return type stays `unknown`. The
  // helper consumers narrow via runtime type checks; this guards the
  // declared signature so a future refactor can't loosen it to `any`.
  // (Compile-time only — runtime assertion is a no-op for type cov.)
  it("declares unknown return so callers must narrow", () => {
    const out: unknown = coerceTreeAddValue("42");
    expect(typeof out).toBe("number");
  });
});
