// Issue — RDB Escape now routes discard through the SAME confirm gate as the
// toolbar Discard button (PR #1013). Escape used to call `onDiscard`
// immediately (unrecoverable), so this pins: with pending edits Escape opens
// the gate (`onRequestDiscard`) instead of discarding; with nothing pending it
// is a no-op; a cell edit or an already-open dialog swallow it (no stacking).
// Mocks: none — the hook attaches a real `window` keydown listener, so we
// dispatch real KeyboardEvents. (2026-07-01)

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRdbDataGridShortcuts } from "./useRdbDataGridShortcuts";

type Overrides = Partial<Parameters<typeof useRdbDataGridShortcuts>[0]>;

function setup(overrides: Overrides = {}) {
  const onRequestDiscard = vi.fn();
  const onToggleQuickLook = vi.fn();
  const onToggleFilters = vi.fn();
  const params = {
    editingCell: null,
    canUndo: false,
    canRedo: false,
    hasPendingChanges: true,
    onToggleFilters,
    onToggleQuickLook,
    onCancelEdit: vi.fn(),
    onRequestDiscard,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  };
  const view = renderHook((p: typeof params) => useRdbDataGridShortcuts(p), {
    initialProps: params,
  });
  return { onRequestDiscard, onToggleQuickLook, onToggleFilters, ...view };
}

function pressKey(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
}

function pressEscape() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useRdbDataGridShortcuts — Escape discard gate", () => {
  it("with pending edits opens the confirm gate and does NOT discard immediately", () => {
    const { onRequestDiscard } = setup({ hasPendingChanges: true });
    pressEscape();
    // Gate opened once; no immediate/unrecoverable discard happened here.
    expect(onRequestDiscard).toHaveBeenCalledTimes(1);
  });

  it("with NO pending edits is a no-op — no confirm popup", () => {
    const { onRequestDiscard } = setup({ hasPendingChanges: false });
    pressEscape();
    expect(onRequestDiscard).not.toHaveBeenCalled();
  });

  it("while editing a cell does not open the gate (editor owns Escape)", () => {
    const { onRequestDiscard } = setup({
      hasPendingChanges: true,
      editingCell: { row: 0, col: 0 },
    });
    pressEscape();
    expect(onRequestDiscard).not.toHaveBeenCalled();
  });

  it("does not re-open/stack the gate when a dialog is already open", () => {
    const { onRequestDiscard } = setup({ hasPendingChanges: true });
    // Simulate the discard-confirm (an alertdialog) already being mounted.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    document.body.appendChild(dialog);
    pressEscape();
    expect(onRequestDiscard).not.toHaveBeenCalled();
  });
});

/**
 * Issue #1734 owner decision 2 — the Quick Look toggle moved out of the
 * toolbar's icon crowd into a labelled button, and `Cmd/Ctrl+L` stays its
 * keyboard path. This pins the binding so the button restyle can't quietly
 * take the shortcut with it, and pins the neighbouring Cmd+F so the two
 * grid-level bindings don't cross-fire.
 */
describe("useRdbDataGridShortcuts — Quick Look shortcut (#1734)", () => {
  it("Cmd+L toggles Quick Look and consumes the event", () => {
    const { onToggleQuickLook } = setup();
    const event = pressKey("l", { metaKey: true });
    expect(onToggleQuickLook).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Ctrl+L toggles Quick Look on non-mac keyboards", () => {
    const { onToggleQuickLook } = setup();
    pressKey("l", { ctrlKey: true });
    expect(onToggleQuickLook).toHaveBeenCalledTimes(1);
  });

  it("a bare L types normally — no modifier, no toggle", () => {
    const { onToggleQuickLook } = setup();
    pressKey("l");
    expect(onToggleQuickLook).not.toHaveBeenCalled();
  });

  it("Cmd+F still toggles filters only — the two bindings don't cross-fire", () => {
    const { onToggleFilters, onToggleQuickLook } = setup();
    pressKey("f", { metaKey: true });
    expect(onToggleFilters).toHaveBeenCalledTimes(1);
    expect(onToggleQuickLook).not.toHaveBeenCalled();
  });
});
