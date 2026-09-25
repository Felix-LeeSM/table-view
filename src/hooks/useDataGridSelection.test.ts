// AC-193-02 — unit tests for the `useDataGridSelection` sub-hook. Asserts
// the four branches (single click / meta-toggle add+remove / shift-range /
// shift-fallback) directly. `useDataGridEdit.multi-select.test.ts` keeps the
// integration assertions, while this file isolates the hook-level selection
// state machine.
// date 2026-05-02.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDataGridSelection } from "./useDataGridSelection";

describe("useDataGridSelection", () => {
  // [AC-193-02-1] A plain click selects a single row and sets the anchor,
  // which becomes the range start for a later shift-click.
  // date 2026-05-02
  it("[AC-193-02-1] plain click selects single row and sets anchor", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(3, false, false);
    });
    expect([...result.current.selectedRowIds]).toEqual([3]);
    expect(result.current.anchorRowIdx).toBe(3);
    expect(result.current.selectedRowIdx).toBe(3);
  });

  // [AC-193-02-2] A meta-click toggles the row into the set. The anchor is
  // set only on the first add and must be kept afterwards so a later
  // shift-range works as intended.
  // date 2026-05-02
  it("[AC-193-02-2] meta-click toggles row in (add) and pins anchor", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    act(() => {
      result.current.handleSelectRow(5, true, false);
    });
    expect([...result.current.selectedRowIds].sort()).toEqual([2, 5]);
    expect(result.current.anchorRowIdx).toBe(2);
    // size === 2, so selectedRowIdx is null.
    expect(result.current.selectedRowIdx).toBeNull();
  });

  // [AC-193-02-3] A meta-click toggles an already selected row off — the
  // user flow of taking one row back out of a multi-row selection.
  // date 2026-05-02
  it("[AC-193-02-3] meta-click toggles row out (remove)", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    act(() => {
      result.current.handleSelectRow(5, true, false);
    });
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    expect([...result.current.selectedRowIds]).toEqual([5]);
    // size drops to 1, so selectedRowIdx is non-null again.
    expect(result.current.selectedRowIdx).toBe(5);
  });

  // [AC-193-02-4] A shift-click with an anchor selects the inclusive range,
  // replacing the existing set (replace, not extend).
  // date 2026-05-02
  it("[AC-193-02-4] shift-click with anchor selects inclusive range", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(2, false, false);
    });
    act(() => {
      result.current.handleSelectRow(5, false, true);
    });
    expect([...result.current.selectedRowIds].sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5,
    ]);
    // The anchor is kept (the next shift-click must be able to take a new
    // range from the same anchor).
    expect(result.current.anchorRowIdx).toBe(2);
  });

  // [AC-193-02-5] A shift-click with no anchor (initial state) falls back
  // to single selection + sets the anchor, so that a later shift-click does
  // something meaningful.
  // date 2026-05-02
  it("[AC-193-02-5] shift-click without anchor falls back to single selection", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(7, false, true);
    });
    expect([...result.current.selectedRowIds]).toEqual([7]);
    expect(result.current.anchorRowIdx).toBe(7);
  });

  // [AC-193-02-6] clearSelection is the escape hatch the facade calls on a
  // page change. The set is empty and the anchor goes back to null.
  // date 2026-05-02
  it("[AC-193-02-6] clearSelection drops set and anchor", () => {
    const { result } = renderHook(() => useDataGridSelection());
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    act(() => {
      result.current.handleSelectRow(5, true, false);
    });
    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.selectedRowIds.size).toBe(0);
    expect(result.current.anchorRowIdx).toBeNull();
    expect(result.current.selectedRowIdx).toBeNull();
  });
});
