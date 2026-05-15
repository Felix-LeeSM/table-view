// Sprint 341 (2026-05-15) — inline JSON tree panel.
//
// Renders inside DocumentDataGrid as a detail row attached to the
// data row whose nested cell was toggled. Mirrors NestedExpandPopover's
// edit-commit contract (pendingByPath / onCommitEdit) so the grid-level
// commit bar keeps owning the save flow — panel V1 is read+edit only.
//
// Out of scope (V2):
// - BSON wrapper inline editor (currently read-only display via raw EJSON)
// - structural edits (add key, push array, delete)
// - regex search

import { useMemo, useState, useCallback } from "react";
import { ChevronRight, ChevronDown, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildTreeNodes,
  computeTreeStats,
  filterTreeNodes,
  renderLeafValue,
  type TreeNode,
} from "@/lib/jsonTree";

export interface DocumentTreePanelProps {
  /** Raw cell value (object or array). */
  value: unknown;
  /** Column name shown in the panel header as the path root. */
  fieldName: string;
  /** Pending edits scoped to this cell — same Map shape NestedExpandPopover uses. */
  pendingByPath?: ReadonlyMap<string, string | Record<string, unknown>>;
  /** Commit a single leaf edit; grid owns Save/Discard. */
  onCommitEdit?: (
    path: string,
    value: string | Record<string, unknown>,
  ) => void;
  /** Close button on the detail row header (mirrors the cell-level toggle). */
  onClose?: () => void;
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
}: DocumentTreePanelProps) {
  const nodes = useMemo(() => buildTreeNodes(value), [value]);
  const stats = useMemo(() => computeTreeStats(value), [value]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const visiblePaths = useMemo(
    () => filterTreeNodes(nodes, search),
    [nodes, search],
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
    if (node.isBson) return; // V2 — BSON inline editor not wired yet.
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
      aria-label="Document tree"
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
              className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-3xs text-amber-400"
            >
              {pendingCount} unsaved edit{pendingCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="document-tree-close"
            onClick={onClose}
            aria-label="Close tree panel"
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
            placeholder="Search keys / values…"
            data-testid="document-tree-search"
            className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs"
          />
        </div>

        <dl
          data-testid="document-tree-stats"
          className="flex flex-wrap gap-1.5 text-3xs"
        >
          <StatPill label="NODES" value={stats.nodes} />
          <StatPill label="KEYS" value={stats.keys} />
          <StatPill label="DEPTH" value={stats.depth} />
          <StatPill label="OBJ" value={stats.objects} />
          <StatPill label="ARR" value={stats.arrays} />
          <StatPill label="MAX" value={stats.maxArray} />
        </dl>
      </div>

      <div
        data-testid="document-tree-list"
        className="max-h-96 overflow-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
      >
        {nodes.map((node) => {
          if (isHidden(node.path)) return null;
          const isCollapsed = collapsed.has(node.path);
          const pending = pendingByPath?.get(node.path);
          const isEditing = editingPath === node.path;
          return (
            <div
              key={node.path || "__root"}
              data-testid={`tree-node-${node.path || "__root"}`}
              className={
                pending !== undefined
                  ? "rounded bg-amber-400/10 px-1 py-0.5"
                  : "px-1 py-0.5"
              }
              style={{ paddingLeft: `${node.depth * 16}px` }}
            >
              {(node.kind === "obj" || node.kind === "arr") && (
                <button
                  type="button"
                  onClick={() => toggleCollapsed(node.path)}
                  className="inline-flex items-center align-middle text-muted-foreground"
                  data-testid={`tree-twist-${node.path || "__root"}`}
                  aria-expanded={!isCollapsed}
                  aria-label={`Toggle ${node.label}`}
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

              {node.kind === "leaf" && !isEditing && (
                <>
                  <span className="ml-1 text-muted-foreground">:</span>
                  <button
                    type="button"
                    onClick={() => startEdit(node)}
                    data-testid={`tree-leaf-${node.path}`}
                    className="ml-1 align-middle text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:hover:no-underline dark:text-emerald-300"
                    disabled={node.isBson}
                  >
                    {pending !== undefined && typeof pending === "string"
                      ? pending
                      : renderLeafValue(node)}
                  </button>
                  <TagBadge>{leafTypeTag(node)}</TagBadge>
                  {pending !== undefined && (
                    <span className="ml-2 text-3xs text-amber-400">
                      ● edited
                    </span>
                  )}
                </>
              )}

              {node.kind === "leaf" && isEditing && (
                <>
                  <span className="ml-1 text-muted-foreground">:</span>
                  <input
                    type="text"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitDraft}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitDraft();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingPath(null);
                        setDraft("");
                      }
                    }}
                    data-testid={`tree-edit-${node.path}`}
                    className="ml-1 inline-block w-56 rounded border border-primary bg-background px-1 align-middle text-foreground"
                  />
                  <TagBadge>{leafTypeTag(node)}</TagBadge>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
