import { useCallback, useRef, useState } from "react";

/**
 * WAI-ARIA tree roving-tabindex + arrow-key navigation, shared by every
 * sidebar tree (relational schema, document databases, KV keys, search
 * catalog, …). A tree supplies a flat, in-visible-order list of rows; exactly
 * one focusable row holds `tabIndex=0` and the arrow keys move that anchor:
 *
 * - ArrowDown / ArrowUp — previous / next focusable row.
 * - ArrowRight — expand a collapsed row, else step into the first child.
 * - ArrowLeft — collapse an expanded row, else hop to the parent row.
 * - Home / End — first / last focusable row.
 *
 * Split focus model (SchemaTree #1012 lesson): a *keyboard* move calls
 * `.focus()` on the target via `focusByKey`; a *mouse / programmatic* focus
 * only syncs the anchor STATE via `setFocusKey` and never re-focuses. A
 * deferred re-focus after a mouse click used to yank focus back from wherever
 * the user moved next (e.g. the query editor), dropping their keystrokes.
 *
 * Each focusable row must render `data-tree-key={row.key}` and
 * `tabIndex={roving.focusKey === row.key ? 0 : -1}` on the element that owns
 * `role="treeitem"`; the `role="tree"` container wires `onKeyDown`.
 */

export interface TreeRovingRow {
  /** Stable key; rendered as `data-tree-key` and used to find/focus the row. */
  key: string;
  /** 0-based tree depth; drives ArrowLeft parent hops and ArrowRight child steps. */
  depth: number;
  /** `true` = expanded, `false` = collapsed, `null` = leaf / no children. */
  expanded: boolean | null;
  /** treeitem rows are focusable; separators / section headers / status rows aren't. */
  focusable: boolean;
}

export interface TreeRoving {
  /** Key of the row that owns `tabIndex=0`; `null` until a first focus. */
  focusKey: string | null;
  /**
   * Sync the anchor to a row that JUST received focus (mouse / programmatic).
   * STATE only — it must NOT call `.focus()`, because the row already has
   * focus and a deferred re-focus would steal it back from wherever the user
   * moved next.
   */
  setFocusKey: (key: string) => void;
  /** `onKeyDown` handler for the `role="tree"` container. */
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}

// A virtualized jump target (Home/End, or an arrow step past the overscan)
// mounts only after `scrollToIndex` re-renders the window, which can span more
// than one frame. Retry `.focus()` across a small bounded number of frames so
// we grab the node once it exists, then give up rather than spin.
const MAX_FOCUS_FRAMES = 6;

/** First earlier row whose depth is shallower than `rows[idx]`. */
export function findParent(
  rows: TreeRovingRow[],
  idx: number,
): TreeRovingRow | undefined {
  const depth = rows[idx]!.depth;
  for (let i = idx - 1; i >= 0; i--) {
    if (rows[i]!.depth < depth) return rows[i];
  }
  return undefined;
}

export function useTreeRoving(
  // Full visible-order list, including non-focusable affordance rows; the hook
  // filters focusable rows for navigation but keeps the full list so a
  // virtualized `scrollToIndex` receives the correct full-list index.
  rows: TreeRovingRow[],
  // Expand / collapse the named row (ArrowRight on a collapsed row, ArrowLeft
  // on an expanded one). No-op for leaves.
  onToggle: (key: string) => void,
  containerRef: React.RefObject<HTMLElement | null>,
  // Only supplied when the tree is virtualized: brings a row index into the
  // rendered window so its DOM node exists before we focus it.
  scrollToIndex?: (index: number) => void,
): TreeRoving {
  const [focusKey, setFocusKeyState] = useState<string | null>(null);
  const focusKeyRef = useRef<string | null>(null);
  focusKeyRef.current = focusKey;

  // Stable refs so the keydown handler doesn't need rows/callbacks in deps.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const scrollToIndexRef = useRef(scrollToIndex);
  scrollToIndexRef.current = scrollToIndex;

  // Keyboard move: set the anchor AND imperatively focus the target. On a
  // virtualized tree a jump target can be outside the rendered window, so ask
  // the virtualizer to bring its index into view first, then focus once the
  // node mounts — retried across a few frames since scroll → re-render → mount
  // may not finish in a single frame.
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
  // the anchor. Deliberately NOT calling `.focus()` here (unlike `focusByKey`).
  const syncFocusKey = useCallback((key: string) => {
    setFocusKeyState(key);
    focusKeyRef.current = key;
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
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

      const focusable = rowsRef.current.filter((r) => r.focusable);
      if (focusable.length === 0) return;

      const current = focusKeyRef.current;
      const idx = focusable.findIndex((r) => r.key === current);
      // No active row yet → first arrow lands on the first treeitem.
      const cur = idx >= 0 ? idx : 0;

      // Don't steal keys from a nested search <input> / <textarea>.
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
        focusByKey(focusable[Math.min(cur + 1, focusable.length - 1)]!.key);
        return;
      }
      if (key === "ArrowUp") {
        focusByKey(focusable[Math.max(cur - 1, 0)]!.key);
        return;
      }

      const row = focusable[cur]!;
      const expanded = row.expanded;

      if (key === "ArrowRight") {
        if (expanded === false) {
          // Collapsed → expand in place (focus stays on the same row).
          onToggleRef.current(row.key);
        } else if (expanded === true) {
          // Expanded → move to the first child (next deeper row).
          const child = focusable[cur + 1];
          if (child && child.depth > row.depth) focusByKey(child.key);
        }
        return;
      }

      // ArrowLeft
      if (expanded === true) {
        // Expanded → collapse in place.
        onToggleRef.current(row.key);
      } else {
        // Leaf or collapsed → move to the parent (previous shallower row).
        const parent = findParent(focusable, cur);
        if (parent) focusByKey(parent.key);
      }
    },
    [focusByKey],
  );

  return { focusKey, setFocusKey: syncFocusKey, onKeyDown };
}
