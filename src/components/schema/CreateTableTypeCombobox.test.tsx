// Sprint 227 — `CreateTableTypeCombobox` test suite (Phase 27 sprint 2).
//
// Date: 2026-05-06.
//
// Why this file exists:
// - Locks AC-227-03 (filter behaviour, Enter commits highlighted
//   suggestion, free-text fallback on blur).
// - Decouples combobox-only assertions from the modal-level tests so
//   the modal suite can stay focused on tab/preview/IPC orchestration.
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import CreateTableTypeCombobox from "./CreateTableTypeCombobox";

/**
 * The combobox is fully controlled — wrap it in a tiny React host so
 * `value` reflects every keystroke. `onChangeSpy` is forwarded so
 * tests can assert the commit value directly.
 */
function ControlledHost({
  onChangeSpy,
}: {
  onChangeSpy?: (next: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <CreateTableTypeCombobox
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy?.(next);
      }}
    />
  );
}

describe("CreateTableTypeCombobox (Sprint 227 — AC-227-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("typing 'int' filters to integer/bigint/smallint/interval (case-insensitive substring)", async () => {
    render(<ControlledHost />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "int" } });

    const listbox = await screen.findByRole("listbox", {
      name: /PostgreSQL types/i,
    });
    expect(listbox).toBeInTheDocument();
    const options = listbox.querySelectorAll('[role="option"]');
    const labels = Array.from(options).map((o) => o.textContent ?? "");
    for (const expected of ["integer", "bigint", "smallint", "interval"]) {
      expect(labels).toContain(expected);
    }
    // Sanity: every visible option contains the substring.
    for (const label of labels) {
      expect(label.toLowerCase()).toContain("int");
    }
  });

  it("Enter commits the highlighted suggestion", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "uuid" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
    fireEvent.keyDown(input, { key: "Enter" });
    // The first (and only) filtered match for "uuid" is "uuid"; the
    // last `onChange` value committed is the suggestion verbatim.
    expect(spy).toHaveBeenLastCalledWith("uuid");
  });

  it("ArrowDown moves the highlight to the next suggestion", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "int" } });

    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    // Filtered list for `int` is ordered as it appears in the canonical
    // list: integer, bigint, smallint, interval. Press ArrowDown twice
    // → highlight = 2 → Enter commits "smallint".
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenLastCalledWith("smallint");
  });

  it("Escape closes the popover without committing a suggestion", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "int" } });
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    // The keystroke onChange already fired with "int" before Escape.
    // No additional commit should fire after Escape.
    expect(spy).toHaveBeenLastCalledWith("int");
  });

  it("free-text fallback — 'numeric(10,4)' commits the raw value verbatim (AC-227-03)", () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "numeric(10,4)" } });
    fireEvent.blur(input);

    // The last `onChange` is the raw keystroke — `numeric(10,4)` —
    // and no further `onChange` fires on blur (the parent already
    // owns the verbatim string).
    expect(spy).toHaveBeenLastCalledWith("numeric(10,4)");
  });

  it("clicking a suggestion commits the value (AC-227-03)", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "uu" } });
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    const uuidOption = screen.getByRole("option", { name: "uuid" });
    fireEvent.mouseDown(uuidOption);
    expect(spy).toHaveBeenLastCalledWith("uuid");
  });
});
