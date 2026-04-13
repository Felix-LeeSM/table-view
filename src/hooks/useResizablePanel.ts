import { useState, useRef, useCallback } from "react";

export interface UseResizablePanelOptions {
  /** Axis of resize: "horizontal" (width) or "vertical" (height). */
  axis: "horizontal" | "vertical";
  /** Minimum value in pixels (for horizontal) or percentage (for vertical). */
  min: number;
  /** Maximum value in pixels (for horizontal) or percentage (for vertical). */
  max: number;
  /** Initial size value (pixels for horizontal, percentage for vertical). */
  initial: number;
  /**
   * When true, the hook interprets sizes as percentages of the container.
   * The caller must supply a ref to the container element so the hook can
   * compute pixel deltas into percentage units.
   */
  percentage?: boolean;
  /**
   * Ref to the container element. Required when `percentage` is true so the
   * hook can measure the container size.
   */
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export interface UseResizablePanelReturn {
  /** Current size (pixels or percentage, depending on `percentage` option). */
  size: number;
  /** Setter to update size imperatively. */
  setSize: (size: number) => void;
  /** Ref that should be attached to the resizable element. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** mousedown handler for the resize handle. */
  handleMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Hook for panel resize via mouse drag.
 *
 * - **Horizontal mode**: Tracks pixel width. Writes directly to `panelRef` DOM
 *   during drag for performance, commits final value to React state on mouseup.
 * - **Vertical/percentage mode**: Tracks a percentage value. Updates React state
 *   on every mousemove (lightweight for a single number).
 *
 * Both modes manage `document.body` cursor and user-select styles during drag
 * and clean up on mouseup.
 */
export function useResizablePanel(
  options: UseResizablePanelOptions,
): UseResizablePanelReturn {
  const { axis, min, max, initial, percentage = false, containerRef } = options;

  const [size, setSize] = useState(initial);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startPos: number; startSize: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      dragRef.current = {
        startPos: axis === "horizontal" ? e.clientX : e.clientY,
        startSize: size,
      };

      const clientField = axis === "horizontal" ? "clientX" : "clientY";
      const cursor = axis === "horizontal" ? "col-resize" : "row-resize";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;

        const delta = moveEvent[clientField] - dragRef.current.startPos;

        if (percentage && containerRef?.current) {
          // Percentage mode: delta / containerSize * 100
          const containerSize =
            axis === "horizontal"
              ? containerRef.current.clientWidth
              : containerRef.current.clientHeight;
          const pctDelta = (delta / containerSize) * 100;
          const newPct = Math.max(
            min,
            Math.min(max, dragRef.current.startSize + pctDelta),
          );
          setSize(newPct);
        } else if (panelRef.current) {
          // Pixel mode: write directly to DOM during drag
          const newWidth = Math.max(
            min,
            Math.min(max, dragRef.current.startSize + delta),
          );
          panelRef.current.style.width = `${newWidth}px`;
        }
      };

      const handleMouseUp = () => {
        if (!percentage && panelRef.current && dragRef.current) {
          // Commit final DOM width to React state
          const finalWidth = parseInt(panelRef.current.style.width, 10);
          if (!Number.isNaN(finalWidth)) {
            setSize(finalWidth);
          }
        }
        dragRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
    },
    [axis, min, max, size, percentage, containerRef],
  );

  return { size, setSize, panelRef, handleMouseDown };
}
