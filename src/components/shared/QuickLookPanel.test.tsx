import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuickLookPanel from "./QuickLookPanel";
import type { TableData } from "@/types/schema";

// Mock BlobViewerDialog so we don't need to mock its internals
vi.mock("@components/datagrid/BlobViewerDialog", () => ({
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
  describe("rdb mode", () => {
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
      render(
        <QuickLookPanel {...defaultProps} selectedRowIds={new Set([1])} />,
      );

      // Should NOT show BLOB button for null data column
      expect(
        screen.queryByLabelText(/View BLOB data for data/),
      ).not.toBeInTheDocument();
    });

    it("shows large text in a textarea", () => {
      // Row 1: bio = "a".repeat(300) — large text
      render(
        <QuickLookPanel {...defaultProps} selectedRowIds={new Set([1])} />,
      );

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
        <QuickLookPanel
          {...defaultProps}
          selectedRowIds={new Set([0, 1, 2])}
        />,
      );

      expect(screen.getByText(/3 selected, showing first/)).toBeInTheDocument();
    });

    it("shows row 2 data correctly", () => {
      render(
        <QuickLookPanel {...defaultProps} selectedRowIds={new Set([2])} />,
      );

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

    // ── Sprint 90 #QL-2: column name / type 2-line split ─────────────
    describe("column header 2-line split (sprint-90 #QL-2)", () => {
      it("renders column name and data type as separate sibling blocks under a flex flex-col parent", () => {
        render(<QuickLookPanel {...defaultProps} />);

        // The "id" column name node lives inside a flex-flex-col header cell.
        const nameNode = screen.getByText("id");
        const typeNode = screen.getByText("integer");

        // They must not be the same DOM node and must not be one a child of the other —
        // they are sibling spans inside the header cell.
        expect(nameNode).not.toBe(typeNode);
        expect(nameNode.contains(typeNode)).toBe(false);
        expect(typeNode.contains(nameNode)).toBe(false);

        // Shared parent is the header cell with `flex flex-col`.
        const parent = nameNode.parentElement;
        expect(parent).not.toBeNull();
        expect(parent).toBe(typeNode.parentElement);
        expect(parent?.className).toMatch(/\bflex\b/);
        expect(parent?.className).toMatch(/\bflex-col\b/);
      });

      it("applies the visual hierarchy classes (font-mono + text-xs on name, text-3xs + opacity-60 on type)", () => {
        render(<QuickLookPanel {...defaultProps} />);

        const nameNode = screen.getByText("id");
        expect(nameNode.className).toMatch(/\bfont-mono\b/);
        expect(nameNode.className).toMatch(/\btext-xs\b/);

        const typeNode = screen.getByText("integer");
        expect(typeNode.className).toMatch(/\btext-3xs\b/);
        expect(typeNode.className).toMatch(/\bopacity-60\b/);
      });

      it("does not truncate a long column name when the data type is long (character varying(255), timestamp with time zone)", () => {
        const longColumns = [
          {
            name: "extremely_long_column_name_that_should_not_be_truncated",
            data_type: "character varying(255)",
            nullable: true,
            default_value: null,
            is_primary_key: false,
            is_foreign_key: false,
            fk_reference: null,
            comment: null,
          },
          {
            name: "another_long_column_name_with_timestamp",
            data_type: "timestamp with time zone",
            nullable: true,
            default_value: null,
            is_primary_key: false,
            is_foreign_key: false,
            fk_reference: null,
            comment: null,
          },
        ];
        const longData: TableData = {
          columns: longColumns,
          rows: [["short value", "2026-04-25T00:00:00Z"]],
          total_count: 1,
          page: 1,
          page_size: 100,
          executed_query: "SELECT * FROM long_columns LIMIT 1 OFFSET 0",
        };

        render(
          <QuickLookPanel
            {...defaultProps}
            data={longData}
            selectedRowIds={new Set([0])}
          />,
        );

        // Long column names are matched in full — proving no truncation by ellipsis/text-clip.
        const longNameNode = screen.getByText(
          "extremely_long_column_name_that_should_not_be_truncated",
        );
        const longTypeNode = screen.getByText("character varying(255)");
        expect(longNameNode).toBeInTheDocument();
        expect(longTypeNode).toBeInTheDocument();

        // Even with a long type next to it, the name node has no truncation
        // utility (no `truncate`, no `text-ellipsis`) and explicitly wraps.
        expect(longNameNode.className).not.toMatch(/\btruncate\b/);
        expect(longNameNode.className).not.toMatch(/\btext-ellipsis\b/);
        expect(longNameNode.className).toMatch(/\bwhitespace-normal\b/);
        expect(longNameNode.className).toMatch(/\bbreak-words\b/);

        // The second long column is rendered too.
        expect(
          screen.getByText("another_long_column_name_with_timestamp"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("timestamp with time zone"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("document mode", () => {
    const documentDefaultProps = {
      mode: "document" as const,
      rawDocuments: [
        {
          _id: { $oid: "65abcdef0123456789abcdef" },
          name: "Alice",
          age: 30,
          tags: ["admin", "beta"],
        },
        {
          _id: { $oid: "65abcdef0123456789abcde0" },
          name: "Bob",
          age: 27,
          tags: [],
        },
      ] as Record<string, unknown>[],
      selectedRowIds: new Set([0]),
      database: "table_view_test",
      collection: "users",
      onClose: vi.fn(),
    };

    it("renders the document details header with the db.collection label", () => {
      render(<QuickLookPanel {...documentDefaultProps} />);

      expect(screen.getByText(/Document Details/)).toBeInTheDocument();
      expect(screen.getByText(/table_view_test\.users/)).toBeInTheDocument();
    });

    it("mounts the BsonTreeViewer with top-level keys for the selected document", () => {
      render(<QuickLookPanel {...documentDefaultProps} />);

      const tree = screen.getByRole("tree", { name: /BSON document tree/i });
      expect(tree).toBeInTheDocument();

      // Top-level keys rendered as copy-path buttons inside the tree.
      expect(tree).toHaveTextContent("_id");
      expect(tree).toHaveTextContent("name");
      expect(tree).toHaveTextContent("age");
      expect(tree).toHaveTextContent("tags");
    });

    it("shows the BsonTreeViewer empty state when the selection is out of bounds", () => {
      render(
        <QuickLookPanel
          {...documentDefaultProps}
          selectedRowIds={new Set([99])}
        />,
      );

      expect(
        screen.getByRole("tree", { name: /BSON document tree/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/No document selected/i)).toBeInTheDocument();
    });

    it("shows the BsonTreeViewer empty state when rawDocuments is empty", () => {
      render(
        <QuickLookPanel
          {...documentDefaultProps}
          rawDocuments={[]}
          selectedRowIds={new Set([0])}
        />,
      );

      expect(
        screen.getByRole("tree", { name: /BSON document tree/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/No document selected/i)).toBeInTheDocument();
    });

    it("indicates multi-select in the header while still showing the first document", () => {
      render(
        <QuickLookPanel
          {...documentDefaultProps}
          selectedRowIds={new Set([0, 1, 2])}
        />,
      );

      expect(screen.getByText(/3 selected, showing first/)).toBeInTheDocument();
      // First document's top-level `name` field is rendered.
      const tree = screen.getByRole("tree", { name: /BSON document tree/i });
      expect(tree).toHaveTextContent("name");
    });

    it("close button calls onClose", () => {
      const onClose = vi.fn();
      render(<QuickLookPanel {...documentDefaultProps} onClose={onClose} />);

      const closeButton = screen.getByLabelText("Close document details");
      fireEvent.click(closeButton);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("uses the document region label for accessibility", () => {
      render(<QuickLookPanel {...documentDefaultProps} />);
      expect(
        screen.getByRole("region", { name: "Document Details" }),
      ).toBeInTheDocument();
    });

    it("does not mount the BLOB viewer dialog in document mode", () => {
      render(<QuickLookPanel {...documentDefaultProps} />);
      expect(
        screen.queryByTestId("blob-viewer-dialog"),
      ).not.toBeInTheDocument();
    });
  });
});
