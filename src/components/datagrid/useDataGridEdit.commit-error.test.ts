import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";
// `?raw` is a Vite-supported query suffix that imports a file's text as a
// string. We use it for the static regression guard so the test verifies the
// SQL branch catch block is not empty without depending on Node fs APIs
// (the project tsconfig does not pull in `@types/node`).
import useDataGridEditSource from "./useDataGridEdit.ts?raw";

// Sprint 93 — handleExecuteCommit's SQL branch must surface commit failures
// instead of swallowing them. Sprint 183 (date 2026-05-01) flipped the call
// from N × executeQuery to a single executeQueryBatch wrapped in BEGIN/COMMIT
// /ROLLBACK, so:
//   - The user-facing message changed from "executed: K, failed at: K+1 of N"
//     to "Commit failed — all changes rolled back: <backend message>".
//   - statementIndex / failedKey are now parsed from the backend message
//     ("statement K of N failed: ...") rather than counted in the loop.
// These tests cover:
//   1. Simple failure (1 statement → reject) → commitError captured, modal
//      stays open, failed cell key recorded in pendingEditErrors.
//   2. Partial failure (3 statements, 2nd rejects with "statement 2 of 3
//      failed: ...") → statementIndex 1, message contains "all changes rolled
//      back" — never the old "executed: K" wording.
//   3. Happy-path regression — all succeed in a single batch call → sqlPreview
//      cleared, pendingEdits empty, fetchData called once, commitError null.
//   4. Static guard — the SQL branch catch block is non-empty (regression
//      guard against re-introducing the silent-swallow bug).

const mockExecuteQuery = vi.fn();
const mockExecuteQueryBatch = vi.fn();
const mockFetchData = vi.fn();

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      executeQuery: mockExecuteQuery,
      executeQueryBatch: mockExecuteQueryBatch,
    }),
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

// Sprint 183 — happy-path batch resolves to one QueryResult per submitted
// statement. We don't inspect the result shape in these tests beyond
// "promise resolved", but mirroring the backend contract keeps drift away
// from production.
function happyBatchResolve(stmts: string[]) {
  return Promise.resolve(
    stmts.map(() => ({
      columns: [],
      rows: [],
      total_count: 0,
      execution_time_ms: 5,
      query_type: "dml" as const,
    })),
  );
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

  it("[AC-183-08b] simple failure: single statement reject records commitError, keeps preview open, flags cell key", async () => {
    // Sprint 183 — backend returns "statement 1 of 1 failed: ..." so the
    // catch block parses the index and surfaces the rolled-back message.
    mockExecuteQueryBatch.mockImplementationOnce(() =>
      Promise.reject(
        new Error("statement 1 of 1 failed: relation does not exist"),
      ),
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

    // (a) commitError captured. Sprint 183: standard "all changes rolled
    // back" wording; old "executed: 0" / "failed at: 1" tokens are gone.
    expect(result.current.commitError).not.toBeNull();
    expect(result.current.commitError?.statementIndex).toBe(0);
    expect(result.current.commitError?.statementCount).toBe(1);
    expect(result.current.commitError?.message).toContain(
      "relation does not exist",
    );
    expect(result.current.commitError?.message).toMatch(
      /Commit failed — all changes rolled back/,
    );
    expect(result.current.commitError?.message).not.toMatch(/executed: \d/);
    expect(result.current.commitError?.message).not.toMatch(/failed at: \d/);
    // sql is the raw failed statement (parsed from index 0 of the batch).
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

    // (d) backend was called exactly once with the full batch (not N times).
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    // single-statement batch
    const [, statementsArg] = mockExecuteQueryBatch.mock.calls[0]!;
    expect(statementsArg).toHaveLength(1);

    // legacy single-statement loop must NOT be hit anymore.
    expect(mockExecuteQuery).not.toHaveBeenCalled();

    // fetchData NOT called — commit failed.
    expect(mockFetchData).not.toHaveBeenCalled();
  });

  it("[AC-183-08b] batch failure (3 statements, backend rolls back at #2) → statementIndex 1, message rolled back", async () => {
    // Sprint 183 — the batch is atomic. Backend reports
    // "statement 2 of 3 failed: ..." after issuing ROLLBACK; we extract
    // the index from that message and surface the rolled-back wording.
    mockExecuteQueryBatch.mockImplementationOnce(() =>
      Promise.reject(new Error("statement 2 of 3 failed: permission denied")),
    );

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

    // 0-indexed statement index = 1 (parsed from "statement 2 of 3").
    expect(result.current.commitError?.statementIndex).toBe(1);
    expect(result.current.commitError?.statementCount).toBe(3);
    // Sprint 183 — standard rolled-back wording. Old "executed:" /
    // "failed at:" tokens MUST NOT appear (atomic semantics).
    expect(result.current.commitError?.message).toMatch(
      /Commit failed — all changes rolled back/,
    );
    expect(result.current.commitError?.message).toContain("permission denied");
    expect(result.current.commitError?.message).not.toMatch(/executed: \d/);
    expect(result.current.commitError?.message).not.toMatch(/failed at: \d/);

    // executeQueryBatch was called exactly once — atomic.
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockExecuteQuery).not.toHaveBeenCalled();

    // sqlPreview still has all 3 statements (modal stays open with full batch).
    expect(result.current.sqlPreview?.length).toBe(3);

    // fetchData NOT called — batch was rolled back.
    expect(mockFetchData).not.toHaveBeenCalled();
  });

  it("[AC-183-08a] happy-path batch: all statements committed in single executeQueryBatch call", async () => {
    // Sprint 183 — single batch call (not N × executeQuery). Backend
    // resolves with one QueryResult per submitted statement.
    mockExecuteQueryBatch.mockImplementationOnce((_conn, stmts) =>
      happyBatchResolve(stmts as string[]),
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

    // Invariants: sqlPreview cleared, pendingEdits empty, fetchData fired
    // exactly once, commitError null. Batch called exactly once with both
    // statements.
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.pendingEditErrors.size).toBe(0);
    expect(result.current.commitError).toBeNull();
    expect(mockFetchData).toHaveBeenCalledTimes(1);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    const [, statementsArg] = mockExecuteQueryBatch.mock.calls[0]!;
    expect(statementsArg).toHaveLength(2);
    // legacy single-statement loop must NOT be hit anymore.
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it("commitError clears when the user opens a fresh commit", async () => {
    mockExecuteQueryBatch.mockImplementationOnce(() =>
      Promise.reject(new Error("statement 1 of 1 failed: boom")),
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
    mockExecuteQueryBatch.mockImplementationOnce(() =>
      Promise.reject(new Error("statement 1 of 1 failed: boom")),
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
    // AC-05 / Sprint 183 — ensure no future change re-introduces the
    // silent-swallow bug. The MQL branch has its own (out-of-scope) empty
    // catch which a separate sprint will tackle, so we narrow the guard
    // to the SQL branch only by slicing the source between the
    // `if (!sqlPreview) return;` marker and the `}, [` end of the
    // `handleExecuteCommit` useCallback.
    //
    // Sprint 183 swapped the per-statement loop for a single batch call,
    // so the positive markers also moved: instead of "executed:" / "failed
    // at:" we now look for the standardised rolled-back wording and the
    // batch indirection ("executeQueryBatch").
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

    // Positive assertion: the SQL branch wires the failure through
    // commitError, calls executeQueryBatch (single transaction), and
    // surfaces the standardised rolled-back wording. A future refactor
    // that removes the surfacing path will trip this assertion.
    expect(sqlBranchSource).toMatch(/setCommitError\(/);
    expect(sqlBranchSource).toMatch(/executeQueryBatch\(/);
    expect(sqlBranchSource).toMatch(/all changes rolled back/);
    // Sprint 183 — old partial-failure tokens must NOT reappear.
    expect(sqlBranchSource).not.toMatch(/executed: \$\{/);
    expect(sqlBranchSource).not.toMatch(/failed at: \$\{/);
  });
});
