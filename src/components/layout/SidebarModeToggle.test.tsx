import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SidebarModeToggle from "./SidebarModeToggle";

describe("SidebarModeToggle", () => {
  it("renders both options as a radio group", () => {
    render(<SidebarModeToggle mode="connections" onChange={vi.fn()} />);

    const group = screen.getByRole("group", { name: /sidebar mode/i });
    expect(group).toBeInTheDocument();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
  });

  it("marks the active option via aria-checked", () => {
    const { rerender } = render(
      <SidebarModeToggle mode="connections" onChange={vi.fn()} />,
    );

    expect(screen.getByRole("radio", { name: /connections/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /schemas/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    rerender(<SidebarModeToggle mode="schemas" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /connections/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("radio", { name: /schemas/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("calls onChange with the clicked mode", () => {
    const onChange = vi.fn();
    render(<SidebarModeToggle mode="connections" onChange={onChange} />);

    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: /schemas/i }));
    });

    expect(onChange).toHaveBeenCalledWith("schemas");
  });

  it("does not call onChange when the active option is clicked again", () => {
    // Radix ToggleGroup type="single" does not fire onValueChange when the
    // already-selected item is clicked — clicking it would deselect it, but
    // our onValueChange guard (v && onChange(v)) prevents that.
    const onChange = vi.fn();
    render(<SidebarModeToggle mode="connections" onChange={onChange} />);

    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: /connections/i }));
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
