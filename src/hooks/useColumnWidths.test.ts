// 작성 2026-05-16 (Phase 4 sprint-369) — IPC SOT 전환 회귀 lock.
//
// 사유: sprint-258 / sprint-259 시점의 localStorage-backed 영속은 Q20.4 결정
// (`datagrid_column_prefs` SQLite SOT) 으로 폐지. 본 sprint 의 invariant 는
//   (1) `column-widths:*` LS key 의 getItem / setItem 0회,
//   (2) `pk` 가 주어지면 mount 시 `get_datagrid_prefs` IPC 1회,
//   (3) drag end (setWidth) 시 `set_datagrid_prefs` IPC widths patch,
//   (4) reset() 시 `reset_datagrid_prefs` 의 widths field 호출.
// `pk` 미제공 (ad-hoc query grid) 은 in-memory only — IPC 호출 / LS 접근 모두 0.
//
// AC-369-08 매핑.

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

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
  setDatagridPrefs,
  resetDatagridPrefs,
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
    // Hidden 은 patch 에 포함되면 안 됨 — codex 7차 #1 의 독립성.
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
