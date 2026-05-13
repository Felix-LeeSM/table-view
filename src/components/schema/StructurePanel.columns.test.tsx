// Sprint 220 — `columns` axis split from `StructurePanel.test.tsx` (P11
// step 3). Covers the Column-CRUD behaviour: Add Column / inline edit /
// cancel / save / delete / multiple pending changes / Review SQL modal /
// Execute / Cancel / preview-and-execute error / Actions header /
// Enter-Escape keys / Escape closes modal / refresh after execute /
// table prop reset / pending-add removal.
//
// Sprint 236 (AC-236-04 / AC-236-05 / AC-236-07 / AC-236-08) — `+ Column`
// toolbar button + per-row trash icon now open `AddColumnDialog` /
// `DropColumnDialog` modals (no inline NewColumnDraft, no trash-as-
// pending-drop). The inline-batched MODIFY path (Edit pencil → change →
// save → Review SQL → Execute) stays UNCHANGED. Cases below are
// migrated mechanically: pending-drop tests now exercise the inline
// MODIFY path (which still flows through `pendingChanges` + alterTable),
// and inline-add NewColumnRow assertions are replaced with modal-mount
// assertions. The dialog internals themselves are exhaustively covered
// by `AddColumnDialog.test.tsx` / `DropColumnDialog.test.tsx`.
// Date: 2026-05-07.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StructurePanel from "./StructurePanel";
import * as tauri from "@lib/tauri";
import {
  mockGetTableColumns,
  renderPanel,
  resetStructurePanelMocks,
} from "./__tests__/structurePanelTestHelpers";
import { invalidatePostgresTypesCache } from "@hooks/usePostgresTypes";

// Helper: drives the inline-MODIFY path (Edit pencil → change data_type
// → save) so a pending change is queued without using the trash icon.
// The trash icon now opens `DropColumnDialog` which writes through
// `onRefresh` directly — it doesn't push pendingChanges anymore.
async function queuePendingModifyForName(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Edit column name"));
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Data type for name"), {
      target: { value: "varchar(255)" },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Save changes for name"));
  });
}

describe("StructurePanel", () => {
  beforeEach(() => {
    resetStructurePanelMocks();
    invalidatePostgresTypesCache("conn-1");
    // Sprint 236 — modal IPC stubs so the dialogs that ColumnsEditor
    // mounts unconditionally (`<AddColumnDialog>`) don't trip on
    // missing tauri exports during initial render.
    vi.spyOn(tauri, "addColumnRequest").mockResolvedValue({
      sql: 'ALTER TABLE "public"."users" ADD COLUMN "email" varchar(255)',
    });
    vi.spyOn(tauri, "dropColumnRequest").mockResolvedValue({
      sql: 'ALTER TABLE "public"."users" DROP COLUMN "name"',
    });
    vi.spyOn(tauri, "listPostgresTypes").mockResolvedValue([]);
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

  // Sprint 236 — `+ Column` no longer adds an inline editable empty row;
  // it now opens `<AddColumnDialog>`. The new assertion is the dialog's
  // identifying input (`Column name`) is visible after the click.
  it("[AC-236-04] clicking Add Column opens AddColumnDialog", async () => {
    await act(async () => {
      renderPanel();
    });

    // Initially 3 column rows + header
    expect(screen.getAllByRole("row").length).toBe(4);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    });

    // Modal mounted — its `Column name` input is now visible.
    expect(screen.getByLabelText("Column name")).toBeInTheDocument();
    // No new editable empty row was inserted into the table — the
    // legacy inline-add `Confirm add column` button is REMOVED.
    expect(
      screen.queryByLabelText("Confirm add column"),
    ).not.toBeInTheDocument();
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

    await queuePendingModifyForName();

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
  // Delete column — Sprint 236 reroutes the trash icon to the
  // `DropColumnDialog` modal. The legacy "trash → pendingChanges →
  // Review SQL" surface is gone. Test now asserts the dialog mount.
  // -----------------------------------------------------------------------
  it("[AC-236-05] clicking delete opens DropColumnDialog", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });

    // The DropColumnDialog mounted — its typing-confirm input is the
    // identifying surface.
    expect(
      screen.getByLabelText("Type the column name to confirm"),
    ).toBeInTheDocument();
    // No pendingChanges pushed by the click — Review SQL button absent.
    expect(
      screen.queryByRole("button", { name: /Review SQL/ }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Pending state tracking — multiple changes (Sprint 236 migrated to
  // inline-MODIFY: edit two columns to data_type changes).
  // -----------------------------------------------------------------------
  it("tracks multiple pending changes and shows correct count", async () => {
    await act(async () => {
      renderPanel();
    });

    // Modify "name" column data_type
    await queuePendingModifyForName();

    // Modify "org_id" column data_type
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Edit column org_id"));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Data type for org_id"), {
        target: { value: "integer" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Save changes for org_id"));
    });

    // Should show count of 2
    expect(
      screen.getByRole("button", { name: "Review SQL (2)" }),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Sprint 236 — confirming/canceling the inline-add draft is gone (the
  // inline NewColumnRow component was removed). The corresponding
  // `Confirm add column` / `Cancel add column` aria-labels no longer
  // exist. The new contract: clicking `+ Column` mounts
  // `AddColumnDialog`. The dialog's own internals (commit / cancel /
  // form validation) are exhaustively covered by AddColumnDialog.test.
  // -----------------------------------------------------------------------
  it("[AC-236-04] AddColumnDialog Cancel closes the modal", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    });

    // Modal mounted.
    expect(screen.getByLabelText("Column name")).toBeInTheDocument();

    // Click the dialog's Cancel button.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    // Modal closed.
    expect(screen.queryByLabelText("Column name")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Review SQL modal — Sprint 236 migrated the trigger to the inline
  // MODIFY path. The Review SQL → Execute → preview/execute lifecycle
  // is unchanged.
  // -----------------------------------------------------------------------
  it("clicking Review SQL opens a modal with SQL preview", async () => {
    await act(async () => {
      renderPanel();
    });

    // Create a pending change (inline-MODIFY).
    await queuePendingModifyForName();

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
      sql: "ALTER TABLE public.users ALTER COLUMN name TYPE varchar(255);",
    });

    await act(async () => {
      renderPanel();
    });

    await queuePendingModifyForName();

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
      "ALTER TABLE public.users ALTER COLUMN name TYPE varchar(255);",
    );
  });

  // -----------------------------------------------------------------------
  // Execute SQL
  // -----------------------------------------------------------------------
  it("clicking Execute in the modal runs alterTable without preview_only", async () => {
    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE public.users ALTER COLUMN name TYPE varchar(255);",
    });

    await act(async () => {
      renderPanel();
    });

    await queuePendingModifyForName();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // Clear previous calls to isolate the execute call
    vi.mocked(tauri.alterTable).mockClear();
    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE public.users ALTER COLUMN name TYPE varchar(255);",
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

    await queuePendingModifyForName();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // Click Cancel
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    // Modal should be closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Pending changes should be cleared. The "name" column row is still
    // visible (modify path doesn't hide the row).
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Review SQL/ }),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Error handling in modal
  // -----------------------------------------------------------------------
  it("shows error in modal when preview fails", async () => {
    await act(async () => {
      renderPanel();
    });

    // Now stage a MODIFY and arrange the next alterTable call to
    // reject — the preview fetch will surface the error.
    await queuePendingModifyForName();
    vi.mocked(tauri.alterTable).mockRejectedValueOnce(
      new Error("Preview failed"),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // Error should appear — Sprint 271c switched useDdlPreviewExecution to
    // surface `err.message` (so parseDbMismatch's `^Database mismatch:` anchor
    // can match), dropping the legacy `"Error: "` prefix from `String(e)`.
    expect(screen.getByText("Preview failed")).toBeInTheDocument();
  });

  it("shows error in modal when execute fails and keeps modal open", async () => {
    await act(async () => {
      renderPanel();
    });

    await queuePendingModifyForName();

    // Arrange: preview succeeds (returns SQL), execute fails.
    vi.mocked(tauri.alterTable)
      .mockResolvedValueOnce({
        sql: "ALTER TABLE users ALTER COLUMN name TYPE varchar(255);",
      })
      .mockRejectedValueOnce(new Error("Execute failed"));

    // Click Review SQL (first call returns SQL)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    // Click Execute (second call fails)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    // Modal should still be open with error (Sprint 271c: bare err.message).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Execute failed")).toBeInTheDocument();
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
  // Sprint 236 — pending-add removal (`Remove pending column email`) is
  // gone with the inline NewColumnDraft surface. The replacement
  // contract is the AddColumnDialog Cancel button (covered above).
  // -----------------------------------------------------------------------

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
      <StructurePanel
        connectionId="conn-1"
        database="db-1"
        table="users"
        schema="public"
      />,
    );

    await act(async () => {
      // Wait for initial render
    });

    // Create a pending change via the inline-MODIFY path.
    await queuePendingModifyForName();

    expect(
      screen.getByRole("button", { name: "Review SQL (1)" }),
    ).toBeInTheDocument();

    // Rerender with a different table
    await act(async () => {
      rerender(
        <StructurePanel
          connectionId="conn-1"
          database="db-1"
          table="orders"
          schema="public"
        />,
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

    await queuePendingModifyForName();

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
    await act(async () => {
      renderPanel();
    });

    // Stage a pending MODIFY before swapping the alterTable mock to a
    // hanging promise so the preview stays in `loading=true`.
    await queuePendingModifyForName();
    vi.mocked(tauri.alterTable).mockReturnValue(new Promise(() => {}));

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
      sql: "ALTER TABLE users ALTER COLUMN name TYPE varchar(255);",
    });

    await act(async () => {
      renderPanel();
    });

    const initialFetchCount = mockGetTableColumns.mock.calls.length;

    // Stage and execute a MODIFY change.
    await queuePendingModifyForName();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review SQL (1)" }));
    });

    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE users ALTER COLUMN name TYPE varchar(255);",
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    });

    // Should have fetched columns again
    expect(mockGetTableColumns.mock.calls.length).toBeGreaterThan(
      initialFetchCount,
    );
  });

  // -----------------------------------------------------------------------
  // Sprint 236 — AC-236-08: column appears / disappears after refresh.
  // The DropColumnDialog modal commit closure calls `onColumnDropped()`
  // which the parent ColumnsEditor wires to `onRefresh` →
  // `getTableColumns`. This case asserts the refresh fires once after
  // a successful drop commit.
  // -----------------------------------------------------------------------
  it("[AC-236-08] DropColumnDialog commit triggers getTableColumns refresh", async () => {
    // Sprint 245 (ADR 0022 Phase 1) — pin Safe Mode to `warn` so the
    // destructive DROP COLUMN flows through. The default `strict` mode
    // would now open the M.1 non-production confirm dialog and short-
    // circuit the refresh-after-commit assertion.
    const { useSafeModeStore } = await import("@stores/safeModeStore");
    useSafeModeStore.setState({ mode: "warn" });
    await act(async () => {
      renderPanel();
    });

    const initialFetchCount = mockGetTableColumns.mock.calls.length;

    // Open the drop dialog.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete column name"));
    });
    // Type the column name to enable Apply.
    await act(async () => {
      fireEvent.change(
        screen.getByLabelText("Type the column name to confirm"),
        { target: { value: "name" } },
      );
    });
    // Sprint 238 — auto-debounced (250ms) preview fetch settles before
    // Apply becomes enabled. Wait for the dropColumnRequest mock to be
    // called at least once with previewOnly=true before clicking Apply.
    const dropColumnSpy = vi.mocked(tauri.dropColumnRequest);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(dropColumnSpy).toHaveBeenCalled();
    // Apply → commit closure runs → onRefresh → getTableColumns.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    expect(mockGetTableColumns.mock.calls.length).toBeGreaterThan(
      initialFetchCount,
    );
  });
});
