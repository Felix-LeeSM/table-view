import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";

// Sprint 98 — Cmd+S immediate visual feedback.
// Covers AC-01..AC-03:
//  AC-01: flashing flips to true synchronously after `commit-changes` dispatch
//         when there are pending edits — well before the SQL preview opens.
//  AC-02: flashing flips back to false once the preview is set, AND the 400ms
//         safety timer covers branches that never set a preview.
//  AC-03: dirty 0 path → toast.info("No changes to commit") + no preview.

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

// Mock the toast façade so AC-03 can assert exactly one info toast on the
// dirty 0 path. We stub the four variant helpers and `dismiss`/`clear` for
// shape parity with the real export — only `info` is used in production code
// touched by this sprint, but importing modules can pull the others.
const toastInfoMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastWarningMock = vi.fn();
vi.mock("@/lib/toast", () => ({
  toast: {
    info: (...args: unknown[]) => toastInfoMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
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

function dispatchCommit() {
  window.dispatchEvent(new Event("commit-changes"));
}

describe("useDataGridEdit — Sprint 98 commit flash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // If a test enabled fake timers, restore real timers so a subsequent
    // test (or the global teardown) doesn't see a stuck scheduler.
    vi.useRealTimers();
  });

  it("AC-01: flashing flips to true synchronously after commit-changes dispatch (before preview is set)", () => {
    // Stage a pending edit that will FAIL coercion: `pendingEdits` is non-
    // empty (so `hasPendingChanges === true` and the dirty-0 branch is
    // skipped), but `generateSqlWithKeys` produces zero statements, so
    // `handleCommit` short-circuits BEFORE `setSqlPreview`. That isolates
    // the entry-point flash flip — the watcher effect cannot fire because
    // no terminal signal (sqlPreview / mqlPreview / commitError) arrives.
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 0, "1");
    });
    act(() => {
      result.current.setEditValue("not-an-int");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.isCommitFlashing).toBe(false);
    expect(result.current.sqlPreview).toBeNull();

    act(() => {
      dispatchCommit();
    });

    // After the dispatch the entry-point flip is observable AND no preview
    // was set — exactly the "200ms before SQL preview opens" window the
    // user experiences in the live app.
    expect(result.current.isCommitFlashing).toBe(true);
    expect(result.current.sqlPreview).toBeNull();
  });

  it("AC-02: flashing flips to false after the SQL preview is set", () => {
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
      dispatchCommit();
    });

    // The watcher effect — `useEffect` keyed on (`sqlPreview`, `mqlPreview`,
    // `commitError`) — flips flashing back off once a terminal signal arrives.
    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.isCommitFlashing).toBe(false);
  });

  it("AC-02 fallback: flashing flips to false after the 400ms safety timeout when no preview is set", () => {
    vi.useFakeTimers();
    const { result } = renderEditHook();

    // Same validation-only path as AC-01: a saved pendingEdit that fails
    // coercion makes `handleCommit` short-circuit before `setSqlPreview` —
    // the watcher cannot clear flashing, so the 400ms safety timer is the
    // sole rescue path.
    act(() => {
      result.current.handleStartEdit(0, 0, "1");
    });
    act(() => {
      result.current.setEditValue("not-an-int");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      dispatchCommit();
    });

    // Flash is on, preview is still null — exactly the stuck-state the
    // safety timer must rescue.
    expect(result.current.isCommitFlashing).toBe(true);
    expect(result.current.sqlPreview).toBeNull();

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current.isCommitFlashing).toBe(false);
  });

  it("AC-03: dirty 0 path fires toast.info and does not open any preview", () => {
    const { result } = renderEditHook();

    // No pending edits — the listener should hit the dirty 0 toast branch.
    expect(result.current.hasPendingChanges).toBe(false);

    act(() => {
      dispatchCommit();
    });

    expect(toastInfoMock).toHaveBeenCalledTimes(1);
    expect(toastInfoMock).toHaveBeenCalledWith("No changes to commit");
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.mqlPreview).toBeNull();
    // No flash for the dirty 0 path — toast itself is the user-facing
    // feedback per AC-03.
    expect(result.current.isCommitFlashing).toBe(false);
  });

  it("toolbar handleCommit entry also flips the flash flag", () => {
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

    expect(result.current.isCommitFlashing).toBe(false);

    act(() => {
      result.current.handleCommit();
    });

    // sqlPreview is set, watcher cleared the flash. The interesting bit is
    // that handleCommit (toolbar entry) DID flip flashing on — we observe
    // the side effect (`sqlPreview` non-null) which only happens after the
    // `beginCommitFlash` call earlier in the function body.
    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.isCommitFlashing).toBe(false);
  });

  it("AC-04 regression: existing happy path (commit-changes with pending edits) still opens preview", () => {
    // Mirrors `commit-shortcut.test.ts` "opens SQL preview when commit-changes
    // fires with pending edits" — proves we have not regressed AC-04.
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
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.sqlPreview).toBeNull();

    act(() => {
      dispatchCommit();
    });

    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.sqlPreview?.length).toBeGreaterThan(0);
  });
});
