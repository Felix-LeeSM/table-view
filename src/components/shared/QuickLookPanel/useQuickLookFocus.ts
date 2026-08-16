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
//
// The second trap is WHERE the restore hangs. #1734 (5) first wired it into each
// close handler and wrote that every close path went through them. Some did not,
// and none of those was a handler at all — a successful commit empties the
// selection the panel's mount gate reads, and a refetch could leave the page with
// no row for the panel to show. (Two later fixes closed that second one: #2133
// clamps an index past the end onto the last surviving row, and #2384 renders an
// empty state for a page that comes back with zero rows instead of unmounting.)
// Enumerating close handlers can only ever be as complete as the last audit, so
// the restore hangs off the one event all of them share instead: the panel node
// leaving the DOM, which React reports by calling `panelRef` with `null`.
// Nothing a call site does (or forgets to do) can bypass it — there is no longer
// a `focusGridCell` to forget.
//
// The condition is on where focus ENDED UP, not on why the panel went away and
// not on where focus was before: after the panel is gone, focus that landed
// nowhere (`<body>`) goes to the grid, and focus anything else is holding stays
// put. "Where it was before" was the obvious rule and it is wrong — a
// successful commit unmounts the SQL preview in a later commit than the panel,
// so the button the user pressed dies too, one step after the panel did.
//
// Two things this still does NOT promise. Escape and `F6` move focus without
// removing the panel, so they stay explicit below. And when the whole grid goes
// away with the panel (tab close), there is no anchor cell left to hand focus
// to — `focusAnchorCell` finds nothing and gives up after its bounded retries.

import { useCallback, useEffect, useRef } from "react";

export interface QuickLookFocus {
  /** Goes on the element wrapping BOTH the grid and the panel. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Goes on `QuickLookPanel`'s `panelRef` prop. A callback ref rather than an
   * object ref on purpose — see the note above on why the restore hangs off the
   * panel node going away instead of off each close handler.
   */
  panelRef: React.RefCallback<HTMLDivElement>;
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
  const panelNodeRef = useRef<HTMLDivElement | null>(null);

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

  const panelWentAwayRef = useRef(false);

  const panelRef = useCallback<React.RefCallback<HTMLDivElement>>((node) => {
    const previous = panelNodeRef.current;
    panelNodeRef.current = node;
    if (previous !== null && node === null) panelWentAwayRef.current = true;
    // `useCallback([])` only avoids the detach/re-attach churn React performs
    // on a callback ref whose identity changed. It is not what keeps that churn
    // from reading as "the panel went away" — the effect's focus condition is
    // (measured: rebuilding this per render leaves every test in this suite
    // green).
  }, []);

  // Runs on every commit, and deliberately not inside the ref callback: the
  // detach happens mid-mutation, before the rest of the commit has landed.
  // Focusing from there picks a cell React is about to replace and reads a
  // `focusAnchorRef` the grid republishes in its own effect — measured landing
  // straight back on `<body>` in the no-handler paths above. By here the DOM
  // is final and the child grid's effect has already run.
  useEffect(() => {
    if (!panelWentAwayRef.current) return;
    // A modal owns focus while it is open (same guard as F6/Escape below), so
    // where focus belongs is not settled yet — keep the flag and re-check on
    // the commit that closes it. Commit-success is exactly this shape: the
    // panel and the SQL preview go in separate commits, and the dialog's own
    // restore then aims at the element it captured before it opened, which was
    // inside the panel and no longer exists.
    if (
      document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
    ) {
      return;
    }
    panelWentAwayRef.current = false;
    // The condition is on where focus ENDED UP, not on why the panel went away
    // or on where focus was before. Anything still holding focus keeps it: the
    // FilterBar the user is typing in, a toolbar button, another cell. This
    // restores, it never yanks. Only focus that ended up nowhere is rescued,
    // and "nowhere" is the whole bug — the panel took the focused element down
    // with it.
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    focusGridCell();
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const panel = panelNodeRef.current;
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

  return { rootRef, panelRef };
}
