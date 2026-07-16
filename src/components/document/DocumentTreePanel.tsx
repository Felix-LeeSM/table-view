// Sprint 341 (2026-05-15) — inline JSON tree panel.
// Sprint 342 (2026-05-15) — V2 enhancements.
//
// Renders inside DocumentDataGrid as a detail row attached to the
// data row whose nested cell was toggled. Mirrors NestedExpandPopover's
// edit-commit contract (pendingByPath / onCommitEdit) so the grid-level
// commit bar keeps owning the save flow.
//
// V2 additions: BSON wrapper inline editor, regex search toggle,
// diff view toggle (shows original vs pending side-by-side), structural
// edits (add key on objects, push item on arrays, delete leaf).

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronRight,
  ChevronDown,
  X,
  Search,
  Trash2,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  TREE_ROW_HEIGHT_ESTIMATE,
  TREE_VIRTUALIZE_THRESHOLD,
} from "@/components/shared/tree/virtualize";
import {
  buildTreeNodesWithGhosts,
  coerceTreeAddValue,
  computeTreeStats,
  filterTreeNodes,
  renderLeafValue,
  type TreeNode,
} from "@/lib/jsonTree";
import BsonTypeEditor from "@/components/document/BsonTypeEditor";
import { detectBsonType, type BsonType } from "@/lib/mongo/bsonTypes";
import { safeStringifyCell } from "@/lib/jsonCell";
import {
  useTreeRoving,
  type TreeRovingRow,
} from "@/components/shared/tree/useTreeRoving";

const BSON_TAG = "__bson__:";

const UNSET_OP = "__op__:unset";

function isPendingUnset(
  pending: string | Record<string, unknown> | undefined,
): boolean {
  return typeof pending === "string" && pending === UNSET_OP;
}

function renderPendingText(pending: string | Record<string, unknown>): string {
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
function joinObjectPath(parent: string, key: string): string {
  if (parent === "") return key;
  return `${parent}.${key}`;
}

function parseBsonLeaf(node: TreeNode): {
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

const KIND_TAG: Record<TreeNode["kind"], string> = {
  obj: "OBJ",
  arr: "ARR",
  leaf: "",
};

function leafTypeTag(node: TreeNode): string {
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
type RenderRow =
  | { type: "node"; node: TreeNode }
  | { type: "objAff"; path: string; depth: number }
  | { type: "arrAff"; path: string; depth: number; baseLength: number };

function renderRowKey(row: RenderRow): string {
  if (row.type === "node") return row.node.path || "__root";
  if (row.type === "objAff") return `__add-key-${row.path || "__root"}`;
  return `__add-item-${row.path}`;
}

export function DocumentTreePanel({
  value,
  fieldName,
  pendingByPath,
  onCommitEdit,
  onClose,
  forbiddenRootKeys,
}: DocumentTreePanelProps) {
  const { t } = useTranslation("document");
  // Sprint 344 Slice A — feed pendingByPath into the tree builder so
  // paths that exist only as pending adds render as ghost nodes
  // alongside `value`'s real children. Empty / undefined pendingByPath
  // collapses to the previous `buildTreeNodes(value)` output exactly
  // (regression-zero, asserted in jsonTree.test.ts).
  const nodes = useMemo(
    () =>
      buildTreeNodesWithGhosts(
        value,
        pendingByPath ?? new Map<string, string | Record<string, unknown>>(),
      ),
    [value, pendingByPath],
  );
  const stats = useMemo(() => computeTreeStats(value), [value]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [searchRegex, setSearchRegex] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Sprint 344 Slice B (2026-05-15) — `+ key` add UI state. Only one
  // object node can be in "add key" mode at a time (the rendered input
  // pair captures focus). `addingPath` holds the parent object's path
  // (root = ""). `keyDraft` / `valueDraft` hold the typed inputs.
  // `addError` is the active validation message (null = no error).
  // Sprint 344 Slice C (2026-05-15) — `addingKind` distinguishes object
  // `+ key` from array `+ item` so the panel renders the right UI
  // branch (paired inputs vs. read-only index label + single input).
  // The same `addingPath` slot drives both — only one inline add UI is
  // visible at a time across the whole tree, by design.
  const [addingPath, setAddingPath] = useState<string | null>(null);
  const [addingKind, setAddingKind] = useState<"obj" | "arr" | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [valueDraft, setValueDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const valueInputRef = useRef<HTMLInputElement | null>(null);
  // Sprint 344 Slice C — the `+ item` flow uses a separate ref because
  // the value input renders in a different DOM subtree (AddItemRow vs.
  // AddKeyRow). Reusing `valueInputRef` would race on parallel
  // mounting in renders where both rows happen to exist transiently.
  const itemValueInputRef = useRef<HTMLInputElement | null>(null);
  // WAI-ARIA tree roving container (#1128).
  const listRef = useRef<HTMLDivElement | null>(null);

  const startAddKey = useCallback((parentPath: string) => {
    setAddingPath(parentPath);
    setAddingKind("obj");
    setKeyDraft("");
    setValueDraft("");
    setAddError(null);
  }, []);

  const cancelAddKey = useCallback(() => {
    setAddingPath(null);
    setAddingKind(null);
    setKeyDraft("");
    setValueDraft("");
    setAddError(null);
  }, []);

  // Sprint 344 Slice C — entering array-add mode. Reuses the same
  // `addingPath` slot but marks the kind as "arr". The index label
  // (`[N]`) is computed at render time from the array node's
  // childCount + any pending appends to the same path.
  const startAddItem = useCallback((arrayPath: string) => {
    setAddingPath(arrayPath);
    setAddingKind("arr");
    setKeyDraft("");
    setValueDraft("");
    setAddError(null);
  }, []);

  // Autofocus the key input (object add) or value input (array add)
  // whenever we enter add-mode for a new path.
  useEffect(() => {
    if (addingPath === null) return;
    if (addingKind === "arr") {
      itemValueInputRef.current?.focus();
    } else {
      keyInputRef.current?.focus();
    }
  }, [addingPath, addingKind]);

  const commitAddKey = useCallback(() => {
    if (addingPath === null || addingKind !== "obj") return;
    const trimmedKey = keyDraft.trim();
    if (trimmedKey === "") {
      setAddError("key required");
      return;
    }
    // Sprint 344 Slice F (2026-05-15) — paradigm-agnostic reserved-key
    // guard. Only applies at the document root (`parentPath === ""`) so
    // a `_id` field inside a nested object is still legal — only the
    // root document's `_id` is protected (Mongo rejects re-adding it,
    // and the mqlGenerator's id-in-patch guard would drop the row
    // anyway). The Mongo grid wires this with `Set(["_id"])`; the RDB
    // grid omits it — keeping DocumentTreePanel paradigm-agnostic.
    if (
      addingPath === "" &&
      forbiddenRootKeys !== undefined &&
      forbiddenRootKeys.has(trimmedKey)
    ) {
      setAddError(`\`${trimmedKey}\` cannot be added to the document root`);
      return;
    }
    // Duplicate-key check against existing children of the parent in
    // `value` AND against same-parent entries already in pendingByPath
    // (so two consecutive `+ key` commits with the same key are blocked).
    const candidatePath = joinObjectPath(addingPath, trimmedKey);
    const existingChildPaths = new Set<string>();
    for (const node of nodes) {
      // Direct children of the parent — their path is parent + "." + label
      // (or just label when parent is root). The candidate collides iff
      // node.path === candidatePath.
      if (node.path === candidatePath) {
        existingChildPaths.add(node.path);
      }
    }
    if (pendingByPath) {
      for (const path of pendingByPath.keys()) {
        if (path === candidatePath) existingChildPaths.add(path);
      }
    }
    if (existingChildPaths.has(candidatePath)) {
      setAddError("key already exists");
      return;
    }

    // Coerce raw input → JSON-typed value per Slice D's outer-quotes
    // rule (number / boolean / null / object / array / string). The
    // panel forwards the typed result verbatim; the test contract
    // asserts on the runtime type at the callback boundary.
    //
    // The prop signature is intentionally narrower than what we may
    // pass at runtime (number / boolean / null / array can flow
    // through). Slice F owns widening the grid wiring; for now the
    // cast keeps TS quiet while preserving the runtime type for
    // assertion. Consumers MUST narrow on `typeof value` before
    // serialising — see DocumentDataGrid + DataGridTable for the
    // existing precedent.
    const coerced = coerceTreeAddValue(valueDraft);
    if (onCommitEdit) {
      onCommitEdit(candidatePath, coerced as string | Record<string, unknown>);
    }
    cancelAddKey();
  }, [
    addingPath,
    addingKind,
    keyDraft,
    valueDraft,
    nodes,
    pendingByPath,
    onCommitEdit,
    cancelAddKey,
    forbiddenRootKeys,
  ]);

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
  const { objAffordanceAfter, arrAffordanceAfter } = useMemo(() => {
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
  }, [nodes]);

  // Sprint 344 Slice C (2026-05-15) — auto-index for the `+ item` row.
  // The next index for an array at `arrayPath` is:
  //   baseLength + count(prior pending bracket-index appends to this
  //                       same array path).
  // The "prior pending appends" set is read from `pendingByPath`: any
  // key matching `<arrayPath>[N]` where N ≥ baseLength counts as an
  // already-occupied append slot, so the new index is the smallest
  // free slot at or beyond baseLength.
  const nextItemIndex = useCallback(
    (arrayPath: string, baseLength: number): number => {
      if (!pendingByPath || pendingByPath.size === 0) return baseLength;
      let max = baseLength - 1;
      const prefix = `${arrayPath}[`;
      for (const path of pendingByPath.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const close = rest.indexOf("]");
        if (close < 0) continue;
        const segment = rest.slice(0, close);
        // Only count direct child slots (no further dot/bracket after
        // the closing `]`). A pending path like `tags[2].name` is a
        // nested edit on an already-tracked slot, not a new append —
        // its slot count was added when `tags[2]` itself was appended.
        const tail = rest.slice(close + 1);
        if (tail !== "") continue;
        const idx = Number.parseInt(segment, 10);
        if (!Number.isInteger(idx) || idx < 0) continue;
        if (idx > max) max = idx;
      }
      return max + 1;
    },
    [pendingByPath],
  );

  const commitAddItem = useCallback(() => {
    if (addingPath === null || addingKind !== "arr") return;
    const arrayNode = nodes.find((n) => n.path === addingPath);
    const baseLength = arrayNode?.childCount ?? 0;
    const idx = nextItemIndex(addingPath, baseLength);
    const targetPath = `${addingPath}[${idx}]`;
    const coerced = coerceTreeAddValue(valueDraft);
    if (onCommitEdit) {
      onCommitEdit(targetPath, coerced as string | Record<string, unknown>);
    }
    cancelAddKey();
  }, [
    addingPath,
    addingKind,
    nodes,
    nextItemIndex,
    valueDraft,
    onCommitEdit,
    cancelAddKey,
  ]);

  const visiblePaths = useMemo(
    () => filterTreeNodes(nodes, search, { regex: searchRegex }),
    [nodes, search, searchRegex],
  );

  const isHidden = useCallback(
    (path: string) => {
      // ancestor-collapse filter
      for (const collapsedPath of collapsed) {
        if (path === collapsedPath) continue;
        if (
          path.startsWith(collapsedPath + ".") ||
          path.startsWith(collapsedPath + "[")
        ) {
          return true;
        }
      }
      if (visiblePaths !== null && !visiblePaths.has(path)) return true;
      return false;
    },
    [collapsed, visiblePaths],
  );

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const startEdit = useCallback((node: TreeNode) => {
    if (node.kind !== "leaf") return;
    setEditingPath(node.path);
    setDraft(renderLeafValue(node));
  }, []);

  // #1140 — return focus to the edited node's treeitem after the inline leaf
  // editor unmounts (commit OR cancel). The editor lives inside the treeitem
  // div, which is focusable via the roving tabindex; restoring there keeps
  // arrow navigation anchored instead of dropping focus on <body>. Centralized
  // on the editingPath transition so every commit/cancel site is covered once.
  const editedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (editingPath !== null) {
      editedPathRef.current = editingPath;
      return;
    }
    const edited = editedPathRef.current;
    editedPathRef.current = null;
    if (edited === null) return;
    const key = edited || "__root";
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-tree-key="${CSS.escape(key)}"]`,
    );
    el?.focus();
  }, [editingPath]);

  const commitDraft = useCallback(() => {
    if (editingPath === null) return;
    // Sprint 341 feedback (1) — only fire onCommitEdit when the draft
    // actually differs from what the panel rendered, otherwise a click
    // + blur on a leaf registers a phantom "edit" with no semantic
    // change. Comparison is done on the *rendered* form so a string
    // round-tripped with its quotes still matches.
    const node = nodes.find((n) => n.path === editingPath);
    const original = node ? renderLeafValue(node) : "";
    if (onCommitEdit && draft !== original) {
      // Strip surrounding quotes for string leaves; commit raw otherwise.
      let next = draft;
      if (next.length >= 2 && next.startsWith('"') && next.endsWith('"')) {
        next = next.slice(1, -1);
      }
      onCommitEdit(editingPath, next);
    }
    setEditingPath(null);
    setDraft("");
  }, [editingPath, draft, nodes, onCommitEdit]);

  const pendingCount = pendingByPath?.size ?? 0;

  // #1448 — one flat, visible-order list of everything the tree renders: each
  // node row plus the trailing `+ key` / `+ item` affordance rows (only when
  // `onCommitEdit` is provided). Pulling the per-index `isHidden` +
  // collapsed-ancestor filtering out of the render into this memo lets both the
  // roving hook and the virtualizer share one index space, and lets a large
  // document hand rendering off to `@tanstack/react-virtual` below.
  const renderRows = useMemo(() => {
    const rows: RenderRow[] = [];
    const collapsedList = Array.from(collapsed);
    // An affordance whose container IS collapsed (or sits under a collapsed
    // ancestor) renders at the end of hidden children, so drop it. `isHidden`
    // treats a collapsed container as still-visible, so this equality check is
    // the extra guard the original inline filter applied.
    const underCollapsed = (path: string) =>
      collapsedList.some(
        (cp) =>
          path === cp || path.startsWith(cp + ".") || path.startsWith(cp + "["),
      );
    for (let idx = 0; idx < nodes.length; idx += 1) {
      const node = nodes[idx];
      if (node === undefined) continue;
      if (!isHidden(node.path)) rows.push({ type: "node", node });
      if (!onCommitEdit) continue;
      for (const aff of objAffordanceAfter.get(idx) ?? []) {
        if (!isHidden(aff.path) && !underCollapsed(aff.path)) {
          rows.push({ type: "objAff", path: aff.path, depth: aff.depth });
        }
      }
      for (const aff of arrAffordanceAfter.get(idx) ?? []) {
        if (!isHidden(aff.path) && !underCollapsed(aff.path)) {
          rows.push({
            type: "arrAff",
            path: aff.path,
            depth: aff.depth,
            baseLength: aff.baseLength,
          });
        }
      }
    }
    return rows;
  }, [
    nodes,
    objAffordanceAfter,
    arrAffordanceAfter,
    isHidden,
    collapsed,
    onCommitEdit,
  ]);

  // WAI-ARIA tree roving (#1128) — a single tab stop over the visible node
  // rows; affordance rows are `focusable: false` so arrow-nav skips them but
  // they still occupy the shared index space (`useTreeRoving` keeps the full
  // list so a virtualized `scrollToIndex` gets the correct full-list index).
  const rovingRows: TreeRovingRow[] = renderRows.map((row) =>
    row.type === "node"
      ? {
          key: row.node.path || "__root",
          depth: row.node.depth,
          expanded:
            row.node.kind === "leaf" ? null : !collapsed.has(row.node.path),
          // #1445 — a "…truncated" indicator is a status row, not a tab stop.
          focusable: !row.node.truncated,
        }
      : {
          key:
            row.type === "objAff"
              ? `__add-key-${row.path || "__root"}`
              : `__add-item-${row.path}`,
          depth: row.depth,
          expanded: null,
          focusable: false,
        },
  );

  // #1448 — hand rendering off to the virtualizer once the visible row list
  // grows past the shared threshold so a 50k-node cell only mounts a
  // viewport-sized window instead of the whole flat list (which freezes the
  // tab). The `role="tree"` div (`listRef`) is itself the scroll element.
  const shouldVirtualize = renderRows.length > TREE_VIRTUALIZE_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? renderRows.length : 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => TREE_ROW_HEIGHT_ESTIMATE,
    overscan: 8,
  });

  const roving = useTreeRoving(
    rovingRows,
    (key) => toggleCollapsed(key === "__root" ? "" : key),
    listRef,
    shouldVirtualize
      ? (index) => rowVirtualizer.scrollToIndex(index)
      : undefined,
  );
  const activeKey = roving.focusKey ?? rovingRows[0]?.key ?? null;

  // #1448 — render one flat row (node or trailing affordance). Called by both
  // the plain map and the virtualized window so the two paths render
  // identically; the affordance branches replace the old per-node `trailing`
  // arrays now that each affordance is its own `renderRows` entry.
  const renderRow = (row: RenderRow): React.ReactNode => {
    if (row.type === "objAff") {
      return (
        <AddKeyRow
          key={`__add-key-${row.path || "__root"}`}
          parentPath={row.path}
          parentDepth={row.depth}
          isOpen={addingPath === row.path && addingKind === "obj"}
          keyDraft={keyDraft}
          valueDraft={valueDraft}
          addError={addError}
          onStart={() => startAddKey(row.path)}
          onKeyDraftChange={(v) => {
            setKeyDraft(v);
            if (addError) setAddError(null);
          }}
          onValueDraftChange={setValueDraft}
          onCommit={commitAddKey}
          onCancel={cancelAddKey}
          keyInputRef={keyInputRef}
          valueInputRef={valueInputRef}
        />
      );
    }
    if (row.type === "arrAff") {
      return (
        <AddItemRow
          key={`__add-item-${row.path}`}
          arrayPath={row.path}
          parentDepth={row.depth}
          isOpen={addingPath === row.path && addingKind === "arr"}
          valueDraft={valueDraft}
          nextIndex={nextItemIndex(row.path, row.baseLength)}
          onStart={() => startAddItem(row.path)}
          onValueDraftChange={setValueDraft}
          onCommit={commitAddItem}
          onCancel={cancelAddKey}
          valueInputRef={itemValueInputRef}
        />
      );
    }
    const node = row.node;
    // #1445 — the jsonTree walk stopped here to enforce the depth / node-count
    // DoS caps. Render a plain "…truncated" indicator instead of the normal
    // node UI so hostile/oversized server data is surfaced rather than silently
    // clipped. No affordances / editor for a truncated node.
    if (node.truncated) {
      return (
        <div
          key={node.path || "__truncated"}
          data-testid="tree-truncated"
          role="treeitem"
          aria-level={node.depth + 1}
          tabIndex={-1}
          className="px-1 py-0.5 text-3xs italic text-warning"
          style={{ paddingLeft: `${node.depth * 16}px` }}
        >
          {t("treePanel.truncated")}
        </div>
      );
    }
    const isCollapsed = collapsed.has(node.path);
    const pending = pendingByPath?.get(node.path);
    const isEditing = editingPath === node.path;
    const treeKey = node.path || "__root";
    const isContainer = node.kind === "obj" || node.kind === "arr";
    return (
      <div
        key={node.path || "__root"}
        data-testid={`tree-node-${node.path || "__root"}`}
        // WAI-ARIA tree roving (#1128) — every visible node is a
        // treeitem; the container owns one tab stop and arrow-key nav.
        // Enter/Space toggles a container; Enter opens a leaf's editor.
        // Editing inputs are skipped by the roving handler (it ignores
        // INPUT/TEXTAREA targets) so typing is never hijacked.
        role="treeitem"
        aria-level={node.depth + 1}
        aria-expanded={isContainer ? !isCollapsed : undefined}
        aria-label={node.label || fieldName}
        data-tree-key={treeKey}
        tabIndex={activeKey === treeKey ? 0 : -1}
        onFocus={() => roving.setFocusKey(treeKey)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (isContainer && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            toggleCollapsed(node.path);
          } else if (
            node.kind === "leaf" &&
            e.key === "Enter" &&
            !isPendingUnset(pending)
          ) {
            e.preventDefault();
            startEdit(node);
          }
        }}
        className={
          node.isGhost
            ? "rounded border border-warning/30 bg-warning/10 px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            : pending !== undefined
              ? "rounded bg-warning/10 px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              : "px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        }
        style={{ paddingLeft: `${node.depth * 16}px` }}
      >
        {(node.kind === "obj" || node.kind === "arr") && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => toggleCollapsed(node.path)}
            className="inline-flex items-center align-middle text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            data-testid={`tree-twist-${node.path || "__root"}`}
            aria-label={t("treePanel.toggleAriaLabel", {
              label: node.label,
            })}
          >
            {isCollapsed ? (
              <ChevronRight size={12} aria-hidden />
            ) : (
              <ChevronDown size={12} aria-hidden />
            )}
          </button>
        )}
        <span className="ml-1 text-value-key">{node.label}</span>
        {node.kind === "obj" && (
          <span className="ml-1 text-muted-foreground">
            : {"{"}
            {node.childCount} item{node.childCount === 1 ? "" : "s"}
            {"}"}
          </span>
        )}
        {node.kind === "arr" && (
          <span className="ml-1 text-muted-foreground">
            : [{node.childCount} item{node.childCount === 1 ? "" : "s"}]
          </span>
        )}
        {node.kind !== "leaf" && KIND_TAG[node.kind] && (
          <TagBadge>{KIND_TAG[node.kind]}</TagBadge>
        )}
        {/* Sprint 344 Slice A — NEW badge on ghost (`+ key` / `+
          item` adds). Rendered on obj/arr ghost containers too
          so a brand-new nested object shows the badge on the
          parent row, distinct from the per-leaf `● edited`. */}
        {node.isGhost && node.kind !== "leaf" && <NewBadge />}

        {node.kind === "leaf" && !isEditing && (
          <>
            <span className="ml-1 text-muted-foreground">:</span>
            {/* Sprint 342 V2 — two render branches for leaves with
              a pending edit:
               1. pending = __op__:unset → strike-through original,
                  "● will delete" badge.
               2. otherwise → pending (or original) as the
                  clickable editor entry-point. */}
            {isPendingUnset(pending) ? (
              <span
                data-testid={`tree-unset-${node.path}`}
                className="ml-1 align-middle text-emerald-700/60 line-through decoration-value-delete dark:text-emerald-300/50"
              >
                {renderLeafValue(node)}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => startEdit(node)}
                data-testid={`tree-leaf-${node.path}`}
                className="ml-1 align-middle text-value-leaf hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {pending !== undefined
                  ? renderPendingText(pending)
                  : renderLeafValue(node)}
              </button>
            )}
            <TagBadge>{leafTypeTag(node)}</TagBadge>
            {/* Sprint 344 Slice A — distinct visual states:
               - ghost (add): "NEW" badge, no "● edited".
               - existing leaf with pending unset: strike +
                 "● will delete".
               - existing leaf with pending edit: "● edited".
              Ghost takes priority because a ghost path also
              has a `pending` entry (the new value lives there). */}
            {node.isGhost ? (
              <NewBadge />
            ) : isPendingUnset(pending) ? (
              <span className="ml-2 text-3xs text-value-delete">
                {t("treePanel.willDelete")}
              </span>
            ) : (
              pending !== undefined && (
                <span className="ml-2 text-3xs text-warning">
                  {t("treePanel.edited")}
                </span>
              )
            )}
            {/* Sprint 342 V2 — leaf delete entry-point. `_id`
              cannot be unset (MongoDB rejects it; mqlGenerator's
              id-in-patch guard would drop the row anyway), so
              hide the trash for those leaves to keep the UI
              honest. */}
            {onCommitEdit &&
              node.path !== "_id" &&
              !isPendingUnset(pending) && (
                <button
                  type="button"
                  data-testid={`tree-delete-${node.path}`}
                  aria-label={t("treePanel.deleteFieldAriaLabel", {
                    path: node.path,
                  })}
                  title={t("treePanel.deleteFieldTitle")}
                  onClick={() => onCommitEdit(node.path, UNSET_OP)}
                  className="ml-2 inline-flex items-center align-middle text-muted-foreground transition-colors hover:text-value-delete focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              )}
          </>
        )}

        {/* Sprint 342 V2 — BSON wrappers (ObjectId / Date /
          Decimal128 / binData) get the type-aware
          BsonTypeEditor instead of the plain string input.
          The editor commits an EJSON wrapper object; the
          parent's onCommitEdit -> tagBsonWrapper round-trip
          keeps the pendingEdits Map shape unchanged. */}
        {node.kind === "leaf" &&
          isEditing &&
          node.isBson &&
          (() => {
            const parsed = parseBsonLeaf(node);
            if (parsed === null) {
              // Unknown BSON wrapper shape — fall back to a plain
              // string editor against the raw EJSON payload.
              return (
                <PlainLeafInput
                  draft={draft}
                  onDraftChange={setDraft}
                  onCommit={commitDraft}
                  onCancel={() => {
                    setEditingPath(null);
                    setDraft("");
                  }}
                  testId={`tree-edit-${node.path}`}
                  typeTag={leafTypeTag(node)}
                />
              );
            }
            return (
              <div
                data-testid={`tree-edit-bson-${node.path}`}
                className="mt-1 flex w-full items-center gap-2 rounded border border-primary bg-background p-1.5"
              >
                <span className="text-3xs uppercase tracking-wider text-muted-foreground">
                  {parsed.type}
                </span>
                <div className="flex-1">
                  <BsonTypeEditor
                    type={parsed.type}
                    initialValue={parsed.ejson}
                    ariaLabel={t("treePanel.editingAriaLabel", {
                      path: node.path,
                      type: parsed.type,
                    })}
                    onCommit={(v) => {
                      if (onCommitEdit) onCommitEdit(node.path, v);
                      setEditingPath(null);
                      setDraft("");
                    }}
                    onCancel={() => {
                      setEditingPath(null);
                      setDraft("");
                    }}
                  />
                </div>
              </div>
            );
          })()}

        {node.kind === "leaf" && isEditing && !node.isBson && (
          <PlainLeafInput
            draft={draft}
            onDraftChange={setDraft}
            onCommit={commitDraft}
            onCancel={() => {
              setEditingPath(null);
              setDraft("");
            }}
            testId={`tree-edit-${node.path}`}
            typeTag={leafTypeTag(node)}
          />
        )}
      </div>
    );
  };

  return (
    <section
      aria-label={t("treePanel.ariaLabel")}
      data-testid="document-tree-panel"
      className="flex flex-col gap-2 bg-secondary/30 px-4 py-3"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            <span className="text-foreground">{fieldName}</span>
            <span className="ml-2 font-mono">$.{fieldName}</span>
          </span>
          {pendingCount > 0 && (
            <span
              data-testid="document-tree-pending-pill"
              className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-3xs text-warning"
            >
              {t("treePanel.unsavedEdits", { count: pendingCount })}
            </span>
          )}
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="document-tree-close"
            onClick={onClose}
            aria-label={t("treePanel.closeAriaLabel")}
          >
            <X size={14} aria-hidden />
          </Button>
        )}
      </header>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              searchRegex
                ? t("treePanel.searchPlaceholderRegex")
                : t("treePanel.searchPlaceholderNormal")
            }
            data-testid="document-tree-search"
            className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-12 text-xs"
          />
          <label
            className="absolute right-1 top-1/2 inline-flex -translate-y-1/2 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-3xs uppercase tracking-wider text-muted-foreground has-[:checked]:bg-primary has-[:checked]:text-primary-foreground"
            title={t("treePanel.regexToggleTitle")}
          >
            <input
              type="checkbox"
              data-testid="document-tree-regex-toggle"
              checked={searchRegex}
              onChange={(e) => setSearchRegex(e.target.checked)}
              className="sr-only"
            />
            .*
          </label>
        </div>

        <dl
          data-testid="document-tree-stats"
          className="flex flex-wrap gap-1.5 text-3xs"
        >
          <StatPill label={t("treePanel.statNodes")} value={stats.nodes} />
          <StatPill label={t("treePanel.statKeys")} value={stats.keys} />
          <StatPill label={t("treePanel.statDepth")} value={stats.depth} />
          <StatPill label={t("treePanel.statObj")} value={stats.objects} />
          <StatPill label={t("treePanel.statArr")} value={stats.arrays} />
          <StatPill label={t("treePanel.statMax")} value={stats.maxArray} />
        </dl>
      </div>

      <div
        ref={listRef}
        role="tree"
        aria-label={t("treePanel.fieldsTreeAriaLabel")}
        data-testid="document-tree-list"
        className="max-h-96 overflow-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
        onKeyDown={roving.onKeyDown}
      >
        {shouldVirtualize ? (
          <VirtualTreeRows renderRows={renderRows} virtualizer={rowVirtualizer}>
            {renderRow}
          </VirtualTreeRows>
        ) : (
          renderRows.map(renderRow)
        )}
      </div>
    </section>
  );
}

// #1448 — windowed row list with top/bottom `aria-hidden` spacers that keep the
// scroll height while only the visible slice lives in the DOM. Mirrors
// `BsonTreeViewer`'s `VirtualBsonRows` (no `scrollMargin` — the `role="tree"`
// div is itself the scroll container with no header above the list).
function VirtualTreeRows({
  renderRows,
  virtualizer,
  children,
}: {
  renderRows: RenderRow[];
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  children: (row: RenderRow) => React.ReactNode;
}) {
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length ? virtualItems[0]!.start : 0;
  const paddingBottom = virtualItems.length
    ? totalSize - virtualItems[virtualItems.length - 1]!.end
    : 0;
  return (
    <div style={{ position: "relative" }}>
      {paddingTop > 0 && (
        <div aria-hidden="true" style={{ height: paddingTop }} />
      )}
      {virtualItems.map((virtualRow) => {
        const row = renderRows[virtualRow.index]!;
        return (
          <div
            key={renderRowKey(row)}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
          >
            {children(row)}
          </div>
        );
      })}
      {paddingBottom > 0 && (
        <div aria-hidden="true" style={{ height: paddingBottom }} />
      )}
    </div>
  );
}

// Sprint 344 Slice B (2026-05-15) — `+ key` row. Two render branches:
//  1. Closed: a small dashed-button affordance ("+ key") that opens
//     the input pair on click.
//  2. Open: key + value inputs side-by-side at the parent's child
//     indent. Tab/Shift+Tab move focus between them (browser default
//     handles this — the ref-driven focus calls below are jsdom
//     fallbacks). Enter commits, Esc cancels. Validation message
//     renders inline below the inputs with aria-live="polite".
//
// The component is intentionally dumb: it owns no state. The parent
// (`DocumentTreePanel`) drives `isOpen`, drafts, and validation so
// only one add UI is visible at a time across the whole tree.
function AddKeyRow({
  parentPath,
  parentDepth,
  isOpen,
  keyDraft,
  valueDraft,
  addError,
  onStart,
  onKeyDraftChange,
  onValueDraftChange,
  onCommit,
  onCancel,
  keyInputRef,
  valueInputRef,
}: {
  parentPath: string;
  parentDepth: number;
  isOpen: boolean;
  keyDraft: string;
  valueDraft: string;
  addError: string | null;
  onStart: () => void;
  onKeyDraftChange: (v: string) => void;
  onValueDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  keyInputRef: React.RefObject<HTMLInputElement | null>;
  valueInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation("document");
  const indent = (parentDepth + 1) * 16;
  const pathKey = parentPath || "__root";
  const ariaLabel = t("treePanel.addKeyAriaLabel", {
    target: parentPath === "" ? "root" : parentPath,
  });

  if (!isOpen) {
    return (
      <div
        data-testid={`tree-add-key-row-${pathKey}`}
        className="px-1 py-0.5"
        style={{ paddingLeft: `${indent}px` }}
      >
        <button
          type="button"
          role="button"
          data-testid={`tree-add-key-${pathKey}`}
          aria-label={ariaLabel}
          onClick={onStart}
          className="inline-flex items-center gap-1 rounded border border-dashed border-muted-foreground/40 px-2 py-0 text-3xs text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Plus size={10} aria-hidden />
          <span>{t("treePanel.addKeyButton")}</span>
        </button>
      </div>
    );
  }

  // Open — paired key + value inputs.
  const onKeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab" && !e.shiftKey) {
      // Browser default would move focus to the next focusable element;
      // jsdom does not always honour that across testing-library
      // user-event versions, so we manually focus the value input as
      // a deterministic fallback. preventDefault keeps the cursor
      // here when the ref-call is the active mechanism.
      e.preventDefault();
      valueInputRef.current?.focus();
    }
  };
  const onValueKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      keyInputRef.current?.focus();
    }
  };

  return (
    <div
      data-testid={`tree-add-key-row-${pathKey}`}
      className="flex flex-col gap-0.5 px-1 py-0.5"
      style={{ paddingLeft: `${indent}px` }}
    >
      <div className="flex items-center gap-1">
        <input
          type="text"
          ref={keyInputRef}
          value={keyDraft}
          onChange={(e) => onKeyDraftChange(e.target.value)}
          onKeyDown={onKeyKeyDown}
          placeholder="key"
          aria-label={t("treePanel.addKeyInputAriaLabel", {
            parent: ariaLabel,
          })}
          aria-invalid={addError !== null ? "true" : undefined}
          data-testid={`tree-add-key-input-${pathKey}`}
          className="inline-block w-32 rounded border border-primary bg-background px-1 text-foreground"
        />
        <span className="text-muted-foreground">:</span>
        <input
          type="text"
          ref={valueInputRef}
          value={valueDraft}
          onChange={(e) => onValueDraftChange(e.target.value)}
          onKeyDown={onValueKeyDown}
          placeholder="value"
          aria-label={t("treePanel.addValueInputAriaLabel", {
            parent: ariaLabel,
          })}
          data-testid={`tree-add-value-input-${pathKey}`}
          className="inline-block w-40 rounded border border-primary bg-background px-1 text-foreground"
        />
      </div>
      {addError !== null && (
        <span
          aria-live="polite"
          data-testid={`tree-add-key-error-${pathKey}`}
          className="text-3xs text-red-500"
        >
          {addError}
        </span>
      )}
    </div>
  );
}

// Sprint 344 Slice C (2026-05-15) — `+ item` row for array nodes.
// Closed state: dashed `+ item` button at the array's child indent.
// Open state: a muted, read-only `[N]` index label sitting next to a
// single value input. Enter commits, Esc cancels — there is no key
// input because arrays are indexed automatically (see `nextItemIndex`
// in the panel; the parent passes the resolved next-slot index in).
//
// Like AddKeyRow this component owns no state; the panel drives
// `isOpen`, `valueDraft`, and the commit/cancel callbacks so only one
// inline add UI is ever visible across the whole tree.
function AddItemRow({
  arrayPath,
  parentDepth,
  isOpen,
  valueDraft,
  nextIndex,
  onStart,
  onValueDraftChange,
  onCommit,
  onCancel,
  valueInputRef,
}: {
  arrayPath: string;
  parentDepth: number;
  isOpen: boolean;
  valueDraft: string;
  nextIndex: number;
  onStart: () => void;
  onValueDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  valueInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation("document");
  const indent = (parentDepth + 1) * 16;
  const ariaLabel = t("treePanel.addItemAriaLabel", { arrayPath });

  if (!isOpen) {
    return (
      <div
        data-testid={`tree-add-item-row-${arrayPath}`}
        className="px-1 py-0.5"
        style={{ paddingLeft: `${indent}px` }}
      >
        <button
          type="button"
          role="button"
          data-testid={`tree-add-item-${arrayPath}`}
          aria-label={ariaLabel}
          onClick={onStart}
          className="inline-flex items-center gap-1 rounded border border-dashed border-muted-foreground/40 px-2 py-0 text-3xs text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Plus size={10} aria-hidden />
          <span>{t("treePanel.addItemButton")}</span>
        </button>
      </div>
    );
  }

  const onValueKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      data-testid={`tree-add-item-row-${arrayPath}`}
      className="flex items-center gap-1 px-1 py-0.5"
      style={{ paddingLeft: `${indent}px` }}
    >
      {/* Index label — read-only span so users cannot click/type
          inside it. The index is owned entirely by the panel
          (`nextItemIndex`) and advances automatically across
          consecutive adds. `onMouseDown` preventDefault keeps the
          focus on the value input when the user mis-clicks the label
          (jsdom otherwise steals focus to <body>). */}
      <span
        aria-hidden
        data-testid={`tree-add-item-index-${arrayPath}`}
        onMouseDown={(e) => e.preventDefault()}
        className="font-mono text-muted-foreground"
      >
        [{nextIndex}]
      </span>
      <span className="text-muted-foreground">:</span>
      <input
        type="text"
        ref={valueInputRef}
        value={valueDraft}
        onChange={(e) => onValueDraftChange(e.target.value)}
        onKeyDown={onValueKeyDown}
        placeholder="value"
        aria-label={t("treePanel.addItemInputAriaLabel", { parent: ariaLabel })}
        data-testid={`tree-add-item-input-${arrayPath}`}
        className="inline-block w-40 rounded border border-primary bg-background px-1 text-foreground"
      />
    </div>
  );
}

function PlainLeafInput({
  draft,
  onDraftChange,
  onCommit,
  onCancel,
  testId,
  typeTag,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  testId: string;
  typeTag: string;
}) {
  return (
    <>
      <span className="ml-1 text-muted-foreground">:</span>
      <input
        type="text"
        autoFocus
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        data-testid={testId}
        className="ml-1 inline-block w-56 rounded border border-primary bg-background px-1 align-middle text-foreground"
      />
      <TagBadge>{typeTag}</TagBadge>
    </>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function TagBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 inline-block rounded bg-muted px-1 py-0 align-middle text-4xs tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

// Sprint 344 Slice A — amber NEW pill for ghost rows (paths that exist
// only in `pendingByPath`). Visually distinct from the inline
// "● edited" marker used for edits on existing leaves; same amber tone
// keeps it in the pending family.
function NewBadge() {
  return (
    <span className="ml-2 inline-block rounded bg-amber-400/20 px-1 py-0 align-middle text-4xs font-semibold uppercase tracking-wider text-amber-500 dark:text-amber-300">
      NEW
    </span>
  );
}
