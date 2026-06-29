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

import {
  Fragment,
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useTranslation } from "react-i18next";
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

  // Sprint 344 Slice B (2026-05-15) — precompute, for each obj node
  // index, the index right after its subtree ends. We splice the
  // `+ key` affordance (or its input pair, when active) at that point
  // so the row renders at the END of the object's children, matching
  // Slice A's ghost-row insertion order.
  const objAffordanceAfter = useMemo(() => {
    // Map<base node index `i`, list of obj paths whose subtree ends at i+1>
    const map = new Map<number, Array<{ path: string; depth: number }>>();
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node === undefined) continue;
      if (node.kind !== "obj") continue;
      // Find the last index j such that nodes[k].depth > node.depth for
      // k in (i, j]. The subtree ends at the first k where depth ≤ node.depth.
      let endIdx = i; // exclusive: end-of-subtree index = endIdx
      for (let j = i + 1; j < nodes.length; j += 1) {
        const inner = nodes[j];
        if (inner === undefined) break;
        if (inner.depth <= node.depth) break;
        endIdx = j;
      }
      // Affordance renders AFTER endIdx, so we attach it to map[endIdx].
      const entries = map.get(endIdx) ?? [];
      entries.push({ path: node.path, depth: node.depth });
      map.set(endIdx, entries);
    }
    return map;
  }, [nodes]);

  // Sprint 344 Slice C (2026-05-15) — same end-of-subtree index map,
  // but keyed on `arr` nodes so the `+ item` row renders at the END
  // of the array's children. Each entry also carries `childCount` so
  // the auto-derived index label can be computed without re-walking
  // the tree at render time.
  const arrAffordanceAfter = useMemo(() => {
    const map = new Map<
      number,
      Array<{ path: string; depth: number; baseLength: number }>
    >();
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node === undefined) continue;
      if (node.kind !== "arr") continue;
      let endIdx = i;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const inner = nodes[j];
        if (inner === undefined) break;
        if (inner.depth <= node.depth) break;
        endIdx = j;
      }
      const entries = map.get(endIdx) ?? [];
      entries.push({
        path: node.path,
        depth: node.depth,
        baseLength: node.childCount ?? 0,
      });
      map.set(endIdx, entries);
    }
    return map;
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
        data-testid="document-tree-list"
        className="max-h-96 overflow-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
      >
        {nodes.map((node, idx) => {
          const objAffsAfter = onCommitEdit
            ? (objAffordanceAfter.get(idx) ?? [])
            : [];
          const arrAffsAfter = onCommitEdit
            ? (arrAffordanceAfter.get(idx) ?? [])
            : [];
          // Build the trailing `+ key` / `+ item` affordance(s) once
          // per index so both the visible-row and hidden-row branches
          // reuse them. We only emit affordances whose container is
          // itself visible (collapsed/filtered ancestors hide their
          // entire subtree including the add row, matching the leaf-
          // row behaviour).
          const visibleObjAffs = objAffsAfter
            .filter((aff) => !isHidden(aff.path))
            .filter(
              (aff) =>
                !Array.from(collapsed).some((cp) => {
                  if (aff.path === cp) return true;
                  return (
                    aff.path.startsWith(cp + ".") ||
                    aff.path.startsWith(cp + "[")
                  );
                }),
            );
          const visibleArrAffs = arrAffsAfter
            .filter((aff) => !isHidden(aff.path))
            .filter(
              (aff) =>
                !Array.from(collapsed).some((cp) => {
                  if (aff.path === cp) return true;
                  return (
                    aff.path.startsWith(cp + ".") ||
                    aff.path.startsWith(cp + "[")
                  );
                }),
            );
          const trailingObj = visibleObjAffs.map((aff) => (
            <AddKeyRow
              key={`__add-key-${aff.path || "__root"}`}
              parentPath={aff.path}
              parentDepth={aff.depth}
              isOpen={addingPath === aff.path && addingKind === "obj"}
              keyDraft={keyDraft}
              valueDraft={valueDraft}
              addError={addError}
              onStart={() => startAddKey(aff.path)}
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
          ));
          const trailingArr = visibleArrAffs.map((aff) => (
            <AddItemRow
              key={`__add-item-${aff.path}`}
              arrayPath={aff.path}
              parentDepth={aff.depth}
              isOpen={addingPath === aff.path && addingKind === "arr"}
              valueDraft={valueDraft}
              nextIndex={nextItemIndex(aff.path, aff.baseLength)}
              onStart={() => startAddItem(aff.path)}
              onValueDraftChange={setValueDraft}
              onCommit={commitAddItem}
              onCancel={cancelAddKey}
              valueInputRef={itemValueInputRef}
            />
          ));
          const trailing = [...trailingObj, ...trailingArr];
          if (isHidden(node.path)) {
            // Hidden row — still surface the trailing affordances if
            // the parent obj is otherwise visible at this index. In
            // practice the filter-ancestor rule keeps obj parents
            // visible while leaves get hidden, so this branch only
            // fires for fully-collapsed subtrees where `trailing`
            // is already empty by the filter above.
            return trailing.length > 0 ? (
              <Fragment key={`__hidden-trailing-${idx}`}>{trailing}</Fragment>
            ) : null;
          }
          const isCollapsed = collapsed.has(node.path);
          const pending = pendingByPath?.get(node.path);
          const isEditing = editingPath === node.path;
          return (
            <Fragment key={node.path || "__root"}>
              <div
                data-testid={`tree-node-${node.path || "__root"}`}
                className={
                  node.isGhost
                    ? "rounded border border-warning/30 bg-warning/10 px-1 py-0.5"
                    : pending !== undefined
                      ? "rounded bg-warning/10 px-1 py-0.5"
                      : "px-1 py-0.5"
                }
                style={{ paddingLeft: `${node.depth * 16}px` }}
              >
                {(node.kind === "obj" || node.kind === "arr") && (
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(node.path)}
                    className="inline-flex items-center align-middle text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    data-testid={`tree-twist-${node.path || "__root"}`}
                    role="treeitem"
                    aria-level={node.depth + 1}
                    aria-expanded={!isCollapsed}
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
                <span className="ml-1 text-sky-700 dark:text-sky-300">
                  {node.label}
                </span>
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
                        className="ml-1 align-middle text-emerald-700/60 line-through decoration-rose-500 dark:text-emerald-300/50"
                      >
                        {renderLeafValue(node)}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(node)}
                        data-testid={`tree-leaf-${node.path}`}
                        className="ml-1 align-middle text-emerald-700 hover:underline dark:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                      <span className="ml-2 text-3xs text-rose-500">
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
                          className="ml-2 inline-flex items-center align-middle text-muted-foreground transition-colors hover:text-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
              {trailing}
            </Fragment>
          );
        })}
      </div>
    </section>
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
