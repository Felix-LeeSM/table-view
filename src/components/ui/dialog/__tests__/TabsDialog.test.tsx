import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import TabsDialog from "@components/ui/dialog/TabsDialog";

describe("TabsDialog (sprint-96 preset)", () => {
  const tabs = [
    { value: "hex", label: "Hex", content: <div>hex-body</div> },
    { value: "text", label: "Text", content: <div>text-body</div> },
  ];

  it("renders the title and tab triggers", () => {
    render(<TabsDialog title="Blob Viewer" tabs={tabs} onClose={vi.fn()} />);

    expect(screen.getByText("Blob Viewer")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Hex" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Text" })).toBeInTheDocument();
  });

  it("activates the first tab by default and shows its content", () => {
    render(<TabsDialog title="t" tabs={tabs} onClose={vi.fn()} />);

    expect(screen.getByText("hex-body")).toBeInTheDocument();
    expect(screen.queryByText("text-body")).toBeNull();
  });

  it("respects defaultTab to start on a different pane", () => {
    render(
      <TabsDialog title="t" tabs={tabs} defaultTab="text" onClose={vi.fn()} />,
    );

    expect(screen.getByText("text-body")).toBeInTheDocument();
    expect(screen.queryByText("hex-body")).toBeNull();
  });

  it("switches tabs on click + invokes onClose when dialog dismissed", () => {
    const onClose = vi.fn();
    render(<TabsDialog title="t" tabs={tabs} onClose={onClose} />);

    act(() => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Text" }));
    });
    expect(screen.getByText("text-body")).toBeInTheDocument();

    // Esc closes the dialog → onClose called.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("supports controlled value + onTabChange", () => {
    const onTabChange = vi.fn();
    render(
      <TabsDialog
        title="t"
        tabs={tabs}
        value="text"
        onTabChange={onTabChange}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("text-body")).toBeInTheDocument();

    act(() => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Hex" }));
    });
    expect(onTabChange).toHaveBeenCalledWith("hex");
  });
});
