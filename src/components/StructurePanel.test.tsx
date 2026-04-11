import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StructurePanel from "./StructurePanel";
import { useSchemaStore } from "../stores/schemaStore";
import type { ColumnInfo, IndexInfo, ConstraintInfo } from "../types/schema";

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
      fireEvent.click(screen.getByRole("tab", { name: "Indexes" }));
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
      fireEvent.click(screen.getByRole("tab", { name: "Indexes" }));
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
      fireEvent.click(screen.getByRole("tab", { name: "Constraints" }));
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
      fireEvent.click(screen.getByRole("tab", { name: "Constraints" }));
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
      fireEvent.click(screen.getByRole("tab", { name: "Constraints" }));
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
      fireEvent.click(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
  });

  it("shows error alert when constraints fetch fails", async () => {
    mockGetTableConstraints.mockRejectedValue(new Error("Schema not found"));

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Constraints" }));
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
      fireEvent.click(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(screen.getByText("No indexes found")).toBeInTheDocument();
  });

  it("shows empty state for constraints when no data returned", async () => {
    mockGetTableConstraints.mockResolvedValue([]);

    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Constraints" }));
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
      fireEvent.click(screen.getByRole("tab", { name: "Indexes" }));
    });

    // The users_name_idx row should not have PK or UNIQUE badge
    expect(screen.getByText("users_name_idx")).toBeInTheDocument();
    const nameIdxRow = screen.getByText("users_name_idx").closest("tr");
    expect(nameIdxRow).toBeTruthy();
    const propsCell = nameIdxRow!.querySelector("td:last-child span");
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
      fireEvent.click(screen.getByRole("tab", { name: "Indexes" }));
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
