// Inline-editing state hooks for DocumentTreePanel: `useTreeAdd` owns the
// `+ key` / `+ item` add UI (only one open at a time across the whole tree),
// `useTreeEditing` owns the leaf value editor + focus restore. Both are pure
// panel-local state — no store wiring — so the panel destructures them and its
// render stays declarative.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  coerceTreeAddValue,
  renderLeafValue,
  type TreeNode,
} from "@/lib/jsonTree";
import { joinObjectPath } from "./types";

type PendingMap = ReadonlyMap<string, string | Record<string, unknown>>;
type CommitEdit = (
  path: string,
  value: string | Record<string, unknown>,
) => void;

export function useTreeAdd({
  nodes,
  pendingByPath,
  onCommitEdit,
  forbiddenRootKeys,
}: {
  nodes: TreeNode[];
  pendingByPath?: PendingMap;
  onCommitEdit?: CommitEdit;
  forbiddenRootKeys?: ReadonlySet<string>;
}) {
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

  return {
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
  };
}

export function useTreeEditing({
  nodes,
  onCommitEdit,
  listRef,
}: {
  nodes: TreeNode[];
  onCommitEdit?: CommitEdit;
  listRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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
  }, [editingPath, listRef]);

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

  return {
    editingPath,
    setEditingPath,
    draft,
    setDraft,
    startEdit,
    commitDraft,
  };
}
