// Sprint 220 — `columns` axis split from `StructurePanel.test.tsx` (P11
// step 3). Covers the Column-CRUD behaviour: Add Column / inline edit /
// cancel / save / delete / multiple pending changes / Review SQL modal /
// Execute / Cancel / preview-and-execute error / Actions header /
// Enter-Escape keys / Escape closes modal / refresh after execute /
// table prop reset / pending-add removal. Cases are byte-equivalent to
// the originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StructurePanel from "./StructurePanel";
import * as tauri from "@lib/tauri";
import {
  mockGetTableColumns,
  renderPanel,
  resetStructurePanelMocks,
} from "./__tests__/structurePanelTestHelpers";

describe("StructurePanel", () => {
  beforeEach(() => {
    resetStructurePanelMocks();
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
});
