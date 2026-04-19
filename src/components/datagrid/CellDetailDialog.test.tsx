import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import CellDetailDialog from "./CellDetailDialog";

function renderDialog(
  data: unknown,
  columnName = "name",
  dataType: string | undefined = "text",
) {
  return render(
    <CellDetailDialog
      open
      onOpenChange={vi.fn()}
      data={data}
      columnName={columnName}
      dataType={dataType}
    />,
  );
}

describe("CellDetailDialog", () => {
  it("renders the column name and data type in the header", () => {
    renderDialog("hello", "title", "varchar");
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("(varchar)")).toBeInTheDocument();
  });

  it("renders a long string in full inside a pre block", () => {
    const long = "a".repeat(2000);
    renderDialog(long);
    // The rendered text should appear verbatim
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it("pretty-prints object cells as JSON", () => {
    renderDialog({ id: 1, nested: { x: true } });
    expect(
      screen.getByText(/"nested":\s*\{[\s\S]*"x":\s*true/),
    ).toBeInTheDocument();
  });

  it("renders NULL for null data", () => {
    renderDialog(null);
    expect(screen.getByText("NULL")).toBeInTheDocument();
  });

  it("renders (empty string) for empty string data", () => {
    renderDialog("");
    expect(screen.getByText("(empty string)")).toBeInTheDocument();
  });

  it("shows char + line count in the footer", () => {
    renderDialog("ab\ncd");
    expect(
      screen.getByText((text) => text.includes("5 chars")),
    ).toBeInTheDocument();
    expect(
      screen.getByText((text) => text.includes("2 lines")),
    ).toBeInTheDocument();
  });

  it("copies the value to the clipboard when Copy is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderDialog("payload");

    const copyBtn = screen.getByLabelText("Copy cell value");
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeText).toHaveBeenCalledWith("payload");
  });
});
