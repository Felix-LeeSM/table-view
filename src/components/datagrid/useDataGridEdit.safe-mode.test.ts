// AC-185-04 — useDataGridEdit Safe Mode gate. Originally 4 cases per
// Sprint 185 contract.
// AC-186-04 — Sprint 186 adds warn-tier handoff (pendingConfirm +
// confirmDangerous + cancelDangerous).
// AC-244 — Sprint 244 (2026-05-08): policy tightened from "block only
// dangerous DML/DDL" to "block any write/DDL on production+strict|off".
// `[AC-185-04b]` (safe DML pass-through under strict) was inverted to
// `[AC-244-10]` (block) — see the test body for the policy matrix.
//
// Current policy (post-Sprint 244):
//   - production + strict | off: SELECT and Mongo read pass; any SQL
//     write (incl. INSERT / UPDATE WHERE / DELETE WHERE) and any DDL
//     are blocked. This matches the DataGrid's `useSafeModeReadOnly`
//     toolbar gate.
//   - production + warn: severity-driven — only analyzer-flagged
//     danger (WHERE-less DELETE/UPDATE, DROP, $out) hits the confirm
//     dialog; safe writes flow through.
//   - non-production: bypass.
// date 2026-05-01 (initial), 2026-05-08 (Sprint 244 tightening).
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

  it("[AC-185-04a] production + strict + WHERE-less DELETE → blocked, executeQueryBatch not called", async () => {
    const { result } = renderHookFor("production", "strict");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(result.current.commitError).not.toBeNull();
    expect(result.current.commitError!.message).toMatch(/Safe Mode blocked/);
    expect(result.current.commitError!.message).toMatch(/DELETE without WHERE/);
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/Safe Mode blocked/),
    );
  });

  it("[AC-244-10] production + strict + safe DML (DELETE WHERE pk) → blocked (read-only)", async () => {
    // Sprint 244 (2026-05-08) — was AC-185-04b "passes through". Strict
    // on production is now a read-only gate at the lib decision layer
    // (matches the DataGrid's `useSafeModeReadOnly` toolbar gate from
    // Sprint 243). Even analyzer-safe writes block.
    const { result } = renderHookFor("production", "strict");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users WHERE id = 1"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(result.current.commitError).not.toBeNull();
    expect(result.current.commitError!.message).toMatch(/Safe Mode blocked/);
    expect(result.current.commitError!.message).toMatch(/DELETE statement/);
  });

  it("[AC-185-04c] non-production + strict + WHERE-less DELETE → passes (env-gated)", async () => {
    const { result } = renderHookFor("development", "strict");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(result.current.commitError).toBeNull();
  });

  it("[AC-190-01-3] production + off + WHERE-less DELETE → blocked (prod-auto)", async () => {
    // Sprint 190 (FB-1b) — Hard auto. Was AC-185-04d which asserted that
    // toggling Safe Mode off let the danger statement through; under
    // prod-auto the off toggle is a no-op on production connections, so
    // the gate now blocks with the dedicated "production environment
    // forces Safe Mode" copy. The connection-environment override path
    // is asserted via the message text (downstream UI copy guard). date
    // 2026-05-02.
    const { result } = renderHookFor("production", "off");

    act(() => {
      result.current.setSqlPreview(["DELETE FROM users"]);
    });

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(result.current.commitError).not.toBeNull();
    expect(result.current.commitError!.message).toMatch(
      /production environment forces Safe Mode/,
    );
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/production environment forces Safe Mode/),
    );
  });

  it("[AC-186-04a] production + warn + WHERE-less DELETE → pendingConfirm set, executeQueryBatch not called", async () => {
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
