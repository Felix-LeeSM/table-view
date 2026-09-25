// Purpose: column-resize drag lifecycle — Esc-revert + commit semantics.
// User requirement: every draggable restores its start size when Esc is
// pressed during the drag. This file pins the resize-drag half of that
// requirement at the useColumnResize layer. Component wiring (HeaderRow grip
// → hook) belongs to DataGridTable.column-resize.test.tsx.

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useColumnResize } from "./useColumnResize";

function parseCols(outer: HTMLElement): number[] {
  const raw = outer.style.getPropertyValue("--cols").trim();
  return raw ? raw.split(/\s+/).map((t) => parseFloat(t)) : [];
}

function setup(widths: number[]) {
  const outer = document.createElement("div");
  const outerRef = { current: outer };
  // getCurrentWidths mirrors React state, which stays at the start widths
  // during a drag (only imperative --cols moves).
  const getCurrentWidths = () => widths;
  const onCommitWidth = vi.fn();
  const { result } = renderHook(() =>
    useColumnResize({ outerRef, getCurrentWidths, onCommitWidth }),
  );
  return { outer, onCommitWidth, result };
}

const mouseDown = (clientX: number) =>
  ({
    clientX,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  }) as unknown as React.MouseEvent;

describe("useColumnResize", () => {
  afterEach(() => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  // Reason: a normal resize still commits the new width — adding Esc does
  // not regress it.
  it("commits the dragged width on mouseup", () => {
    const { outer, onCommitWidth, result } = setup([100, 150]);

    act(() => result.current.handleResizeStart(mouseDown(0), "id", 0));
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    });
    expect(parseCols(outer)).toEqual([150, 150]);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(onCommitWidth).toHaveBeenCalledTimes(1);
    expect(onCommitWidth).toHaveBeenCalledWith("id", 150);
  });

  // Reason: Esc during the drag restores --cols to the start width and
  // cancels the commit.
  it("Esc reverts --cols to the start width and cancels the commit", () => {
    const { outer, onCommitWidth, result } = setup([100, 150]);

    act(() => result.current.handleResizeStart(mouseDown(0), "id", 0));
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    });
    expect(parseCols(outer)).toEqual([150, 150]);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    // Reverted to the drag-start width, no persist commit.
    expect(parseCols(outer)).toEqual([100, 150]);
    expect(onCommitWidth).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  // Reason: a trailing mouseup after Esc does not commit, and the listeners
  // are detached without leaking.
  it("does not commit or react to further events after Esc", () => {
    const { outer, onCommitWidth, result } = setup([100, 150]);

    act(() => result.current.handleResizeStart(mouseDown(0), "id", 0));
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 500 }));
    });

    expect(onCommitWidth).not.toHaveBeenCalled();
    // Listeners torn down: --cols stays at the reverted start width.
    expect(parseCols(outer)).toEqual([100, 150]);
  });
});
