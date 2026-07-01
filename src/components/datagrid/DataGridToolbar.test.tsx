import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import DataGridToolbar, { type DataGridToolbarProps } from "./DataGridToolbar";
import type { SortInfo, TableData } from "@/types/schema";
import { DOCUMENT_LABELS } from "@/lib/strings/document";

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
      screen.queryByRole("button", { name: "Undo last pending change" }),
    ).not.toBeInTheDocument();
  });
});

// Sprint 98 — Cmd+S immediate visual feedback. The Commit button must
// advertise an aria-busy/data-committing state and swap its icon for a
// spinner when the flashing flag is on.
describe("DataGridToolbar — Sprint 98 commit flashing", () => {
  it("shows the Commit button in non-busy state when isCommitFlashing is false", () => {
    renderToolbar({ hasPendingChanges: true, isCommitFlashing: false });
    const btn = screen.getByRole("button", { name: "Commit changes" });
    // Without the flash, no aria-busy / data-committing markers — the
    // baseline rendering matches sprint-79 / sprint-93 callers that have
    // never opted into the new prop.
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

// Sprint 249 (ADR 0022 Phase 5) — Toolbar Undo button. Maps to
// AC-249-T1..T3 from `docs/sprints/sprint-249/contract.md`. The button
// is a discoverability surface for users who don't know the Cmd+Z
// binding wired in DataGrid. Date 2026-05-09.
describe("DataGridToolbar — Sprint 249 Undo button (AC-249-T1..T3)", () => {
  it("[AC-249-T1] canUndo=true → Undo button is enabled", () => {
    const onUndo = vi.fn();
    renderToolbar({ onUndo, canUndo: true });
    const btn = screen.getByRole("button", {
      name: "Undo last pending change",
    });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("[AC-249-T2] canUndo=false → Undo button is disabled", () => {
    const onUndo = vi.fn();
    renderToolbar({ onUndo, canUndo: false });
    const btn = screen.getByRole("button", {
      name: "Undo last pending change",
    });
    expect(btn).toBeDisabled();
  });

  it("[AC-249-T3] click → onUndo is called once", () => {
    const onUndo = vi.fn();
    renderToolbar({ onUndo, canUndo: true });
    const btn = screen.getByRole("button", {
      name: "Undo last pending change",
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
      screen.queryByRole("button", { name: "Undo last pending change" }),
    ).not.toBeInTheDocument();
  });
});

// Reason: Sprint 179 (AC-179-03b) regression guard — DataGridToolbar's
// label-prop default is now sourced from the RDB paradigm dictionary
// entry (lower-cased) instead of inline literals. The DocumentDataGrid
// caller still spreads DOCUMENT_LABELS, which is itself derived from the
// same dictionary's `document` entry. These tests anchor (a) RDB defaults
// produce "rows" / "Add row" etc., and (b) spreading DOCUMENT_LABELS
// produces "documents" / "Add document" etc. — guarding against any
// silent drift in the derivation. Date: 2026-04-30.
describe("DataGridToolbar — Sprint 179 paradigm-aware labels (AC-179-03)", () => {
  it("[AC-179-03b] default RDB labels render legacy 'rows' / 'Add row' vocabulary", () => {
    renderToolbar();

    // Inline count label.
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    // Action button accessible names — these are what the existing
    // RDB-default Sprint 79/93/98 tests assert.
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

    // Inline count label uses lower-cased plural.
    expect(screen.getByText(/2 documents/)).toBeInTheDocument();
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

  describe("Sprint 238 AC-238-12 — Reset column widths button", () => {
    it("renders the Reset column widths button when onResetColumnWidths is provided", () => {
      renderToolbar({ onResetColumnWidths: vi.fn() });
      expect(
        screen.getByRole("button", { name: /reset column widths/i }),
      ).toBeInTheDocument();
    });

    it("invokes onResetColumnWidths on click", () => {
      const handler = vi.fn();
      renderToolbar({ onResetColumnWidths: handler });
      fireEvent.click(
        screen.getByRole("button", { name: /reset column widths/i }),
      );
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("does not render the button when onResetColumnWidths is omitted", () => {
      renderToolbar();
      expect(
        screen.queryByRole("button", { name: /reset column widths/i }),
      ).not.toBeInTheDocument();
    });
  });

  // 작성 이유 (2026-05-13, Sprint 289): 종전 page input 의 onChange 핸들러가
  // 매 키스트로크마다 `onSetPage` 를 호출 → 매번 fetch 가 폭발. 사용자가
  // "더 나은 인터페이스" 를 요구해 draft state + Enter/blur commit 으로 분리.
  // 본 회귀 가드는 (a) 타이핑 중 onSetPage 안 부름 (b) Enter 시 commit
  // (c) Escape 시 revert (d) blur 시 commit (e) invalid 입력 reset.
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
    // shape drift after Sprint 179's derivation refactor.
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
