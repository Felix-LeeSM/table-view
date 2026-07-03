import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import DocumentFilterBar, {
  type DocumentFilterBarProps,
} from "./DocumentFilterBar";
import { expectUndoRevertsEdit } from "../query/__tests__/editorHistoryHelpers";

function renderBar(overrides: Partial<DocumentFilterBarProps> = {}) {
  const props: DocumentFilterBarProps = {
    fieldNames: ["age", "name", "active"],
    onApply: vi.fn(),
    onClose: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<DocumentFilterBar {...props} />) };
}

function getRawEditorView(): EditorView {
  const container = screen.getByLabelText("Raw MQL filter");
  const cm = container.querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(cm);
  if (!view) throw new Error("Raw EditorView not found");
  return view;
}

function setRawText(text: string) {
  const view = getRawEditorView();
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  });
}

describe("DocumentFilterBar", () => {
  it("renders Filters label and both mode toggles", () => {
    renderBar();
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Structured" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Raw MQL" })).toBeInTheDocument();
  });

  it("auto-creates one structured row keyed to the first field", () => {
    renderBar();
    expect(
      screen.getByRole("combobox", { name: "Filter field" }),
    ).toBeInTheDocument();
    // Apply button is rendered now that there's at least one row.
    expect(
      screen.getByRole("button", { name: "Apply filter" }),
    ).toBeInTheDocument();
  });

  it("calls onApply with a $gte filter when the structured row is built", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    // Initial row was auto-created on `age`. Change operator + value.
    const operatorTriggers = screen.getAllByRole("combobox", {
      name: "Filter operator",
    });
    fireEvent.click(operatorTriggers[0]!);
    // Radix Select renders options in a portal; pick by role + name.
    const gteOption = screen.getByRole("option", { name: "≥" });
    fireEvent.click(gteOption);

    const valueInput = screen.getByRole("textbox", { name: "Filter value" });
    fireEvent.change(valueInput, { target: { value: "18" } });

    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ age: { $gte: 18 } });
  });

  it("submits the structured filter via Enter key on the value input", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    const valueInput = screen.getByRole("textbox", { name: "Filter value" });
    fireEvent.change(valueInput, { target: { value: "Ada" } });
    fireEvent.keyDown(valueInput, { key: "Enter" });

    // First field is "age" with default operator "$eq"; "Ada" stays a string.
    expect(onApply).toHaveBeenCalledWith({ age: { $eq: "Ada" } });
  });

  // #1247 — Raw MQL editor was assembled without history() + historyKeymap,
  // so Cmd+Z did nothing (inconsistent with the query editors fixed in #1225).
  it("reverts a Raw MQL edit via undo and binds Mod-z (#1247)", () => {
    renderBar();
    fireEvent.click(screen.getByRole("radio", { name: "Raw MQL" }));

    // #1248 — `expectUndoRevertsEdit` now asserts the Mod-z binding itself.
    expectUndoRevertsEdit(getRawEditorView());
  });

  it("renders the Raw MQL CodeMirror editor with role=textbox", () => {
    renderBar();

    fireEvent.click(screen.getByRole("radio", { name: "Raw MQL" }));

    const container = screen.getByLabelText("Raw MQL filter");
    expect(container).toHaveAttribute("role", "textbox");
    expect(container).toHaveAttribute("aria-multiline", "true");
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });

  it("prefills the Raw editor with the structured filter on mode swap", () => {
    renderBar();

    // Configure structured row: age $gte 18.
    fireEvent.click(
      screen.getAllByRole("combobox", { name: "Filter operator" })[0]!,
    );
    fireEvent.click(screen.getByRole("option", { name: "≥" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter value" }), {
      target: { value: "18" },
    });

    // Swap to Raw — editor should now contain the JSON encoding.
    fireEvent.click(screen.getByRole("radio", { name: "Raw MQL" }));

    const view = getRawEditorView();
    expect(view.state.doc.toString()).toBe(
      JSON.stringify({ age: { $gte: 18 } }, null, 2),
    );
  });

  it("invokes onApply with the parsed JSON from the Raw editor", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    fireEvent.click(screen.getByRole("radio", { name: "Raw MQL" }));
    setRawText('{"_id": {"$exists": true}}');

    fireEvent.click(screen.getByRole("button", { name: "Apply MQL filter" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ _id: { $exists: true } });
  });

  it("shows an inline error and does not call onApply for invalid Raw JSON", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    fireEvent.click(screen.getByRole("radio", { name: "Raw MQL" }));
    setRawText("{not valid");

    fireEvent.click(screen.getByRole("button", { name: "Apply MQL filter" }));

    expect(onApply).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Invalid MQL JSON/);
  });

  it("rejects a JSON array in Raw mode with a non-object error", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    fireEvent.click(screen.getByRole("radio", { name: "Raw MQL" }));
    setRawText("[1,2,3]");

    fireEvent.click(screen.getByRole("button", { name: "Apply MQL filter" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(
      /MQL filter must be a JSON object/,
    );
  });

  it("invokes onClear and onClose via the dedicated buttons", () => {
    const onClear = vi.fn();
    const onClose = vi.fn();
    renderBar({ onClear, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    expect(onClear).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close filter bar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("treats an empty Raw editor as the empty filter and forwards {} to onApply", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    fireEvent.click(screen.getByRole("radio", { name: "Raw MQL" }));
    setRawText("   \n   ");

    fireEvent.click(screen.getByRole("button", { name: "Apply MQL filter" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("falls back to a placeholder option when fieldNames is empty", () => {
    renderBar({ fieldNames: [] });

    // No auto-row when there are no fields, so no Apply button.
    expect(screen.queryByRole("button", { name: "Apply filter" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Add Filter/ }),
    ).toBeInTheDocument();
  });

  // Sprint 313 (2026-05-14) — Slice B.1 wires `$in` / `$nin` through the
  // structured row. The dropdown must expose the IN / NOT IN labels and
  // CSV input must round-trip into an array via `buildMqlFilter`.
  it("exposes IN and NOT IN options in the operator dropdown", () => {
    renderBar();

    fireEvent.click(
      screen.getAllByRole("combobox", { name: "Filter operator" })[0]!,
    );
    expect(screen.getByRole("option", { name: "IN" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "NOT IN" })).toBeInTheDocument();
  });

  it("applies $in with a coerced numeric array from CSV input", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    fireEvent.click(
      screen.getAllByRole("combobox", { name: "Filter operator" })[0]!,
    );
    fireEvent.click(screen.getByRole("option", { name: "IN" }));

    const valueInput = screen.getByRole("textbox", { name: "Filter value" });
    expect(valueInput).toHaveAttribute("placeholder", "1, 2, 3");

    fireEvent.change(valueInput, { target: { value: "18, 19, 20" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(onApply).toHaveBeenCalledWith({ age: { $in: [18, 19, 20] } });
  });

  it("applies $nin with mixed-type tokens preserving non-numeric strings", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    fireEvent.click(
      screen.getAllByRole("combobox", { name: "Filter operator" })[0]!,
    );
    fireEvent.click(screen.getByRole("option", { name: "NOT IN" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Filter value" }), {
      target: { value: "1, alpha, 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(onApply).toHaveBeenCalledWith({ age: { $nin: [1, "alpha", 2] } });
  });

  // Sprint 314 (2026-05-15) — Slice B.2 composite ops. Match ALL/ANY
  // toggle + per-row NOT button. ALL = implicit $and (default), ANY =
  // top-level $or. NOT wraps the clause in $not.
  it("exposes Match ALL / ANY toggle defaulting to ALL", () => {
    renderBar();
    const all = screen.getByRole("radio", { name: "ALL" });
    const any = screen.getByRole("radio", { name: "ANY" });
    expect(all).toBeInTheDocument();
    expect(any).toBeInTheDocument();
    expect(all).toHaveAttribute("data-state", "on");
    expect(any).toHaveAttribute("data-state", "off");
  });

  it("emits a $or array when Match ANY is selected with multiple rows", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    // Auto-row 1: age $eq "" (will be ignored or kept as string). Set value.
    const valueInputs1 = screen.getAllByRole("textbox", {
      name: "Filter value",
    });
    fireEvent.change(valueInputs1[0]!, { target: { value: "18" } });
    fireEvent.click(
      screen.getAllByRole("combobox", { name: "Filter operator" })[0]!,
    );
    fireEvent.click(screen.getByRole("option", { name: "≥" }));

    // Add a second row.
    fireEvent.click(screen.getByRole("button", { name: /Add Filter/ }));

    // Configure the second row: name $eq Ada. By default the new row's
    // field is the first field ("age") — change it.
    const fieldTriggers = screen.getAllByRole("combobox", {
      name: "Filter field",
    });
    fireEvent.click(fieldTriggers[1]!);
    fireEvent.click(screen.getByRole("option", { name: "name" }));
    const valueInputs2 = screen.getAllByRole("textbox", {
      name: "Filter value",
    });
    fireEvent.change(valueInputs2[1]!, { target: { value: "Ada" } });

    // Flip Match to ANY.
    fireEvent.click(screen.getByRole("radio", { name: "ANY" }));

    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(onApply).toHaveBeenCalledWith({
      $or: [{ age: { $gte: 18 } }, { name: { $eq: "Ada" } }],
    });
  });

  it("wraps a single row's clause in $not when the NOT button is pressed", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    fireEvent.click(
      screen.getAllByRole("combobox", { name: "Filter operator" })[0]!,
    );
    fireEvent.click(screen.getByRole("option", { name: ">" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter value" }), {
      target: { value: "18" },
    });

    const notButton = screen.getByRole("button", { name: "Negate filter" });
    expect(notButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(notButton);
    expect(notButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(onApply).toHaveBeenCalledWith({ age: { $not: { $gt: 18 } } });
  });

  it("combines NOT and Match ANY across rows", () => {
    const onApply = vi.fn();
    renderBar({ onApply });

    // Row 1: NOT active $eq true (negated).
    fireEvent.click(
      screen.getAllByRole("combobox", { name: "Filter field" })[0]!,
    );
    fireEvent.click(screen.getByRole("option", { name: "active" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter value" }), {
      target: { value: "true" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Negate filter" }));

    // Row 2: age $gte 18.
    fireEvent.click(screen.getByRole("button", { name: /Add Filter/ }));
    const opTriggers = screen.getAllByRole("combobox", {
      name: "Filter operator",
    });
    fireEvent.click(opTriggers[1]!);
    fireEvent.click(screen.getByRole("option", { name: "≥" }));
    const valueInputs = screen.getAllByRole("textbox", {
      name: "Filter value",
    });
    fireEvent.change(valueInputs[1]!, { target: { value: "18" } });

    // Match ANY.
    fireEvent.click(screen.getByRole("radio", { name: "ANY" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(onApply).toHaveBeenCalledWith({
      $or: [{ active: { $not: { $eq: "true" } } }, { age: { $gte: 18 } }],
    });
  }, 30_000);
});
