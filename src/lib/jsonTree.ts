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
  /**
   * Sprint 344 Slice A — true when this node exists only in
   * `pendingByPath` (a brand-new key/item) and not in the underlying
   * `value`. Used by DocumentTreePanel to render a "NEW" badge so
   * users can distinguish ghost adds from `● edited` leaf updates.
   */
  isGhost?: boolean;
  /**
   * #1445 — the walk stopped here to enforce {@link MAX_TREE_DEPTH} /
   * {@link MAX_TREE_NODES}. Set on the deepest emitted container when the
   * depth cap is hit, or on a terminal marker leaf when the node cap is
   * hit. The subtree below is intentionally NOT rendered — a DoS guard
   * against hostile server data (extreme nesting / oversized documents).
   * DocumentTreePanel renders these rows as a "…truncated" indicator.
   */
  truncated?: boolean;
}

/**
 * #1445 — DoS caps for the tree walk. Tree data comes from the DB server
 * (outside the trust boundary), so a hostile or malfunctioning server can
 * return a pathologically deep structure (which would overflow the
 * recursive walk's call stack) or an oversized document (which would
 * freeze the tab building millions of nodes).
 *
 * All three walks below honour both caps. `buildTreeNodes` and the ghost-
 * paste walk in `buildTreeNodesWithGhosts` (#1500) stop at the caps and
 * flag the cut with a `truncated` marker node so the panel shows
 * "…truncated". `computeTreeStats` also stops at the caps but emits no
 * marker (it has no nodes — its stats just go approximate at the extreme,
 * which is fine for hostile input).
 *
 * `MAX_TREE_DEPTH` sits well above any legitimate document (MongoDB's own
 * BSON nesting limit is 100) and far below the JS call-stack ceiling.
 * `MAX_TREE_NODES` bounds the flat list the panel materialises.
 */
export const MAX_TREE_DEPTH = 200;
export const MAX_TREE_NODES = 50_000;

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
    // #1445 node cap — stop emitting once the flat list is full; a single
    // terminal marker is appended after the root walk returns.
    if (out.length >= MAX_TREE_NODES) return;
    // #1445 depth cap — a container at the cap is emitted but NOT descended
    // into, so the recursion depth (and stack) stays bounded.
    const atDepthCap = depth >= MAX_TREE_DEPTH;
    if (isPlainObject(v)) {
      const keys = Object.keys(v);
      const node: TreeNode = {
        path,
        depth,
        label,
        kind: "obj",
        childCount: keys.length,
      };
      if (atDepthCap) node.truncated = true;
      out.push(node);
      if (atDepthCap) return;
      for (const k of keys) {
        walk(v[k], joinPath(path, k), k, depth + 1);
      }
      return;
    }
    if (Array.isArray(v)) {
      const node: TreeNode = {
        path,
        depth,
        label,
        kind: "arr",
        childCount: v.length,
      };
      if (atDepthCap) node.truncated = true;
      out.push(node);
      if (atDepthCap) return;
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
  // #1445 — node-count truncation: append one terminal marker so the panel
  // shows "…truncated" rather than a silently-clipped tree.
  if (out.length >= MAX_TREE_NODES) {
    out.push({
      path: `${basePath}…truncated`,
      depth: 0,
      label: "…",
      kind: "leaf",
      leafType: "unknown",
      truncated: true,
    });
  }
  return out;
}

/**
 * Sprint 344 Slice A — extend `buildTreeNodes` so paths present only
 * in `pendingByPath` (= brand-new keys/items not in `value` yet) also
 * render as TreeNodes, marked `isGhost: true`. Ghosts are inserted at
 * the END of their parent's child list in `pendingByPath` insertion
 * order, matching the contract used by the upcoming `+ key` / `+ item`
 * affordances (Slices B/C).
 *
 * Ghost values that JSON-parse into an object/array expand into nested
 * ghost children (so a single `pendingByPath["meta"]` entry holding
 * `'{"role":"owner"}'` produces both `meta` and `meta.role`). Parse
 * failures fall back to a string leaf — no crash.
 *
 * Pure: no mutation, no I/O. Empty `pendingByPath` returns exactly
 * what `buildTreeNodes(value, basePath)` returns (regression-zero).
 */
export function buildTreeNodesWithGhosts(
  value: unknown,
  pendingByPath: ReadonlyMap<string, string | Record<string, unknown>>,
  basePath = "",
): TreeNode[] {
  const base = buildTreeNodes(value, basePath);
  if (pendingByPath.size === 0) return base;

  const basePaths = new Set(base.map((n) => n.path));
  // Ghost candidates: pending entries whose path is NOT already in
  // `value`. (Pending hits on an existing path are leaf-edits / deletes
  // handled by the panel's render branch, not ghost adds.)
  const ghostEntries: Array<{
    path: string;
    raw: string | Record<string, unknown>;
  }> = [];
  for (const [path, raw] of pendingByPath) {
    if (basePaths.has(path)) continue;
    ghostEntries.push({ path, raw });
  }
  if (ghostEntries.length === 0) return base;

  // Walk each ghost path and assemble its nested children. Keep a
  // running set of paths we've already emitted so deeper ghost
  // children (e.g. `meta.role` while `meta` itself is also a ghost)
  // attribute to the right parent without duplicating.
  const emitted = new Set(basePaths);
  // Group ghosts by parent path so we can splice them at the end of
  // each parent's child block in insertion order.
  const childrenByParent = new Map<string, TreeNode[]>();

  // #1619 — node cap shared across EVERY ghost block. The walk used to cap
  // each block's own `out.length`, so N separate `+ key` pastes could each
  // reach MAX_TREE_NODES (N × 50k combined). One shared counter bounds the
  // COMBINED ghost total instead; `ghostTruncated` guarantees exactly one
  // terminal marker for the whole set, not one per block.
  let ghostNodeCount = 0;
  let ghostTruncated = false;

  const ghostWalk = (
    v: unknown,
    path: string,
    label: string,
    depth: number,
    out: TreeNode[],
  ) => {
    // #1500 / #1619 node cap — a user can paste an oversized JSON blob into a
    // `+ key` value; stop emitting once the SHARED ghost total is full so
    // neither a single blob nor many blocks in aggregate freeze the panel
    // materialising millions of ghost rows. The caller appends one terminal
    // marker after the cap is hit (mirrors `buildTreeNodes`). O(1) per node.
    if (ghostNodeCount >= MAX_TREE_NODES) return;
    ghostNodeCount += 1;
    // #1445 depth cap — cap the ghost recursion at the same depth so a
    // deeply nested blob can't overflow the stack. The container is
    // emitted, its children are not.
    const atDepthCap = depth >= MAX_TREE_DEPTH;
    if (isPlainObject(v)) {
      const keys = Object.keys(v);
      const node: TreeNode = {
        path,
        depth,
        label,
        kind: "obj",
        childCount: keys.length,
        isGhost: true,
      };
      if (atDepthCap) node.truncated = true;
      out.push(node);
      if (atDepthCap) return;
      for (const k of keys) {
        ghostWalk(v[k], joinPath(path, k), k, depth + 1, out);
      }
      return;
    }
    if (Array.isArray(v)) {
      const node: TreeNode = {
        path,
        depth,
        label,
        kind: "arr",
        childCount: v.length,
        isGhost: true,
      };
      if (atDepthCap) node.truncated = true;
      out.push(node);
      if (atDepthCap) return;
      v.forEach((item, idx) => {
        ghostWalk(item, joinPath(path, `[${idx}]`), `[${idx}]`, depth + 1, out);
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
      isGhost: true,
    });
  };

  const parentOf = (path: string): { parent: string; label: string } => {
    if (path === "") return { parent: "", label: "" };
    const lastBracket = path.lastIndexOf("[");
    const lastDot = path.lastIndexOf(".");
    const cut = Math.max(lastBracket, lastDot);
    if (cut < 0) return { parent: basePath, label: path };
    if (cut === lastBracket) {
      return { parent: path.slice(0, cut), label: path.slice(cut) };
    }
    return { parent: path.slice(0, cut), label: path.slice(cut + 1) };
  };

  const expandedGhostValue = (
    raw: string | Record<string, unknown>,
  ): unknown => {
    if (typeof raw !== "string") return raw;
    // Try JSON.parse — object/array results expand, primitives fall
    // through to string leaf (per AC-344-A-04 fallback).
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isPlainObject(parsed) || Array.isArray(parsed)) return parsed;
    } catch {
      // not JSON — treat as raw string.
    }
    return raw;
  };

  // Depth ordering: deeper ghost paths must see their parent (whether
  // real or ghost) already accounted for. Sort by segment count to
  // process shallow ghosts first.
  const depthOf = (p: string): number => {
    if (p === "") return 0;
    // A bracket-led path (`[0]…`, an array-column root child) has no leading
    // bare-key segment, so start at 0 and let the `[` counter below account
    // for the first index. Dot-led / bare-key paths keep the +1 for their
    // first segment. Without this, `[0].a` counted as depth 3 while its
    // sibling `[0].id` (via buildTreeNodes) is depth 2 — the ghost rendered
    // one indent too deep. Result now equals buildTreeNodes' segment count.
    let n = p.startsWith("[") ? 0 : 1;
    for (let i = 0; i < p.length; i += 1) {
      const ch = p.charAt(i);
      if (ch === "." || ch === "[") n += 1;
    }
    return n;
  };

  for (const entry of ghostEntries) {
    const { parent, label } = parentOf(entry.path);
    const depth = depthOf(entry.path);
    const expanded = expandedGhostValue(entry.raw);
    const block: TreeNode[] = [];
    ghostWalk(expanded, entry.path, label, depth, block);
    // #1500 / #1619 node-count truncation — mirror `buildTreeNodes`, but key
    // off the SHARED counter: append exactly one terminal marker (not one per
    // block) at the block where the combined ghost total first hits the cap,
    // so an oversized paste — or many blocks in aggregate — shows a truncation
    // indicator instead of a silently-clipped subtree. The marker is a leaf
    // status row; DocumentTreePanel renders it with `focusable: !n.truncated`,
    // keeping it out of the roving order.
    if (ghostNodeCount >= MAX_TREE_NODES && !ghostTruncated) {
      ghostTruncated = true;
      block.push({
        path: `${entry.path}…truncated`,
        depth,
        label: "…",
        kind: "leaf",
        leafType: "unknown",
        isGhost: true,
        truncated: true,
      });
    }
    for (const node of block) emitted.add(node.path);
    const bucket = childrenByParent.get(parent);
    if (bucket) bucket.push(...block);
    else childrenByParent.set(parent, [...block]);
  }

  // Splice each ghost block in at the END of its parent's child range
  // in `base`. The "end of child range" for a node N is the index right
  // before the next base node whose depth ≤ N.depth (or end-of-array).
  // Crucially, when a deep leaf ends, MULTIPLE ancestor blocks may
  // end simultaneously — so after pushing each base node we drain ghost
  // buckets for every ancestor whose subtree ends at this position.
  const result: TreeNode[] = [];
  for (let i = 0; i < base.length; i += 1) {
    const node = base[i];
    if (node === undefined) continue;
    result.push(node);
    const nextBase = base[i + 1];
    // Drain ghost children for `node` itself first (its own subtree
    // ends here if next sibling has depth ≤ node.depth, or no next).
    if (nextBase === undefined || nextBase.depth <= node.depth) {
      const ghosts = childrenByParent.get(node.path);
      if (ghosts) {
        result.push(...ghosts);
        childrenByParent.delete(node.path);
      }
    }
    // Then drain ancestor ghost buckets whose subtree also ends here.
    // An ancestor A ends iff next base depth ≤ A.depth (or no next).
    // We walk up `node.path` segment by segment to enumerate ancestors.
    const nextDepth = nextBase === undefined ? -1 : nextBase.depth;
    let cursor = node.path;
    while (cursor !== basePath) {
      const { parent } = parentOf(cursor);
      // The parent's depth in the base tree = depthOf(parent) when
      // basePath = "". With a non-empty basePath the math is the
      // same because both use the same joinPath semantics.
      const parentDepth = parent === basePath ? 0 : depthOf(parent);
      if (nextDepth > parentDepth) break;
      const ghosts = childrenByParent.get(parent);
      if (ghosts) {
        result.push(...ghosts);
        childrenByParent.delete(parent);
      }
      if (parent === basePath) break;
      cursor = parent;
    }
  }

  // Ghosts whose parent is itself a ghost (not in `base`). Append in
  // depth-ascending order so each parent's children land right after
  // the parent's subtree closes inside `result`.
  if (childrenByParent.size > 0) {
    const remaining = Array.from(childrenByParent.entries()).sort(
      ([a], [b]) => depthOf(a) - depthOf(b),
    );
    for (const [parent, ghosts] of remaining) {
      let insertAt = result.length;
      for (let i = result.length - 1; i >= 0; i -= 1) {
        const r = result[i];
        if (r === undefined) continue;
        if (r.path === parent) {
          let j = i + 1;
          while (j < result.length) {
            const rj = result[j];
            if (rj === undefined) break;
            if (
              rj.path === parent ||
              rj.path.startsWith(parent + ".") ||
              rj.path.startsWith(parent + "[")
            ) {
              j += 1;
              continue;
            }
            break;
          }
          insertAt = j;
          break;
        }
      }
      result.splice(insertAt, 0, ...ghosts);
    }
  }

  return result;
}

/**
 * Sprint 344 Slice D — coerce a user-typed `+ key` / `+ item` raw input
 * into a JSON-typed commit payload.
 *
 * Outer-quotes rule: trim whitespace, then try `JSON.parse`. On success
 * the parsed value is returned (number / boolean / null / object /
 * array / quoted-string). On failure (free text, malformed JSON, empty
 * input) we fall back to the trimmed raw string so the user sees what
 * they typed instead of an error.
 *
 * Pure, deterministic, never throws. Slice B/C call this before firing
 * `onCommitEdit`; Slice A's ghost renderer then reads the parsed shape
 * to expand nested object/array adds at render time.
 */
export function coerceTreeAddValue(input: string): unknown {
  const trimmed = input.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // JSON.parse threw — not valid JSON. Return the trimmed raw string
    // so empty / free-text / malformed inputs round-trip as STR.
    return trimmed;
  }
}

export function computeTreeStats(value: unknown): TreeStats {
  let nodes = 0;
  let keys = 0;
  let depth = 0;
  let objects = 0;
  let arrays = 0;
  let maxArray = 0;

  const walk = (v: unknown, currentDepth: number) => {
    // #1445 — same DoS caps as `buildTreeNodes`: bound total visits and
    // recursion depth so a hostile document can't hang / overflow the
    // stats walk (the panel calls this alongside `buildTreeNodes`). Stats
    // become approximate at the extreme, which is fine for hostile input.
    if (nodes >= MAX_TREE_NODES) return;
    nodes += 1;
    if (currentDepth > depth) depth = currentDepth;
    const atDepthCap = currentDepth >= MAX_TREE_DEPTH;

    if (isPlainObject(v)) {
      objects += 1;
      const entries = Object.entries(v);
      keys += entries.length;
      if (atDepthCap) return;
      for (const [, child] of entries) walk(child, currentDepth + 1);
      return;
    }
    if (Array.isArray(v)) {
      arrays += 1;
      if (v.length > maxArray) maxArray = v.length;
      if (atDepthCap) return;
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
