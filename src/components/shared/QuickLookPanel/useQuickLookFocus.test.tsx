// Issue #1734 (5) — the seam between Quick Look and the grid's own focuser.
//
// #1734 (5) first restored focus with a bare
// `querySelector('[data-grid-row][tabindex="0"]')?.focus()`. That is a silent
// no-op whenever the anchor row is outside the RDB grid's virtual window, which
// is the default state past 200 rows, so closing the panel dropped focus on
// `<body>` and the arrow keys died. The fix delegates to the focuser the grid
// publishes (`useGridRoving.focusAnchorCell`, which scrolls the row back in and
// retries). These tests pin that delegation from the panel's side; the
// scroll-in + retry itself is `useGridRoving.test.tsx:67`, and the grid's end
// of the wire is `DataGridTable.roving.test.tsx`.
//
// The fix then moved WHERE the restore hangs, and that is what the harness below
// encodes: nothing calls a restore function — the panel is simply unmounted,
// the same way a commit or a refetch onto an empty page removes it. Those real
// paths are in `DataGrid.quicklook-focus.test.tsx`. (#2133 narrowed the refetch
// one: a page that comes back shorter but non-empty now clamps the selection and
// keeps the panel, so only an empty page still takes it down.)

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useQuickLookFocus } from "./useQuickLookFocus";

/**
 * Grid + panel under one root, exactly as `DataGrid` mounts them. `hasAnchor`
 * false renders the grid WITHOUT its anchor cell — what a virtualized-out row
 * looks like to the DOM. "remove panel" unmounts the panel and nothing else:
 * no close handler, no restore call.
 */
function Harness({
  hasAnchor = true,
  gridFocuser,
}: {
  hasAnchor?: boolean;
  gridFocuser?: () => void;
}) {
  const [mounted, setMounted] = useState(true);
  const focusAnchorRef = useRef<(() => void) | null>(gridFocuser ?? null);
  const { rootRef, panelRef } = useQuickLookFocus(
    mounted,
    gridFocuser ? focusAnchorRef : undefined,
  );
  return (
    <div ref={rootRef}>
      {hasAnchor && (
        <div data-grid-row="7" data-grid-col="0" tabIndex={0}>
          cell
        </div>
      )}
      {mounted && (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="region"
          aria-label="Row Details"
        >
          <button type="button">in panel</button>
        </div>
      )}
      <button type="button" onClick={() => setMounted(false)}>
        remove panel
      </button>
      {/* Outlives the panel — stands in for the FilterBar / a toolbar button. */}
      <button type="button">outside</button>
    </div>
  );
}

const panel = () => screen.getByRole("region", { name: "Row Details" });
const anchor = () =>
  document.querySelector<HTMLElement>('[data-grid-row][tabindex="0"]');
const click = (name: string) => {
  act(() => {
    screen.getByRole("button", { name }).click();
  });
};
const focusPanel = () => {
  act(() => {
    panel().focus();
  });
};

describe("useQuickLookFocus", () => {
  // Reason: THE round-1 bug. With the anchor row unmounted the DOM lookup finds
  // nothing, so if the hook did not delegate, focus would sit on <body>.
  it("restores focus through the grid's focuser when the anchor row is not in the DOM", () => {
    const gridFocuser = vi.fn();
    render(<Harness hasAnchor={false} gridFocuser={gridFocuser} />);
    focusPanel();

    click("remove panel");

    expect(gridFocuser).toHaveBeenCalledTimes(1);
  });

  // Reason: the grid's focuser knows about scrolling; the DOM lookup does not.
  // Preferring it even when both would work is what makes the virtualized case
  // impossible to regress by accident.
  it("prefers the grid's focuser over the DOM anchor lookup", () => {
    const gridFocuser = vi.fn();
    render(<Harness gridFocuser={gridFocuser} />);
    const cell = anchor();
    focusPanel();

    click("remove panel");

    expect(gridFocuser).toHaveBeenCalledTimes(1);
    // The fallback did NOT also run — the grid owns the restore.
    expect(document.activeElement).not.toBe(cell);
  });

  // Reason: the document grid never virtualizes and publishes no focuser, so
  // the fallback has to keep working on its own.
  it("falls back to the live roving anchor when no focuser is published", () => {
    render(<Harness />);
    focusPanel();

    click("remove panel");

    expect(document.activeElement).toBe(anchor());
  });

  // Reason: #1734 (5) — the restore has to survive paths that remove the
  // panel without calling anything. Nothing here calls a restore; the panel is
  // taken out of the tree and the hook sees only its ref detaching, which is
  // what a successful commit and a refetch onto an empty page look like from
  // here.
  it("restores focus from a nested control with no close handler in the path", () => {
    render(<Harness />);
    const inside = screen.getByRole("button", { name: "in panel" });
    act(() => {
      inside.focus();
    });

    click("remove panel");

    expect(document.activeElement).toBe(anchor());
  });

  // Reason: the counterweight. Hanging the restore on unmount would be a focus
  // thief if it fired unconditionally — the panel can disappear while the user
  // is typing in the FilterBar, and yanking them into the grid mid-keystroke is
  // worse than the bug being fixed. This is also the guard that keeps a
  // re-render of the panel (React re-attaching the callback ref) from reading
  // as "the panel went away".
  it("leaves focus alone when something else still holds it", () => {
    const gridFocuser = vi.fn();
    render(<Harness gridFocuser={gridFocuser} />);
    const outside = screen.getByRole("button", { name: "outside" });
    act(() => {
      outside.focus();
    });

    click("remove panel");

    expect(gridFocuser).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
  });

  // Reason: `BlobViewerDialog` mounts inside the panel, so without this guard
  // F6 pulls focus out of an open modal.
  it("F6 is inert while a dialog is open", () => {
    render(<Harness />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    act(() => {
      fireEvent.keyDown(window, { key: "F6" });
    });

    expect(document.activeElement).not.toBe(panel());
    dialog.remove();
  });
});
