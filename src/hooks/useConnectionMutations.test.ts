import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ConnectionConfig, ConnectionDraft } from "@/types/connection";

// 2026-05-06 — Sprint 219 (P10 step 1). The 3 mutation toasts (added /
// updated / removed) used to live inside `connectionStore.ts`'s action
// bodies. They've moved here so the store stays a pure state-transition
// module. These tests pin the byte-equivalent toast text + the contract
// that a store throw does NOT fire a toast (the dialog's catch renders the
// error inline; we don't want a duplicate "success" toast on top).
//
// Mock pattern follows `useConnectionLifecycle.test.ts` — `vi.hoisted` +
// factory `vi.mock("@stores/connectionStore", ...)` + `vi.mock("@lib/toast",
// ...)` so the mocks are wired BEFORE the hook module imports run.

const { mockAdd, mockUpdate, mockRemove, mockToastSuccess, mockGetState } =
  vi.hoisted(() => ({
    mockAdd: vi.fn(),
    mockUpdate: vi.fn(),
    mockRemove: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockGetState: vi.fn(),
  }));

vi.mock("@stores/connectionStore", () => ({
  useConnectionStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        addConnection: mockAdd,
        updateConnection: mockUpdate,
        removeConnection: mockRemove,
      }),
    { getState: mockGetState },
  ),
}));

vi.mock("@lib/toast", () => ({
  toast: {
    success: mockToastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
}));

import { useConnectionMutations } from "./useConnectionMutations";

function makeDraft(over: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "c1",
    name: "Local PG",
    db_type: "postgres",
    host: "localhost",
    port: 5432,
    database: "postgres",
    username: "postgres",
    password: "secret",
    ssl: false,
    group_id: null,
    environment: null,
    ...over,
  } as ConnectionDraft;
}

function makeSaved(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "c1",
    name: "Local PG",
    db_type: "postgres",
    host: "localhost",
    port: 5432,
    database: "postgres",
    username: "postgres",
    has_password: true,
    ssl: false,
    group_id: null,
    environment: null,
    ...over,
  } as ConnectionConfig;
}

describe("useConnectionMutations", () => {
  beforeEach(() => {
    mockAdd.mockReset();
    mockUpdate.mockReset();
    mockRemove.mockReset();
    mockToastSuccess.mockReset();
    mockGetState.mockReset();
    // Default: connection lookup resolves to a stored connection so the
    // happy-path remove case can name the connection in its toast.
    mockGetState.mockReturnValue({
      connections: [makeSaved({ id: "c1", name: "Local PG" })],
    });
  });

  it("addConnection on success calls toast.success with byte-equivalent text 'Connection \"<name>\" added.'", async () => {
    const draft = makeDraft({ name: "Prod Replica" });
    const saved = makeSaved({ id: "c1", name: "Prod Replica" });
    mockAdd.mockResolvedValueOnce(saved);

    const { result } = renderHook(() => useConnectionMutations());
    let returned: ConnectionConfig | undefined;
    await act(async () => {
      returned = await result.current.addConnection(draft);
    });

    expect(mockAdd).toHaveBeenCalledWith(draft);
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Connection "Prod Replica" added.',
    );
    expect(returned).toBe(saved);
  });

  it("updateConnection on success calls toast.success with byte-equivalent text 'Connection \"<name>\" updated.'", async () => {
    const draft = makeDraft({ name: "Staging" });
    mockUpdate.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useConnectionMutations());
    await act(async () => {
      await result.current.updateConnection(draft);
    });

    expect(mockUpdate).toHaveBeenCalledWith(draft);
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Connection "Staging" updated.',
    );
  });

  it("removeConnection on success with resolved name calls toast.success with 'Connection \"<name>\" removed.'", async () => {
    mockGetState.mockReturnValue({
      connections: [makeSaved({ id: "c1", name: "Local PG" })],
    });
    mockRemove.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useConnectionMutations());
    await act(async () => {
      await result.current.removeConnection("c1");
    });

    expect(mockRemove).toHaveBeenCalledWith("c1");
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Connection "Local PG" removed.',
    );
  });

  it("removeConnection on success with unresolvable name falls back to 'Connection removed.'", async () => {
    // Connection isn't in state — e.g. cross-window race already removed
    // it, or a stale id reached the dialog. The toast must still fire,
    // just without the name.
    mockGetState.mockReturnValue({ connections: [] });
    mockRemove.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useConnectionMutations());
    await act(async () => {
      await result.current.removeConnection("missing-id");
    });

    expect(mockRemove).toHaveBeenCalledWith("missing-id");
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith("Connection removed.");
  });

  it("addConnection on store throw does not call toast and re-propagates", async () => {
    // Store-side throw (e.g. tauri.saveConnection rejected with a
    // RUSQLITE_CONSTRAINT). The dialog renders the error inline via its
    // catch — a "success" toast on top would be a regression.
    mockAdd.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useConnectionMutations());
    await act(async () => {
      await expect(result.current.addConnection(makeDraft())).rejects.toThrow(
        "boom",
      );
    });

    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("removeConnection snapshots the name BEFORE awaiting the store action", async () => {
    // Regression guard: the store removes the connection from state as
    // part of its action body. If the hook resolved the name AFTER the
    // await, every successful remove would land on the fallback string.
    let lookupOrder: "before" | "after" | null = null;
    mockGetState.mockImplementation(() => {
      lookupOrder = lookupOrder ?? "before";
      return {
        connections: [makeSaved({ id: "c1", name: "Local PG" })],
      };
    });
    mockRemove.mockImplementationOnce(async () => {
      // Once the store action has resolved the lookup must have already
      // happened — flip the marker so a post-await getState() call would
      // be observed.
      lookupOrder = "after";
    });

    const { result } = renderHook(() => useConnectionMutations());
    await act(async () => {
      await result.current.removeConnection("c1");
    });

    expect(lookupOrder).toBe("after");
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Connection "Local PG" removed.',
    );
  });
});
