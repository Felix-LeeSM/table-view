// AC-247-H1..H5 — Sprint 247 (ADR 0022 Phase 3) `useDryRun` hook contract.
// date 2026-05-09.
//
// `useDryRun` powers the destructive-statement confirm dialog's preview
// pane. The hook's contract is narrow: paradigm gate (document →
// unsupported, rdb → IPC), enabled gate (false → idle), state
// transitions (running → success | error), and unmount cancel
// best-effort. We test these via `renderHook` with a controllable
// `executeQueryDryRun` mock; the dialog integration is covered in
// `ConfirmDestructiveDialog.test.tsx`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { act, renderHook, waitFor } from "@testing-library/react";

const executeQueryDryRunMock = vi.fn();
const cancelQueryMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    executeQueryDryRun: (...args: unknown[]) => executeQueryDryRunMock(...args),
    cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
  });
});

import { useDryRun } from "./useDryRun";

describe("useDryRun", () => {
  beforeEach(() => {
    executeQueryDryRunMock.mockReset();
    cancelQueryMock.mockReset();
    cancelQueryMock.mockResolvedValue("cancelled");
  });

  it('[AC-247-H1] paradigm="document" → unsupported, IPC not called', () => {
    const { result } = renderHook(() =>
      useDryRun({
        connectionId: "c",
        statements: ["DELETE FROM users"],
        paradigm: "document",
        enabled: true,
      }),
    );
    expect(result.current.status).toBe("unsupported");
    expect(result.current.results).toBeNull();
    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
  });

  it("[AC-247-H2] enabled=false → idle, IPC not called", () => {
    const { result } = renderHook(() =>
      useDryRun({
        connectionId: "c",
        statements: ["DELETE FROM users"],
        paradigm: "rdb",
        enabled: false,
      }),
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.results).toBeNull();
    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
  });

  it("[AC-247-H3] enabled=true + IPC resolve → idle/running → success with results", async () => {
    const payload = [
      {
        columns: [],
        rows: [],
        total_count: 7,
        execution_time_ms: 4,
        query_type: { dml: { rows_affected: 7 } },
      },
    ];
    executeQueryDryRunMock.mockResolvedValueOnce(payload);

    const { result } = renderHook(() =>
      useDryRun({
        connectionId: "c",
        statements: ["UPDATE t SET x = 1"],
        paradigm: "rdb",
        enabled: true,
      }),
    );

    // Initial state is `running` (the hook seeds it synchronously when
    // enabled=true) — the IPC mock resolves on next microtask.
    expect(result.current.status).toBe("running");

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.results).toEqual(payload);
    expect(result.current.error).toBeNull();
    expect(executeQueryDryRunMock).toHaveBeenCalledWith(
      "c",
      ["UPDATE t SET x = 1"],
      expect.stringMatching(/^dry:/),
    );
  });

  it("[AC-247-H4] enabled=true + IPC reject → status=error with message", async () => {
    executeQueryDryRunMock.mockRejectedValueOnce(
      new Error("statement 1 of 1 failed: boom"),
    );

    const { result } = renderHook(() =>
      useDryRun({
        connectionId: "c",
        statements: ["DROP TABLE foo"],
        paradigm: "rdb",
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.results).toBeNull();
    expect(result.current.error).toBe("statement 1 of 1 failed: boom");
  });

  it("[AC-247-H5] unmount → cancelQuery(queryId) called once (best-effort)", async () => {
    // Hold the IPC promise so unmount fires while the dry-run is still
    // in flight; this is the only path where cancel matters.
    let resolveIpc: (v: unknown[]) => void = () => {};
    executeQueryDryRunMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveIpc = resolve;
        }),
    );

    const { result, unmount } = renderHook(() =>
      useDryRun({
        connectionId: "c",
        statements: ["DELETE FROM x"],
        paradigm: "rdb",
        enabled: true,
      }),
    );
    expect(result.current.status).toBe("running");
    // The IPC was started — capture the queryId via the mock's args.
    expect(executeQueryDryRunMock).toHaveBeenCalledTimes(1);
    const [, , queryId] = executeQueryDryRunMock.mock.calls[0]!;

    act(() => {
      unmount();
    });

    expect(cancelQueryMock).toHaveBeenCalledTimes(1);
    expect(cancelQueryMock).toHaveBeenCalledWith(queryId);

    // Drain the pending promise so the test isn't flagged as leaking.
    resolveIpc([]);
  });
});
