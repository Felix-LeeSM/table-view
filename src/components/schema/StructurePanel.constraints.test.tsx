// Sprint 220 — `constraints` axis split from `StructurePanel.test.tsx`
// (P11 step 3). Covers the Constraint-CRUD behaviour: Add Constraint
// button + dynamic modal (FK reference fields / CHECK expression /
// UNIQUE column checkboxes) + submit (preview + execute) + delete (3
// row buttons + drop modal preview/execute/cancel) + Actions header +
// dropConstraint preview error + Preview SQL disabled validation. Cases
// are byte-equivalent to the originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as tauri from "@lib/tauri";
import {
  renderPanel,
  resetStructurePanelMocks,
} from "./__tests__/structurePanelTestHelpers";

describe("StructurePanel", () => {
  beforeEach(() => {
    resetStructurePanelMocks();
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
});
