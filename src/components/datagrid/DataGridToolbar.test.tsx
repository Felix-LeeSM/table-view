import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DOCUMENT_LABELS } from "@/lib/strings/document";
import type { SortInfo, TableData } from "@/types/schema";
import DataGridToolbar, { type DataGridToolbarProps } from "./DataGridToolbar";

const MOCK_DATA: TableData = {
  columns: [
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
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

const defaultProps = {
  data: MOCK_DATA,
  schema: "public",
  table: "users",
  page: 1,
  pageSize: 100,
  totalPages: 1,
  sorts: [] as SortInfo[],
  activeFilterCount: 0,
  showFilters: false,
  hasPendingChanges: false,
  isCommitFlashing: false,
  pendingEditsSize: 0,
  pendingNewRowsCount: 0,
  pendingDeletedRowKeysSize: 0,
  selectedRowIdsCount: 0,
  onSetPage: vi.fn(),
  onSetPageSize: vi.fn(),
  onToggleFilters: vi.fn(),
  showQuickLook: false,
  onToggleQuickLook: vi.fn(),
  onCommit: vi.fn(),
  onDiscard: vi.fn(),
  onAddRow: vi.fn(),
  onDeleteRow: vi.fn(),
  onDuplicateRow: vi.fn(),
};

function renderToolbar(overrides: Partial<DataGridToolbarProps> = {}) {
  return render(<DataGridToolbar {...defaultProps} {...overrides} />);
}

describe("DataGridToolbar — Duplicate Row button", () => {
  // AC-01: Duplicate Row button is visible
  it("renders Duplicate Row button", () => {
    renderToolbar();
    expect(
      screen.getByRole("button", { name: "Duplicate row" }),
    ).toBeInTheDocument();
  });

  // AC-01: Disabled when no rows selected
  it("is disabled when selectedRowIdsCount is 0", () => {
    renderToolbar({ selectedRowIdsCount: 0 });
    expect(
      screen.getByRole("button", { name: "Duplicate row" }),
    ).toBeDisabled();
  });

  // AC-01: Enabled when rows are selected
  it("is enabled when selectedRowIdsCount > 0", () => {
    renderToolbar({ selectedRowIdsCount: 1 });
    expect(
      screen.getByRole("button", { name: "Duplicate row" }),
    ).not.toBeDisabled();
  });

  // AC-02: Calls onDuplicateRow when clicked
  it("calls onDuplicateRow when clicked with selected rows", () => {
    const onDuplicateRow = vi.fn();
    renderToolbar({ selectedRowIdsCount: 2, onDuplicateRow });

    fireEvent.click(screen.getByRole("button", { name: "Duplicate row" }));

    expect(onDuplicateRow).toHaveBeenCalledTimes(1);
  });

  // Does not call onDuplicateRow when disabled
  it("does not call onDuplicateRow when button is disabled", () => {
    const onDuplicateRow = vi.fn();
    renderToolbar({ selectedRowIdsCount: 0, onDuplicateRow });

    const btn = screen.getByRole("button", { name: "Duplicate row" });
    expect(btn).toBeDisabled();
    // Clicking a disabled button should not fire the handler
    fireEvent.click(btn);
    expect(onDuplicateRow).not.toHaveBeenCalled();
  });

  it("does not expose row-write controls when row editing is unsupported", () => {
    renderToolbar({
      canEditRows: false,
      hasPendingChanges: true,
      selectedRowIdsCount: 1,
      onUndo: vi.fn(),
      canUndo: true,
    });

    expect(
      screen.queryByRole("button", { name: "Add row" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete row" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Duplicate row" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Commit changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Undo a pending edit, or re-stage the last commit's values",
      }),
    ).not.toBeInTheDocument();
  });
});

// Cmd+S immediate visual feedback. The Commit button must advertise an
// aria-busy/data-committing state and swap its icon for a spinner when the
// flashing flag is on.
describe("DataGridToolbar — Sprint 98 commit flashing", () => {
  it("shows the Commit button in non-busy state when isCommitFlashing is false", () => {
    renderToolbar({ hasPendingChanges: true, isCommitFlashing: false });
    const btn = screen.getByRole("button", { name: "Commit changes" });
    // Without the flash, no aria-busy / data-committing markers — the
    // baseline rendering matches callers that have never opted into the
    // prop.
    expect(btn).not.toHaveAttribute("aria-busy", "true");
    expect(btn).not.toHaveAttribute("data-committing", "true");
  });

  it("renders aria-busy + data-committing + spinner when isCommitFlashing is true", () => {
    const { container } = renderToolbar({
      hasPendingChanges: true,
      isCommitFlashing: true,
    });
    const btn = screen.getByRole("button", { name: "Commit changes" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAttribute("data-committing", "true");
    // Loader2 is a lucide-react SVG with the `animate-spin` class — query the
    // button subtree directly so we don't depend on lucide's internal data
    // attributes (they change between major versions).
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });
});

// ADR 0022 — Toolbar Undo button, mapped to AC-249-T1..T3. The button is a
// discoverability surface for users who don't know the Cmd+Z binding wired
// in DataGrid.
describe("DataGridToolbar — Sprint 249 Undo button (AC-249-T1..T3)", () => {
  it("[AC-249-T1] canUndo=true → Undo button is enabled", () => {
    const onUndo = vi.fn();
    renderToolbar({ onUndo, canUndo: true });
    const btn = screen.getByRole("button", {
      name: "Undo a pending edit, or re-stage the last commit's values",
    });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("[AC-249-T2] canUndo=false → Undo button is disabled", () => {
    const onUndo = vi.fn();
    renderToolbar({ onUndo, canUndo: false });
    const btn = screen.getByRole("button", {
      name: "Undo a pending edit, or re-stage the last commit's values",
    });
    expect(btn).toBeDisabled();
  });

  it("[AC-249-T3] click → onUndo is called once", () => {
    const onUndo = vi.fn();
    renderToolbar({ onUndo, canUndo: true });
    const btn = screen.getByRole("button", {
      name: "Undo a pending edit, or re-stage the last commit's values",
    });

    fireEvent.click(btn);

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("does not render the Undo button when onUndo is not provided", () => {
    // Document grid path: it doesn't yet wire pending undo. Without
    // an `onUndo` prop the button is intentionally absent so that
    // `canUndo` from the editState (which reflects RDB-style state)
    // can't bleed a non-functional button into the document toolbar.
    renderToolbar();
    expect(
      screen.queryByRole("button", {
        name: "Undo a pending edit, or re-stage the last commit's values",
      }),
    ).not.toBeInTheDocument();
  });
});

// Reason: AC-179-03b regression guard — DataGridToolbar's label-prop
// default is sourced from the RDB paradigm dictionary entry (lower-cased)
// instead of inline literals. The DocumentDataGrid caller still spreads
// DOCUMENT_LABELS, which is itself derived from the same dictionary's
// `document` entry. These tests anchor (a) RDB defaults produce "rows" /
// "Add row" etc., and (b) spreading DOCUMENT_LABELS produces "documents" /
// "Add document" etc. — guarding against any silent drift in the
// derivation.
describe("DataGridToolbar — Sprint 179 paradigm-aware labels (AC-179-03)", () => {
  it("[AC-179-03b] default RDB labels render legacy 'rows' / 'Add row' vocabulary", () => {
    renderToolbar();

    // Inline count label. Anchored: the pagination range added in #1061 also
    // contains "2 rows" ("1–2 of 2 rows"); the bare total stays its own node.
    expect(screen.getByText(/^2 rows$/)).toBeInTheDocument();
    // Action button accessible names — these are what the existing
    // RDB-default tests assert.
    expect(screen.getByRole("button", { name: "Add row" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete row" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Duplicate row" }),
    ).toBeInTheDocument();
  });

  it("[AC-179-03b] spreading DOCUMENT_LABELS produces 'documents' / 'Add document' vocabulary", () => {
    renderToolbar({
      ...DOCUMENT_LABELS,
      selectedRowIdsCount: 1,
    });

    // Inline count label uses lower-cased plural. Anchored: the pagination
    // range added in #1061 also embeds "2 documents" inside "1–2 of 2".
    expect(screen.getByText(/^2 documents$/)).toBeInTheDocument();
    // Action buttons use sentence-case action copy.
    expect(
      screen.getByRole("button", { name: "Add document" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete document" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Duplicate document" }),
    ).toBeInTheDocument();
  });

  // #1733 (2026-07-24) — the duplicate "Reset column widths" toolbar button
  // (Columns3) was removed. The user-visible column-width reset contract now
  // exists only as the header context menu + the resize grip double-click
  // (plus the hover title hint), and the lower layer
  // `DataGridTable/HeaderRow.reset-affordance.test.tsx` verifies it (P1:
  // lowest layer). The tests that asserted that button were deleted here —
  // the toolbar no longer owns the column-width reset concern.

  // Reason: the page input's old onChange handler called `onSetPage` on
  // every keystroke → every keystroke exploded into a fetch. The user asked
  // for "a better interface", so it was split into draft state + Enter/blur
  // commit. This regression guard covers (a) no onSetPage while typing,
  // (b) commit on Enter, (c) revert on Escape, (d) commit on blur,
  // (e) reset on invalid input.
  describe("PageJumpInput (Sprint 289)", () => {
    it("타이핑만으로는 onSetPage 를 호출하지 않는다 (draft only)", () => {
      const onSetPage = vi.fn();
      renderToolbar({ page: 1, totalPages: 10, onSetPage });
      const input = screen.getByLabelText("Jump to page");
      fireEvent.change(input, { target: { value: "5" } });
      expect(onSetPage).not.toHaveBeenCalled();
    });

    it("Enter 키 입력 시 commit", () => {
      const onSetPage = vi.fn();
      renderToolbar({ page: 1, totalPages: 10, onSetPage });
      const input = screen.getByLabelText("Jump to page");
      fireEvent.change(input, { target: { value: "7" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSetPage).toHaveBeenCalledWith(7);
    });

    it("blur 시 commit", () => {
      const onSetPage = vi.fn();
      renderToolbar({ page: 1, totalPages: 10, onSetPage });
      const input = screen.getByLabelText("Jump to page");
      fireEvent.change(input, { target: { value: "3" } });
      fireEvent.blur(input);
      expect(onSetPage).toHaveBeenCalledWith(3);
    });

    it("Escape 키 입력 시 draft 를 외부 page 로 revert (commit 없음)", () => {
      const onSetPage = vi.fn();
      renderToolbar({ page: 2, totalPages: 10, onSetPage });
      const input = screen.getByLabelText("Jump to page") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "9" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onSetPage).not.toHaveBeenCalled();
      expect(input.value).toBe("2");
    });

    it("범위 밖 입력 (0, total+1, NaN) 은 commit 없이 revert", () => {
      const onSetPage = vi.fn();
      renderToolbar({ page: 4, totalPages: 10, onSetPage });
      const input = screen.getByLabelText("Jump to page") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "99" } });
      fireEvent.blur(input);
      expect(onSetPage).not.toHaveBeenCalled();
      expect(input.value).toBe("4");
    });

    it("동일한 page commit 은 onSetPage 를 호출하지 않는다 (idempotent)", () => {
      const onSetPage = vi.fn();
      renderToolbar({ page: 3, totalPages: 10, onSetPage });
      const input = screen.getByLabelText("Jump to page");
      fireEvent.change(input, { target: { value: "3" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSetPage).not.toHaveBeenCalled();
    });
  });

  it("[AC-179-03b] DOCUMENT_LABELS literal output is unchanged byte-for-byte", () => {
    // Anchors the derived constant's literal strings so DocumentDataGrid
    // (the existing consumer at DocumentDataGrid.tsx:273-276) sees no
    // shape drift after the derivation refactor.
    expect(DOCUMENT_LABELS).toEqual({
      rowCountLabel: "documents",
      addRowLabel: "Add document",
      deleteRowLabel: "Delete document",
      duplicateRowLabel: "Duplicate document",
    });
  });
});

// Issue #6 — Discard now routes through a confirm dialog because
// `handleDiscard` wipes the entire pending entry *including the undo
// stack*, making a mis-click unrecoverable. The gate lives in the shared
// `DataGridToolbar` so both RDB and Document grids inherit it. mock scope:
// only the `onDiscard` callback (no store / hook). The dialog is the real
// reused `ConfirmDialog` primitive.
describe("DataGridToolbar — Issue #6 Discard confirmation", () => {
  it("clicking Discard does NOT call onDiscard immediately — it opens a confirm dialog", () => {
    const onDiscard = vi.fn();
    renderToolbar({ hasPendingChanges: true, onDiscard });

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    // The destructive clear must wait for explicit confirmation.
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Discard all changes?")).toBeInTheDocument();
    // Irreversibility is surfaced to the user.
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it("confirming the dialog calls onDiscard once", () => {
    const onDiscard = vi.fn();
    renderToolbar({ hasPendingChanges: true, onDiscard });

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    const dialog = screen.getByRole("alertdialog");
    // The toolbar trigger and the confirm button share the "Discard
    // changes" name, so scope to the dialog to grab the confirm action.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Discard changes" }),
    );

    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("cancelling the dialog never calls onDiscard and closes the dialog", () => {
    const onDiscard = vi.fn();
    renderToolbar({ hasPendingChanges: true, onDiscard });

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  // Controlled gate — RDB drives `discardConfirmOpen` so its Escape shortcut
  // opens the *same* dialog. Here we assert the parent-controlled path:
  // opening via the prop, and confirm/cancel routing back through the
  // parent's callbacks (identical outcome to the local uncontrolled path).
  it("renders the gate from `discardConfirmOpen` without a button click", () => {
    renderToolbar({
      hasPendingChanges: true,
      discardConfirmOpen: true,
      onDiscardConfirmOpenChange: vi.fn(),
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("controlled confirm calls onDiscard and closes via onDiscardConfirmOpenChange(false)", () => {
    const onDiscard = vi.fn();
    const onDiscardConfirmOpenChange = vi.fn();
    renderToolbar({
      hasPendingChanges: true,
      discardConfirmOpen: true,
      onDiscard,
      onDiscardConfirmOpenChange,
    });

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Discard changes" }),
    );

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onDiscardConfirmOpenChange).toHaveBeenCalledWith(false);
  });

  it("controlled cancel keeps edits (no onDiscard) and requests close", () => {
    const onDiscard = vi.fn();
    const onDiscardConfirmOpenChange = vi.fn();
    renderToolbar({
      hasPendingChanges: true,
      discardConfirmOpen: true,
      onDiscard,
      onDiscardConfirmOpenChange,
    });

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(onDiscard).not.toHaveBeenCalled();
    expect(onDiscardConfirmOpenChange).toHaveBeenCalledWith(false);
  });
});

// Issue #1061 — the toolbar showed only the page number + "/ totalPages";
// it now shows the absolute row range "X–Y of Z rows". The user must be able
// to read the absolute position of the visible rows without doing
// page×pageSize arithmetic. The range's upper bound comes from
// data.rows.length, so it stays correct on a partially filled last page.
describe("DataGridToolbar — Issue #1061 row range summary", () => {
  it("renders '1–2 of 2 rows' on the first (and only) page", () => {
    renderToolbar();
    expect(screen.getByText("1–2 of 2 rows")).toBeInTheDocument();
  });

  it("computes range from page + pageSize on a multi-page dataset", () => {
    // 100 rows on page 2 of a 1234-row, 100-per-page dataset.
    const pageRows = Array.from({ length: 100 }, (_, i) => [i + 101, `r${i}`]);
    renderToolbar({
      page: 2,
      pageSize: 100,
      totalPages: 13,
      data: {
        ...MOCK_DATA,
        rows: pageRows,
        total_count: 1234,
        page: 2,
        page_size: 100,
      },
    });
    expect(screen.getByText("101–200 of 1,234 rows")).toBeInTheDocument();
  });

  it("clamps the upper bound on a partial last page", () => {
    // 34 rows on the final page (1234 = 12*100 + 34).
    const pageRows = Array.from({ length: 34 }, (_, i) => [i + 1201, `r${i}`]);
    renderToolbar({
      page: 13,
      pageSize: 100,
      totalPages: 13,
      data: {
        ...MOCK_DATA,
        rows: pageRows,
        total_count: 1234,
        page: 13,
        page_size: 100,
      },
    });
    expect(screen.getByText("1,201–1,234 of 1,234 rows")).toBeInTheDocument();
  });

  it("honors the rowCountLabel override for document paradigm", () => {
    renderToolbar({ ...DOCUMENT_LABELS });
    expect(screen.getByText("1–2 of 2 documents")).toBeInTheDocument();
  });
});

/**
 * Issue #1734 owner decision 2 put a labelled Quick Look button with a
 * `Cmd/Ctrl+L` badge in this toolbar. #2426 moved row details into the
 * workspace bottom dock's Details tab, so the button and its badge both left
 * — the issue asked for the badge to go and the button went with it, being
 * the badge's only host. The shortcut itself did not go: `App.tsx` owns
 * `Cmd/Ctrl+L` now and `ShortcutCheatsheet` lists it.
 */
describe("DataGridToolbar — Quick Look entry point removed (#2426)", () => {
  it("[bottom-panel] renders no Quick Look button", () => {
    renderToolbar();
    expect(
      screen.queryByRole("button", { name: /toggle row details/i }),
    ).toBeNull();
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("[bottom-panel] renders no Cmd/Ctrl+L badge anywhere in the toolbar", () => {
    const { container } = renderToolbar();
    expect(screen.queryByText("Cmd/Ctrl+L")).toBeNull();
    // The badge was this toolbar's only `<kbd>`; a leftover one would mean
    // some other control picked up a shortcut caption.
    expect(container.querySelectorAll("kbd")).toHaveLength(0);
  });
});
