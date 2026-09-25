// Nested expand popover component.
//
// Reason: regression guard for the sentinel cell's 1-depth inspect popover
// — (a) it mounts on trigger click, (b) each object / array entry renders
// as label + value + type subtitle, (c) the trigger click's row-selection
// propagation is stopped.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NestedExpandPopover from "./NestedExpandPopover";

describe("NestedExpandPopover (Sprint 321 F.1)", () => {
  it("mounts a 'Expand nested' trigger when value is a composite", () => {
    render(<NestedExpandPopover value={{ a: 1, b: "two" }} fieldName="meta" />);
    expect(
      screen.getByRole("button", { name: "Expand nested meta" }),
    ).toBeInTheDocument();
  });

  it("renders nothing for scalar values (no trigger)", () => {
    const { container } = render(
      <NestedExpandPopover value={42} fieldName="age" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the popover with object entries on trigger click", () => {
    render(
      <NestedExpandPopover
        value={{ a: 1, b: "two", c: { deep: 1 } }}
        fieldName="meta"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    const region = screen.getByRole("region", {
      name: "Nested fields for meta",
    });
    expect(region).toHaveTextContent("a");
    expect(region).toHaveTextContent("1");
    expect(region).toHaveTextContent("b");
    expect(region).toHaveTextContent("two");
    // nested-of-nested → sentinel
    expect(region).toHaveTextContent("c");
    expect(region).toHaveTextContent("{...}");
  });

  it("renders array entries with index labels", () => {
    render(<NestedExpandPopover value={["x", "y", "z"]} fieldName="tags" />);
    fireEvent.click(screen.getByRole("button", { name: "Expand nested tags" }));
    const region = screen.getByRole("region", {
      name: "Nested fields for tags",
    });
    expect(region).toHaveTextContent("[0]");
    expect(region).toHaveTextContent("[1]");
    expect(region).toHaveTextContent("[2]");
    expect(region).toHaveTextContent("x");
    expect(region).toHaveTextContent("y");
    expect(region).toHaveTextContent("z");
  });

  it("stops the click event from propagating to the row container", () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <NestedExpandPopover value={{ a: 1 }} fieldName="meta" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  // Edit flow.
  it("shows a Pencil button on scalar entries only when onCommitEdit is provided", () => {
    const onCommitEdit = vi.fn();
    render(
      <NestedExpandPopover
        value={{ a: 1, b: { deep: 1 } }}
        fieldName="meta"
        onCommitEdit={onCommitEdit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    // scalar a → Pencil; nested b → no Pencil
    expect(
      screen.getByRole("button", { name: "Edit meta.a" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit meta.b" })).toBeNull();
  });

  it("clicking the Pencil opens an inline input pre-filled with the current value", () => {
    render(
      <NestedExpandPopover
        value={{ verified: true }}
        fieldName="meta"
        onCommitEdit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit meta.verified" }));
    const input = screen.getByLabelText("Editing meta.verified");
    expect(input).toHaveValue("true");
  });

  it("Enter commits the edit with the dot-notation path", () => {
    const onCommitEdit = vi.fn();
    render(
      <NestedExpandPopover
        value={{ role: "user" }}
        fieldName="meta"
        onCommitEdit={onCommitEdit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit meta.role" }));
    const input = screen.getByLabelText("Editing meta.role");
    fireEvent.change(input, { target: { value: "admin" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommitEdit).toHaveBeenCalledWith("role", "admin");
  });

  it("Escape cancels the edit and does not invoke onCommitEdit", () => {
    const onCommitEdit = vi.fn();
    render(
      <NestedExpandPopover
        value={{ a: 1 }}
        fieldName="meta"
        onCommitEdit={onCommitEdit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit meta.a" }));
    const input = screen.getByLabelText("Editing meta.a");
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommitEdit).not.toHaveBeenCalled();
  });

  it("renders pendingByPath value with the highlight chip in place of the original", () => {
    render(
      <NestedExpandPopover
        value={{ role: "user" }}
        fieldName="meta"
        onCommitEdit={vi.fn()}
        pendingByPath={new Map([["role", "admin"]])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    const pending = screen.getByTestId("nested-pending");
    expect(pending).toHaveTextContent("admin");
  });

  // A Pencil click on a BSON wrapper entry mounts the BsonTypeEditor
  // (type-aware input).
  it("Pencil on a $oid entry mounts the BsonTypeEditor (24-hex hint)", () => {
    render(
      <NestedExpandPopover
        value={{ ownerId: { $oid: "65abcdef0123456789abcdef" } }}
        fieldName="meta"
        onCommitEdit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit meta.ownerId" }));
    expect(screen.getByLabelText("Editing meta.ownerId")).toHaveValue(
      "65abcdef0123456789abcdef",
    );
    expect(screen.getByTestId("bson-editor-hint")).toHaveTextContent(/24-hex/i);
  });

  it("BsonTypeEditor commit emits the canonical EJSON wrapper as the new value", () => {
    const onCommitEdit = vi.fn();
    render(
      <NestedExpandPopover
        value={{ ownerId: { $oid: "65abcdef0123456789abcdef" } }}
        fieldName="meta"
        onCommitEdit={onCommitEdit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit meta.ownerId" }));
    const input = screen.getByLabelText("Editing meta.ownerId");
    fireEvent.change(input, {
      target: { value: "1111111111111111aaaaaaaa" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommitEdit).toHaveBeenCalledWith("ownerId", {
      $oid: "1111111111111111aaaaaaaa",
    });
  });

  it("BsonTypeEditor invalid input blocks commit and surfaces the hint", () => {
    const onCommitEdit = vi.fn();
    render(
      <NestedExpandPopover
        value={{ ownerId: { $oid: "65abcdef0123456789abcdef" } }}
        fieldName="meta"
        onCommitEdit={onCommitEdit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit meta.ownerId" }));
    const input = screen.getByLabelText("Editing meta.ownerId");
    fireEvent.change(input, { target: { value: "too-short" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommitEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/24-hex/i);
  });
});
