// AC-185-04 — useDataGridEdit Safe Mode gate. Originally 4 cases per
// Sprint 185 contract.
// AC-186-04 — Sprint 186 adds warn-tier handoff (pendingConfirm +
// confirmDangerous + cancelDangerous).
// Sprint 244 (2026-05-08) tightened the policy to "production+strict|off
// = read-only" — that tightening is REVERTED in Sprint 245 (ADR 0022
// Phase 1). `[AC-244-10]` (block on prod+strict + safe DML) was
// re-inverted back to a pass-through assertion below — same statement
// (DELETE WHERE pk), opposite expectation, fresh AC id (AC-245-C1).
//
// Current policy (Sprint 245 — ADR 0022 Phase 1, destructive-only):
//   - production + any mode: SELECT and safe writes (INSERT, UPDATE
//     WHERE, DELETE WHERE, CREATE, ALTER additive) flow through;
//     destructive (DROP / TRUNCATE / WHERE-less DELETE-UPDATE / etc.)
//     opens the confirm dialog (mode-specific reason copy: strict /
//     warn share toolbar-override copy, off uses prod-auto copy).
//   - non-production + strict: destructive opens the dialog (M.1 new
//     flow); safe writes / SELECT pass.
//   - non-production + warn / off: bypass.
// date 2026-05-01 (initial), 2026-05-08 (Sprint 244 → Sprint 245).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { TableData } from "@/types/schema";

const mockExecuteQueryBatch = vi.fn();
const mockToastError = vi.fn();
const mockToastInfo = vi.fn();
const mockFetchData = vi.fn();

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      executeQuery: vi.fn(),
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

let mockEnvironment: string | null = "production";

vi.mock("@stores/connectionStore", () => ({
  useConnectionStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      connections: [
        {
          id: "conn-pg",
          environment: mockEnvironment,
        },
      ],
    }),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    error: (msg: string) => mockToastError(msg),
    success: vi.fn(),
    info: (msg: string) => mockToastInfo(msg),
    warn: vi.fn(),
  },
}));

const RDB_DATA: TableData = {
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
  ],
  rows: [[1]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM users",
};

function renderHookFor(env: string | null, mode: "strict" | "warn" | "off") {
  mockEnvironment = env;
  useSafeModeStore.setState({ mode });
  return renderHook(() =>
    useDataGridEdit({
      data: RDB_DATA,
      schema: "public",
      table: "users",
      connectionId: "conn-pg",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

describe("useDataGridEdit — Sprint 185 Safe Mode gate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExecuteQueryBatch.mockResolvedValue([]);
  });

  it("[AC-185-04a] production + strict + WHERE-less DELETE → confirm dialog, executeQueryBatch not called", async () => {
    // Sprint 245 (ADR 0022 Phase 1) — was "block" under Sprint 244's
    // read-only policy. Production destructive now opens the confirm
    // dialog regardless of mode. Reason copy stays bare for strict /
    // warn (Phase 1 dialog uses type-to-confirm; Phase 2 will redesign).
    const { result } = renderHookFor("production", "strict");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(result.current.pendingConfirm).not.toBeNull();
    expect(result.current.pendingConfirm!.reason).toBe(
      "DELETE without WHERE clause",
    );
    expect(result.current.commitError).toBeNull();
  });

  it("[AC-245-C1] production + strict + safe DML (DELETE WHERE pk) → executeQueryBatch called once (Sprint 244 block reverted)", async () => {
    // Sprint 245 — was [AC-244-10] "block". The destructive-only policy
    // lets safe writes flow through on production regardless of mode;
    // Cmd+Z (Phase 5) is the safety net for accidental commits.
    const { result } = renderHookFor("production", "strict");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users WHERE id = 1"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(result.current.commitError).toBeNull();
    expect(result.current.pendingConfirm).toBeNull();
  });

  it("[AC-185-04c] non-production + strict + WHERE-less DELETE → confirm dialog (M.1 new flow)", async () => {
    // Sprint 245 — was "passes through" (non-prod bypass). Strict on
    // non-production now also opens the destructive dialog (M.1 — for
    // shared-staging / learning environments). Distinguishing reason
    // copy ("Safe Mode strict — destructive statement in non-
    // production") differentiates this from the bare prod+strict copy.
    const { result } = renderHookFor("development", "strict");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(result.current.pendingConfirm).not.toBeNull();
    expect(result.current.pendingConfirm!.reason).toBe(
      "DELETE without WHERE clause (Safe Mode strict — destructive statement in non-production)",
    );
  });

  it("[AC-185-04c-2] non-production + warn + WHERE-less DELETE → passes through (warn unguarded outside prod)", async () => {
    // Sprint 245 — paired with the new strict-mode flow above so the
    // matrix coverage stays complete: warn / off on non-prod do NOT
    // open the dialog even on destructive statements.
    const { result } = renderHookFor("development", "warn");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(result.current.commitError).toBeNull();
  });

  it("[AC-245-L6] production + off + WHERE-less DELETE → confirm dialog with prod-auto copy", async () => {
    // Sprint 245 — was [AC-190-01-3] "block (prod-auto)". The
    // destructive-only policy opens the confirm dialog instead of
    // blocking; prod-auto reason copy ("production environment forces
    // Safe Mode — change connection environment tag to override") is
    // preserved so downstream UI guidance still differs from the
    // toolbar-override copy.
    const { result } = renderHookFor("production", "off");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(result.current.pendingConfirm).not.toBeNull();
    expect(result.current.pendingConfirm!.reason).toMatch(
      /production environment forces Safe Mode/,
    );
  });

  it("[AC-186-04a] production + warn + WHERE-less DELETE → pendingConfirm set, executeQueryBatch not called", async () => {
    // Sprint 245 — preserves Sprint 244 warn-tier dialog text exactly
    // (bare analyzer reason). The Phase 1 dialog uses type-to-confirm
    // and the user types this reason verbatim.
    const { result } = renderHookFor("production", "warn");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(result.current.pendingConfirm).not.toBeNull();
    expect(result.current.pendingConfirm!.reason).toBe(
      "DELETE without WHERE clause",
    );
    expect(result.current.pendingConfirm!.sql).toBe("DELETE FROM users");
    expect(result.current.pendingConfirm!.statementIndex).toBe(0);
    expect(result.current.commitError).toBeNull();
  });

  it("[AC-186-04b] confirmDangerous → executeQueryBatch called once + pendingConfirm cleared", async () => {
    const { result } = renderHookFor("production", "warn");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(result.current.pendingConfirm).not.toBeNull();

    await act(async () => {
      await result.current.confirmDangerous();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(result.current.pendingConfirm).toBeNull();
    expect(result.current.commitError).toBeNull();
  });

  it("[AC-186-04c] cancelDangerous → commitError set with warn message + toast.info", async () => {
    const { result } = renderHookFor("production", "warn");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(result.current.pendingConfirm).not.toBeNull();

    act(() => {
      result.current.cancelDangerous();
    });

    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(result.current.pendingConfirm).toBeNull();
    expect(result.current.commitError).not.toBeNull();
    expect(result.current.commitError!.message).toMatch(
      /Safe Mode \(warn\): confirmation cancelled/,
    );
    expect(mockToastInfo).toHaveBeenCalledWith(
      expect.stringMatching(/confirmation cancelled/),
    );
  });
});
