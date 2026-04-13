import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

function createItems(): ContextMenuItem[] {
  return [
    { label: "Edit", onClick: vi.fn() },
    { label: "Delete", danger: true, onClick: vi.fn() },
  ];
}

describe("ContextMenu", () => {
  const onClose = vi.fn();
  let items: ContextMenuItem[];

  beforeEach(() => {
    onClose.mockReset();
    items = createItems();
  });

  it("renders menu items", () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("calls onClick and onClose when a menu item is clicked", () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    });

    expect(items[0]!.onClick).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking outside the menu", () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    act(() => {
      fireEvent.mouseDown(document.body);
    });

    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(onClose).toHaveBeenCalled();
  });

  it("positions the menu with fixed positioning", () => {
    render(<ContextMenu x={200} y={300} items={items} onClose={onClose} />);

    const menu = screen.getByRole("menu");
    expect(menu).toHaveStyle({ position: "fixed" });
  });

  it("renders danger items with danger styling", () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    const deleteItem = screen.getByRole("menuitem", { name: "Delete" });
    expect(deleteItem.className).toContain("destructive");
  });

  it("renders items with icons", () => {
    const itemsWithIcon: ContextMenuItem[] = [
      {
        label: "Edit",
        icon: <span data-testid="icon">ICON</span>,
        onClick: vi.fn(),
      },
    ];

    render(
      <ContextMenu x={100} y={100} items={itemsWithIcon} onClose={onClose} />,
    );

    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("removes event listeners on unmount", () => {
    const { unmount } = render(
      <ContextMenu x={100} y={100} items={items} onClose={onClose} />,
    );

    unmount();

    // After unmount, clicking outside should NOT call onClose
    onClose.mockClear();
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has select-none class on outer div to prevent text selection", () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("select-none");
  });

  // -----------------------------------------------------------------------
  // Sprint 48: Keyboard navigation and disabled support
  // -----------------------------------------------------------------------
  it("focuses the first item when opened", async () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    const editItem = screen.getByRole("menuitem", { name: "Edit" });
    // The first item should receive focus after the menu positions itself
    await vi.waitFor(() => {
      expect(editItem).toHaveFocus();
    });
  });

  it("ArrowDown moves focus to next item", async () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    // Wait for initial focus
    await vi.waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: "ArrowDown" });

    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  it("ArrowUp moves focus to previous item", async () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    await vi.waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowUp" });

    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });

  it("renders disabled items with aria-disabled", () => {
    const itemsWithDisabled: ContextMenuItem[] = [
      { label: "Connect", disabled: true, onClick: vi.fn() },
      { label: "Delete", danger: true, onClick: vi.fn() },
    ];

    render(
      <ContextMenu
        x={100}
        y={100}
        items={itemsWithDisabled}
        onClose={onClose}
      />,
    );

    const connectItem = screen.getByRole("menuitem", { name: "Connect" });
    expect(connectItem).toHaveAttribute("aria-disabled", "true");
    expect(connectItem.className).toContain("opacity-40");
  });

  it("does not call onClick for disabled items", () => {
    const onClick = vi.fn();
    const itemsWithDisabled: ContextMenuItem[] = [
      { label: "Connect", disabled: true, onClick },
    ];

    render(
      <ContextMenu
        x={100}
        y={100}
        items={itemsWithDisabled}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Connect" }));

    expect(onClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("skips disabled items during keyboard navigation", async () => {
    const itemsWithDisabled: ContextMenuItem[] = [
      { label: "Connect", disabled: true, onClick: vi.fn() },
      { label: "Edit", onClick: vi.fn() },
      { label: "Delete", danger: true, onClick: vi.fn() },
    ];

    render(
      <ContextMenu
        x={100}
        y={100}
        items={itemsWithDisabled}
        onClose={onClose}
      />,
    );

    // Should skip disabled "Connect" and focus "Edit" first
    await vi.waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: "ArrowDown" });

    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();

    // ArrowDown from last item should wrap around, skipping disabled
    fireEvent.keyDown(document, { key: "ArrowDown" });

    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });
});
