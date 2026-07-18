// Purpose: column-resize drag lifecycle — Esc-revert + commit semantics (2026-07-18)
// 사용자 요구: 모든 draggable 은 드래그 중 Esc 로 시작 크기 복원. 이 파일은
// 리사이즈 드래그 한정 요구를 useColumnResize 레이어에서 고정한다.
// 컴포넌트 wiring (HeaderRow grip → hook) 은 DataGridTable.column-resize.test.tsx 담당.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
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

  // Reason: 정상 리사이즈는 기존대로 새 폭을 커밋 — Esc 추가가 회귀시키지 않음 (2026-07-18)
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

  // Reason: 드래그 중 Esc → --cols 를 시작 폭으로 복원 + 커밋 취소 (2026-07-18)
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

  // Reason: Esc 이후 trailing mouseup 이 커밋하지 않고, 리스너가 누수 없이 해제됨 (2026-07-18)
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
