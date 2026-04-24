import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FilterBar from "./FilterBar";
import type { ColumnInfo, FilterCondition } from "@/types/schema";

const COLUMNS: ColumnInfo[] = [
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
];

const defaultFilter: FilterCondition = {
  column: "id",
  operator: "Eq",
  value: "",
  id: "test-uuid-1",
};

function renderFilterBar(
  overrides: Partial<Parameters<typeof FilterBar>[0]> = {},
) {
  const props = {
    columns: COLUMNS,
    filters: [defaultFilter],
    onFiltersChange: vi.fn(),
    onApply: vi.fn(),
    onClose: vi.fn(),
    onClearAll: vi.fn(),
    filterMode: "structured" as const,
    rawSql: "",
    onFilterModeChange: vi.fn(),
    onRawSqlChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<FilterBar {...props} />), props };
}

describe("FilterBar", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2, 8),
    });
  });

  // 1. Structured mode rendering
  it("renders column select, operator select, and value input in structured mode", () => {
    renderFilterBar();
    // Column selector should show column names
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2); // column + operator
    // Value input
    expect(screen.getByPlaceholderText("Value...")).toBeInTheDocument();
  });

  // 2. Raw SQL mode rendering
  it("renders SQL input field when switched to raw mode", async () => {
    renderFilterBar({ filterMode: "raw" });
    expect(screen.getByPlaceholderText(/e\.g\./)).toBeInTheDocument();
    expect(screen.getByText("Apply")).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  // 3. Auto-creates filter when columns arrive and no filters exist
  it("auto-creates one empty filter when columns arrive and filters are empty", () => {
    const onFiltersChange = vi.fn();
    renderFilterBar({ filters: [], onFiltersChange });
    // The useEffect should have called onFiltersChange with one filter
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    const created = onFiltersChange.mock.calls[0]![0] as FilterCondition[];
    expect(created).toHaveLength(1);
    expect(created[0]!.column).toBe("id");
    expect(created[0]!.operator).toBe("Eq");
  });

  // 4. Add Filter button
  it("adds a filter when Add Filter is clicked", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderFilterBar({ onFiltersChange });
    await user.click(screen.getByText("Add Filter"));
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    const newFilters = onFiltersChange.mock.calls[0]![0] as FilterCondition[];
    expect(newFilters).toHaveLength(2);
  });

  // 5. Remove button
  it("removes a filter when remove button is clicked", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    // Start with 2 filters
    const filter2: FilterCondition = {
      column: "name",
      operator: "Eq",
      value: "",
      id: "test-uuid-2",
    };
    renderFilterBar({ filters: [defaultFilter, filter2], onFiltersChange });
    const removeButtons = screen.getAllByLabelText("Remove filter");
    await user.click(removeButtons[0]!);
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    const remaining = onFiltersChange.mock.calls[0]![0] as FilterCondition[];
    expect(remaining).toHaveLength(1);
  });

  // 6. Clear All
  it("calls onFiltersChange([]) and onClearAll when Clear All is clicked", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const onClearAll = vi.fn();
    renderFilterBar({ onFiltersChange, onClearAll });
    await user.click(screen.getByText("Clear All"));
    expect(onFiltersChange).toHaveBeenCalledWith([]);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  // 7. IS NULL hides value input
  it("hides value input when IS NULL operator is selected", async () => {
    const onFiltersChange = vi.fn();
    const isNullFilter: FilterCondition = {
      column: "id",
      operator: "IsNull",
      value: null,
      id: "test-uuid-1",
    };
    renderFilterBar({ filters: [isNullFilter], onFiltersChange });
    // Value input should not be present
    expect(screen.queryByPlaceholderText("Value...")).not.toBeInTheDocument();
  });

  // 8. IS NOT NULL hides value input
  it("hides value input when IS NOT NULL operator is selected", () => {
    const isNotNullFilter: FilterCondition = {
      column: "id",
      operator: "IsNotNull",
      value: null,
      id: "test-uuid-1",
    };
    renderFilterBar({ filters: [isNotNullFilter] });
    expect(screen.queryByPlaceholderText("Value...")).not.toBeInTheDocument();
  });

  // 9. Switching to IS NULL sets value to null
  it("sets value to null when switching operator to IS NULL", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const filterWithValue: FilterCondition = {
      column: "id",
      operator: "Eq",
      value: "42",
      id: "test-uuid-1",
    };
    renderFilterBar({ filters: [filterWithValue], onFiltersChange });

    // Find the operator select (second combobox)
    const selects = screen.getAllByRole("combobox");
    const operatorSelect = selects[1]!; // second select is operator
    await user.selectOptions(operatorSelect, "IsNull");

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    const updated = onFiltersChange.mock.calls[0]![0] as FilterCondition[];
    expect(updated[0]!.operator).toBe("IsNull");
    expect(updated[0]!.value).toBeNull();
  });

  // 10. Apply button calls onApply
  it("calls onApply when Apply button is clicked", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderFilterBar({ onApply });
    await user.click(screen.getByText("Apply"));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  // 11. Raw SQL mode Enter key validates and applies
  it("applies on Enter with valid raw SQL", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onRawSqlChange = vi.fn();
    renderFilterBar({
      filterMode: "raw",
      rawSql: "id = 5",
      onApply,
      onRawSqlChange,
    });

    const input = screen.getByPlaceholderText(/e\.g\./);
    await user.type(input, "{Enter}");
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  // 12. Raw SQL mode shows error for semicolons
  it("shows error message when raw SQL contains semicolons", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onRawSqlChange = vi.fn();
    renderFilterBar({
      filterMode: "raw",
      rawSql: "id = 1; DROP TABLE",
      onApply,
      onRawSqlChange,
    });

    const input = screen.getByPlaceholderText(/e\.g\./);
    await user.type(input, "{Enter}");

    expect(
      screen.getByText("Raw WHERE clause must not contain semicolons"),
    ).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  // 13. Raw SQL Apply button validates
  it("shows error when Apply is clicked with dangerous SQL", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderFilterBar({ filterMode: "raw", rawSql: "DROP TABLE users", onApply });

    await user.click(screen.getByText("Apply"));
    expect(screen.getByText(/must not start with DROP/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  // 14. Close button calls onClose
  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderFilterBar({ onClose });

    await user.click(screen.getByLabelText("Close filter bar"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 15. Filter mode toggle switches to raw mode
  it("calls onFilterModeChange when Raw SQL button is clicked", async () => {
    const user = userEvent.setup();
    const onFilterModeChange = vi.fn();
    renderFilterBar({ onFilterModeChange });

    await user.click(screen.getByText("Raw SQL"));
    expect(onFilterModeChange).toHaveBeenCalledWith("raw");
  });

  // 16. Filter mode toggle switches to structured mode
  it("calls onFilterModeChange when Structured button is clicked", async () => {
    const user = userEvent.setup();
    const onFilterModeChange = vi.fn();
    renderFilterBar({ filterMode: "raw", onFilterModeChange });

    await user.click(screen.getByText("Structured"));
    expect(onFilterModeChange).toHaveBeenCalledWith("structured");
  });

  // 17. Value input Enter triggers onApply
  it("calls onApply when Enter is pressed in value input", async () => {
    const onApply = vi.fn();
    const filterWithValue: FilterCondition = {
      column: "id",
      operator: "Eq",
      value: "42",
      id: "test-uuid-1",
    };
    renderFilterBar({ filters: [filterWithValue], onApply });

    const input = screen.getByPlaceholderText("Value...");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  // 18. Column selector change updates filter
  it("updates column when column select is changed", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderFilterBar({ onFiltersChange });

    const selects = screen.getAllByRole("combobox");
    const columnSelect = selects[0]!;
    await user.selectOptions(columnSelect, "name");

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    const updated = onFiltersChange.mock.calls[0]![0] as FilterCondition[];
    expect(updated[0]!.column).toBe("name");
  });

  // 19. Switching from IS NULL to Eq sets value to empty string
  it("sets value to empty string when switching from IS NULL to Eq", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const isNullFilter: FilterCondition = {
      column: "id",
      operator: "IsNull",
      value: null,
      id: "test-uuid-1",
    };
    renderFilterBar({ filters: [isNullFilter], onFiltersChange });

    const selects = screen.getAllByRole("combobox");
    const operatorSelect = selects[1]!;
    await user.selectOptions(operatorSelect, "Eq");

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    const updated = onFiltersChange.mock.calls[0]![0] as FilterCondition[];
    expect(updated[0]!.operator).toBe("Eq");
    expect(updated[0]!.value).toBe("");
  });

  // 20. Value input change updates filter
  it("updates value when typing in value input", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderFilterBar({ onFiltersChange });

    const input = screen.getByPlaceholderText("Value...");
    await user.type(input, "4");

    // Should have been called for each character typed
    const lastCall = onFiltersChange.mock.calls[
      onFiltersChange.mock.calls.length - 1
    ]![0] as FilterCondition[];
    expect(lastCall[0]!.value).toBe("4");
  });

  // 21. Raw SQL Clear button resets state
  it("clears raw SQL and calls onClearAll when Clear is clicked in raw mode", async () => {
    const user = userEvent.setup();
    const onRawSqlChange = vi.fn();
    const onClearAll = vi.fn();
    renderFilterBar({
      filterMode: "raw",
      rawSql: "some text",
      onRawSqlChange,
      onClearAll,
    });

    await user.click(screen.getByText("Clear"));

    expect(onRawSqlChange).toHaveBeenCalledWith("");
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  // 22. Raw SQL input change calls onRawSqlChange
  it("calls onRawSqlChange when typing in raw SQL input", async () => {
    const user = userEvent.setup();
    const onRawSqlChange = vi.fn();
    renderFilterBar({ filterMode: "raw", rawSql: "", onRawSqlChange });

    const input = screen.getByPlaceholderText(/e\.g\./);
    await user.type(input, "a");

    expect(onRawSqlChange).toHaveBeenCalled();
  });

  // 23. No Clear All or Apply when filters are empty in structured mode
  it("hides Clear All and Apply buttons when no filters exist", () => {
    // Don't provide empty filters with columns to avoid auto-creation effect
    renderFilterBar({ filters: [], columns: [] });
    expect(screen.queryByText("Clear All")).not.toBeInTheDocument();
    // The structured Apply button (separate from raw mode)
    // With 0 filters, structured mode Apply should be hidden
    const applyButtons = screen.queryAllByText("Apply");
    expect(applyButtons).toHaveLength(0);
  });

  // 24. Value input preserves empty string when emptied (NULL vs '' distinction)
  it("preserves empty string when value input is cleared", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const filterWithValue: FilterCondition = {
      column: "id",
      operator: "Eq",
      value: "abc",
      id: "test-uuid-1",
    };
    renderFilterBar({ filters: [filterWithValue], onFiltersChange });

    const input = screen.getByPlaceholderText("Value...");
    // Clear the input by triple-clicking and typing empty
    await user.tripleClick(input);
    await user.keyboard("{Backspace}");

    const lastCall = onFiltersChange.mock.calls[
      onFiltersChange.mock.calls.length - 1
    ]![0] as FilterCondition[];
    expect(lastCall[0]!.value).toBe("");
  });

  // -----------------------------------------------------------------------
  // Sprint 48: aria-label and role="alert" for accessibility
  // -----------------------------------------------------------------------
  it("has aria-label on column and operator selects", () => {
    renderFilterBar();
    expect(screen.getByLabelText("Filter column")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter operator")).toBeInTheDocument();
  });

  it("raw SQL error div has role=alert", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderFilterBar({
      filterMode: "raw",
      rawSql: "id = 1; DROP TABLE",
      onApply,
    });

    const input = screen.getByPlaceholderText(/e\.g\./);
    await user.type(input, "{Enter}");

    const alertEl = screen.getByRole("alert");
    expect(alertEl).toBeInTheDocument();
    expect(alertEl.textContent).toContain("semicolons");
  });
});
