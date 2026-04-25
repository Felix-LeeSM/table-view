import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DataGridToolbar from "./DataGridToolbar";
import type { SortInfo, TableData } from "@/types/schema";

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

function renderToolbar(overrides: Partial<typeof defaultProps> = {}) {
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
