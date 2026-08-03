// Issue #1734 (5), round 2 — the seam between Quick Look and the grid's own
// focuser.
//
// Round 1 restored focus with a bare
// `querySelector('[data-grid-row][tabindex="0"]')?.focus()`. That is a silent
// no-op whenever the anchor row is outside the RDB grid's virtual window, which
// is the default state past 200 rows, so closing the panel dropped focus on
// `<body>` and the arrow keys died. The fix delegates to the focuser the grid
// publishes (`useGridRoving.focusAnchorCell`, which scrolls the row back in and
// retries). These tests pin that delegation from the panel's side; the
// scroll-in + retry itself is `useGridRoving.test.tsx:67`, and the grid's end
// of the wire is `DataGridTable.roving.test.tsx`.

import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useQuickLookFocus } from "./useQuickLookFocus";

/**
 * Grid + panel under one root, exactly as `DataGrid` mounts them. `hasAnchor`
 * false renders the grid WITHOUT its anchor cell — what a virtualized-out row
 * looks like to the DOM.
 */
function Harness({
  open = true,
  hasAnchor = true,
  gridFocuser,
}: {
  open?: boolean;
  hasAnchor?: boolean;
  gridFocuser?: () => void;
}) {
  const focusAnchorRef = useRef<(() => void) | null>(gridFocuser ?? null);
  const { rootRef, panelRef, focusGridCell } = useQuickLookFocus(
    open,
    gridFocuser ? focusAnchorRef : undefined,
  );
  return (
    <div ref={rootRef}>
      {hasAnchor && (
        <div data-grid-row="7" data-grid-col="0" tabIndex={0}>
          cell
        </div>
      )}
      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="region"
          aria-label="Row Details"
        >
          panel
        </div>
      )}
      <button type="button" onClick={focusGridCell}>
        close
      </button>
    </div>
  );
}

const panel = () => document.querySelector<HTMLElement>('[role="region"]')!;
const closeButton = () => document.querySelector<HTMLElement>("button")!;

describe("useQuickLookFocus", () => {
  // Reason: THE round-1 bug. With the anchor row unmounted the DOM lookup finds
  // nothing, so if the hook did not delegate, focus would sit on <body>.
  it("restores focus through the grid's focuser when the anchor row is not in the DOM", () => {
    const gridFocuser = vi.fn();
    render(<Harness hasAnchor={false} gridFocuser={gridFocuser} />);

    act(() => {
      closeButton().click();
    });

    expect(gridFocuser).toHaveBeenCalledTimes(1);
  });

  // Reason: the grid's focuser knows about scrolling; the DOM lookup does not.
  // Preferring it even when both would work is what makes the virtualized case
  // impossible to regress by accident.
  it("prefers the grid's focuser over the DOM anchor lookup", () => {
    const gridFocuser = vi.fn();
    render(<Harness gridFocuser={gridFocuser} />);
    const anchor = document.querySelector<HTMLElement>("[data-grid-row]")!;

    act(() => {
      closeButton().click();
    });

    expect(gridFocuser).toHaveBeenCalledTimes(1);
    // The fallback did NOT also run — the grid owns the restore.
    expect(document.activeElement).not.toBe(anchor);
  });

  // Reason: the document grid never virtualizes and publishes no focuser, so
  // the fallback has to keep working on its own.
  it("falls back to the live roving anchor when no focuser is published", () => {
    render(<Harness />);

    act(() => {
      closeButton().click();
    });

    expect(document.activeElement).toBe(
      document.querySelector('[data-grid-row][tabindex="0"]'),
    );
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
