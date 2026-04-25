import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";
// `?raw` is a Vite-supported query suffix that imports a file's text as a
// string. We use it for the static regression guard so the test verifies the
// SQL branch catch block is not empty without depending on Node fs APIs
// (the project tsconfig does not pull in `@types/node`).
import useDataGridEditSource from "./useDataGridEdit.ts?raw";

// Sprint 93 — handleExecuteCommit's SQL branch must surface executeQuery
// failures instead of swallowing them in an empty catch. These tests cover:
//   1. Simple failure (1 statement → reject) → commitError captured, modal
//      stays open, failed cell key recorded in pendingEditErrors.
//   2. Partial failure (3 statements, 2nd rejects) → statementIndex 1,
//      message contains "executed: 1" and "failed at: 2".
//   3. Happy-path regression — all succeed → sqlPreview cleared, pendingEdits
//      empty, fetchData called once, commitError null.
//   4. Static guard — the SQL branch catch block is non-empty (regression
//      guard against re-introducing the silent-swallow bug).

const mockExecuteQuery = vi.fn();
const mockFetchData = vi.fn();

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ executeQuery: mockExecuteQuery }),
}));

vi.mock("@stores/tabStore", () => ({
  useTabStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeTabId: "tab-1",
      promoteTab: vi.fn(),
      setTabDirty: vi.fn(),
    }),
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
    {
      name: "age",
      data_type: "integer",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice", 30],
    [2, "Bob", 40],
    [3, "Carol", 50],
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function renderEditHook(data: TableData | null = MOCK_DATA) {
  return renderHook(() =>
    useDataGridEdit({
      data,
      schema: "public",
      table: "users",
      connectionId: "conn1",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

function happyResolve() {
  return Promise.resolve({
    columns: [],
    rows: [],
    total_count: 0,
    execution_time_ms: 5,
    query_type: "dml" as const,
  });
}

describe("useDataGridEdit — Sprint 93 commit error surfacing", () => {
  beforeEach(() => {
    // resetAllMocks both clears call history and drains queued
    // mockImplementationOnce entries — important because some tests below
    // intentionally leave the third mock implementation unused (3-statement
    // batch with the 2nd rejecting), and we don't want it leaking into the
    // next test.
    vi.resetAllMocks();
  });

  it("simple failure: single statement reject records commitError, keeps preview open, flags cell key", async () => {
    mockExecuteQuery.mockImplementationOnce(() =>
      Promise.reject(new Error("relation does not exist")),
    );

    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });

    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.commitError).toBeNull();

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    // (a) commitError captured.
    expect(result.current.commitError).not.toBeNull();
    expect(result.current.commitError?.statementIndex).toBe(0);
    expect(result.current.commitError?.statementCount).toBe(1);
    expect(result.current.commitError?.message).toContain(
      "relation does not exist",
    );
    expect(result.current.commitError?.message).toContain("executed: 0");
    expect(result.current.commitError?.message).toContain("failed at: 1");
    // sql is the raw failed statement.
    expect(result.current.commitError?.sql).toContain("UPDATE");
    expect(result.current.commitError?.sql).toContain("Alicia");

    // (b) sqlPreview is preserved — the modal stays open.
    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.sqlPreview?.length).toBe(1);

    // (c) failed cell key flagged in pendingEditErrors.
    expect(result.current.pendingEditErrors.has("0-1")).toBe(true);
    expect(result.current.pendingEditErrors.get("0-1")).toContain(
      "relation does not exist",
    );

    // fetchData NOT called — commit failed.
    expect(mockFetchData).not.toHaveBeenCalled();
  });

  it("partial failure: 3 statements with 2nd rejecting → statementIndex 1, executed: 1, failed at: 2", async () => {
    // First statement succeeds, second rejects, third should not run.
    mockExecuteQuery
      .mockImplementationOnce(() => happyResolve())
      .mockImplementationOnce(() =>
        Promise.reject(new Error("permission denied")),
      )
      .mockImplementationOnce(() => happyResolve());

    const { result } = renderEditHook();

    // Three independent UPDATEs — one per row.
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("A1");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleStartEdit(1, 1, "Bob");
    });
    act(() => {
      result.current.setEditValue("B1");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleStartEdit(2, 1, "Carol");
    });
    act(() => {
      result.current.setEditValue("C1");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleCommit();
    });

    expect(result.current.sqlPreview?.length).toBe(3);

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    // 0-indexed statement index = 1 (the second statement).
    expect(result.current.commitError?.statementIndex).toBe(1);
    expect(result.current.commitError?.statementCount).toBe(3);
    // Message contains the 1-indexed partial-failure context per AC-02.
    expect(result.current.commitError?.message).toContain("executed: 1");
    expect(result.current.commitError?.message).toContain("failed at: 2");
    expect(result.current.commitError?.message).toContain("permission denied");

    // executeQuery was called exactly twice — third statement skipped.
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);

    // sqlPreview still has all 3 statements (modal stays open with full batch).
    expect(result.current.sqlPreview?.length).toBe(3);

    // fetchData NOT called — partial failure.
    expect(mockFetchData).not.toHaveBeenCalled();
  });

  it("happy path regression: all succeed → sqlPreview null, pendingEdits empty, fetchData once, commitError null", async () => {
    mockExecuteQuery
      .mockImplementationOnce(() => happyResolve())
      .mockImplementationOnce(() => happyResolve());

    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("A1");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleStartEdit(1, 1, "Bob");
    });
    act(() => {
      result.current.setEditValue("B1");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.sqlPreview?.length).toBe(2);

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    // Invariants from contract: sqlPreview null, pendingEdits.size 0, fetchData 1.
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.pendingEditErrors.size).toBe(0);
    expect(result.current.commitError).toBeNull();
    expect(mockFetchData).toHaveBeenCalledTimes(1);
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  it("commitError clears when the user opens a fresh commit", async () => {
    mockExecuteQuery.mockImplementationOnce(() =>
      Promise.reject(new Error("boom")),
    );

    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("A1");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });
    expect(result.current.commitError).not.toBeNull();

    // A subsequent handleCommit (e.g. after the user opens a fresh batch)
    // resets commitError so the dialog opens clean.
    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.commitError).toBeNull();
  });

  it("commitError clears when setSqlPreview(null) dismisses the modal", async () => {
    mockExecuteQuery.mockImplementationOnce(() =>
      Promise.reject(new Error("boom")),
    );

    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("A1");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    await act(async () => {
      await result.current.handleExecuteCommit();
    });
    expect(result.current.commitError).not.toBeNull();

    act(() => {
      result.current.setSqlPreview(null);
    });
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.commitError).toBeNull();
  });

  it("static regression guard: SQL branch catch block is non-empty", () => {
    // AC-05 — ensure no future change re-introduces the silent-swallow bug.
    // The MQL branch has its own (out-of-scope) empty catch which a separate
    // sprint will tackle, so we narrow the guard to the SQL branch only by
    // slicing the source between the `if (!sqlPreview) return;` marker and
    // the `}, [` end of the `handleExecuteCommit` useCallback.
    const source = useDataGridEditSource;

    const sqlBranchStart = source.indexOf("if (!sqlPreview) return;");
    expect(
      sqlBranchStart,
      "SQL branch marker not found — useDataGridEdit refactor required",
    ).toBeGreaterThan(-1);
    const sqlBranchSlice = source.slice(sqlBranchStart);
    // First `}, [` after the slice closes the useCallback dependency array.
    const sqlBranchEnd = sqlBranchSlice.indexOf("}, [");
    const sqlBranchSource = sqlBranchSlice.slice(0, sqlBranchEnd);

    // Empty-catch shape: `} catch (err?) { whitespace + // comments only }`.
    // Both the parenthesised and parenthesis-less forms are checked.
    const emptyCatchRe =
      /\}\s*catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*(?:\/\/[^\n]*\s*)*\}/g;
    const emptyCatchMatches = sqlBranchSource.match(emptyCatchRe) ?? [];
    expect(
      emptyCatchMatches,
      "SQL branch catch must not be empty (sprint-93 regression guard)",
    ).toHaveLength(0);

    // Positive assertion: the SQL branch wires the failure through commitError
    // and the partial-failure formatting tokens. A future refactor that
    // removes the surfacing path will trip this assertion.
    expect(sqlBranchSource).toMatch(/setCommitError\(/);
    expect(sqlBranchSource).toMatch(/executed:/);
    expect(sqlBranchSource).toMatch(/failed at:/);
  });
});
