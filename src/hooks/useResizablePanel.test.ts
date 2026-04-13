import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResizablePanel } from "./useResizablePanel";

describe("useResizablePanel", () => {
  afterEach(() => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("returns initial size", () => {
    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "horizontal",
        min: 100,
        max: 500,
        initial: 250,
      }),
    );
    expect(result.current.size).toBe(250);
  });

  it("returns a panelRef and handleMouseDown", () => {
    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "horizontal",
        min: 100,
        max: 500,
        initial: 250,
      }),
    );
    expect(result.current.panelRef).toBeDefined();
    expect(typeof result.current.handleMouseDown).toBe("function");
  });

  // --- Horizontal (pixel) mode ---

  it("sets cursor and userSelect on mousedown in horizontal mode", () => {
    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "horizontal",
        min: 100,
        max: 500,
        initial: 250,
      }),
    );

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientX: 250,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });

    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
  });

  it("updates DOM width on mousemove in horizontal mode", () => {
    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "horizontal",
        min: 100,
        max: 500,
        initial: 250,
      }),
    );

    // Simulate a panel element
    const mockDiv = document.createElement("div");
    mockDiv.style.width = "250px";
    result.current.panelRef.current = mockDiv;

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientX: 250,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
    });

    // Width should be 250 + 50 = 300
    expect(mockDiv.style.width).toBe("300px");
  });

  it("commits final size on mouseup in horizontal mode", () => {
    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "horizontal",
        min: 100,
        max: 500,
        initial: 250,
      }),
    );

    const mockDiv = document.createElement("div");
    mockDiv.style.width = "250px";
    result.current.panelRef.current = mockDiv;

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientX: 250,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(result.current.size).toBe(300);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("clamps to min in horizontal mode", () => {
    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "horizontal",
        min: 100,
        max: 500,
        initial: 250,
      }),
    );

    const mockDiv = document.createElement("div");
    mockDiv.style.width = "250px";
    result.current.panelRef.current = mockDiv;

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientX: 250,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0 }));
    });

    expect(mockDiv.style.width).toBe("100px");
  });

  it("clamps to max in horizontal mode", () => {
    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "horizontal",
        min: 100,
        max: 500,
        initial: 250,
      }),
    );

    const mockDiv = document.createElement("div");
    mockDiv.style.width = "250px";
    result.current.panelRef.current = mockDiv;

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientX: 250,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 1000 }));
    });

    expect(mockDiv.style.width).toBe("500px");
  });

  // --- Vertical (percentage) mode ---

  it("sets row-resize cursor in vertical mode", () => {
    const containerRef = { current: document.createElement("div") };
    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "vertical",
        min: 10,
        max: 90,
        initial: 50,
        percentage: true,
        containerRef,
      }),
    );

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientY: 500,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });

    expect(document.body.style.cursor).toBe("row-resize");
    expect(document.body.style.userSelect).toBe("none");
  });

  it("updates size as percentage on mousemove in vertical mode", () => {
    const container = document.createElement("div");
    // Mock clientHeight
    Object.defineProperty(container, "clientHeight", {
      value: 1000,
      configurable: true,
    });
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "vertical",
        min: 10,
        max: 90,
        initial: 50,
        percentage: true,
        containerRef,
      }),
    );

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientY: 500,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });

    // Move 100px down on a 1000px container = 10% increase
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 600 }));
    });

    expect(result.current.size).toBe(60);
  });

  it("clamps percentage to min in vertical mode", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", {
      value: 1000,
      configurable: true,
    });
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "vertical",
        min: 10,
        max: 90,
        initial: 50,
        percentage: true,
        containerRef,
      }),
    );

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientY: 500,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });

    // Move 500px up = -50%, but clamped to 10
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 0 }));
    });

    expect(result.current.size).toBe(10);
  });

  it("clamps percentage to max in vertical mode", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", {
      value: 1000,
      configurable: true,
    });
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "vertical",
        min: 10,
        max: 90,
        initial: 50,
        percentage: true,
        containerRef,
      }),
    );

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientY: 500,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });

    // Move 1000px down = +100%, but clamped to 90
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 1500 }));
    });

    expect(result.current.size).toBe(90);
  });

  it("cleans up on mouseup in vertical mode", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", {
      value: 1000,
      configurable: true,
    });
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "vertical",
        min: 10,
        max: 90,
        initial: 50,
        percentage: true,
        containerRef,
      }),
    );

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientY: 500,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("setSize updates size directly", () => {
    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "horizontal",
        min: 100,
        max: 500,
        initial: 250,
      }),
    );

    act(() => {
      result.current.setSize(400);
    });
    expect(result.current.size).toBe(400);
  });

  it("no further updates after mouseup", () => {
    const { result } = renderHook(() =>
      useResizablePanel({
        axis: "horizontal",
        min: 100,
        max: 500,
        initial: 250,
      }),
    );

    const mockDiv = document.createElement("div");
    mockDiv.style.width = "250px";
    result.current.panelRef.current = mockDiv;

    const mouseEvent = {
      preventDefault: vi.fn(),
      clientX: 250,
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.handleMouseDown(mouseEvent);
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    const sizeAfterUp = result.current.size;

    // Further mousemove should not affect the committed state
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 500 }));
    });

    expect(result.current.size).toBe(sizeAfterUp);
  });
});
