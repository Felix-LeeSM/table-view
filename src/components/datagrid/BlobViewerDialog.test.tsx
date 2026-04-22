import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BlobViewerDialog from "./BlobViewerDialog";

describe("BlobViewerDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: () => {},
    data: "Hello World" as unknown,
    columnName: "blob_col",
  };

  it("renders the dialog when open", () => {
    render(<BlobViewerDialog {...defaultProps} />);
    expect(screen.getByText(/BLOB Viewer/)).toBeInTheDocument();
    expect(screen.getByText("blob_col")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<BlobViewerDialog {...defaultProps} open={false} />);
    expect(screen.queryByText(/BLOB Viewer/)).not.toBeInTheDocument();
  });

  it("shows hex view by default", () => {
    render(<BlobViewerDialog {...defaultProps} />);
    // Hex view should show offset-style formatting
    expect(screen.getByText("Hex")).toBeInTheDocument();
    // Check for hex dump format (offset column)
    expect(screen.getByText(/00000000/)).toBeInTheDocument();
  });

  it("switches to text view on tab click", () => {
    render(<BlobViewerDialog {...defaultProps} />);
    fireEvent.mouseDown(screen.getByText("Text"));
    // Should show decoded text
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("handles null data gracefully", () => {
    render(<BlobViewerDialog {...defaultProps} data={null} />);
    expect(screen.getByText("(empty)")).toBeInTheDocument();
  });

  it("handles object data by JSON-stringifying", () => {
    render(<BlobViewerDialog {...defaultProps} data={{ key: "value" }} />);
    // Click Text tab to see the JSON string
    fireEvent.mouseDown(screen.getByText("Text"));
    expect(screen.getByText(/"key"/)).toBeInTheDocument();
    expect(screen.getByText(/"value"/)).toBeInTheDocument();
  });

  it("handles numeric data", () => {
    render(<BlobViewerDialog {...defaultProps} data={42} />);
    fireEvent.mouseDown(screen.getByText("Text"));
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows byte count in footer", () => {
    render(<BlobViewerDialog {...defaultProps} data="Hello" />);
    // "Hello" is 5 bytes
    expect(screen.getByText(/5 bytes/)).toBeInTheDocument();
  });

  it("shows singular 'byte' for single byte", () => {
    render(<BlobViewerDialog {...defaultProps} data="A" />);
    expect(screen.getByText(/1 byte/)).toBeInTheDocument();
  });

  it("calls onOpenChange with false when dialog is closed", () => {
    const onOpenChange = vi.fn();
    render(<BlobViewerDialog {...defaultProps} onOpenChange={onOpenChange} />);
    // Find the close button — it contains an SVG (X icon) with sr-only "Close" text
    const closeButtons = screen.getAllByRole("button");
    // The dialog close button is the one with the X icon
    const closeBtn = closeButtons.find(
      (btn) => btn.querySelector("svg") && btn.textContent?.includes("Close"),
    );
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders hex dump format correctly for binary-like data", () => {
    // String that has mixed printable and non-printable bytes
    render(<BlobViewerDialog {...defaultProps} data="Hello World" />);
    // Hex dump should contain the hex representation
    const preElement = document.querySelector("pre");
    expect(preElement).toBeInTheDocument();
    const text = preElement!.textContent ?? "";
    // Should contain the hex for 'H' = 48
    expect(text).toContain("48");
    // Should contain the ASCII representation
    expect(text).toContain("Hello World");
  });
});
