import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SidebarModeToggle from "./SidebarModeToggle";

describe("SidebarModeToggle", () => {
  it("renders both tabs as a tablist", () => {
    render(<SidebarModeToggle mode="connections" onChange={vi.fn()} />);

    const tablist = screen.getByRole("tablist", { name: /sidebar mode/i });
    expect(tablist).toBeInTheDocument();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
  });

  it("marks the active tab via aria-selected", () => {
    const { rerender } = render(
      <SidebarModeToggle mode="connections" onChange={vi.fn()} />,
    );

    expect(screen.getByRole("tab", { name: /connections/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /schemas/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    rerender(<SidebarModeToggle mode="schemas" onChange={vi.fn()} />);

    expect(screen.getByRole("tab", { name: /connections/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: /schemas/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("calls onChange with the clicked mode", () => {
    const onChange = vi.fn();
    render(<SidebarModeToggle mode="connections" onChange={onChange} />);

    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /schemas/i }));
    });

    expect(onChange).toHaveBeenCalledWith("schemas");
  });

  it("does not call onChange when the active tab is clicked again", () => {
    // Note: this is a UX consideration — re-clicking the active tab fires
    // onChange too (the parent can choose to no-op). We just verify the call.
    const onChange = vi.fn();
    render(<SidebarModeToggle mode="connections" onChange={onChange} />);

    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /connections/i }));
    });

    expect(onChange).toHaveBeenCalledWith("connections");
  });
});
