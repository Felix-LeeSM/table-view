// Sprint 222 — shared helpers extracted from `DataGrid.test.tsx`
// (P11 step 5, last) so the behaviour-axis test files can reuse the
// same `vi.fn()` instances + `MOCK_DATA` fixture + the `beforeEach`
// body. The 6 mock functions, the `MOCK_DATA` fixture, and the
// reset / fixture-builder / render helpers mirror the original
// mega-test verbatim — no behaviour change. Each axis file imports
// these and re-applies them in its own `beforeEach` so worker-per-
// file isolation + `mockReset()` keep state from leaking across
// cases.
//
// ES hoisting note: `vi.mock(...)` factories cannot live in a helper
// module. Each axis file declares the 3 factories
// (`./FilterBar` / `@stores/schemaStore` / `@stores/workspaceStore`) at its
// own module top-level and references the mock functions exported
// from this helper. The Sprint 76 reactive `mockTabStoreState` +
// `subscribers` + `useReducer` rerender pattern also stays at each
// axis file's module top because the `vi.mock("@stores/workspaceStore", ...)`
// factory captures the closure inline.
//
// Cross-store import policy (Sprint 221 lint rule answer): this file
// uses **type-only** imports from `@stores/*`/`@/types/*`. No runtime
// store handle is imported — the dynamic `await import(...)` calls
// in the last two cases stay inline in the editing axis file.
import { vi } from "vitest";
import { render } from "@testing-library/react";
import DataGrid from "../DataGrid";
import { useConnectionStore } from "@stores/connectionStore";
import type { TableData } from "@/types/schema";

// ---------------------------------------------------------------------------
// Mock fixture data — byte-equivalent to the original DataGrid.test.tsx
// ---------------------------------------------------------------------------

export const MOCK_DATA: TableData = {
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
    {
      name: "meta",
      data_type: "jsonb",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice", { key: "value" }],
    [2, null, null],
    [3, "Charlie", [1, 2, 3]],
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

export function createMockQueryTableData(overrides?: Partial<TableData>) {
  return vi.fn(() => Promise.resolve({ ...MOCK_DATA, ...overrides }));
}

// ---------------------------------------------------------------------------
// Mock functions — shared `vi.fn()` instances across the axis files. Each
// axis file's `vi.mock(...)` factory references these by reading the
// helper module from its closure.
// ---------------------------------------------------------------------------

export const mockQueryTableData = createMockQueryTableData();

export const mockExecuteQuery = vi.fn(() =>
  Promise.resolve({
    columns: [],
    rows: [],
    total_count: 0,
    execution_time_ms: 5,
    query_type: "dml" as const,
  }),
);

// Sprint 183 — RDB commit pipeline now flows through executeQueryBatch.
// Default to a happy resolution that mirrors the backend contract (one
// QueryResult per submitted statement).
export const mockExecuteQueryBatch = vi.fn(
  (_id: string, statements: string[]) =>
    Promise.resolve(
      statements.map(() => ({
        columns: [],
        rows: [],
        total_count: 0,
        execution_time_ms: 5,
        query_type: "dml" as const,
      })),
    ),
);

export const mockPromoteTab = vi.fn();

export const mockUpdateTabSorts = vi.fn();

export const mockSetTabDirty = vi.fn();

export const mockAddTab = vi.fn();

// ---------------------------------------------------------------------------
// Reset helper — mirrors the original `beforeEach` body verbatim. Each
// axis file calls this before every test in addition to clearing its
// own Sprint-76 reactive `mockTabStoreState` (which lives at the axis
// file's module top because the `vi.mock("@stores/workspaceStore", ...)`
// factory captures it through the closure).
// ---------------------------------------------------------------------------

export function resetDataGridMocks(): void {
  if (typeof useConnectionStore.setState === "function") {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "Postgres",
          dbType: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          database: "db1",
          groupId: null,
          color: null,
          hasPassword: false,
          paradigm: "rdb",
        },
      ],
      groups: [],
      activeStatuses: {},
      focusedConnId: "conn1",
      loading: false,
      hasLoadedOnce: true,
      error: null,
    });
  }
  mockQueryTableData.mockReset();
  mockQueryTableData.mockResolvedValue({ ...MOCK_DATA });
  mockExecuteQuery.mockReset();
  mockExecuteQuery.mockResolvedValue({
    columns: [],
    rows: [],
    total_count: 0,
    execution_time_ms: 5,
    query_type: "dml" as const,
  });
  // Sprint 183 — restore the default happy-path batch resolver after
  // each test (mockReset wipes the implementation we registered at
  // module scope).
  mockExecuteQueryBatch.mockReset();
  mockExecuteQueryBatch.mockImplementation((_id: string, stmts: string[]) =>
    Promise.resolve(
      stmts.map(() => ({
        columns: [],
        rows: [],
        total_count: 0,
        execution_time_ms: 5,
        query_type: "dml" as const,
      })),
    ),
  );
  mockPromoteTab.mockReset();
  mockAddTab.mockReset();
}

// ---------------------------------------------------------------------------
// Render helper — wraps DataGrid with the standard test props. Each axis
// file passes through additional partials (e.g. `initialFilters`).
// ---------------------------------------------------------------------------

export function renderDataGrid(
  props: Partial<Parameters<typeof DataGrid>[0]> = {},
) {
  return render(
    <DataGrid
      connectionId="conn1"
      database="db1"
      table="users"
      schema="public"
      {...props}
    />,
  );
}
