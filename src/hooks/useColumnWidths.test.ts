// Written 2026-05-16 — regression lock for the IPC SOT switch.
//
// Reason: the earlier localStorage-backed persistence was retired by decision
// Q20.4 (`datagrid_column_prefs` SQLite SOT). The invariants:
//   (1) zero getItem / setItem calls on `column-widths:*` LS keys,
//   (2) with a `pk`, one `get_datagrid_prefs` IPC on mount,
//   (3) on drag end (setWidth), a `set_datagrid_prefs` IPC widths patch,
//   (4) on reset(), a `reset_datagrid_prefs` call for the widths field.
// Without a `pk` (ad-hoc query grid) the hook is in-memory only — no IPC
// calls and no LS access.
//
// Maps to AC-369-08.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { ColumnCategory } from "@/lib/columnCategory";

import { useColumnWidths } from "./useColumnWidths";

type Col = { name: string; category: ColumnCategory };

function setRootFontSize(px: number): void {
  document.documentElement.style.fontSize = `${px}px`;
}

const PK = {
  connectionId: "c1",
  paradigm: "rdb" as const,
  dbName: "appdb",
  namespace: "public",
  tableName: "users",
};

// Mock the IPC wrapper. Tests assert against the spy directly so we don't
// depend on a live Tauri runtime in jsdom.
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
  resetDatagridPrefs,
  setDatagridPrefs,
} from "@/lib/tauri/datagrid_prefs";

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("useColumnWidths — initial mount (P1: hook layer)", () => {
  it("computes default rem * rootFontSize per column when no pk and no persisted state", () => {
    setRootFontSize(16);
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() => useColumnWidths(cols));

    expect(result.current.widths).toEqual({ active: 64, label: 240 });
  });
});

describe("useColumnWidths — IPC hydration (AC-369-08)", () => {
  it("calls get_datagrid_prefs once on mount when pk is provided", async () => {
    setRootFontSize(16);
    const cols: Col[] = [{ name: "active", category: "bool" }];

    renderHook(() => useColumnWidths(cols, PK));
    await waitFor(() => {
      expect(getDatagridPrefs).toHaveBeenCalledTimes(1);
    });
    expect((getDatagridPrefs as Mock).mock.calls[0]?.[0]).toEqual(PK);
  });

  it("applies stored widths from the IPC response", async () => {
    setRootFontSize(16);
    (getDatagridPrefs as Mock).mockResolvedValueOnce({
      widths: { active: 333, label: 444 },
      hiddenColumns: [],
      updatedAt: 1,
    });
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() => useColumnWidths(cols, PK));
    await waitFor(() => {
      expect(result.current.widths.active).toBe(333);
      expect(result.current.widths.label).toBe(444);
    });
  });

  it("falls back to defaults when IPC returns empty widths", async () => {
    setRootFontSize(16);
    (getDatagridPrefs as Mock).mockResolvedValueOnce({
      widths: {},
      hiddenColumns: [],
      updatedAt: null,
    });
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() => useColumnWidths(cols, PK));
    await waitFor(() => {
      expect(result.current.widths.active).toBe(64);
    });
  });

  it("ignores IPC failure silently and keeps defaults (best-effort load)", async () => {
    setRootFontSize(16);
    (getDatagridPrefs as Mock).mockRejectedValueOnce(new Error("network"));
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() => useColumnWidths(cols, PK));

    // Defaults are visible immediately; IPC rejection is swallowed so the
    // hook doesn't crash the calling tree.
    expect(result.current.widths.active).toBe(64);
    await waitFor(() => {
      expect(getDatagridPrefs).toHaveBeenCalled();
    });
    expect(result.current.widths.active).toBe(64);
  });
});

describe("useColumnWidths — IPC write (AC-369-08)", () => {
  it("setWidth dispatches set_datagrid_prefs with widths patch", async () => {
    setRootFontSize(16);
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() => useColumnWidths(cols, PK));
    // Wait for hydration to settle so subsequent setWidth isn't racing the
    // mount effect.
    await waitFor(() => {
      expect(getDatagridPrefs).toHaveBeenCalled();
    });

    act(() => {
      result.current.setWidth("active", 200);
    });

    await waitFor(() => {
      expect(setDatagridPrefs).toHaveBeenCalledTimes(1);
    });
    const arg = (setDatagridPrefs as Mock).mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      ...PK,
      widths: expect.objectContaining({ active: 200 }),
    });
    // Hidden columns must not be in the patch — widths and hidden columns
    // are independent.
    expect(arg.hiddenColumns).toBeUndefined();
  });

  it("setWidth changes only the targeted column, leaves others intact", () => {
    setRootFontSize(16);
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() => useColumnWidths(cols));

    act(() => {
      result.current.setWidth("active", 200);
    });

    expect(result.current.widths.active).toBe(200);
    expect(result.current.widths.label).toBe(240);
  });
});

describe("useColumnWidths — reset (AC-369-08 + codex 7차 #1)", () => {
  it("reset() dispatches resetDatagridPrefs with field='widths' only", async () => {
    setRootFontSize(16);
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() => useColumnWidths(cols, PK));
    await waitFor(() => {
      expect(getDatagridPrefs).toHaveBeenCalled();
    });

    act(() => {
      result.current.setWidth("active", 999);
    });
    expect(result.current.widths.active).toBe(999);

    act(() => {
      result.current.reset();
    });

    expect(result.current.widths.active).toBe(64);
    await waitFor(() => {
      expect(resetDatagridPrefs).toHaveBeenCalledTimes(1);
    });
    expect((resetDatagridPrefs as Mock).mock.calls[0]?.[0]).toEqual({
      ...PK,
      field: "widths",
    });
  });

  it("reset() with no pk → just resets in memory, no IPC", () => {
    setRootFontSize(16);
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() => useColumnWidths(cols));
    act(() => {
      result.current.setWidth("active", 999);
      result.current.reset();
    });

    expect(result.current.widths.active).toBe(64);
    expect(resetDatagridPrefs).not.toHaveBeenCalled();
  });
});

describe("useColumnWidths — invariant: 0 LS access for legacy keys", () => {
  it("never reads or writes column-widths:* localStorage with pk", () => {
    setRootFontSize(16);
    const getSpy = vi.spyOn(window.localStorage, "getItem");
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() => useColumnWidths(cols, PK));
    act(() => {
      result.current.setWidth("active", 200);
    });

    const reads = getSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("column-widths:"),
    );
    const writes = setSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("column-widths:"),
    );
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("never reads or writes column-widths:* localStorage without pk", () => {
    setRootFontSize(16);
    const getSpy = vi.spyOn(window.localStorage, "getItem");
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() => useColumnWidths(cols));
    act(() => {
      result.current.setWidth("active", 200);
    });

    const reads = getSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("column-widths:"),
    );
    const writes = setSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("column-widths:"),
    );
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
