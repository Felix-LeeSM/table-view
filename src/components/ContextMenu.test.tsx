import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("calls onClick and onClose when a menu item is clicked", () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

    expect(items[0]!.onClick).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking outside the menu", () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

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
    expect(deleteItem.className).toContain("color-danger");
  });

  it("renders items with icons", () => {
    const itemsWithIcon: ContextMenuItem[] = [
      { label: "Edit", icon: <span data-testid="icon">ICON</span>, onClick: vi.fn() },
    ];

    render(<ContextMenu x={100} y={100} items={itemsWithIcon} onClose={onClose} />);

    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("removes event listeners on unmount", () => {
    const { unmount } = render(
      <ContextMenu x={100} y={100} items={items} onClose={onClose} />,
    );

    unmount();

    // After unmount, clicking outside should NOT call onClose
    onClose.mockClear();
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
