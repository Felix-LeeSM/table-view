import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseType } from "@/types/connection";
import type { ColumnInfo, FilterCondition } from "@/types/schema";
import FilterBar from "./FilterBar";

// #2430 — 필터 연산자 목록이 연결된 DBMS 의 방언을 따라가는지 잰다.
// 한 방언만 재면 base 의 고정 목록도 통과하므로, 같은 파일에서 PostgreSQL
// (ILIKE 있음) 과 MySQL·SQLite (없음) 을 같이 단언한다.

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

function renderFilterBar(dbType?: DatabaseType) {
  const onFiltersChange = vi.fn();
  render(
    <FilterBar
      columns={COLUMNS}
      filters={[FILTER]}
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
    // 방언 무관 연산자는 그대로 남는다 — 목록이 통째로 비는 것이 아니다.
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

  // 라벨이 아니라 백엔드 enum 으로 나가는 값을 잰다. `FilterOperator::Ilike`
  // 는 serde 기본 표기라 wire 값이 "Ilike" 다 — 이 문자열이 어긋나면
  // PostgreSQL 어댑터가 조건을 통째로 버린다.
  it("emits the Ilike wire value the backend enum expects", async () => {
    const { onFiltersChange } = renderFilterBar("postgresql");
    const user = await openOperatorMenu();

    await user.click(screen.getByRole("option", { name: "ILIKE" }));

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    const updated = onFiltersChange.mock.calls[0]![0] as FilterCondition[];
    expect(updated[0]!.operator).toBe("Ilike");
  });
});
