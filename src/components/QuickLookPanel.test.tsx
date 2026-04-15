import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuickLookPanel from "./QuickLookPanel";
import type { TableData } from "../types/schema";

// Mock BlobViewerDialog so we don't need to mock its internals
vi.mock("./datagrid/BlobViewerDialog", () => ({
  default: ({
    open,
    columnName,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    data: unknown;
    columnName: string;
  }) =>
    open ? (
      <div data-testid="blob-viewer-dialog">BLOB Viewer — {columnName}</div>
    ) : null,
  __esModule: true,
}));

const MOCK_COLUMNS = [
  {
    name: "id",
    data_type: "integer",
    nullable: false,
    default_value: null,
    is_primary_key: true,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  },
  {
    name: "name",
    data_type: "text",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  },
  {
    name: "active",
    data_type: "boolean",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  },
  {
    name: "meta",
    data_type: "jsonb",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  },
  {
    name: "data",
    data_type: "bytea",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  },
  {
    name: "bio",
    data_type: "text",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  },
];

const MOCK_DATA: TableData = {
  columns: MOCK_COLUMNS,
  rows: [
    [1, "Alice", true, { key: "value" }, "binary-data", null],
    [2, null, false, null, null, "a".repeat(300)],
    [3, "Charlie", true, [1, 2, 3], { nested: true }, "short bio"],
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

const defaultProps = {
  data: MOCK_DATA,
  selectedRowIds: new Set([0]),
  schema: "public",
  table: "users",
  onClose: vi.fn(),
};

describe("QuickLookPanel", () => {
  it("renders field names and values for the selected row", () => {
    render(<QuickLookPanel {...defaultProps} />);

    // Header
    expect(screen.getByText(/Row Details/)).toBeInTheDocument();
    expect(screen.getByText(/public\.users/)).toBeInTheDocument();

    // Column names should appear
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("meta")).toBeInTheDocument();
    expect(screen.getByText("data")).toBeInTheDocument();
    expect(screen.getByText("bio")).toBeInTheDocument();

    // Values for row 0: id=1, name=Alice
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows NULL for null values", () => {
    // Row 0: bio is null
    render(<QuickLookPanel {...defaultProps} />);

    const nullElements = screen.getAllByText("NULL");
    // Row 0 has bio=null
    expect(nullElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows boolean values as badges", () => {
    render(<QuickLookPanel {...defaultProps} />);

    // Row 0: active=true
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("shows formatted JSON for object values", () => {
    render(<QuickLookPanel {...defaultProps} />);

    // Row 0: meta = {key: "value"} should be pretty-printed
    expect(screen.getByText(/"key"/)).toBeInTheDocument();
    expect(screen.getByText(/"value"/)).toBeInTheDocument();
  });

  it("shows BLOB button for BLOB columns with non-null data", () => {
    render(<QuickLookPanel {...defaultProps} />);

    // Row 0: data = "binary-data" (bytea column)
    const blobButton = screen.getByLabelText(/View BLOB data for data/);
    expect(blobButton).toBeInTheDocument();
    expect(blobButton).toHaveTextContent("(BLOB)");
  });

  it("opens BLOB viewer when BLOB button is clicked", () => {
    render(<QuickLookPanel {...defaultProps} />);

    const blobButton = screen.getByLabelText(/View BLOB data for data/);
    fireEvent.click(blobButton);

    expect(screen.getByTestId("blob-viewer-dialog")).toBeInTheDocument();
    expect(screen.getByText(/BLOB Viewer — data/)).toBeInTheDocument();
  });

  it("shows NULL for null BLOB columns", () => {
    // Row 1: data is null (bytea column)
    render(<QuickLookPanel {...defaultProps} selectedRowIds={new Set([1])} />);

    // Should NOT show BLOB button for null data column
    expect(
      screen.queryByLabelText(/View BLOB data for data/),
    ).not.toBeInTheDocument();
  });

  it("shows large text in a textarea", () => {
    // Row 1: bio = "a".repeat(300) — large text
    render(<QuickLookPanel {...defaultProps} selectedRowIds={new Set([1])} />);

    const textarea = screen.getByLabelText("Value for bio");
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveAttribute("readonly");
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    render(<QuickLookPanel {...defaultProps} onClose={onClose} />);

    const closeButton = screen.getByLabelText("Close row details");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders nothing when selected row index is out of bounds", () => {
    const { container } = render(
      <QuickLookPanel {...defaultProps} selectedRowIds={new Set([99])} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when selection is empty", () => {
    const { container } = render(
      <QuickLookPanel {...defaultProps} selectedRowIds={new Set()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows first row when multiple rows are selected", () => {
    render(
      <QuickLookPanel {...defaultProps} selectedRowIds={new Set([2, 0])} />,
    );

    // Should show row 0 data (smallest id in the set)
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("indicates multiple selection in header", () => {
    render(
      <QuickLookPanel {...defaultProps} selectedRowIds={new Set([0, 1, 2])} />,
    );

    expect(screen.getByText(/3 selected, showing first/)).toBeInTheDocument();
  });

  it("shows row 2 data correctly", () => {
    render(<QuickLookPanel {...defaultProps} selectedRowIds={new Set([2])} />);

    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("has row details region for accessibility", () => {
    render(<QuickLookPanel {...defaultProps} />);
    expect(
      screen.getByRole("region", { name: "Row Details" }),
    ).toBeInTheDocument();
  });

  it("shows column data types next to column names", () => {
    render(<QuickLookPanel {...defaultProps} />);
    // The column data types should appear in the panel
    expect(screen.getByText("integer")).toBeInTheDocument();
    // "text" appears as data type for name and bio columns
    const textLabels = screen.getAllByText("text");
    expect(textLabels.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("boolean")).toBeInTheDocument();
    expect(screen.getByText("jsonb")).toBeInTheDocument();
    expect(screen.getByText("bytea")).toBeInTheDocument();
  });
});
