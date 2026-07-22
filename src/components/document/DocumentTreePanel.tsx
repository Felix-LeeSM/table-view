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

import { useMemo, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronRight,
  ChevronDown,
  X,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  TREE_ROW_HEIGHT_ESTIMATE,
  TREE_VIRTUALIZE_THRESHOLD,
} from "@/components/shared/tree/virtualize";
import {
  buildTreeNodesWithGhosts,
  computeTreeStats,
  filterTreeNodes,
  renderLeafValue,
} from "@/lib/jsonTree";
import BsonTypeEditor from "@/components/document/BsonTypeEditor";
import {
  useTreeRoving,
  type TreeRovingRow,
} from "@/components/shared/tree/useTreeRoving";
import {
  computeAffordances,
  type DocumentTreePanelProps,
  isPendingUnset,
  KIND_TAG,
  leafTypeTag,
  parseBsonLeaf,
  type RenderRow,
  renderPendingText,
  UNSET_OP,
} from "./DocumentTreePanel/types";
import {
  AddItemRow,
  AddKeyRow,
  NewBadge,
  PlainLeafInput,
  StatPill,
  TagBadge,
  VirtualTreeRows,
} from "./DocumentTreePanel/rows";
import { useTreeAdd, useTreeEditing } from "./DocumentTreePanel/hooks";

export function DocumentTreePanel({
  value,
  fieldName,
  pendingByPath,
  onCommitEdit,
  onRemovePending,
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
  // WAI-ARIA tree roving container (#1128).
  const listRef = useRef<HTMLDivElement | null>(null);

  const {
    editingPath,
    setEditingPath,
    draft,
    setDraft,
    startEdit,
    commitDraft,
  } = useTreeEditing({ nodes, onCommitEdit, listRef });

  const {
    addingPath,
    addingKind,
    keyDraft,
    setKeyDraft,
    valueDraft,
    setValueDraft,
    addError,
    setAddError,
    keyInputRef,
    valueInputRef,
    itemValueInputRef,
    startAddKey,
    cancelAddKey,
    startAddItem,
    commitAddKey,
    commitAddItem,
    nextItemIndex,
  } = useTreeAdd({ nodes, pendingByPath, onCommitEdit, forbiddenRootKeys });

  const { objAffordanceAfter, arrAffordanceAfter } = useMemo(
    () => computeAffordances(nodes),
    [nodes],
  );

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
        {/* #1703 — a pending unset deletes the whole entry (key), so the key
          label carries the strike, not only the value. The value strike alone
          reads as "value edited", hiding that the key itself is going away. */}
        <span
          className={
            isPendingUnset(pending)
              ? "ml-1 text-value-key line-through decoration-value-delete opacity-60"
              : "ml-1 text-value-key"
          }
        >
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
              honest.
              #1703 — once a leaf is marked for delete, reuse the
              same slot as an "undo delete" toggle (the trash used
              to just vanish, leaving no in-tree way to cancel).
              Clicking drops the pending unset via onRemovePending. */}
            {onCommitEdit &&
              node.path !== "_id" &&
              (isPendingUnset(pending) ? (
                onRemovePending && (
                  <button
                    type="button"
                    data-testid={`tree-undo-delete-${node.path}`}
                    aria-label={t("treePanel.undoDeleteFieldAriaLabel", {
                      path: node.path,
                    })}
                    title={t("treePanel.undoDeleteFieldTitle")}
                    onClick={() => onRemovePending(node.path)}
                    className="ml-2 inline-flex items-center align-middle text-value-delete transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <Undo2 size={12} aria-hidden />
                  </button>
                )
              ) : (
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
              ))}
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
