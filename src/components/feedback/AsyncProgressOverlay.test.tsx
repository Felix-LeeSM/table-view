/**
 * Reason: Sprint-180 (AC-180-01, AC-180-02, AC-180-06) — shared overlay
 * regression suite. Exercises the threshold-controlled visibility, the
 * Cancel callback contract, the accessible-name + data-testid uniformity
 * pin, and the Sprint 176 pointer-event hardening preserved inside the
 * shared component.
 *
 * Date: 2026-04-30
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";
import AsyncProgressOverlay from "./AsyncProgressOverlay";

describe("AsyncProgressOverlay", () => {
  // [AC-180-01a] When the host has not yet flipped `visible` to true
  // (e.g. sub-second op), the overlay must not render. The threshold
  // gate is the host's responsibility, but the component must respect
  // its prop without painting any DOM.
  // Date: 2026-04-30
  it("[AC-180-01a] does not render when visible=false", () => {
    render(<AsyncProgressOverlay visible={false} onCancel={vi.fn()} />);
    expect(screen.queryByTestId("async-cancel")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // [AC-180-01b] After the host flips `visible` to true, the overlay
  // renders with the spinner + Cancel button visible to the user.
  // Date: 2026-04-30
  it("[AC-180-01b] renders overlay and Cancel button when visible=true", () => {
    render(<AsyncProgressOverlay visible={true} onCancel={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.getByTestId("async-cancel")).toBeInTheDocument();
  });

  // [AC-180-02a] Clicking Cancel invokes the onCancel callback exactly
  // once. The host then clears its `loading` flag, which flips visible
  // back to false on the next render.
  // Date: 2026-04-30
  it("[AC-180-02a] Cancel button click invokes onCancel", () => {
    const onCancel = vi.fn();
    render(<AsyncProgressOverlay visible={true} onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId("async-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // [AC-180-06a] The Cancel button has the literal accessible name
  // `"Cancel"` so screen readers announce it identically across all
  // four host surfaces. Native `<button>` semantics provide
  // tabIndex >= 0 by default.
  // Date: 2026-04-30
  it("[AC-180-06a] Cancel button has stable accessible name 'Cancel'", () => {
    render(<AsyncProgressOverlay visible={true} onCancel={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Cancel" });
    expect(btn).toBeInTheDocument();
    // Negative-asserts the prefix so a future "Cancel queued op" copy
    // change would catch this test.
    expect(btn.textContent?.trim()).toBe("Cancel");
  });

  // [AC-180-06b] data-testid is the literal string `"async-cancel"` so
  // the four surface tests can `screen.getByTestId("async-cancel")` and
  // assert uniformity. Hyphenated lowercase per spec.
  // Date: 2026-04-30
  it("[AC-180-06b] data-testid is 'async-cancel' literally", () => {
    render(<AsyncProgressOverlay visible={true} onCancel={vi.fn()} />);
    const btn = screen.getByTestId("async-cancel");
    expect(btn.getAttribute("data-testid")).toBe("async-cancel");
  });

  // Sprint 176 regression — overlay's mouseDown handler must call
  // `e.preventDefault()`. Without this, drag-select on the rows
  // underneath would still start.
  // Date: 2026-04-30
  it("[AC-180-06c] overlay calls preventDefault on mouseDown (Sprint 176 invariant)", () => {
    render(<AsyncProgressOverlay visible={true} onCancel={vi.fn()} />);
    const overlay = screen.getByRole("status", { name: "Loading" });
    const event = createEvent.mouseDown(overlay);
    fireEvent(overlay, event);
    expect(event.defaultPrevented).toBe(true);
  });

  // Sprint 176 regression — overlay's click handler must call
  // `e.preventDefault()`. Same shape as mouseDown.
  // Date: 2026-04-30
  it("[AC-180-06c] overlay calls preventDefault on click (Sprint 176 invariant)", () => {
    render(<AsyncProgressOverlay visible={true} onCancel={vi.fn()} />);
    const overlay = screen.getByRole("status", { name: "Loading" });
    const event = createEvent.click(overlay);
    fireEvent(overlay, event);
    expect(event.defaultPrevented).toBe(true);
  });

  // Sprint 176 regression — overlay's doubleClick handler must call
  // `e.preventDefault()`. Without this, a double-click directly above a
  // cell would open the inline editor.
  // Date: 2026-04-30
  it("[AC-180-06c] overlay calls preventDefault on doubleClick (Sprint 176 invariant)", () => {
    render(<AsyncProgressOverlay visible={true} onCancel={vi.fn()} />);
    const overlay = screen.getByRole("status", { name: "Loading" });
    const event = createEvent.dblClick(overlay);
    fireEvent(overlay, event);
    expect(event.defaultPrevented).toBe(true);
  });

  // Sprint 176 regression — overlay's contextMenu handler must call
  // `e.preventDefault()`. Without this, right-click would open the
  // ContextMenu mid-refetch.
  // Date: 2026-04-30
  it("[AC-180-06c] overlay calls preventDefault on contextMenu (Sprint 176 invariant)", () => {
    render(<AsyncProgressOverlay visible={true} onCancel={vi.fn()} />);
    const overlay = screen.getByRole("status", { name: "Loading" });
    const event = createEvent.contextMenu(overlay);
    fireEvent(overlay, event);
    expect(event.defaultPrevented).toBe(true);
  });

  // Cancel button click must NOT bubble up to the overlay's onClick
  // handler — but the cancel callback still fires because React calls
  // children handlers before parents. Without the explicit
  // stopPropagation on the button, the parent's preventDefault would
  // still apply, but the test below pins the behaviour so a future
  // refactor can't accidentally swallow the cancel action.
  // Date: 2026-04-30
  it("Cancel button click reaches onCancel even with overlay swallowing pointer events", () => {
    const onCancel = vi.fn();
    render(<AsyncProgressOverlay visible={true} onCancel={onCancel} />);
    const btn = screen.getByTestId("async-cancel");

    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // Custom label override — ensures consumers (e.g. a future Search
  // result panel) can override the aria-label without changing the
  // Cancel button copy.
  // Date: 2026-04-30
  it("supports a custom label prop for the aria-label", () => {
    render(
      <AsyncProgressOverlay
        visible={true}
        onCancel={vi.fn()}
        label="Loading rows"
      />,
    );
    expect(
      screen.getByRole("status", { name: "Loading rows" }),
    ).toBeInTheDocument();
    // Cancel button copy is paradigm-neutral and fixed.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
