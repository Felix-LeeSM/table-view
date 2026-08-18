// #2432 — the copy half of the selection policy.
//
// Turning text selection off app-wide takes away the way a user got a value
// out of a panel: drag across it, Cmd+C. The trade the owner accepted is that
// values worth copying copy themselves on a click instead, so these assertions
// are what makes the trade safe to ship — if the click path or the keyboard
// path breaks, the value is unreachable, not merely inconvenient.
//
// Measured here rather than on `CopyableText` in isolation: the component
// existing proves nothing about the QuickLook value actually being wired to
// it, and the wiring is the half that silently regresses.
//
// The keyboard case is not a duplicate of the click case. A `<div onClick>`
// passes the click assertion and leaves keyboard users with no way to reach
// the value at all; only activating through the focused element separates the
// two. `user-event` dispatches Enter on a focused `<button>` the way a browser
// does, which is exactly the native behaviour being relied on.

import { useToastStore } from "@stores/toastStore";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "@/types/schema";
import { FieldRow } from "./FieldRow";

const COLUMN: ColumnInfo = {
  name: "email",
  data_type: "text",
  nullable: false,
  default_value: null,
  is_primary_key: false,
  is_foreign_key: false,
  fk_reference: null,
  comment: null,
  category: "text",
};

function installClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

function renderValue(value: unknown) {
  render(
    <FieldRow
      column={COLUMN}
      value={value}
      rowIdx={0}
      colIdx={0}
      onBlobView={vi.fn()}
    />,
  );
}

/** Messages of the toasts queued so far, newest last. */
function toastMessages(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("QuickLook scalar value — click to copy (#2432)", () => {
  it("[select-policy] clicking a value writes it to the clipboard and confirms", async () => {
    // `userEvent.setup()` installs a clipboard stub of its own, so the real
    // stub goes in after it or the assertions watch the wrong carrier.
    const user = userEvent.setup();
    const writeText = installClipboard();
    renderValue("ada@example.com");

    await user.click(screen.getByText("ada@example.com"));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("ada@example.com");
    expect(toastMessages()).toContain("Copied to clipboard.");
  });

  it("[select-policy] the same value copies from the keyboard", async () => {
    // `userEvent.setup()` installs a clipboard stub of its own, so the real
    // stub goes in after it or the assertions watch the wrong carrier.
    const user = userEvent.setup();
    const writeText = installClipboard();
    renderValue("ada@example.com");

    // Tab, not `.focus()` — reaching the value by keyboard at all is half of
    // what this asserts. A non-focusable element fails here.
    await user.tab();
    expect(screen.getByText("ada@example.com")).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("ada@example.com");
    expect(toastMessages()).toContain("Copied to clipboard.");
  });

  it("[select-policy] a failing clipboard says so instead of going quiet", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
    });
    renderValue("ada@example.com");

    await user.click(screen.getByText("ada@example.com"));

    expect(toastMessages()).toContain("Copy failed: denied");
  });

  it("[select-policy] an empty value is not a focusable control", async () => {
    const user = userEvent.setup();
    installClipboard();
    renderValue("");

    // Nothing to copy, so nothing to tab to: focus stays on <body>.
    await user.tab();
    expect(document.body).toHaveFocus();
  });
});
