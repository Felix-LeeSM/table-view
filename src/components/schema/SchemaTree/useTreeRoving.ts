import { useCallback, useRef, useState } from "react";
import type { VisibleRow } from "./treeRows";

/**
 * WAI-ARIA tree roving-tabindex + arrow-key navigation for `SchemaTree`.
 *
 * The schema tree renders an ordered flat list of rows (`getVisibleRows`),
 * a mix of focusable `treeitem`s (schema / category / item) and
 * non-focusable affordance rows (separator / loading / search / empty).
 * Standard tree keyboard support means exactly one treeitem is in the tab
 * order (`tabIndex=0`); the rest are `-1` and the user moves focus with the
 * arrow keys.
 *
 * Focus is keyed by the row's stable `key`. We mirror the focused key in a
 * ref so the keydown handler reads the latest value without re-subscribing,
 * and call `.focus()` on the matching `[data-tree-key]` node after each move.
 *
 * Depth is derived from `kind` (schema=0, category=1, item=2) — the parent/
 * child relationship is identical across all `treeShape`s even though the
 * rendered `aria-level` differs (no-schema/flat shift one step up).
 */

const KIND_DEPTH: Partial<Record<VisibleRow["kind"], number>> = {
  schema: 0,
  category: 1,
  item: 2,
};

// A virtualized jump target (Home/End, or an arrow step past the overscan)
// mounts only after `scrollToIndex` re-renders the window, which can span
// more than one frame. Retry `.focus()` across a small bounded number of
// frames so we grab the node once it exists, then give up rather than spin.
const MAX_FOCUS_FRAMES = 6;

type FocusableRow = VisibleRow & { kind: "schema" | "category" | "item" };

function isFocusable(row: VisibleRow): row is FocusableRow {
  return (
    row.kind === "schema" || row.kind === "category" || row.kind === "item"
  );
}

/** Row's tree depth, or -1 for non-treeitem rows. */
export function rowDepth(row: VisibleRow): number {
  return KIND_DEPTH[row.kind] ?? -1;
}

/** Whether an arrow can expand/collapse this row (leaf items can't). */
function rowIsExpanded(row: FocusableRow): boolean | null {
  if (row.kind === "item") return null; // leaf
  return row.isExpanded;
}

export interface TreeRovingActions {
  /** Toggle expand/collapse of the named schema row. */
  onToggleSchema: (schemaName: string) => void;
  /** Toggle expand/collapse of the named category row. */
  onToggleCategory: (row: Extract<VisibleRow, { kind: "category" }>) => void;
}

export interface TreeRoving {
  /** Key of the row that owns `tabIndex=0`; null until first focusable row. */
  focusKey: string | null;
  /**
   * Sync the roving anchor to a row that JUST received focus (mouse click /
   * programmatic). State only — it must NOT call `.focus()`, because the row
   * already has focus; a deferred re-focus would steal focus back from
   * wherever the user moved next (e.g. the query editor), dropping keystrokes.
   */
  setFocusKey: (key: string) => void;
  /** `onKeyDown` for the `role="tree"` container. */
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function useTreeRoving(
  rows: VisibleRow[],
  actions: TreeRovingActions,
  containerRef: React.RefObject<HTMLElement | null>,
  // Only supplied when the tree is virtualized: brings a row index into the
  // rendered window so its DOM node exists before we focus it. Omitted on the
  // eager path (every row is already mounted).
  scrollToIndex?: (index: number) => void,
): TreeRoving {
  const [focusKey, setFocusKeyState] = useState<string | null>(null);
  const focusKeyRef = useRef<string | null>(null);
  focusKeyRef.current = focusKey;

  // Stable refs so the keydown handler doesn't need rows/actions in deps.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const scrollToIndexRef = useRef(scrollToIndex);
  scrollToIndexRef.current = scrollToIndex;

  // Keyboard navigation: move the anchor AND imperatively focus the target.
  // On a virtualized tree a jump target (Home/End) can be scrolled out of the
  // rendered window, so first ask the virtualizer to bring its index into
  // view, then focus once the node mounts — retried across a few frames since
  // scroll → re-render → mount may not finish in a single frame.
  const focusByKey = useCallback(
    (key: string) => {
      setFocusKeyState(key);
      focusKeyRef.current = key;
      const scroll = scrollToIndexRef.current;
      if (scroll) {
        const idx = rowsRef.current.findIndex((r) => r.key === key);
        if (idx >= 0) scroll(idx);
      }
      let frames = 0;
      const tryFocus = () => {
        const el = containerRef.current?.querySelector<HTMLElement>(
          `[data-tree-key="${CSS.escape(key)}"]`,
        );
        if (el) {
          el.focus();
          return;
        }
        if (++frames < MAX_FOCUS_FRAMES) requestAnimationFrame(tryFocus);
      };
      requestAnimationFrame(tryFocus);
    },
    [containerRef],
  );

  // Mouse / programmatic focus sync: the row already owns focus, so only move
  // the roving anchor. Deliberately NOT calling `.focus()` here (unlike
  // `focusByKey`) — a deferred re-focus would yank focus back after the user
  // moved to another control, which dropped keystrokes in the query editor.
  const syncFocusKey = useCallback((key: string) => {
    setFocusKeyState(key);
    focusKeyRef.current = key;
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const { key } = e;
      if (
        key !== "ArrowDown" &&
        key !== "ArrowUp" &&
        key !== "ArrowRight" &&
        key !== "ArrowLeft" &&
        key !== "Home" &&
        key !== "End"
      ) {
        return;
      }

      const allRows = rowsRef.current;
      const focusable = allRows.filter(isFocusable);
      if (focusable.length === 0) return;

      const current = focusKeyRef.current;
      const idx = focusable.findIndex((r) => r.key === current);
      // No active row yet → first arrow lands on the first treeitem.
      const cur = idx >= 0 ? idx : 0;

      // The focus target is the tree container or a treeitem inside it.
      // Don't steal keys from the search <input> / context-menu buttons.
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      e.preventDefault();

      if (key === "Home") {
        focusByKey(focusable[0]!.key);
        return;
      }
      if (key === "End") {
        focusByKey(focusable[focusable.length - 1]!.key);
        return;
      }
      if (key === "ArrowDown") {
        const next = focusable[Math.min(cur + 1, focusable.length - 1)]!;
        focusByKey(next.key);
        return;
      }
      if (key === "ArrowUp") {
        const prev = focusable[Math.max(cur - 1, 0)]!;
        focusByKey(prev.key);
        return;
      }

      const row = focusable[cur]!;
      const expanded = rowIsExpanded(row);

      if (key === "ArrowRight") {
        if (expanded === false) {
          // Collapsed → expand in place (focus stays on the same row).
          dispatchToggle(row, actionsRef.current);
        } else if (expanded === true) {
          // Expanded → move to first child (next row, deeper).
          const child = focusable[cur + 1];
          if (child && rowDepth(child) > rowDepth(row)) focusByKey(child.key);
        }
        return;
      }

      // ArrowLeft
      if (expanded === true) {
        // Expanded → collapse in place.
        dispatchToggle(row, actionsRef.current);
      } else {
        // Leaf or collapsed → move to parent (previous row, shallower).
        const parent = findParent(focusable, cur);
        if (parent) focusByKey(parent.key);
      }
    },
    [focusByKey],
  );

  return { focusKey, setFocusKey: syncFocusKey, onKeyDown };
}

/** First earlier row whose depth is shallower than `rows[idx]`. */
function findParent(
  rows: FocusableRow[],
  idx: number,
): FocusableRow | undefined {
  const depth = rowDepth(rows[idx]!);
  for (let i = idx - 1; i >= 0; i--) {
    if (rowDepth(rows[i]!) < depth) return rows[i];
  }
  return undefined;
}

function dispatchToggle(row: FocusableRow, actions: TreeRovingActions): void {
  if (row.kind === "schema") actions.onToggleSchema(row.schemaName);
  else if (row.kind === "category") actions.onToggleCategory(row);
}

// ── exported for unit test ───────────────────────────────────────────────
export const __test = { findParent, isFocusable };
