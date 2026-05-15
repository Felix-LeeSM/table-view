// Sprint 325 (2026-05-15) — Slice H: field projection dialog.
//
// 작성 이유: server-side projection 의 (a) include / exclude 모드,
// (b) per-column checkbox, (c) Apply / Clear / Cancel 의 콜백 호출
// 시나리오를 회귀 가드. Mongo find body 의 `projection` shape (`{
// field: 1 }` / `{ field: 0 }`) 으로 정확히 변환되어야 한다.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProjectionDialog from "./ProjectionDialog";

const COLUMNS = [
  { name: "_id" },
  { name: "name" },
  { name: "age" },
  { name: "email" },
];

describe("ProjectionDialog (Sprint 325 H)", () => {
  it("renders all columns with checkboxes when open", () => {
    render(
      <ProjectionDialog
        open
        onOpenChange={vi.fn()}
        columns={COLUMNS}
        initial={null}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "_id" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "name" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "age" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "email" })).toBeInTheDocument();
  });

  it("defaults to include mode when no initial projection is supplied", () => {
    render(
      <ProjectionDialog
        open
        onOpenChange={vi.fn()}
        columns={COLUMNS}
        initial={null}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Include selected fields")).toBeChecked();
    expect(screen.getByLabelText("Exclude selected fields")).not.toBeChecked();
  });

  it("Apply emits include-mode projection { name: 1 } when name is checked", () => {
    const onApply = vi.fn();
    render(
      <ProjectionDialog
        open
        onOpenChange={vi.fn()}
        columns={COLUMNS}
        initial={null}
        onApply={onApply}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "name" }));
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));
    expect(onApply).toHaveBeenCalledWith({ name: 1 });
  });

  it("Apply emits exclude-mode projection { email: 0 } when toggled to exclude", () => {
    const onApply = vi.fn();
    render(
      <ProjectionDialog
        open
        onOpenChange={vi.fn()}
        columns={COLUMNS}
        initial={null}
        onApply={onApply}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Exclude selected fields"));
    fireEvent.click(screen.getByRole("checkbox", { name: "email" }));
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));
    expect(onApply).toHaveBeenCalledWith({ email: 0 });
  });

  it("Clear button invokes onClear and not onApply", () => {
    const onApply = vi.fn();
    const onClear = vi.fn();
    render(
      <ProjectionDialog
        open
        onOpenChange={vi.fn()}
        columns={COLUMNS}
        initial={{ name: 1, age: 1 }}
        onApply={onApply}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/i }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("hydrates initial projection — include mode with name+age pre-checked", () => {
    render(
      <ProjectionDialog
        open
        onOpenChange={vi.fn()}
        columns={COLUMNS}
        initial={{ name: 1, age: 1 }}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Include selected fields")).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "name" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "age" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "email" })).not.toBeChecked();
  });

  it("Apply with no selected fields emits an empty projection (caller decides semantics)", () => {
    const onApply = vi.fn();
    render(
      <ProjectionDialog
        open
        onOpenChange={vi.fn()}
        columns={COLUMNS}
        initial={null}
        onApply={onApply}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));
    expect(onApply).toHaveBeenCalledWith({});
  });
});
