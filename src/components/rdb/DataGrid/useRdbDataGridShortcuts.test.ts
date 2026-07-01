// Issue — RDB Escape now routes discard through the SAME confirm gate as the
// toolbar Discard button (PR #1013). Escape used to call `onDiscard`
// immediately (unrecoverable), so this pins: with pending edits Escape opens
// the gate (`onRequestDiscard`) instead of discarding; with nothing pending it
// is a no-op; a cell edit or an already-open dialog swallow it (no stacking).
// Mocks: none — the hook attaches a real `window` keydown listener, so we
// dispatch real KeyboardEvents. (2026-07-01)

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRdbDataGridShortcuts } from "./useRdbDataGridShortcuts";

type Overrides = Partial<Parameters<typeof useRdbDataGridShortcuts>[0]>;

function setup(overrides: Overrides = {}) {
  const onRequestDiscard = vi.fn();
  const params = {
    editingCell: null,
    canUndo: false,
    hasPendingChanges: true,
    onToggleFilters: vi.fn(),
    onToggleQuickLook: vi.fn(),
    onCancelEdit: vi.fn(),
    onRequestDiscard,
    onUndo: vi.fn(),
    ...overrides,
  };
  const view = renderHook((p: typeof params) => useRdbDataGridShortcuts(p), {
    initialProps: params,
  });
  return { onRequestDiscard, ...view };
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
