// Issue #1734 (5) — keyboard focus exchange between a data grid and its Quick
// Look panel.
//
// `F6` — the platform convention for "next pane" — walks
//
//   grid cell  --F6-->  panel region  --F6-->  grid cell
//
// and Escape inside the panel (outside a text field) hands focus back to the
// grid without closing anything. Tab does reach the panel (it is the grid's
// next sibling and owns a `tabIndex={0}` resize handle and a Close button), but
// only by walking through them, and the grid's roving tabindex means Tab
// re-enters the grid at its single tab stop rather than where the user was.
// `F6` is the direct route in both directions.
//
// Returning focus to "the cell the user came from" has one trap. The obvious
// implementations both break on the RDB grid, which virtualizes past 200 rows
// (`gridPolicy.DEFAULT_PAGE_SIZE` 300 vs `columnUtils.VIRTUALIZE_THRESHOLD`
// 200): a node captured when the panel opened goes detached, and a live
// `querySelector('[data-grid-row][tabindex="0"]')` returns null — the anchor
// row is simply not in the DOM once the user scrolls it past `overscan`.
// Either way `.focus()` is a silent no-op and focus lands on `<body>`, which is
// the exact state this was meant to prevent.
//
// So the grid hands us its own focuser instead (`focusAnchorRef`, published by
// `DataGridTable` from `useGridRoving.focusAnchorCell`): it scrolls the anchor
// row back in and retries for a bounded number of frames. Callers that cannot
// virtualize (the document grid) pass nothing and get the live-lookup fallback,
// which is also what keeps the anchor correct when the user moves the selection
// while the panel is open.

import { useCallback, useEffect, useRef } from "react";

export interface QuickLookFocus {
  /** Goes on the element wrapping BOTH the grid and the panel. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /** Goes on `QuickLookPanel`'s `panelRef` prop. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Moves focus to the grid's roving anchor cell. Call it from every path that
   * closes the panel so focus never falls back to `<body>`.
   */
  focusGridCell: () => void;
}

/** Is this event target a text field that owns its own Escape handling? */
function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

export function useQuickLookFocus(
  open: boolean,
  /**
   * The grid's own "focus the anchor cell" function, if it published one. See
   * the note above on why the DOM fallback is not enough for a virtualized
   * grid.
   */
  focusAnchorRef?: React.RefObject<(() => void) | null>,
): QuickLookFocus {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const focusGridCell = useCallback(() => {
    const viaGrid = focusAnchorRef?.current;
    if (viaGrid) {
      viaGrid();
      return;
    }
    rootRef.current
      ?.querySelector<HTMLElement>('[data-grid-row][tabindex="0"]')
      ?.focus();
  }, [focusAnchorRef]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      // A modal owns focus while it is open — and one of them, the cell
      // `BlobViewerDialog`, mounts INSIDE the panel. Same guard the grid's
      // Escape gate uses (`useRdbDataGridShortcuts`).
      if (
        document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
      ) {
        return;
      }
      const inPanel = panel.contains(document.activeElement);

      if (e.key === "F6") {
        e.preventDefault();
        if (inPanel) focusGridCell();
        else panel.focus();
        return;
      }

      // Escape returns focus to the grid. Inside a field Escape already means
      // "revert this draft" (`FieldRow`), so those keep it.
      //
      // This listener only moves focus — it does not close the panel and does
      // not consume the event. That is deliberate but NOT free: the grid's
      // Escape gate (`useRdbDataGridShortcuts`) has no focus-position
      // condition, so with pending edits one Escape both moves focus here and
      // opens the discard confirm. Swallowing the event instead would make
      // Escape-inside-the-panel the one place the discard gate cannot be
      // reached, which is worse; the gate needing a focus condition is its own
      // change.
      if (e.key === "Escape" && inPanel && !isTextField(e.target)) {
        focusGridCell();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, focusGridCell]);

  return { rootRef, panelRef, focusGridCell };
}
