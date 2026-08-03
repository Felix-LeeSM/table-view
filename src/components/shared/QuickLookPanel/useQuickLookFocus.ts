// Issue #1734 (5) — keyboard focus exchange between a data grid and its Quick
// Look panel.
//
// The grid keeps a single tab stop (`useGridRoving`'s roving tabindex), so Tab
// cannot walk into the panel and back. `F6` — the platform convention for
// "next pane" — does that walk instead:
//
//   grid cell  --F6-->  panel region  --F6-->  grid cell
//
// and Escape inside the panel (outside a text field) hands focus back to the
// grid without closing anything.
//
// The return target is the live roving anchor (`[data-grid-row][tabindex="0"]`)
// rather than an element captured when the panel opened. Two reasons: a
// virtualized row can unmount while the panel is open, which would leave a
// captured node detached and `.focus()` a no-op; and moving the selection while
// the panel is open (which re-syncs the detail view) also moves the anchor, so
// the live lookup returns the cell the user is actually on.

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

export function useQuickLookFocus(open: boolean): QuickLookFocus {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const focusGridCell = useCallback(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[data-grid-row][tabindex="0"]')
      ?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const inPanel = panel.contains(document.activeElement);

      if (e.key === "F6") {
        e.preventDefault();
        if (inPanel) focusGridCell();
        else panel.focus();
        return;
      }

      // Escape returns focus to the grid. Inside a field Escape already means
      // "revert this draft" (`FieldRow`), so those keep it. This listener only
      // moves focus — it does not close the panel and does not consume the
      // event, so the grid's own Escape gate (discard confirm) is untouched.
      if (e.key === "Escape" && inPanel && !isTextField(e.target)) {
        focusGridCell();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, focusGridCell]);

  return { rootRef, panelRef, focusGridCell };
}
