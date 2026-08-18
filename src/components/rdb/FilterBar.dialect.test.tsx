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

// PostgreSQL 에서 걸고 그 연결의 DBMS 종류를 바꾸면 남는 조건이 이 모양이다.
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

  // #2430 실측: `dbType` 이 바뀌어 지금 걸린 연산자가 목록에서 빠지면
  // 트리거가 빈칸이 됐다. 트리거를 그리는 것은 `<SelectValue />` 이고 그것은
  // 마운트된 `SelectItem` 에서 텍스트를 읽으므로, 목록 밖 항목을 하나 더
  // 그려야 표기가 남는다 (`ConnectionDialogBody.tsx:463-468` 과 같은 처방).

  it("keeps the selected operator readable after the dialect drops it", () => {
    renderFilterBar("sqlite", ILIKE_FILTER);

    expect(screen.getByLabelText("Filter operator")).toHaveTextContent("ILIKE");
  });

  it("still hides the dropped operator from the dropdown", async () => {
    renderFilterBar("sqlite", ILIKE_FILTER);
    await openOperatorMenu();

    // 목록 밖 항목을 하나 더 그리는 처방이 드롭다운을 도로 넓히면 안 된다 —
    // 그 항목은 지금 걸린 연산자 하나이고, 고를 수 있는 나머지는 방언 목록이다.
    expect(screen.getAllByRole("option", { name: "ILIKE" })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "LIKE" })).toBeInTheDocument();
  });

  it("keeps the value input for an operator the dialect dropped", () => {
    renderFilterBar("sqlite", ILIKE_FILTER);

    expect(screen.getByLabelText("Filter value for name")).toBeInTheDocument();
  });

  // 목록 밖 항목을 그리는 갈래가 조건 없이 돌면 방언이 이미 주는 연산자가 두
  // 번 뜬다. 이 단언이 그 갈래의 조건을 잠근다.
  it("does not duplicate an operator the dialect already offers", async () => {
    renderFilterBar("postgresql", ILIKE_FILTER);
    await openOperatorMenu();

    expect(screen.getAllByRole("option", { name: "ILIKE" })).toHaveLength(1);
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
