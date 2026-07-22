// Pure helpers, constants, props, and derived row/affordance types for
// DocumentTreePanel. No React state — the panel and its sub-components import
// these so the main component file stays focused on wiring/render.

import type { TreeNode } from "@/lib/jsonTree";
import { detectBsonType, type BsonType } from "@/lib/mongo/bsonTypes";
import { safeStringifyCell } from "@/lib/jsonCell";

export const BSON_TAG = "__bson__:";

export const UNSET_OP = "__op__:unset";

export function isPendingUnset(
  pending: string | Record<string, unknown> | undefined,
): boolean {
  return typeof pending === "string" && pending === UNSET_OP;
}

export function renderPendingText(
  pending: string | Record<string, unknown>,
): string {
  if (typeof pending !== "string") {
    // BSON wrapper object — render the EJSON payload via safeStringifyCell
    // so a Decimal128 / BigInt slipping in doesn't blow up the panel
    // (Sprint 305 cell-domain rule).
    return safeStringifyCell(pending);
  }
  return pending.startsWith(BSON_TAG)
    ? pending.slice(BSON_TAG.length)
    : pending;
}

// Sprint 344 Slice B (2026-05-15) — local copy of the dot/bracket path
// joiner used by jsonTree.buildTreeNodes. Kept private here because the
// helper is purely a `+ key` UX concern: the panel only ever joins a
// parent object path with a typed key (never an array index segment),
// so a tiny inline implementation is clearer than re-exporting and
// drags fewer regressions across the lib boundary.
export function joinObjectPath(parent: string, key: string): string {
  if (parent === "") return key;
  return `${parent}.${key}`;
}

export function parseBsonLeaf(node: TreeNode): {
  type: BsonType;
  ejson: Record<string, unknown>;
} | null {
  if (!node.isBson || typeof node.leafValue !== "string") return null;
  try {
    const ejson = JSON.parse(node.leafValue.slice(BSON_TAG.length)) as Record<
      string,
      unknown
    >;
    const type = detectBsonType(ejson);
    if (type === null) return null;
    return { type, ejson };
  } catch {
    return null;
  }
}

export interface DocumentTreePanelProps {
  /** Raw cell value (object or array). */
  value: unknown;
  /** Column name shown in the panel header as the path root. */
  fieldName: string;
  /** Pending edits scoped to this cell — same Map shape NestedExpandPopover uses. */
  pendingByPath?: ReadonlyMap<string, string | Record<string, unknown>>;
  /** Commit a single leaf edit; grid owns Save/Discard.
   *
   * Sprint 344 Slice B (2026-05-15) — the panel may also call this with
   * a Slice D-coerced JSON value (number / boolean / null / array) for
   * `+ key` adds. The prop signature stays narrow on
   * `string | Record<string, unknown>` so downstream type-narrowing in
   * the grid (which does `typeof value === "string" ? value :
   * tagBsonWrapper(value)`) keeps compiling without grid-side edits;
   * Slice F is responsible for widening the grid wiring to forward
   * non-string non-object coerced values to the SQL / MQL emit layer.
   * The runtime value is whatever `coerceTreeAddValue` returned.
   */
  onCommitEdit?: (
    path: string,
    value: string | Record<string, unknown>,
  ) => void;
  /**
   * #1703 — drop a single pending entry for `path` (undo a pending
   * `__op__:unset` delete). The panel can only ever *add* to the pending map
   * via `onCommitEdit`; cancelling a marked-for-delete key needs a removal
   * path. Shared across Mongo / RDB / Redis consumers so the in-tree undo
   * toggle works for every backend that renders this panel.
   */
  onRemovePending?: (path: string) => void;
  /** Close button on the detail row header (mirrors the cell-level toggle). */
  onClose?: () => void;
  /**
   * Sprint 344 Slice F (2026-05-15) — paradigm-agnostic guard against
   * adding reserved keys at the **document root**. Each Set member is
   * a bare key name (no dot/bracket). The panel rejects `+ key` commits
   * where `parentPath === ""` AND the typed key matches any entry,
   * surfacing the same aria-invalid + inline message UX as the empty/
   * duplicate-key reject branches. Nested objects are unaffected — a
   * literal `_id` field inside `meta` is still allowed because Mongo
   * permits arbitrary keys below the root.
   *
   * Mongo grid passes `new Set(["_id"])`; RDB grid passes `undefined`
   * (or omits the prop) — DocumentTreePanel stays paradigm-agnostic.
   */
  forbiddenRootKeys?: ReadonlySet<string>;
}

export const KIND_TAG: Record<TreeNode["kind"], string> = {
  obj: "OBJ",
  arr: "ARR",
  leaf: "",
};

export function leafTypeTag(node: TreeNode): string {
  switch (node.leafType) {
    case "string":
      return "STR";
    case "number":
      return "NUM";
    case "boolean":
      return "BOOL";
    case "null":
      return "NULL";
    case "bson":
      return "BSON";
    default:
      return "?";
  }
}

// #1448 — one visible-order render row: a tree node, or a trailing `+ key` /
// `+ item` affordance. The flat list drives both the roving hook and the
// virtualizer.
export type RenderRow =
  | { type: "node"; node: TreeNode }
  | { type: "objAff"; path: string; depth: number }
  | { type: "arrAff"; path: string; depth: number; baseLength: number };

export function renderRowKey(row: RenderRow): string {
  if (row.type === "node") return row.node.path || "__root";
  if (row.type === "objAff") return `__add-key-${row.path || "__root"}`;
  return `__add-item-${row.path}`;
}

export interface TreeAffordances {
  objAffordanceAfter: Map<number, Array<{ path: string; depth: number }>>;
  arrAffordanceAfter: Map<
    number,
    Array<{ path: string; depth: number; baseLength: number }>
  >;
}

// Sprint 344 Slice B/C (2026-05-15) — for each obj / arr node, the flat-list
// index right after its subtree ends, so the trailing `+ key` / `+ item`
// affordance renders at the END of that container's children (matching Slice
// A's ghost-row insertion order).
//
// #1448 — one O(n) pre-order stack pass replaces the previous per-node O(n²)
// inner subtree scan (which, on a 50k-node capped tree, quadratically blew
// up). A container is popped — its subtree ended at the prior index — the
// moment a node at its own depth-or-shallower appears. Both maps come from
// the single pass; the arr map also carries `baseLength` for the auto-index
// label.
export function computeAffordances(nodes: TreeNode[]): TreeAffordances {
  const objMap = new Map<number, Array<{ path: string; depth: number }>>();
  const arrMap = new Map<
    number,
    Array<{ path: string; depth: number; baseLength: number }>
  >();
  const attach = (containerIdx: number, endIdx: number) => {
    const node = nodes[containerIdx];
    if (node === undefined) return;
    // #1448 review — a depth-capped `truncated` container had its children cut
    // from the walk, so `nodes` holds no real subtree to append a `+ key` /
    // `+ item` row after. Emitting one would let `commitAddKey`'s duplicate
    // check (which only scans the truncated `nodes`) silently overwrite a real
    // cut child — the hostile-data path #1445/#1508 defends. Original main
    // dropped trailing affordances via the `if (node.truncated) return`
    // node-render gate; the flat render-row model reinstates it here.
    if (node.truncated) return;
    if (node.kind === "obj") {
      const entries = objMap.get(endIdx) ?? [];
      entries.push({ path: node.path, depth: node.depth });
      objMap.set(endIdx, entries);
    } else if (node.kind === "arr") {
      const entries = arrMap.get(endIdx) ?? [];
      entries.push({
        path: node.path,
        depth: node.depth,
        baseLength: node.childCount ?? 0,
      });
      arrMap.set(endIdx, entries);
    }
  };
  // Open containers awaiting their subtree end, innermost on top.
  const stack: Array<{ index: number; depth: number }> = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node === undefined) continue;
    // Every open container at this node's depth-or-shallower has no further
    // children — its subtree ended at i - 1.
    while (
      stack.length > 0 &&
      node.depth <= (stack[stack.length - 1]?.depth ?? -1)
    ) {
      const container = stack.pop();
      if (container !== undefined) attach(container.index, i - 1);
    }
    if (node.kind === "obj" || node.kind === "arr") {
      stack.push({ index: i, depth: node.depth });
    }
  }
  // Trailing open containers close at the last node.
  while (stack.length > 0) {
    const container = stack.pop();
    if (container !== undefined) attach(container.index, nodes.length - 1);
  }
  // Nested containers sharing an end index were popped innermost-first; the
  // original outer-loop order was outermost-first (shallower depth), so sort
  // each bucket by depth to keep the affordance stacking order identical.
  for (const entries of objMap.values())
    entries.sort((a, b) => a.depth - b.depth);
  for (const entries of arrMap.values())
    entries.sort((a, b) => a.depth - b.depth);
  return { objAffordanceAfter: objMap, arrAffordanceAfter: arrMap };
}
