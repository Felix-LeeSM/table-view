import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseType } from "@/types/connection";
import type { ColumnInfo, FilterCondition } from "@/types/schema";
import FilterBar from "./FilterBar";

// #2430 — measures whether the filter operator list follows the
// connected DBMS dialect. Measuring one dialect alone would also pass
// against the base's fixed list, so the same file asserts PostgreSQL
// (has ILIKE) together with MySQL and SQLite (no ILIKE).

const COLUMNS: ColumnInfo[] = [
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

const FILTER: FilterCondition = {
  column: "name",
  operator: "Eq",
  value: "",
  id: "test-uuid-1",
};

// The shape a condition keeps after it is set on PostgreSQL and the
// connection's DBMS type is then changed.
const ILIKE_FILTER: FilterCondition = {
  column: "name",
  operator: "Ilike",
  value: "a%",
  id: "test-uuid-2",
};

function renderFilterBar(
  dbType?: DatabaseType,
  filter: FilterCondition = FILTER,
) {
  const onFiltersChange = vi.fn();
  render(
    <FilterBar
      columns={COLUMNS}
      filters={[filter]}
      onFiltersChange={onFiltersChange}
      onApply={vi.fn()}
      onClose={vi.fn()}
      onClearAll={vi.fn()}
      filterMode="structured"
      rawSql=""
      onFilterModeChange={vi.fn()}
      onRawSqlChange={vi.fn()}
      dbType={dbType}
    />,
  );
  return { onFiltersChange };
}

async function openOperatorMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Filter operator"));
  return user;
}

describe("FilterBar operator list follows the connected dialect (#2430)", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: () => `test-uuid-${Math.random().toString(36).slice(2, 8)}`,
    });
  });

  it("offers ILIKE on PostgreSQL", async () => {
    renderFilterBar("postgresql");
    await openOperatorMenu();

    expect(screen.getByRole("option", { name: "ILIKE" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "LIKE" })).toBeInTheDocument();
  });

  it("hides ILIKE on MySQL, which has no such operator", async () => {
    renderFilterBar("mysql");
    await openOperatorMenu();

    expect(screen.queryByRole("option", { name: "ILIKE" })).toBeNull();
    // Dialect-independent operators stay — the list is not emptied.
    expect(screen.getByRole("option", { name: "LIKE" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "IS NULL" })).toBeInTheDocument();
  });

  it("hides ILIKE on SQLite, which has no such operator", async () => {
    renderFilterBar("sqlite");
    await openOperatorMenu();

    expect(screen.queryByRole("option", { name: "ILIKE" })).toBeNull();
    expect(screen.getByRole("option", { name: "LIKE" })).toBeInTheDocument();
  });

  it("hides ILIKE when the connection is not readable yet", async () => {
    renderFilterBar(undefined);
    await openOperatorMenu();

    expect(screen.queryByRole("option", { name: "ILIKE" })).toBeNull();
    expect(screen.getByRole("option", { name: "LIKE" })).toBeInTheDocument();
  });

  // #2430 measured: when `dbType` changes and the currently set
  // operator drops out of the list, the trigger went blank.
  // `<SelectValue />` draws the trigger and reads its text from a
  // mounted `SelectItem`, so one extra item outside the list has to be
  // drawn for the label to survive (the same prescription as
  // `ConnectionDialogBody.tsx:463-468`).

  it("keeps the selected operator readable after the dialect drops it", () => {
    renderFilterBar("sqlite", ILIKE_FILTER);

    expect(screen.getByLabelText("Filter operator")).toHaveTextContent("ILIKE");
  });

  it("still hides the dropped operator from the dropdown", async () => {
    renderFilterBar("sqlite", ILIKE_FILTER);
    await openOperatorMenu();

    // Drawing one extra item outside the list must not widen the
    // dropdown again — that item is the single currently set operator,
    // and the rest that can be chosen is the dialect list.
    expect(screen.getAllByRole("option", { name: "ILIKE" })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "LIKE" })).toBeInTheDocument();
  });

  it("keeps the value input for an operator the dialect dropped", () => {
    renderFilterBar("sqlite", ILIKE_FILTER);

    expect(screen.getByLabelText("Filter value for name")).toBeInTheDocument();
  });

  // If the branch that draws the out-of-list item runs unconditionally,
  // an operator the dialect already offers shows up twice. This
  // assertion locks that branch's condition.
  it("does not duplicate an operator the dialect already offers", async () => {
    renderFilterBar("postgresql", ILIKE_FILTER);
    await openOperatorMenu();

    expect(screen.getAllByRole("option", { name: "ILIKE" })).toHaveLength(1);
  });

  // Measures the value that goes out as the backend enum, not the
  // label. `FilterOperator::Ilike` uses serde's default representation,
  // so the wire value is "Ilike" — if this string diverges, the
  // PostgreSQL adapter drops the whole condition.
  it("emits the Ilike wire value the backend enum expects", async () => {
    const { onFiltersChange } = renderFilterBar("postgresql");
    const user = await openOperatorMenu();

    await user.click(screen.getByRole("option", { name: "ILIKE" }));

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    const updated = onFiltersChange.mock.calls[0]![0] as FilterCondition[];
    expect(updated[0]!.operator).toBe("Ilike");
  });
});
