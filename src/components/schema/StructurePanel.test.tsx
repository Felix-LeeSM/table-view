import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StructurePanel from "./StructurePanel";
import { useSchemaStore } from "@stores/schemaStore";
import type { ColumnInfo, IndexInfo, ConstraintInfo } from "@/types/schema";
import * as tauri from "@lib/tauri";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_COLUMNS: ColumnInfo[] = [
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
    default_value: "'unknown'",
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: "User display name",
  },
  {
    name: "org_id",
    data_type: "bigint",
    nullable: false,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: true,
    fk_reference: "public.organizations(id)",
    comment: null,
  },
];

const MOCK_INDEXES: IndexInfo[] = [
  {
    name: "users_pkey",
    columns: ["id"],
    index_type: "btree",
    is_primary: true,
    is_unique: true,
  },
  {
    name: "users_name_idx",
    columns: ["name"],
    index_type: "btree",
    is_primary: false,
    is_unique: false,
  },
  {
    name: "users_email_uniq",
    columns: ["email"],
    index_type: "hash",
    is_primary: false,
    is_unique: true,
  },
];

const MOCK_CONSTRAINTS: ConstraintInfo[] = [
  {
    name: "users_pkey",
    constraint_type: "PRIMARY KEY",
    columns: ["id"],
    reference_table: null,
    reference_columns: null,
  },
  {
    name: "users_org_id_fkey",
    constraint_type: "FOREIGN KEY",
    columns: ["org_id"],
    reference_table: "organizations",
    reference_columns: ["id"],
  },
  {
    name: "users_email_notnull",
    constraint_type: "CHECK",
    columns: ["email"],
    reference_table: null,
    reference_columns: null,
  },
];

// ---------------------------------------------------------------------------
// Store mocking
// ---------------------------------------------------------------------------

const mockGetTableColumns = vi.fn().mockResolvedValue(MOCK_COLUMNS);
const mockGetTableIndexes = vi.fn().mockResolvedValue(MOCK_INDEXES);
const mockGetTableConstraints = vi.fn().mockResolvedValue(MOCK_CONSTRAINTS);

function setStoreState(overrides: Record<string, unknown> = {}) {
  useSchemaStore.setState({
    getTableColumns: mockGetTableColumns,
    getTableIndexes: mockGetTableIndexes,
    getTableConstraints: mockGetTableConstraints,
    ...overrides,
  } as Partial<Parameters<typeof useSchemaStore.setState>[0]>);
}

function renderPanel(
  props: {
    connectionId?: string;
    table?: string;
    schema?: string;
  } = {},
) {
  return render(
    <StructurePanel
      connectionId={props.connectionId ?? "conn-1"}
      table={props.table ?? "users"}
      schema={props.schema ?? "public"}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StructurePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTableColumns.mockResolvedValue([...MOCK_COLUMNS]);
    mockGetTableIndexes.mockResolvedValue([...MOCK_INDEXES]);
    mockGetTableConstraints.mockResolvedValue([...MOCK_CONSTRAINTS]);
    setStoreState();
    vi.spyOn(tauri, "alterTable").mockResolvedValue({
      sql: "ALTER TABLE users ADD COLUMN email varchar(255);",
    });
    vi.spyOn(tauri, "createIndex").mockResolvedValue({
      sql: "CREATE INDEX idx_name ON public.users (name);",
    });
    vi.spyOn(tauri, "dropIndex").mockResolvedValue({
      sql: "DROP INDEX idx_name;",
    });
    vi.spyOn(tauri, "addConstraint").mockResolvedValue({
      sql: "ALTER TABLE public.users ADD CONSTRAINT uk_email UNIQUE (email);",
    });
    vi.spyOn(tauri, "dropConstraint").mockResolvedValue({
      sql: "ALTER TABLE public.users DROP CONSTRAINT uk_email;",
    });
  });

  // -----------------------------------------------------------------------
  // AC-09: Renders columns tab by default and fetches column data
  // -----------------------------------------------------------------------
  it("renders Columns tab as active by default", () => {
    // Keep promise pending so we see the initial tab state
    mockGetTableColumns.mockReturnValue(new Promise(() => {}));
    renderPanel();
    const columnsTab = screen.getByRole("tab", { name: "Columns" });
    expect(columnsTab).toHaveAttribute("aria-selected", "true");
  });

  it("calls getTableColumns on mount with correct arguments", async () => {
    await act(async () => {
      renderPanel();
    });

    expect(mockGetTableColumns).toHaveBeenCalledWith(
      "conn-1",
      "users",
      "public",
    );
  });

  it("renders column data in the table", async () => {
    await act(async () => {
      renderPanel();
    });

    // Column names
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("org_id")).toBeInTheDocument();

    // Data types
    expect(screen.getByText("integer")).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();

    // Nullable
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getAllByText("NO").length).toBeGreaterThanOrEqual(1);

    // Default value
    expect(screen.getByText("'unknown'")).toBeInTheDocument();

    // FK reference
    expect(screen.getByText("public.organizations(id)")).toBeInTheDocument();

    // Comment
    expect(screen.getByText("User display name")).toBeInTheDocument();
  });

  it("shows primary key icon for primary key columns", async () => {
    await act(async () => {
      renderPanel();
    });

    const pkIcons = screen.getAllByLabelText("Primary Key");
    expect(pkIcons.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // AC-10: Switches between columns/indexes/constraints tabs
  // -----------------------------------------------------------------------
  it("switches to Indexes tab and fetches indexes", async () => {
    await act(async () => {
      renderPanel();
    });

    // Initial fetch is columns
    expect(mockGetTableColumns).toHaveBeenCalledTimes(1);

    // Switch to indexes tab
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    const indexesTab = screen.getByRole("tab", { name: "Indexes" });
    expect(indexesTab).toHaveAttribute("aria-selected", "true");

    expect(mockGetTableIndexes).toHaveBeenCalledWith(
      "conn-1",
      "users",
      "public",
    );
  });

  it("renders index data in the table", async () => {
    await act(async () => {
      renderPanel();
    });

    // Switch to indexes tab
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    // Index names
    expect(screen.getByText("users_pkey")).toBeInTheDocument();
    expect(screen.getByText("users_name_idx")).toBeInTheDocument();

    // Index columns
    expect(screen.getByText("id")).toBeInTheDocument();

    // Index types
    expect(screen.getAllByText("btree").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("hash")).toBeInTheDocument();

    // Properties - PK and UNIQUE badges
    expect(screen.getByText("PK")).toBeInTheDocument();
    expect(screen.getByText("UNIQUE")).toBeInTheDocument();
  });

  it("switches to Constraints tab and fetches constraints", async () => {
    await act(async () => {
      renderPanel();
    });

    // Switch to constraints tab
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    const constraintsTab = screen.getByRole("tab", { name: "Constraints" });
    expect(constraintsTab).toHaveAttribute("aria-selected", "true");

    expect(mockGetTableConstraints).toHaveBeenCalledWith(
      "conn-1",
      "users",
      "public",
    );
  });

  it("renders constraint data in the table", async () => {
    await act(async () => {
      renderPanel();
    });

    // Switch to constraints tab
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    // Constraint names
    expect(screen.getByText("users_pkey")).toBeInTheDocument();
    expect(screen.getByText("users_org_id_fkey")).toBeInTheDocument();

    // Constraint types
    expect(screen.getByText("PRIMARY KEY")).toBeInTheDocument();
    expect(screen.getByText("FOREIGN KEY")).toBeInTheDocument();
    expect(screen.getByText("CHECK")).toBeInTheDocument();

    // Constraint columns
    expect(screen.getByText("org_id")).toBeInTheDocument();

    // References
    expect(screen.getByText("organizations(id)")).toBeInTheDocument();
  });

  it("shows em-dash for constraints without reference table", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    // The em-dash character is used for null reference_table
    const cells = screen.getAllByRole("cell");
    const cellTexts = cells.map((c) => c.textContent);
    expect(cellTexts).toContain("\u2014");
  });

  // -----------------------------------------------------------------------
  // AC-11: Shows error state when fetch fails
  // -----------------------------------------------------------------------
  it("shows error alert when columns fetch fails", async () => {
    mockGetTableColumns.mockRejectedValue(new Error("Connection lost"));

    await act(async () => {
      renderPanel();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  });

  it("shows error alert when indexes fetch fails", async () => {
    mockGetTableIndexes.mockRejectedValue(new Error("Permission denied"));

    await act(async () => {
      renderPanel();
    });

    // Switch to indexes tab
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
  });

  it("shows error alert when constraints fetch fails", async () => {
    mockGetTableConstraints.mockRejectedValue(new Error("Schema not found"));

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Schema not found");
  });

  // -----------------------------------------------------------------------
  // AC-12: Shows "No columns/indexes/constraints found" for empty data
  // -----------------------------------------------------------------------
  it("shows empty state for columns when no data returned", async () => {
    mockGetTableColumns.mockResolvedValue([]);

    await act(async () => {
      renderPanel();
    });

    expect(screen.getByText("No columns found")).toBeInTheDocument();
  });

  it("shows empty state for indexes when no data returned", async () => {
    mockGetTableIndexes.mockResolvedValue([]);

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(screen.getByText("No indexes found")).toBeInTheDocument();
  });

  it("shows empty state for constraints when no data returned", async () => {
    mockGetTableConstraints.mockResolvedValue([]);

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    expect(screen.getByText("No constraints found")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------
  it("shows spinner while loading", () => {
    mockGetTableColumns.mockReturnValue(new Promise(() => {}));
    renderPanel();

    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("removes spinner after data loads", async () => {
    await act(async () => {
      renderPanel();
    });

    expect(document.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Refresh event
  // -----------------------------------------------------------------------
  it("refetches data on refresh-structure window event", async () => {
    await act(async () => {
      renderPanel();
    });

    const initialCallCount = mockGetTableColumns.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event("refresh-structure"));
    });

    expect(mockGetTableColumns.mock.calls.length).toBeGreaterThan(
      initialCallCount,
    );
  });

  // -----------------------------------------------------------------------
  // Tab headers
  // -----------------------------------------------------------------------
  it("renders all three tab buttons", () => {
    mockGetTableColumns.mockReturnValue(new Promise(() => {}));
    renderPanel();

    expect(screen.getByRole("tab", { name: "Columns" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Indexes" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Constraints" }),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Non-primary, non-unique index shows em-dash in properties
  // -----------------------------------------------------------------------
  it("shows em-dash for non-primary non-unique indexes", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    // The users_name_idx row should not have PK or UNIQUE badge
    expect(screen.getByText("users_name_idx")).toBeInTheDocument();
    const nameIdxRow = screen.getByText("users_name_idx").closest("tr");
    expect(nameIdxRow).toBeTruthy();
    // Properties is the 4th td (Name, Columns, Type, Properties, Actions)
    const propsCell = nameIdxRow!.querySelector("td:nth-child(4) span");
    // The em-dash may render as the literal escape sequence or the actual character
    expect(propsCell?.textContent).toBeTruthy();
    expect(propsCell?.textContent).not.toBe("PK");
    expect(propsCell?.textContent).not.toBe("UNIQUE");
  });

  // -----------------------------------------------------------------------
  // Table headers for columns tab
  // -----------------------------------------------------------------------
  it("renders correct table headers for columns tab", async () => {
    await act(async () => {
      renderPanel();
    });

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Nullable")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Ref")).toBeInTheDocument();
    expect(screen.getByText("Comment")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Null default value rendered as em-dash
  // -----------------------------------------------------------------------
  it("shows em-dash for null default_value", async () => {
    await act(async () => {
      renderPanel();
    });

    // The "id" column has default_value: null, should show em-dash
    const cells = screen.getAllByRole("cell");
    const cellTexts = cells.map((c) => c.textContent);
    expect(cellTexts).toContain("\u2014");
  });

  // -----------------------------------------------------------------------
  // Null comment rendered as em-dash
  // -----------------------------------------------------------------------
  it("shows em-dash for null comment", async () => {
    await act(async () => {
      renderPanel();
    });

    // id and org_id columns have comment: null
    // There should be em-dash cells
    const cells = screen.getAllByRole("cell");
    const cellTexts = cells.map((c) => c.textContent);
    const emDashCount = cellTexts.filter((t) => t === "\u2014").length;
    expect(emDashCount).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Column with no default shows em-dash
  // -----------------------------------------------------------------------
  it("renders null fk_reference as em-dash", async () => {
    await act(async () => {
      renderPanel();
    });

    // id and name columns have fk_reference: null
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBe(MOCK_COLUMNS.length + 1); // +1 for header
  });

  // -----------------------------------------------------------------------
  // Switching tabs clears error from previous tab
  // -----------------------------------------------------------------------
  it("clears error when switching tabs", async () => {
    mockGetTableColumns.mockRejectedValue(new Error("Error on columns"));

    await act(async () => {
      renderPanel();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Error on columns");

    // Switch to indexes tab (which succeeds)
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // =======================================================================
  // NEW TESTS: Column editing functionality
  // =======================================================================

  // -----------------------------------------------------------------------
  // Add Column button
  // -----------------------------------------------------------------------
  it("renders Add Column button on columns tab", async () => {
    await act(async () => {
      renderPanel();
    });

    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
  });

  it("does not render Add Column button on indexes tab", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(
      screen.queryByRole("button", { name: "Add column" }),
    ).not.toBeInTheDocument();
  });

  it("clicking Add Column adds an editable empty row", async () => {
    await act(async () => {
      renderPanel();
    });

    // Initially 3 column rows + header
    expect(screen.getAllByRole("row").length).toBe(4);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    });

    // Should have 4 column rows + header
    expect(screen.getAllByRole("row").length).toBe(5);

    // New row should have placeholder inputs
    expect(screen.getByPlaceholderText("column_name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("varchar(255)")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Edit column — hover shows edit/delete icons
  // -----------------------------------------------------------------------
  it("renders edit and delete buttons for each column row", async () => {
    await act(async () => {
      renderPanel();
    });

    // Each column should have edit and delete buttons
    expect(screen.getByLabelText("Edit column id")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete column id")).toBeInTheDocument();
    expect(screen.getByLabelText("Edit column name")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete column name")).toBeInTheDocument();
    expect(screen.getByLabelText("Edit column org_id")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete column org_id")).toBeInTheDocument();
  });

  it("clicking edit button makes column fields inline-editable", async () => {
    await act(async () => {
      renderPanel();
    });

    // Click edit on the "name" column
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Edit column name"));
    });

    // Should now show editable inputs for data type, nullable checkbox, default value
    expect(screen.getByLabelText("Data type for name")).toBeInTheDocument();
    expect(screen.getByLabelText("Nullable for name")).toBeInTheDocument();
    expect(screen.getByLabelText("Default value for name")).toBeInTheDocument();

    // The input should have the current value
    const dataTypeInput = screen.getByLabelText(
      "Data type for name",
    ) as HTMLInputElement;
    expect(dataTypeInput.value).toBe("text");
  });

  it("saving an edit creates a pending modify change", async () => {
    await act(async () => {
      renderPanel();
    });

    // Click edit on the "name" column
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Edit column name"));
    });

    // Change the data type
    const dataTypeInput = screen.getByLabelText("Data type for name");
    await act(async () => {
      fireEvent.change(dataTypeInput, { target: { value: "varchar(255)" } });
    });

    // Save the edit
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Save changes for name"));
    });

    // Review SQL button should appear with count 1
    expect(
      screen.getByRole("button", { name: "Review SQL (1)" }),
    ).toBeInTheDocument();
  });

  it("canceling an edit reverts to read-only mode", async () => {
    await act(async () => {
      renderPanel();
    });

    // Click edit on the "name" column
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Edit column name"));
    });

    // Cancel edit
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Cancel editing name"));
    });

    // Should no longer show editable inputs
    expect(
      screen.queryByLabelText("Data type for name"),
    ).not.toBeInTheDocument();
    // Review SQL button should not appear
    expect(
      screen.queryByRole("button", { name: /Review SQL/ }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Delete column
  // -----------------------------------------------------------------------
  it("clicking delete adds pending drop change and hides the column", async () => {
    await act(async () => {
      renderPanel();
    });

    // Delete the "name" column
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    // The column should be removed from the visible list
    // We still see "name" text in the column header "Name" but not as a cell
    const allNameCells = screen
      .getAllByRole("cell")
      .filter((cell) => cell.textContent === "name");
    expect(allNameCells.length).toBe(0);

    // Review SQL button should appear with count 1
    expect(
      screen.getByRole("button", { name: "Review SQL (1)" }),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Pending state tracking — multiple changes
  // -----------------------------------------------------------------------
  it("tracks multiple pending changes and shows correct count", async () => {
    await act(async () => {
      renderPanel();
    });

    // Delete "name" column
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    // Delete "org_id" column
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column org_id"));
    });

    // Should show count of 2
    expect(
      screen.getByRole("button", { name: "Review SQL (2)" }),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Confirm new column draft
  // -----------------------------------------------------------------------
  it("confirming a new column draft adds a pending add change", async () => {
    await act(async () => {
      renderPanel();
    });

    // Click Add Column
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    });

    // Fill in the draft
    const nameInput = screen.getByPlaceholderText("column_name");
    const typeInput = screen.getByPlaceholderText("varchar(255)");

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "email" } });
      fireEvent.change(typeInput, { target: { value: "varchar(255)" } });
    });

    // Confirm the draft
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Confirm add column"));
    });

    // Should show the new column as pending with "new" badge
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("new")).toBeInTheDocument();

    // Review SQL button should appear
    expect(
      screen.getByRole("button", { name: "Review SQL (1)" }),
    ).toBeInTheDocument();
  });

  it("canceling a new column draft removes the draft row", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    });

    // Should have draft row
    expect(screen.getByPlaceholderText("column_name")).toBeInTheDocument();

    // Cancel the draft
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Cancel add column"));
    });

    // Draft row should be gone
    expect(
      screen.queryByPlaceholderText("column_name"),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Review SQL modal
  // -----------------------------------------------------------------------
  it("clicking Review SQL opens a modal with SQL preview", async () => {
    await act(async () => {
      renderPanel();
    });

    // Create a pending change
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    // Click Review SQL
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // Modal should be visible
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Review SQL Changes")).toBeInTheDocument();

    // alterTable should have been called with preview_only=true
    expect(tauri.alterTable).toHaveBeenCalledWith(
      expect.objectContaining({ preview_only: true }),
    );
  });

  it("modal shows the preview SQL content", async () => {
    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE public.users DROP COLUMN name;",
    });

    await act(async () => {
      renderPanel();
    });

    // Create a pending change
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    // Click Review SQL
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // The SQL should appear in the modal. SqlSyntax tokenises the SQL into
    // multiple <span>s, so assert against the preview <pre>'s textContent.
    const preview = screen
      .getByRole("dialog")
      .querySelector("pre") as HTMLPreElement | null;
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toBe(
      "ALTER TABLE public.users DROP COLUMN name;",
    );
  });

  // -----------------------------------------------------------------------
  // Execute SQL
  // -----------------------------------------------------------------------
  it("clicking Execute in the modal runs alterTable without preview_only", async () => {
    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE public.users DROP COLUMN name;",
    });

    await act(async () => {
      renderPanel();
    });

    // Create a pending change
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    // Click Review SQL
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // Clear previous calls to isolate the execute call
    vi.mocked(tauri.alterTable).mockClear();
    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE public.users DROP COLUMN name;",
    });

    // Click Execute
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    // alterTable should have been called without preview_only (or preview_only: false)
    expect(tauri.alterTable).toHaveBeenCalledWith(
      expect.objectContaining({ preview_only: false }),
    );

    // Modal should be closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Pending changes should be cleared
    expect(
      screen.queryByRole("button", { name: /Review SQL/ }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Cancel from modal
  // -----------------------------------------------------------------------
  it("clicking Cancel in the modal clears all pending changes", async () => {
    await act(async () => {
      renderPanel();
    });

    // Create a pending change
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    // Click Review SQL
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // Click Cancel
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    // Modal should be closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Pending changes should be cleared — "name" column should reappear
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Review SQL/ }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Error handling in modal
  // -----------------------------------------------------------------------
  it("shows error in modal when preview fails", async () => {
    vi.mocked(tauri.alterTable).mockRejectedValue(new Error("Preview failed"));

    await act(async () => {
      renderPanel();
    });

    // Create a pending change
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    // Click Review SQL
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // Error should appear — String(new Error(...)) includes "Error: "
    expect(screen.getByText("Error: Preview failed")).toBeInTheDocument();
  });

  it("shows error in modal when execute fails and keeps modal open", async () => {
    vi.mocked(tauri.alterTable)
      .mockResolvedValueOnce({ sql: "ALTER TABLE users DROP COLUMN name;" })
      .mockRejectedValueOnce(new Error("Execute failed"));

    await act(async () => {
      renderPanel();
    });

    // Create a pending change
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    // Click Review SQL (first call returns SQL)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // Click Execute (second call fails)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    // Modal should still be open with error
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Error: Execute failed")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Actions column header
  // -----------------------------------------------------------------------
  it("renders Actions column header on columns tab", async () => {
    await act(async () => {
      renderPanel();
    });

    expect(screen.getByText("Actions")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Removing a pending add change
  // -----------------------------------------------------------------------
  it("allows removing a pending add column change", async () => {
    await act(async () => {
      renderPanel();
    });

    // Add a new column
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("column_name"), {
        target: { value: "email" },
      });
      fireEvent.change(screen.getByPlaceholderText("varchar(255)"), {
        target: { value: "varchar(255)" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Confirm add column"));
    });

    // Should show "email" with "new" badge
    expect(screen.getByText("email")).toBeInTheDocument();

    // Click the remove button for the pending add
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove pending column email"));
    });

    // The pending add should be removed
    expect(
      screen.queryByLabelText("Remove pending column email"),
    ).not.toBeInTheDocument();

    // No pending changes — no Review SQL button
    expect(
      screen.queryByRole("button", { name: /Review SQL/ }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Edit with no actual changes just cancels edit mode
  // -----------------------------------------------------------------------
  it("saving edit with no changes exits edit mode without creating pending change", async () => {
    await act(async () => {
      renderPanel();
    });

    // Click edit on the "name" column
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Edit column name"));
    });

    // Save without making any changes
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Save changes for name"));
    });

    // Should not have any pending changes
    expect(
      screen.queryByRole("button", { name: /Review SQL/ }),
    ).not.toBeInTheDocument();

    // Should be back in read-only mode
    expect(
      screen.queryByLabelText("Data type for name"),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Enter key saves edit, Escape cancels
  // -----------------------------------------------------------------------
  it("pressing Enter in edit mode saves the edit", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Edit column name"));
    });

    const dataTypeInput = screen.getByLabelText("Data type for name");
    await act(async () => {
      fireEvent.change(dataTypeInput, { target: { value: "varchar(100)" } });
    });

    // Press Enter
    await act(async () => {
      fireEvent.keyDown(dataTypeInput, { key: "Enter" });
    });

    // Should have pending change
    expect(
      screen.getByRole("button", { name: "Review SQL (1)" }),
    ).toBeInTheDocument();
  });

  it("pressing Escape in edit mode cancels the edit", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Edit column name"));
    });

    const dataTypeInput = screen.getByLabelText("Data type for name");
    await act(async () => {
      fireEvent.keyDown(dataTypeInput, { key: "Escape" });
    });

    // Should be back in read-only mode with no pending changes
    expect(
      screen.queryByLabelText("Data type for name"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Review SQL/ }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // State reset on table change
  // -----------------------------------------------------------------------
  it("resets editing state when table prop changes", async () => {
    const { rerender } = render(
      <StructurePanel connectionId="conn-1" table="users" schema="public" />,
    );

    await act(async () => {
      // Wait for initial render
    });

    // Create a pending change
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    expect(
      screen.getByRole("button", { name: "Review SQL (1)" }),
    ).toBeInTheDocument();

    // Rerender with a different table
    await act(async () => {
      rerender(
        <StructurePanel connectionId="conn-1" table="orders" schema="public" />,
      );
    });

    // Pending changes should be cleared
    expect(
      screen.queryByRole("button", { name: /Review SQL/ }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Escape closes the modal
  // -----------------------------------------------------------------------
  it("pressing Escape closes the SQL preview modal", async () => {
    await act(async () => {
      renderPanel();
    });

    // Create a pending change and open modal
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Press Escape
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Execute disabled when no SQL preview content
  // -----------------------------------------------------------------------
  it("Execute button is disabled when SQL preview is empty and loading", async () => {
    // Make alterTable hang so loading is true
    vi.mocked(tauri.alterTable).mockReturnValue(new Promise(() => {}));

    await act(async () => {
      renderPanel();
    });

    // Create a pending change and open modal
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // Execute button should be disabled while loading
    const executeBtn = screen.getByRole("button", { name: "Executing..." });
    expect(executeBtn).toBeDisabled();
  });

  // -----------------------------------------------------------------------
  // Successful execute refreshes columns
  // -----------------------------------------------------------------------
  it("refreshes column data after successful execute", async () => {
    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE users DROP COLUMN name;",
    });

    await act(async () => {
      renderPanel();
    });

    const initialFetchCount = mockGetTableColumns.mock.calls.length;

    // Create a pending change and execute it
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE users DROP COLUMN name;",
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    // Should have fetched columns again
    expect(mockGetTableColumns.mock.calls.length).toBeGreaterThan(
      initialFetchCount,
    );
  });

  // =======================================================================
  // INDEX CRUD TESTS
  // =======================================================================

  // -----------------------------------------------------------------------
  // AC-01: Create Index button visible on indexes tab
  // -----------------------------------------------------------------------
  it("renders Create Index button on indexes tab", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(
      screen.getByRole("button", { name: "Create index" }),
    ).toBeInTheDocument();
  });

  it("does not render Create Index button on columns tab", async () => {
    await act(async () => {
      renderPanel();
    });

    expect(
      screen.queryByRole("button", { name: "Create index" }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-02: Create Index modal opens with form fields
  // -----------------------------------------------------------------------
  it("clicking Create Index opens a modal with form fields", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create index" }));
    });

    expect(
      screen.getByRole("dialog", { name: "Create Index" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Index name")).toBeInTheDocument();
    expect(screen.getByLabelText("Index type")).toBeInTheDocument();
    expect(screen.getByText("Unique")).toBeInTheDocument();
  });

  it("modal shows available columns as checkboxes", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create index" }));
    });

    // The modal fetches columns and displays them with data type in parentheses
    // Use the dialog-scoped query to avoid conflicts with the table behind
    const dialog = screen.getByRole("dialog", { name: "Create Index" });
    expect(dialog).toBeInTheDocument();
    // The column checkboxes are present in the modal
    const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThanOrEqual(3);
  });

  it("closing the modal works", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create index" }));
    });

    expect(
      screen.getByRole("dialog", { name: "Create Index" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    });

    expect(
      screen.queryByRole("dialog", { name: "Create Index" }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-03: Create index preview and execute flow
  // -----------------------------------------------------------------------
  it("submitting create index form shows SQL preview then executes", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create index" }));
    });

    // Fill the form
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Index name"), {
        target: { value: "idx_email" },
      });
    });

    // Select a column checkbox - find the label containing "name" in the column list
    const columnCheckboxes = screen.getAllByRole("checkbox");
    // Find the checkbox next to "name" column text
    const nameCheckbox = columnCheckboxes.find((cb) =>
      cb.closest("label")?.textContent?.includes("name"),
    );
    expect(nameCheckbox).toBeTruthy();
    await act(async () => {
      fireEvent.click(nameCheckbox!);
    });

    // Click Preview SQL
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview SQL" }));
    });

    // createIndex should have been called with preview_only=true
    expect(tauri.createIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        index_name: "idx_email",
        preview_only: true,
      }),
    );

    // The form modal should close and SQL preview modal should open
    expect(
      screen.queryByRole("dialog", { name: "Create index" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // The SQL preview should be visible. SqlSyntax tokenises the SQL into
    // multiple <span>s, so assert against the preview <pre>'s textContent.
    const preview = screen
      .getByRole("dialog")
      .querySelector("pre") as HTMLPreElement | null;
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toBe(
      "CREATE INDEX idx_name ON public.users (name);",
    );

    // Clear previous calls
    vi.mocked(tauri.createIndex).mockClear();
    vi.mocked(tauri.createIndex).mockResolvedValue({
      sql: "CREATE INDEX idx_email ON public.users (name);",
    });

    // Click Execute
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    // createIndex should have been called with preview_only=false
    expect(tauri.createIndex).toHaveBeenCalledWith(
      expect.objectContaining({ preview_only: false }),
    );

    // Modal should be closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-04: Index row delete action
  // -----------------------------------------------------------------------
  it("non-primary indexes have a delete button visible on hover", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    // Non-primary index should have delete button
    expect(
      screen.getByLabelText("Delete index users_name_idx"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Delete index users_email_uniq"),
    ).toBeInTheDocument();
  });

  it("primary key indexes do not have a delete button", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    // Primary key index should NOT have delete button
    expect(
      screen.queryByLabelText("Delete index users_pkey"),
    ).not.toBeInTheDocument();
  });

  it("clicking delete on an index shows SQL preview modal", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete index users_name_idx"));
    });

    // dropIndex should have been called with preview_only=true
    expect(tauri.dropIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        index_name: "users_name_idx",
        preview_only: true,
      }),
    );

    // SQL preview modal should open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Review SQL Changes")).toBeInTheDocument();
  });

  it("executing drop index calls dropIndex without preview_only", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete index users_name_idx"));
    });

    // Clear the preview call
    vi.mocked(tauri.dropIndex).mockClear();
    vi.mocked(tauri.dropIndex).mockResolvedValue({
      sql: "DROP INDEX users_name_idx;",
    });

    // Click Execute
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    // dropIndex should have been called with preview_only=false
    expect(tauri.dropIndex).toHaveBeenCalledWith(
      expect.objectContaining({ preview_only: false }),
    );

    // Modal should close
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("canceling drop index closes the modal", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete index users_name_idx"));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Index Actions column header
  // -----------------------------------------------------------------------
  it("renders Actions column header on indexes tab", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    // Indexes table should have Actions header
    const headers = screen.getAllByRole("columnheader");
    const actionsHeader = headers.find((h) => h.textContent === "Actions");
    expect(actionsHeader).toBeTruthy();
  });

  // =======================================================================
  // CONSTRAINT CRUD TESTS
  // =======================================================================

  // -----------------------------------------------------------------------
  // AC-05: Add Constraint button visible on constraints tab
  // -----------------------------------------------------------------------
  it("renders Add Constraint button on constraints tab", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    expect(
      screen.getByRole("button", { name: "Add constraint" }),
    ).toBeInTheDocument();
  });

  it("does not render Add Constraint button on columns tab", async () => {
    await act(async () => {
      renderPanel();
    });

    expect(
      screen.queryByRole("button", { name: "Add constraint" }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-06: Add Constraint modal with dynamic fields
  // -----------------------------------------------------------------------
  it("clicking Add Constraint opens a modal with form fields", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    });

    expect(
      screen.getByRole("dialog", { name: "Add Constraint" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Constraint name")).toBeInTheDocument();
    expect(screen.getByLabelText("Constraint type")).toBeInTheDocument();
  });

  it("selecting FOREIGN KEY shows reference fields", async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    });

    // Sprint-112: Radix Select migration — open the constraint type
    // trigger and click the FOREIGN KEY option.
    const trigger = screen.getByLabelText("Constraint type");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "FOREIGN KEY" }));

    expect(screen.getByLabelText("Reference table")).toBeInTheDocument();
    expect(screen.getByLabelText("Reference columns")).toBeInTheDocument();
  });

  it("selecting CHECK shows expression field", async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    });

    // Sprint-112: Radix Select migration — open the constraint type
    // trigger and click the CHECK option.
    const trigger = screen.getByLabelText("Constraint type");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "CHECK" }));

    expect(screen.getByLabelText("Check expression")).toBeInTheDocument();
  });

  it("selecting UNIQUE shows column checkboxes", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    });

    // Default is UNIQUE, should show column checkboxes
    // Columns are fetched on opening the modal
    const dialog = screen.getByRole("dialog", { name: "Add Constraint" });
    expect(dialog).toBeInTheDocument();
    const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThanOrEqual(3);
  });

  // -----------------------------------------------------------------------
  // AC-07: Add constraint preview and execute flow
  // -----------------------------------------------------------------------
  it("submitting add constraint form shows SQL preview then executes", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    });

    // Fill the form
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Constraint name"), {
        target: { value: "uk_email" },
      });
    });

    // Select UNIQUE type (already default) - select a column
    const columnCheckboxes = screen.getAllByRole("checkbox");
    const emailCheckbox = columnCheckboxes.find((cb) =>
      cb.closest("label")?.textContent?.includes("name"),
    );
    expect(emailCheckbox).toBeTruthy();
    await act(async () => {
      fireEvent.click(emailCheckbox!);
    });

    // Click Preview SQL
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview SQL" }));
    });

    // addConstraint should have been called with preview_only=true
    expect(tauri.addConstraint).toHaveBeenCalledWith(
      expect.objectContaining({
        constraint_name: "uk_email",
        preview_only: true,
      }),
    );

    // Form modal should close, SQL preview modal should open
    expect(
      screen.queryByRole("dialog", { name: "Add constraint" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Clear and mock execute call
    vi.mocked(tauri.addConstraint).mockClear();
    vi.mocked(tauri.addConstraint).mockResolvedValue({
      sql: "ALTER TABLE public.users ADD CONSTRAINT uk_email UNIQUE (name);",
    });

    // Click Execute
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    // addConstraint should have been called with preview_only=false
    expect(tauri.addConstraint).toHaveBeenCalledWith(
      expect.objectContaining({ preview_only: false }),
    );

    // Modal should be closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // AC-08: Constraint row delete action
  // -----------------------------------------------------------------------
  it("constraint rows have a delete button visible on hover", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    expect(
      screen.getByLabelText("Delete constraint users_pkey"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Delete constraint users_org_id_fkey"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Delete constraint users_email_notnull"),
    ).toBeInTheDocument();
  });

  it("clicking delete on a constraint shows SQL preview modal", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Delete constraint users_email_notnull"),
      );
    });

    // dropConstraint should have been called with preview_only=true
    expect(tauri.dropConstraint).toHaveBeenCalledWith(
      expect.objectContaining({
        constraint_name: "users_email_notnull",
        preview_only: true,
      }),
    );

    // SQL preview modal should open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Review SQL Changes")).toBeInTheDocument();
  });

  it("executing drop constraint calls dropConstraint without preview_only", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Delete constraint users_email_notnull"),
      );
    });

    // Clear the preview call
    vi.mocked(tauri.dropConstraint).mockClear();
    vi.mocked(tauri.dropConstraint).mockResolvedValue({
      sql: "ALTER TABLE public.users DROP CONSTRAINT users_email_notnull;",
    });

    // Click Execute
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    // dropConstraint should have been called with preview_only=false
    expect(tauri.dropConstraint).toHaveBeenCalledWith(
      expect.objectContaining({ preview_only: false }),
    );

    // Modal should close
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("canceling drop constraint closes the modal", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Delete constraint users_email_notnull"),
      );
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Constraint Actions column header
  // -----------------------------------------------------------------------
  it("renders Actions column header on constraints tab", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    // Constraints table should have Actions header
    const headers = screen.getAllByRole("columnheader");
    const actionsHeader = headers.find((h) => h.textContent === "Actions");
    expect(actionsHeader).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Error handling for index/constraint operations
  // -----------------------------------------------------------------------
  it("shows error in modal when createIndex preview fails", async () => {
    vi.mocked(tauri.createIndex).mockRejectedValue(
      new Error("Index creation failed"),
    );

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create index" }));
    });

    // Fill the form minimally
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Index name"), {
        target: { value: "idx_test" },
      });
    });

    // Select a column
    const columnCheckboxes = screen.getAllByRole("checkbox");
    const nameCheckbox = columnCheckboxes.find((cb) =>
      cb.closest("label")?.textContent?.includes("name"),
    );
    await act(async () => {
      fireEvent.click(nameCheckbox!);
    });

    // Click Preview SQL - this will fail
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview SQL" }));
    });

    // Error should appear in the create index modal
    expect(
      screen.getByText("Error: Index creation failed"),
    ).toBeInTheDocument();
  });

  it("shows error in modal when dropIndex preview fails", async () => {
    vi.mocked(tauri.dropIndex).mockRejectedValue(
      new Error("Drop index failed"),
    );

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete index users_name_idx"));
    });

    // Error should appear in the preview modal
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Error: Drop index failed")).toBeInTheDocument();
  });

  it("shows error in modal when execute drop index fails", async () => {
    vi.mocked(tauri.dropIndex)
      .mockResolvedValueOnce({ sql: "DROP INDEX users_name_idx;" })
      .mockRejectedValueOnce(new Error("Execute failed"));

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete index users_name_idx"));
    });

    // Click Execute (second call fails)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    // Modal should still be open with error
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Error: Execute failed")).toBeInTheDocument();
  });

  it("shows error when dropConstraint preview fails", async () => {
    vi.mocked(tauri.dropConstraint).mockRejectedValue(
      new Error("Drop constraint failed"),
    );

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Delete constraint users_email_notnull"),
      );
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Error: Drop constraint failed"),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Preview SQL button disabled when form is invalid
  // -----------------------------------------------------------------------
  it("Preview SQL button is disabled when index form is incomplete", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create index" }));
    });

    // Preview SQL button should be disabled without required fields
    const previewBtn = screen.getByRole("button", { name: "Preview SQL" });
    expect(previewBtn).toBeDisabled();
  });

  it("Preview SQL button is disabled when constraint form is incomplete", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    });

    // Preview SQL button should be disabled without required fields
    const previewBtn = screen.getByRole("button", { name: "Preview SQL" });
    expect(previewBtn).toBeDisabled();
  });

  // =========================================================================
  // SPRINT 179 — Paradigm-aware vocabulary (AC-179-02 / AC-179-03 / AC-179-04)
  // =========================================================================
  describe("paradigm-aware vocabulary (Sprint 179)", () => {
    // Reason: AC-179-02a — paradigm="document" renders the Mongo tab
    // label ("Fields") and the Mongo Add/Empty copy delegated to
    // ColumnsEditor; the legacy RDB tab label ("Columns") is absent.
    // Mongo collection's columns endpoint returning [] is a realistic
    // fixture (StructurePanel is RDB-only-mounted today; the test
    // simulates the future paradigm="document" mount path).
    // Date: 2026-04-30.
    it('[AC-179-02a] paradigm="document" renders Mongo tab label + empty-state copy', async () => {
      mockGetTableColumns.mockResolvedValue([]);

      await act(async () => {
        render(
          <StructurePanel
            connectionId="conn-1"
            table="users"
            schema="public"
            paradigm="document"
          />,
        );
      });

      // Tab label is "Fields" (dictionary's document.units).
      expect(screen.getByRole("tab", { name: "Fields" })).toBeInTheDocument();
      // RDB tab label "Columns" is absent.
      expect(
        screen.queryByRole("tab", { name: "Columns" }),
      ).not.toBeInTheDocument();
      // Editor empty-state delegates to ColumnsEditor with paradigm prop.
      expect(screen.getByText("No fields found")).toBeInTheDocument();
      expect(screen.queryByText("No columns found")).not.toBeInTheDocument();
    });

    // Reason: AC-179-03a — explicit paradigm="rdb" preserves the legacy
    // tab label "Columns". Anchors the dictionary's rdb entry equals the
    // existing literal. Date: 2026-04-30.
    it("[AC-179-03a] paradigm=\"rdb\" renders the legacy 'Columns' tab", async () => {
      mockGetTableColumns.mockReturnValue(new Promise(() => {}));

      render(
        <StructurePanel
          connectionId="conn-1"
          table="users"
          schema="public"
          paradigm="rdb"
        />,
      );

      expect(screen.getByRole("tab", { name: "Columns" })).toBeInTheDocument();
    });

    // Reason: AC-179-04a — paradigm prop missing/undefined falls back to
    // the RDB dictionary entry (tab label "Columns"). Component-level
    // fence; the dictionary-level fence is in paradigm-vocabulary.test.ts.
    // Date: 2026-04-30.
    it("[AC-179-04a] paradigm undefined falls back to 'Columns' tab", async () => {
      mockGetTableColumns.mockReturnValue(new Promise(() => {}));

      // Render without the prop entirely.
      render(
        <StructurePanel connectionId="conn-1" table="users" schema="public" />,
      );

      expect(screen.getByRole("tab", { name: "Columns" })).toBeInTheDocument();
    });
  });
});
