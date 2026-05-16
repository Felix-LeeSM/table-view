// 작성 2026-05-16 (Phase 4 sprint-369) — IPC SOT 전환 회귀 lock.
//
// 사유: sprint-317 시점 의 `hidden-columns:<key>` localStorage 영속은
// Q20.5 결정 (`datagrid_column_prefs.hidden_columns_json` SQLite SOT) 으로
// 폐지. 본 sprint 의 invariant:
//   (1) `hidden-columns:*` LS key 의 getItem / setItem 0회,
//   (2) `pk` 가 주어지면 mount 시 `get_datagrid_prefs` IPC 1회,
//   (3) hide/show/toggle/clear 호출 시 `set_datagrid_prefs` 의 hiddenColumns
//       patch (clear 는 빈 배열),
//   (4) 명시적 reset 은 `reset_datagrid_prefs(field="hiddenColumns")` 로
//       옵셔널 (UI 가 clear() 와 별도로 노출하는 경우).
//
// AC-369-09 매핑.

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useHiddenColumns } from "./useHiddenColumns";

const PK = {
  connectionId: "c1",
  paradigm: "document" as const,
  dbName: "appdb",
  namespace: "appdb",
  tableName: "users",
};

vi.mock("@/lib/tauri/datagrid_prefs", () => ({
  getDatagridPrefs: vi.fn(async () => ({
    widths: {},
    hiddenColumns: [],
    updatedAt: null,
  })),
  setDatagridPrefs: vi.fn(async () => undefined),
  resetDatagridPrefs: vi.fn(async () => undefined),
}));

import {
  getDatagridPrefs,
  setDatagridPrefs,
  resetDatagridPrefs,
} from "@/lib/tauri/datagrid_prefs";

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("useHiddenColumns — in-memory mode", () => {
  it("starts empty when no pk and no persisted state", () => {
    const { result } = renderHook(() => useHiddenColumns());
    expect(result.current.hidden.size).toBe(0);
    expect(result.current.isHidden("foo")).toBe(false);
  });

  it("hides a column and reflects it through isHidden", () => {
    const { result } = renderHook(() => useHiddenColumns());
    act(() => {
      result.current.hide("foo");
    });
    expect(result.current.hidden.has("foo")).toBe(true);
    expect(result.current.isHidden("foo")).toBe(true);
  });

  it("show() removes a column, clear() wipes all", () => {
    const { result } = renderHook(() => useHiddenColumns());
    act(() => {
      result.current.hide("a");
      result.current.hide("b");
      result.current.show("a");
    });
    expect(result.current.hidden.has("a")).toBe(false);
    expect(result.current.hidden.has("b")).toBe(true);

    act(() => {
      result.current.clear();
    });
    expect(result.current.hidden.size).toBe(0);
  });

  it("toggle() flips state both directions", () => {
    const { result } = renderHook(() => useHiddenColumns());
    act(() => {
      result.current.toggle("x");
    });
    expect(result.current.isHidden("x")).toBe(true);
    act(() => {
      result.current.toggle("x");
    });
    expect(result.current.isHidden("x")).toBe(false);
  });

  it("does not call any IPC when no pk is provided", () => {
    const { result } = renderHook(() => useHiddenColumns());
    act(() => {
      result.current.hide("a");
      result.current.show("a");
      result.current.toggle("b");
      result.current.clear();
    });
    expect(setDatagridPrefs).not.toHaveBeenCalled();
    expect(getDatagridPrefs).not.toHaveBeenCalled();
    expect(resetDatagridPrefs).not.toHaveBeenCalled();
  });
});

describe("useHiddenColumns — IPC hydration (AC-369-09)", () => {
  it("calls get_datagrid_prefs once on mount when pk is provided", async () => {
    renderHook(() => useHiddenColumns(PK));
    await waitFor(() => {
      expect(getDatagridPrefs).toHaveBeenCalledTimes(1);
    });
    expect((getDatagridPrefs as Mock).mock.calls[0]?.[0]).toEqual(PK);
  });

  it("applies stored hiddenColumns from the IPC response", async () => {
    (getDatagridPrefs as Mock).mockResolvedValueOnce({
      widths: {},
      hiddenColumns: ["legacy", "internal"],
      updatedAt: 1,
    });
    const { result } = renderHook(() => useHiddenColumns(PK));
    await waitFor(() => {
      expect(result.current.isHidden("legacy")).toBe(true);
      expect(result.current.isHidden("internal")).toBe(true);
    });
  });

  it("swallows IPC failure and keeps empty hidden set", async () => {
    (getDatagridPrefs as Mock).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useHiddenColumns(PK));
    await waitFor(() => {
      expect(getDatagridPrefs).toHaveBeenCalled();
    });
    expect(result.current.hidden.size).toBe(0);
  });
});

describe("useHiddenColumns — IPC write (AC-369-09)", () => {
  it("hide dispatches set_datagrid_prefs with hiddenColumns patch (no widths)", async () => {
    const { result } = renderHook(() => useHiddenColumns(PK));
    await waitFor(() => {
      expect(getDatagridPrefs).toHaveBeenCalled();
    });

    act(() => {
      result.current.hide("email");
    });

    await waitFor(() => {
      expect(setDatagridPrefs).toHaveBeenCalledTimes(1);
    });
    const arg = (setDatagridPrefs as Mock).mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      ...PK,
      hiddenColumns: ["email"],
    });
    expect(arg.widths).toBeUndefined();
  });

  it("clear() empties the set AND dispatches hiddenColumns: []", async () => {
    (getDatagridPrefs as Mock).mockResolvedValueOnce({
      widths: {},
      hiddenColumns: ["a", "b"],
      updatedAt: 1,
    });
    const { result } = renderHook(() => useHiddenColumns(PK));
    await waitFor(() => {
      expect(result.current.hidden.size).toBe(2);
    });

    act(() => {
      result.current.clear();
    });
    await waitFor(() => {
      expect(setDatagridPrefs).toHaveBeenCalled();
    });
    const calls = (setDatagridPrefs as Mock).mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.hiddenColumns).toEqual([]);
  });
});

describe("useHiddenColumns — invariant: 0 LS access for legacy keys", () => {
  it("never reads or writes hidden-columns:* localStorage with pk", () => {
    const getSpy = vi.spyOn(window.localStorage, "getItem");
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    const { result } = renderHook(() => useHiddenColumns(PK));
    act(() => {
      result.current.hide("a");
      result.current.show("a");
    });

    const reads = getSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("hidden-columns:"),
    );
    const writes = setSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("hidden-columns:"),
    );
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("never reads or writes hidden-columns:* localStorage without pk", () => {
    const getSpy = vi.spyOn(window.localStorage, "getItem");
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    const { result } = renderHook(() => useHiddenColumns());
    act(() => {
      result.current.hide("a");
      result.current.show("a");
    });

    const reads = getSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("hidden-columns:"),
    );
    const writes = setSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("hidden-columns:"),
    );
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
