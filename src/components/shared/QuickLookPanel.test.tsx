import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuickLookPanel from "./QuickLookPanel";
import type { TableData } from "@/types/schema";
import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";

// Sprint 194 — minimal `DataGridEditState` factory for QuickLook edit-mode
// tests. Only the surface QuickLook actually consumes is filled in; the rest
// is `vi.fn()` no-ops to satisfy the type contract. Pendingedits / errors
// default to empty Maps so `Modified` pill stays off unless overridden.
function makeEditState(
  overrides: Partial<DataGridEditState> = {},
): DataGridEditState {
  return {
    editingCell: null,
    editValue: null,
    setEditValue: vi.fn(),
    setEditNull: vi.fn(),
    pendingEdits: new Map(),
    pendingNewRows: [],
    pendingDeletedRowKeys: new Set(),
    pendingEditErrors: new Map(),
    sqlPreview: null,
    setSqlPreview: vi.fn(),
    commitError: null,
    setCommitError: vi.fn(),
    mqlPreview: null,
    setMqlPreview: vi.fn(),
    selectedRowIds: new Set(),
    anchorRowIdx: null,
    selectedRowIdx: null,
    hasPendingChanges: false,
    isCommitFlashing: false,
    saveCurrentEdit: vi.fn(),
    cancelEdit: vi.fn(),
    handleStartEdit: vi.fn(),
    handleSelectRow: vi.fn(),
    handleCommit: vi.fn(),
    handleExecuteCommit: vi.fn().mockResolvedValue(undefined),
    pendingConfirm: null,
    confirmDangerous: vi.fn().mockResolvedValue(undefined),
    cancelDangerous: vi.fn(),
    handleDiscard: vi.fn(),
    handleAddRow: vi.fn(),
    handleDeleteRow: vi.fn(),
    handleDuplicateRow: vi.fn(),
    ...overrides,
  };
}

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

    // ── Sprint 194 — FB-4 edit mode (RDB) ────────────────────────────
    describe("edit mode (sprint-194 FB-4 RDB)", () => {
      it("[AC-194-01-1] does not render the edit toggle when editState is absent", () => {
        // Read-only call-site (existing): no editState prop → no toggle.
        render(<QuickLookPanel {...defaultProps} />);
        expect(
          screen.queryByLabelText(/Toggle edit mode/i),
        ).not.toBeInTheDocument();
      });

      it("[AC-194-01-2] renders the edit toggle when editState is provided", () => {
        const editState = makeEditState({ selectedRowIds: new Set([0]) });
        render(<QuickLookPanel {...defaultProps} editState={editState} />);
        expect(screen.getByLabelText(/Toggle edit mode/i)).toBeInTheDocument();
      });

      it("[AC-194-01-3] entering edit mode swaps editable values into <input> / <textarea> / <select> by column family", () => {
        const editState = makeEditState({ selectedRowIds: new Set([0]) });
        render(<QuickLookPanel {...defaultProps} editState={editState} />);

        // Toggle on
        fireEvent.click(screen.getByLabelText(/Toggle edit mode/i));

        // name (text) → input
        const nameInput = screen.getByLabelText("Edit value for name");
        expect(nameInput).toBeInTheDocument();
        expect(nameInput.tagName).toBe("INPUT");

        // active (boolean) → Radix <Select> trigger (combobox role).
        const activeSelect = screen.getByLabelText("Edit value for active");
        expect(activeSelect).toBeInTheDocument();
        expect(activeSelect.getAttribute("role")).toBe("combobox");

        // meta (jsonb) → textarea
        const metaTextarea = screen.getByLabelText("Edit value for meta");
        expect(metaTextarea.tagName).toBe("TEXTAREA");
      });

      it("[AC-194-01-4] PK / BLOB columns stay read-only in edit mode (no input rendered)", () => {
        const editState = makeEditState({ selectedRowIds: new Set([0]) });
        render(<QuickLookPanel {...defaultProps} editState={editState} />);

        fireEvent.click(screen.getByLabelText(/Toggle edit mode/i));

        // id (PK) — no editable input
        expect(
          screen.queryByLabelText("Edit value for id"),
        ).not.toBeInTheDocument();
        // data (bytea / BLOB) — no editable input
        expect(
          screen.queryByLabelText("Edit value for data"),
        ).not.toBeInTheDocument();
        // BLOB button remains
        expect(
          screen.getByLabelText(/View BLOB data for data/),
        ).toBeInTheDocument();
      });

      it("[AC-194-01-5] Enter on a text input dispatches handleStartEdit + setEditValue + saveCurrentEdit (in that order)", () => {
        const handleStartEdit = vi.fn();
        const setEditValue = vi.fn();
        const saveCurrentEdit = vi.fn();
        const editState = makeEditState({
          selectedRowIds: new Set([0]),
          handleStartEdit,
          setEditValue,
          saveCurrentEdit,
        });

        render(<QuickLookPanel {...defaultProps} editState={editState} />);
        fireEvent.click(screen.getByLabelText(/Toggle edit mode/i));

        const nameInput = screen.getByLabelText(
          "Edit value for name",
        ) as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: "Bob" } });
        fireEvent.keyDown(nameInput, { key: "Enter" });

        // QuickLook dispatches the hook's start→set→save trio. colIdx for
        // `name` is 1.
        expect(handleStartEdit).toHaveBeenCalledWith(0, 1, "Alice");
        expect(setEditValue).toHaveBeenCalledWith("Bob");
        expect(saveCurrentEdit).toHaveBeenCalledOnce();
        // Order: start before set before save.
        const startOrder = handleStartEdit.mock.invocationCallOrder[0]!;
        const setOrder = setEditValue.mock.invocationCallOrder[0]!;
        const saveOrder = saveCurrentEdit.mock.invocationCallOrder[0]!;
        expect(startOrder).toBeLessThan(setOrder);
        expect(setOrder).toBeLessThan(saveOrder);
      });

      it("[AC-194-01-6] Esc on an input cancels the local edit (no dispatch)", () => {
        const handleStartEdit = vi.fn();
        const setEditValue = vi.fn();
        const saveCurrentEdit = vi.fn();
        const editState = makeEditState({
          selectedRowIds: new Set([0]),
          handleStartEdit,
          setEditValue,
          saveCurrentEdit,
        });

        render(<QuickLookPanel {...defaultProps} editState={editState} />);
        fireEvent.click(screen.getByLabelText(/Toggle edit mode/i));

        const nameInput = screen.getByLabelText(
          "Edit value for name",
        ) as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: "Bob" } });
        fireEvent.keyDown(nameInput, { key: "Escape" });

        // Esc → no save dispatched, value reverts to original on next render.
        expect(saveCurrentEdit).not.toHaveBeenCalled();
        expect(handleStartEdit).not.toHaveBeenCalled();
      });

      it("[AC-194-01-7] Set NULL button dispatches handleStartEdit + setEditValue(null) + saveCurrentEdit", () => {
        const handleStartEdit = vi.fn();
        const setEditValue = vi.fn();
        const saveCurrentEdit = vi.fn();
        const editState = makeEditState({
          selectedRowIds: new Set([0]),
          handleStartEdit,
          setEditValue,
          saveCurrentEdit,
        });

        render(<QuickLookPanel {...defaultProps} editState={editState} />);
        fireEvent.click(screen.getByLabelText(/Toggle edit mode/i));

        // The "Set NULL" button is per-row inside the FieldRow; pick the one
        // for `name` column.
        const setNullBtn = screen.getByLabelText("Set NULL for name");
        fireEvent.click(setNullBtn);

        expect(handleStartEdit).toHaveBeenCalledWith(0, 1, "Alice");
        expect(setEditValue).toHaveBeenCalledWith(null);
        expect(saveCurrentEdit).toHaveBeenCalledOnce();
      });

      it("[AC-194-02-1] textarea (jsonb) Cmd+Enter saves; plain Enter does not", () => {
        const setEditValue = vi.fn();
        const saveCurrentEdit = vi.fn();
        const editState = makeEditState({
          selectedRowIds: new Set([0]),
          setEditValue,
          saveCurrentEdit,
        });

        render(<QuickLookPanel {...defaultProps} editState={editState} />);
        fireEvent.click(screen.getByLabelText(/Toggle edit mode/i));

        const metaTextarea = screen.getByLabelText(
          "Edit value for meta",
        ) as HTMLTextAreaElement;

        // Plain Enter inside textarea → no save (newline insertion is the
        // user's intent).
        fireEvent.change(metaTextarea, { target: { value: '{"a":1}' } });
        fireEvent.keyDown(metaTextarea, { key: "Enter" });
        expect(saveCurrentEdit).not.toHaveBeenCalled();

        // Cmd+Enter → save.
        fireEvent.keyDown(metaTextarea, { key: "Enter", metaKey: true });
        expect(saveCurrentEdit).toHaveBeenCalledOnce();
        expect(setEditValue).toHaveBeenCalledWith('{"a":1}');
      });

      it("[AC-194-04-1] dirty pill renders when pendingEdits has an entry for the selected row", () => {
        const editState = makeEditState({
          selectedRowIds: new Set([0]),
          // colIdx 1 = name
          pendingEdits: new Map([["0-1", "Bob"]]),
        });

        render(<QuickLookPanel {...defaultProps} editState={editState} />);
        expect(screen.getByText(/Modified/)).toBeInTheDocument();
      });

      it("[AC-194-04-2] dirty pill does NOT render when pendingEdits has only OTHER rows", () => {
        const editState = makeEditState({
          selectedRowIds: new Set([0]),
          // pending edit is for row 2, not the selected row 0
          pendingEdits: new Map([["2-1", "Charlie-edit"]]),
        });

        render(<QuickLookPanel {...defaultProps} editState={editState} />);
        expect(screen.queryByText(/Modified/)).not.toBeInTheDocument();
      });

      it("[AC-194-04-3] dirty pill does NOT render in read-only call-site (no editState)", () => {
        // Read-only path stays clean — no pill chrome at all.
        render(<QuickLookPanel {...defaultProps} />);
        expect(screen.queryByText(/Modified/)).not.toBeInTheDocument();
      });
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

    // ── Sprint 194 — FB-4 edit mode (document) ───────────────────────
    describe("edit mode (sprint-194 FB-4 document)", () => {
      const docColumns = [
        {
          name: "_id",
          data_type: "objectId",
          nullable: false,
          default_value: null,
          is_primary_key: true,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
        {
          name: "name",
          data_type: "string",
          nullable: true,
          default_value: null,
          is_primary_key: false,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
        {
          name: "age",
          data_type: "int32",
          nullable: true,
          default_value: null,
          is_primary_key: false,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
        {
          name: "tags",
          data_type: "array",
          nullable: true,
          default_value: null,
          is_primary_key: false,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
      ];

      const docData: TableData = {
        columns: docColumns,
        rows: [
          [
            { $oid: "65abcdef0123456789abcdef" },
            "Alice",
            30,
            ["admin", "beta"],
          ],
          [{ $oid: "65abcdef0123456789abcde0" }, "Bob", 27, []],
        ],
        total_count: 2,
        page: 1,
        page_size: 100,
        executed_query: "db.users.find({}).limit(100)",
      };

      const baseEditableProps = {
        ...documentDefaultProps,
        data: docData,
      };

      it("[AC-194-03-1] document mode shows the edit toggle when editState is provided", () => {
        const editState = makeEditState({ selectedRowIds: new Set([0]) });
        render(<QuickLookPanel {...baseEditableProps} editState={editState} />);
        expect(screen.getByLabelText(/Toggle edit mode/i)).toBeInTheDocument();
      });

      it("[AC-194-03-2] entering edit mode swaps the BSON tree for per-field inputs", () => {
        const editState = makeEditState({ selectedRowIds: new Set([0]) });
        render(<QuickLookPanel {...baseEditableProps} editState={editState} />);

        // Tree is mounted in read-only mode.
        expect(
          screen.getByRole("tree", { name: /BSON document tree/i }),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText(/Toggle edit mode/i));

        // After toggle: tree gone, per-field inputs present.
        expect(
          screen.queryByRole("tree", { name: /BSON document tree/i }),
        ).not.toBeInTheDocument();
        expect(
          screen.getByLabelText("Edit value for name"),
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Edit value for age")).toBeInTheDocument();
      });

      it("[AC-194-03-3] _id stays read-only in document edit mode (Mongo paradigm contract)", () => {
        const editState = makeEditState({ selectedRowIds: new Set([0]) });
        render(<QuickLookPanel {...baseEditableProps} editState={editState} />);

        fireEvent.click(screen.getByLabelText(/Toggle edit mode/i));

        expect(
          screen.queryByLabelText("Edit value for _id"),
        ).not.toBeInTheDocument();
      });

      it("[AC-194-03-4] saving a field dispatches handleStartEdit + setEditValue + saveCurrentEdit on the synthesized column index", () => {
        const handleStartEdit = vi.fn();
        const setEditValue = vi.fn();
        const saveCurrentEdit = vi.fn();
        const editState = makeEditState({
          selectedRowIds: new Set([0]),
          handleStartEdit,
          setEditValue,
          saveCurrentEdit,
        });

        render(<QuickLookPanel {...baseEditableProps} editState={editState} />);
        fireEvent.click(screen.getByLabelText(/Toggle edit mode/i));

        const nameInput = screen.getByLabelText(
          "Edit value for name",
        ) as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: "Alicia" } });
        fireEvent.keyDown(nameInput, { key: "Enter" });

        // colIdx for `name` in docColumns is 1.
        expect(handleStartEdit).toHaveBeenCalledWith(0, 1, "Alice");
        expect(setEditValue).toHaveBeenCalledWith("Alicia");
        expect(saveCurrentEdit).toHaveBeenCalledOnce();
      });
    });

    // ── Sprint 105 #QL-1: keyboard-accessible resizer (document mode) ─
    it("exposes the resize handle as a focusable separator with ARIA in document mode", () => {
      render(<QuickLookPanel {...documentDefaultProps} />);

      const handle = screen.getByRole("separator", {
        name: "Resize Quick Look panel",
      });
      expect(handle).toHaveAttribute("tabindex", "0");
      expect(handle).toHaveAttribute("aria-orientation", "horizontal");
      expect(handle).toHaveAttribute("aria-valuemin", "120");
      expect(handle).toHaveAttribute("aria-valuemax", "600");
      // Default height is 280.
      expect(handle).toHaveAttribute("aria-valuenow", "280");
      expect(handle).not.toHaveAttribute("aria-hidden");
    });
  });

  // ── Sprint 105 #QL-1: keyboard-accessible resizer (RDB mode) ───────
  describe("keyboard resizer (sprint-105 #QL-1)", () => {
    const MIN_HEIGHT = 120;
    const MAX_HEIGHT = 600;
    const STEP = 8;
    const DEFAULT_HEIGHT = 280;

    it("renders the resize handle with role=separator, tabIndex=0 and ARIA attributes", () => {
      render(<QuickLookPanel {...defaultProps} />);

      const handle = screen.getByRole("separator", {
        name: "Resize Quick Look panel",
      });
      expect(handle).toBeInTheDocument();
      expect(handle).toHaveAttribute("tabindex", "0");
      expect(handle).toHaveAttribute("aria-orientation", "horizontal");
      expect(handle).toHaveAttribute("aria-valuemin", String(MIN_HEIGHT));
      expect(handle).toHaveAttribute("aria-valuemax", String(MAX_HEIGHT));
      expect(handle).toHaveAttribute("aria-valuenow", String(DEFAULT_HEIGHT));
      expect(handle).not.toHaveAttribute("aria-hidden");
    });

    it("Shift+ArrowUp grows the panel by 8px and updates aria-valuenow", () => {
      render(<QuickLookPanel {...defaultProps} />);

      const handle = screen.getByRole("separator", {
        name: "Resize Quick Look panel",
      });
      fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });

      expect(handle).toHaveAttribute(
        "aria-valuenow",
        String(DEFAULT_HEIGHT + STEP),
      );
    });

    it("Shift+ArrowDown shrinks the panel by 8px and updates aria-valuenow", () => {
      render(<QuickLookPanel {...defaultProps} />);

      const handle = screen.getByRole("separator", {
        name: "Resize Quick Look panel",
      });
      fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true });

      expect(handle).toHaveAttribute(
        "aria-valuenow",
        String(DEFAULT_HEIGHT - STEP),
      );
    });

    it("Shift+ArrowUp clamps to MAX_HEIGHT (600)", () => {
      render(<QuickLookPanel {...defaultProps} />);

      const handle = screen.getByRole("separator", {
        name: "Resize Quick Look panel",
      });
      // Default height is 280; need (600-280)/8 = 40 steps to reach max.
      // Press 50 times to confirm the clamp holds beyond the upper bound.
      for (let i = 0; i < 50; i++) {
        fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });
      }

      expect(handle).toHaveAttribute("aria-valuenow", String(MAX_HEIGHT));
    });

    it("Shift+ArrowDown clamps to MIN_HEIGHT (120)", () => {
      render(<QuickLookPanel {...defaultProps} />);

      const handle = screen.getByRole("separator", {
        name: "Resize Quick Look panel",
      });
      // Default height is 280; need (280-120)/8 = 20 steps to reach min.
      // Press 30 times to confirm the clamp holds below the lower bound.
      for (let i = 0; i < 30; i++) {
        fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true });
      }

      expect(handle).toHaveAttribute("aria-valuenow", String(MIN_HEIGHT));
    });

    it("ignores plain ArrowUp without Shift (no-op)", () => {
      render(<QuickLookPanel {...defaultProps} />);

      const handle = screen.getByRole("separator", {
        name: "Resize Quick Look panel",
      });
      fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: false });

      expect(handle).toHaveAttribute("aria-valuenow", String(DEFAULT_HEIGHT));
    });

    it("ignores plain ArrowDown without Shift (no-op)", () => {
      render(<QuickLookPanel {...defaultProps} />);

      const handle = screen.getByRole("separator", {
        name: "Resize Quick Look panel",
      });
      fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: false });

      expect(handle).toHaveAttribute("aria-valuenow", String(DEFAULT_HEIGHT));
    });

    it("ignores other keys with Shift (e.g. Shift+Enter)", () => {
      render(<QuickLookPanel {...defaultProps} />);

      const handle = screen.getByRole("separator", {
        name: "Resize Quick Look panel",
      });
      fireEvent.keyDown(handle, { key: "Enter", shiftKey: true });

      expect(handle).toHaveAttribute("aria-valuenow", String(DEFAULT_HEIGHT));
    });
  });
});
