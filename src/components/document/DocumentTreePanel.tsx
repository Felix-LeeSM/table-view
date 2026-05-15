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

import { useMemo, useState, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  X,
  Search,
  GitCompare,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildTreeNodes,
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
  const [searchRegex, setSearchRegex] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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
        <div className="flex items-center gap-1">
          <Button
            variant={diffMode ? "default" : "ghost"}
            size="sm"
            data-testid="document-tree-diff-toggle"
            onClick={() => setDiffMode((v) => !v)}
            aria-pressed={diffMode}
            aria-label="Toggle diff view"
            title="Show original → pending for unsaved edits"
          >
            <GitCompare size={14} aria-hidden />
            <span className="ml-1 text-3xs uppercase tracking-wider">Diff</span>
          </Button>
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
        </div>
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
              searchRegex ? "Regex (e.g. ^Gloss\\w+)" : "Search keys / values…"
            }
            data-testid="document-tree-search"
            className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-12 text-xs"
          />
          <label
            className="absolute right-1 top-1/2 inline-flex -translate-y-1/2 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-3xs uppercase tracking-wider text-muted-foreground has-[:checked]:bg-primary has-[:checked]:text-primary-foreground"
            title="Match by JavaScript regex (case-insensitive)"
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
                  {/* Sprint 342 V2 — three render branches for leaves
                      with a pending edit:
                       1. pending = __op__:unset → strike-through original,
                          "● will delete" badge.
                       2. diffMode on → original (strike) → pending (amber).
                       3. otherwise → pending (or original) as the
                          clickable editor entry-point.
                      Branch 1 takes precedence over 2 because a delete
                      shouldn't render an `→` arrow into the unset marker. */}
                  {isPendingUnset(pending) ? (
                    <span
                      data-testid={`tree-unset-${node.path}`}
                      className="ml-1 align-middle text-emerald-700/60 line-through decoration-rose-500 dark:text-emerald-300/50"
                    >
                      {renderLeafValue(node)}
                    </span>
                  ) : diffMode && pending !== undefined ? (
                    <span
                      data-testid={`tree-diff-${node.path}`}
                      className="ml-1 inline-flex items-center gap-1.5 align-middle"
                    >
                      <span
                        data-testid={`tree-diff-original-${node.path}`}
                        className="text-emerald-700/60 line-through decoration-emerald-700/40 dark:text-emerald-300/50"
                      >
                        {renderLeafValue(node)}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <button
                        type="button"
                        onClick={() => startEdit(node)}
                        data-testid={`tree-leaf-${node.path}`}
                        className="rounded bg-amber-400/15 px-1 text-amber-700 hover:underline dark:text-amber-300"
                      >
                        {renderPendingText(pending)}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(node)}
                      data-testid={`tree-leaf-${node.path}`}
                      className="ml-1 align-middle text-emerald-700 hover:underline dark:text-emerald-300"
                    >
                      {pending !== undefined
                        ? renderPendingText(pending)
                        : renderLeafValue(node)}
                    </button>
                  )}
                  <TagBadge>{leafTypeTag(node)}</TagBadge>
                  {isPendingUnset(pending) ? (
                    <span className="ml-2 text-3xs text-rose-500">
                      ● will delete
                    </span>
                  ) : (
                    pending !== undefined &&
                    !diffMode && (
                      <span className="ml-2 text-3xs text-amber-400">
                        ● edited
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
                        aria-label={`Delete ${node.path}`}
                        title="Mark this field for $unset on Save"
                        onClick={() => onCommitEdit(node.path, UNSET_OP)}
                        className="ml-2 inline-flex items-center align-middle text-muted-foreground transition-colors hover:text-rose-500"
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
                          ariaLabel={`Editing ${node.path} (${parsed.type})`}
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
        })}
      </div>
    </section>
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
