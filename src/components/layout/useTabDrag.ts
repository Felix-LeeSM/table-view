import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useTabStore, type Tab } from "@stores/tabStore";

// 8px drag-start threshold. The pre-2026-05-11 4px floor produced phantom
// ghosts when a high-DPI trackpad click drifted 2–6px; 8px matches the de
// facto Chrome / VSCode threshold and stays well below the smallest
// intentional drag distance reported in dogfooding.
const DRAG_THRESHOLD_PX = 8;

export interface GhostStyle {
  x: number;
  y: number;
  width: number;
  title: string;
  type: "table" | "query";
}

export interface TabDragHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
}

export interface UseTabDragResult {
  /** Ref to the scroll container the consumer mounts as `role="tablist"`. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Tab id currently being dragged, or `null`. Drives opacity dimming. */
  draggingId: string | null;
  /** Ghost coordinates / metadata, or `null` when no drag is in flight. */
  ghostStyle: GhostStyle | null;
  /**
   * Per-tab pointer handlers. Each invocation returns a fresh handler set
   * bound to `tab` + `displayTitle` (the title shown on the ghost).
   */
  getDragHandlers: (tab: Tab, displayTitle: string) => TabDragHandlers;
  /**
   * True for one macrotask after a drag ends. Consumers gate `onClick` on
   * this so the DOM `click` event that follows a drag's `pointerup` does
   * not re-activate the originating tab.
   */
  shouldSuppressClick: () => boolean;
}

interface DragState {
  tabId: string;
  pointerId: number;
  startX: number;
  isDragging: boolean;
  offsetX: number;
  tabWidth: number;
  tabHeight: number;
  tabTitle: string;
  tabType: "table" | "query";
}

/**
 * Owns the pointer-event drag state for `TabBar`. Encapsulates the
 * `setPointerCapture`-based reorder dance so individual `TabItem`s stay
 * presentational. The 2026-05-11 migration from `mousedown` + document
 * listeners → pointer events + capture lives entirely inside this hook;
 * the previous design was brittle when WKWebView swallowed `mouseup`
 * (cursor released outside the window, OS-level focus pivot, etc.).
 *
 * Drop-target resolution happens inside `onPointerUp`: with the pointer
 * captured on the originating tab, every pointermove / pointerup /
 * pointercancel routes back here regardless of cursor location, so the
 * old strip-level `onMouseUp` (empty-area / inter-tab gap release) is
 * subsumed by per-tab logic that compares cursor X against each tab's
 * bounding box.
 */
export function useTabDrag(): UseTabDragResult {
  const moveTab = useTabStore((s) => s.moveTab);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [ghostStyle, setGhostStyle] = useState<GhostStyle | null>(null);

  const dragStateRef = useRef<DragState | null>(null);
  // Set by pointerup when a real drag occurred, cleared on next tick.
  // The DOM `click` event fires after pointerup; without this guard, a
  // drag that lands back on the originating tab would re-activate it.
  const justDraggedRef = useRef(false);

  const cleanup = (el: HTMLElement, pointerId: number) => {
    dragStateRef.current = null;
    setDraggingId(null);
    setGhostStyle(null);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // jsdom + some legacy WKWebView builds don't implement
    // hasPointerCapture; guard so the wrap-up path never throws.
    try {
      if (el.hasPointerCapture?.(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
    } catch {
      /* best-effort */
    }
  };

  const resolveDropTarget = (
    sourceTabId: string,
    cursorX: number,
  ): { targetId: string; side: "before" | "after" } | null => {
    if (!scrollRef.current) return null;
    const tabEls = Array.from(
      scrollRef.current.querySelectorAll<HTMLElement>("[data-tab-id]"),
    );
    if (tabEls.length === 0) return null;

    const lastEl = tabEls[tabEls.length - 1]!;
    const lastRect = lastEl.getBoundingClientRect();
    let targetEl: HTMLElement;
    let side: "before" | "after";
    if (cursorX >= lastRect.right) {
      // Past the last tab — drop at the end.
      targetEl = lastEl;
      side = "after";
    } else {
      // Find the first tab whose midpoint is ≥ cursor X. That tab is
      // the insertion anchor; before/after is chosen by which half of
      // its rect the cursor sits in.
      const found = tabEls.find((tabEl) => {
        const r = tabEl.getBoundingClientRect();
        return r.left + r.width / 2 >= cursorX;
      });
      if (found) {
        const r = found.getBoundingClientRect();
        targetEl = found;
        side = cursorX < r.left + r.width / 2 ? "before" : "after";
      } else {
        targetEl = lastEl;
        side = "after";
      }
    }
    const targetId = targetEl.getAttribute("data-tab-id");
    if (!targetId || targetId === sourceTabId) return null;
    return { targetId, side };
  };

  const getDragHandlers = (
    tab: Tab,
    displayTitle: string,
  ): TabDragHandlers => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return; // primary button only
      // 2026-05-11 — if pointerdown originated on an interactive child
      // (the close button), let that child own the gesture entirely.
      // `setPointerCapture` on the tab div would re-route the
      // following `pointerup` here and the close button's synthesized
      // `click` would fire on the tab div instead of the button —
      // making the X visually un-clickable. The user-visible symptom
      // before this guard: "탭이 X 버튼을 아무리 눌러도 안 닫힘".
      if ((e.target as Element | null)?.closest("button")) return;
      const el = e.currentTarget;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* best-effort — jsdom may not support setPointerCapture */
      }
      // 2026-05-11 — suppress native text selection for the whole
      // gesture. `setPointerCapture` redirects pointer events but does
      // NOT inhibit the browser's selection logic, which anchors on
      // `mousedown` and extends as the cursor moves. Setting
      // `user-select: none` only on threshold-cross (the pre-fix
      // contract) was too late — the selection had already started.
      // We clear any partial selection too as a defensive belt.
      document.body.style.userSelect = "none";
      window.getSelection?.()?.removeAllRanges?.();
      const rect = el.getBoundingClientRect();
      dragStateRef.current = {
        tabId: tab.id,
        pointerId: e.pointerId,
        startX: e.clientX,
        isDragging: false,
        offsetX: e.clientX - rect.left,
        tabWidth: rect.width,
        tabHeight: rect.height,
        tabTitle: displayTitle,
        tabType: tab.type,
      };
    },
    onPointerMove: (e) => {
      const src = dragStateRef.current;
      if (!src || src.pointerId !== e.pointerId) return;
      const dx = Math.abs(e.clientX - src.startX);
      if (dx > DRAG_THRESHOLD_PX && !src.isDragging) {
        src.isDragging = true;
        setDraggingId(src.tabId);
        document.body.style.cursor = "grabbing";
        // `userSelect = "none"` was already set in `pointerdown` so the
        // browser never anchored a text selection in the first place.
      }
      if (src.isDragging) {
        setGhostStyle({
          x: e.clientX - src.offsetX,
          y: e.clientY - src.tabHeight / 2,
          width: src.tabWidth,
          title: src.tabTitle,
          type: src.tabType,
        });
      }
    },
    onPointerUp: (e) => {
      const src = dragStateRef.current;
      const el = e.currentTarget;
      if (!src || src.pointerId !== e.pointerId) {
        cleanup(el, e.pointerId);
        return;
      }
      // Resolve drop target only when a real drag happened — a pointerup
      // without crossing the threshold is a click and must not reorder.
      if (src.isDragging) {
        justDraggedRef.current = true;
        // Reset on the next macrotask so the immediately-following
        // `click` event sees the flag, but a later click does not.
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
        const drop = resolveDropTarget(src.tabId, e.clientX);
        if (drop) moveTab(src.tabId, drop.targetId, drop.side);
      }
      cleanup(el, e.pointerId);
    },
    onPointerCancel: (e) => {
      cleanup(e.currentTarget, e.pointerId);
    },
  });

  return {
    scrollRef,
    draggingId,
    ghostStyle,
    getDragHandlers,
    shouldSuppressClick: () => justDraggedRef.current,
  };
}
