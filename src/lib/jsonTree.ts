// Sprint 341 — utilities for the inline document tree (Option D).
//
// `buildTreeNodes` walks a JSON-ish value (objects, arrays, scalars, and
// `__bson__:<EJSON>` prefix-tagged BSON wrapper strings) into a flat
// list of records. Flat shape keeps render + filter cheap and lets the
// component use the same key=path map for collapse-state and pending
// edits.
//
// `computeTreeStats` derives the six headline numbers shown above the
// tree (NODES / KEYS / DEPTH / OBJECTS / ARRAYS / MAX ARRAY).

import { safeStringifyCell } from "@/lib/jsonCell";

export type TreeNodeKind = "obj" | "arr" | "leaf";

export type TreeLeafType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "bson"
  | "unknown";

export interface TreeNode {
  /** Dot-notation path from the column root (e.g. `glossary.GlossDiv.GlossList`). Root node = "". */
  path: string;
  /** Depth from the column root (root = 0). */
  depth: number;
  /** Key under the parent (`""` for root, the parent key for object children, `[i]` for array children). */
  label: string;
  kind: TreeNodeKind;
  /** For obj/arr: child count. For leaf: undefined. */
  childCount?: number;
  /** For leaf: raw value (rendered via safeStringifyCell when not a string). */
  leafValue?: unknown;
  /** For leaf: type tag rendered next to the value. */
  leafType?: TreeLeafType;
  /** True when this leaf came from a `__bson__:<EJSON>` wrapper string. */
  isBson?: boolean;
}

export interface TreeStats {
  nodes: number;
  keys: number;
  depth: number;
  objects: number;
  arrays: number;
  maxArray: number;
}

const BSON_TAG = "__bson__:";

function isBsonWrapperString(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(BSON_TAG);
}

function classifyLeaf(value: unknown): TreeLeafType {
  if (value === null) return "null";
  if (isBsonWrapperString(value)) return "bson";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "unknown";
  }
}

function joinPath(parent: string, segment: string): string {
  if (parent === "") return segment;
  if (segment.startsWith("[")) return `${parent}${segment}`;
  return `${parent}.${segment}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !isBsonWrapperString(v)
  );
}

/**
 * Walks `value` into a flat list of TreeNodes in render order.
 *
 * `__bson__:<EJSON>` prefix-tagged strings are treated as leaves (a
 * single ObjectId / Date / Decimal128 — not an unfolded object) so the
 * tree mirrors what the grid cell already shows.
 */
export function buildTreeNodes(value: unknown, basePath = ""): TreeNode[] {
  const out: TreeNode[] = [];

  const walk = (v: unknown, path: string, label: string, depth: number) => {
    if (isPlainObject(v)) {
      const keys = Object.keys(v);
      out.push({
        path,
        depth,
        label,
        kind: "obj",
        childCount: keys.length,
      });
      for (const k of keys) {
        walk(v[k], joinPath(path, k), k, depth + 1);
      }
      return;
    }
    if (Array.isArray(v)) {
      out.push({
        path,
        depth,
        label,
        kind: "arr",
        childCount: v.length,
      });
      v.forEach((item, idx) => {
        walk(item, joinPath(path, `[${idx}]`), `[${idx}]`, depth + 1);
      });
      return;
    }
    out.push({
      path,
      depth,
      label,
      kind: "leaf",
      leafValue: v,
      leafType: classifyLeaf(v),
      isBson: isBsonWrapperString(v),
    });
  };

  walk(value, basePath, basePath === "" ? "root" : basePath, 0);
  return out;
}

export function computeTreeStats(value: unknown): TreeStats {
  let nodes = 0;
  let keys = 0;
  let depth = 0;
  let objects = 0;
  let arrays = 0;
  let maxArray = 0;

  const walk = (v: unknown, currentDepth: number) => {
    nodes += 1;
    if (currentDepth > depth) depth = currentDepth;

    if (isPlainObject(v)) {
      objects += 1;
      const entries = Object.entries(v);
      keys += entries.length;
      for (const [, child] of entries) walk(child, currentDepth + 1);
      return;
    }
    if (Array.isArray(v)) {
      arrays += 1;
      if (v.length > maxArray) maxArray = v.length;
      for (const child of v) walk(child, currentDepth + 1);
      return;
    }
    // leaf — counted above.
  };

  walk(value, 0);

  return { nodes, keys, depth, objects, arrays, maxArray };
}

/**
 * Renders a leaf value the same way the inline editor input should
 * start out: strings keep their quotes, other primitives stringify
 * verbatim, and BSON wrapper strings show the EJSON payload.
 */
export function renderLeafValue(node: TreeNode): string {
  if (node.kind !== "leaf") return "";
  if (node.isBson && typeof node.leafValue === "string") {
    return node.leafValue.slice(BSON_TAG.length);
  }
  if (typeof node.leafValue === "string") {
    return `"${node.leafValue}"`;
  }
  if (node.leafValue === undefined) return "undefined";
  return safeStringifyCell(node.leafValue);
}

export interface FilterOptions {
  /** When true, `query` is compiled as a JS regex (case-insensitive). */
  regex?: boolean;
}

/**
 * Case-insensitive substring match over key (path tail) + rendered
 * leaf value. Returns the set of paths that should remain visible
 * (matches *and* all of their ancestors so the tree stays connected).
 *
 * Sprint 342 V2 — pass `{ regex: true }` to switch to JS regex matching.
 * Invalid regex sources fall back to substring (so the user can type a
 * partial pattern without the tree blanking out mid-edit).
 */
export function filterTreeNodes(
  nodes: TreeNode[],
  query: string,
  options: FilterOptions = {},
): Set<string> | null {
  const trimmed = query.trim();
  if (trimmed === "") return null;

  let matcher: (s: string) => boolean;
  if (options.regex) {
    try {
      const re = new RegExp(trimmed, "i");
      matcher = (s: string) => re.test(s);
    } catch {
      const lower = trimmed.toLowerCase();
      matcher = (s: string) => s.toLowerCase().includes(lower);
    }
  } else {
    const lower = trimmed.toLowerCase();
    matcher = (s: string) => s.toLowerCase().includes(lower);
  }

  const visible = new Set<string>();
  for (const node of nodes) {
    const labelHit = matcher(node.label);
    const valueHit = node.kind === "leaf" && matcher(renderLeafValue(node));
    if (labelHit || valueHit) {
      // walk the path back up by splitting on "." / "[i]" segments.
      visible.add(node.path);
      let cursor = node.path;
      while (cursor !== "") {
        const lastBracket = cursor.lastIndexOf("[");
        const lastDot = cursor.lastIndexOf(".");
        const cut = Math.max(lastBracket, lastDot);
        if (cut <= 0) {
          cursor = "";
        } else if (cut === lastBracket) {
          cursor = cursor.slice(0, cut);
        } else {
          cursor = cursor.slice(0, cut);
        }
        visible.add(cursor);
      }
    }
  }
  return visible;
}
