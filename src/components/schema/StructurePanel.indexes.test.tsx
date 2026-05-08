// Sprint 220 — `indexes` axis split from `StructurePanel.test.tsx` (P11
// step 3). Covers the Index-CRUD behaviour: Create Index button + modal
// + columns checkboxes + close / submit (preview + execute) + delete (PK
// skip / non-PK delete) + Actions header + drop modal cancel +
// createIndex preview error + dropIndex preview error + dropIndex
// execute error + Preview SQL disabled validation. Cases are
// byte-equivalent to the originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
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

  it("modal surfaces available columns as ordered-picker chips", async () => {
    await act(async () => {
      renderPanel();
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create index" }));
    });

    // Sprint 239 — replaced the multi-checkbox grid with the
    // OrderedColumnPicker. Each column surfaces as a `+ name` button
    // inside the picker; the wrapper carries `aria-label="Index column
    // picker"`. Three columns mounted by `renderPanel()` (id / name /
    // email) → three `+`-chip buttons.
    const dialog = screen.getByRole("dialog", { name: "Create Index" });
    expect(dialog).toBeInTheDocument();
    const picker = dialog.querySelector(
      '[aria-label="Index column picker"]',
    ) as HTMLElement;
    expect(picker).toBeTruthy();
    const addChips = picker.querySelectorAll(
      'button[aria-label^="Index column: "]',
    );
    expect(addChips.length).toBeGreaterThanOrEqual(3);
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

    // Sprint 239 — column picker is now an OrderedColumnPicker with `+`
    // chip buttons keyed by `aria-label="Index column: <name>"`.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Index column: name"));
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

    // Sprint 239 — column picker is now an OrderedColumnPicker.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Index column: name"));
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
});
