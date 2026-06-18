import type { TableData } from "@/types/schema";

export const DATAGRID_PERF_PAGE_SIZE = 1_000;

export function makeDataGridPerfColumns(): TableData["columns"] {
  return [
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
}

export function makeDataGridPerfTable(
  rowCount: number,
  executedQuery = "q1",
  pageSize = rowCount,
): TableData {
  return {
    columns: makeDataGridPerfColumns(),
    rows: Array.from({ length: rowCount }, (_, i) => [i, `name-${i}`]),
    total_count: rowCount,
    page: 1,
    page_size: pageSize,
    executed_query: executedQuery,
  };
}

export function makeDataGridPageSize1000Fixture(
  executedQuery = "q-page-size-1000",
): TableData {
  return makeDataGridPerfTable(
    DATAGRID_PERF_PAGE_SIZE,
    executedQuery,
    DATAGRID_PERF_PAGE_SIZE,
  );
}
