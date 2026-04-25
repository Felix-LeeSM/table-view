import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";

// Sprint 77 — cover the promotion-trigger gaps that existed before.
// The sort/filter/page promotion lives in the DataGrid effect, but
// starting an edit, adding a row, or deleting a row never re-fetch and
// therefore never fired that effect. This suite pins the hook itself as
// the responsible caller by mocking `promoteTab` and asserting it's
// invoked at the earliest point of each interaction.

const mockExecuteQuery = vi.fn(() =>
  Promise.resolve({
    columns: [],
    rows: [],
    total_count: 0,
    execution_time_ms: 5,
    query_type: "dml" as const,
  }),
);
const mockFetchData = vi.fn();
const mockPromoteTab = vi.fn();

// The hook reads two slices off tabStore: `activeTabId` and `promoteTab`.
// Point both at a known identity so we can assert the exact tab id flowed
// through. No other tabStore actions are touched by the hook.
vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ executeQuery: mockExecuteQuery }),
}));

vi.mock("@stores/tabStore", () => ({
  useTabStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeTabId: "tab-1", promoteTab: mockPromoteTab }),
}));

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

function renderEditHook(paradigm: "rdb" | "document" = "rdb") {
  return renderHook(() =>
    useDataGridEdit({
      data: MOCK_DATA,
      schema: "public",
      table: "users",
      connectionId: "conn1",
      page: 1,
      fetchData: mockFetchData,
      paradigm,
    }),
  );
}

describe("useDataGridEdit — preview tab promotion (Sprint 77)", () => {
  beforeEach(() => {
    mockExecuteQuery.mockClear();
    mockFetchData.mockClear();
    mockPromoteTab.mockClear();
  });

  // AC-02 — starting a cell edit promotes the active preview tab.
  // Without this, a user could type into a ghost tab and have it
  // silently overwritten by the next sidebar click.
  it("handleStartEdit promotes the active tab", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });

    expect(mockPromoteTab).toHaveBeenCalledWith("tab-1");
    expect(mockPromoteTab).toHaveBeenCalledTimes(1);
  });

  // Sprint 86 — the document paradigm's no-op guard was removed because the
  // hook now routes document edits through the MQL generator + Tauri mutate
  // wrappers (see `useDataGridEdit.document.test.ts`). Starting an edit for
  // a Mongo cell therefore promotes the active tab just like an RDB grid —
  // the user's edit is a legitimate "I want to keep this tab" signal.
  it("handleStartEdit promotes the active tab for document paradigm (Sprint 86)", () => {
    const { result } = renderEditHook("document");

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });

    expect(mockPromoteTab).toHaveBeenCalledWith("tab-1");
    expect(mockPromoteTab).toHaveBeenCalledTimes(1);
  });

  // AC-03 — row add.
  it("handleAddRow promotes the active tab", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleAddRow();
    });

    expect(mockPromoteTab).toHaveBeenCalledWith("tab-1");
    expect(mockPromoteTab).toHaveBeenCalledTimes(1);
  });

  // AC-03 — row delete. Requires a prior selection because
  // `handleDeleteRow` early-returns on an empty selection (that
  // behaviour is tested in the multi-select suite).
  it("handleDeleteRow promotes the active tab after selection", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    mockPromoteTab.mockClear();

    act(() => {
      result.current.handleDeleteRow();
    });

    expect(mockPromoteTab).toHaveBeenCalledWith("tab-1");
    expect(mockPromoteTab).toHaveBeenCalledTimes(1);
  });

  // Guard: `handleDeleteRow` with no selection must stay silent so
  // accidentally tapping the delete key on an empty grid does not
  // promote the current preview tab.
  it("handleDeleteRow is a no-op (no promotion) when no rows are selected", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleDeleteRow();
    });

    expect(mockPromoteTab).not.toHaveBeenCalled();
  });

  // Idempotency — `promoteTab` itself is a no-op on a non-preview tab
  // (see tabStore.ts), so calling it repeatedly from the hook is safe.
  // This test pins that calling `handleStartEdit` multiple times simply
  // dispatches multiple identical promote calls without any other side
  // effect on the edit state. If someone later memoises this away the
  // test fails loudly rather than the user experiencing a stale flag.
  it("multiple handleStartEdit calls dispatch promote each time (idempotent)", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.handleStartEdit(1, 1, "Bob");
    });

    expect(mockPromoteTab).toHaveBeenCalledTimes(2);
    expect(mockPromoteTab).toHaveBeenNthCalledWith(1, "tab-1");
    expect(mockPromoteTab).toHaveBeenNthCalledWith(2, "tab-1");
  });
});
