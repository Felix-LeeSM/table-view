import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import {
  setSchemaStoreState,
  resetStores,
} from "./__tests__/schemaTreeTestHelpers";
import { makeSchemaTreePerfTables } from "./SchemaTree.perfFixtures";
import { ROW_HEIGHT_ESTIMATE } from "./SchemaTree/treeRows";

/**
 * Regression for #1222 — the sidebar SchemaTree virtualized list clipped its
 * bottom rows. Two root causes, both asserted here at the config/behaviour
 * level that jsdom (no real layout) can observe:
 *
 *  1. `useVirtualizer` had no `scrollMargin`, so the "Schemas" header that
 *     precedes the list *inside the same scroll container* shifted every
 *     item's true position — the virtualizer's coordinate origin was the
 *     scroll top, not the list top, so the computed end landed above the
 *     real bottom and the tail clipped.
 *  2. Row wrappers had no `ref={measureElement}`, so the virtualizer never
 *     learned real row heights and `getTotalSize()` stayed pinned to the
 *     26px estimate, under-counting taller rows (search input, etc.).
 *
 * jsdom returns 0 for layout metrics, so — like `SchemaTree.virtualization`
 * — we patch `offset*` / `clientHeight` / `getBoundingClientRect` to give
 * the virtualizer a viewport. Here the patches are per-element: the `role=
 * tree` list reports a `HEADER`-sized `offsetTop` (the header above it) and
 * `data-index` rows report the estimate height, isolating the `scrollMargin`
 * effect from measurement noise.
 */

const VIEWPORT = 520; // ≈ 20 estimated rows.
const HEADER = 260; // ≈ 10 estimated rows of header offset.

const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalOffsetTop = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetTop",
);
const originalClientHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientHeight",
);
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;
const originalResizeObserver = globalThis.ResizeObserver;

// Records every element the virtualizer observes. `measureElement` observes
// each windowed row, so after the fix this contains `data-index` rows.
let observedNodes: Element[] = [];

describe("SchemaTree scroll clipping (#1222)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    observedNodes = [];

    class RecordingResizeObserver {
      observe(el: Element) {
        observedNodes.push(el);
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver =
      RecordingResizeObserver as unknown as typeof ResizeObserver;

    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return 320;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        // Windowed rows report the estimate height so measurement is a
        // numerical no-op and the `scrollMargin` assertion stays isolated.
        return this.hasAttribute("data-index") ? ROW_HEIGHT_ESTIMATE : VIEWPORT;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        // The `role=tree` list is offset by the header height above it.
        return this.getAttribute("role") === "tree" ? HEADER : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return VIEWPORT;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 320,
        bottom: VIEWPORT,
        width: 320,
        height: VIEWPORT,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  });

  afterEach(() => {
    cleanup();
    if (originalOffsetWidth)
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        originalOffsetWidth,
      );
    if (originalOffsetHeight)
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    if (originalOffsetTop)
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetTop",
        originalOffsetTop,
      );
    if (originalClientHeight)
      Object.defineProperty(
        HTMLElement.prototype,
        "clientHeight",
        originalClientHeight,
      );
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    globalThis.ResizeObserver = originalResizeObserver;
  });

  function seedThousandTables() {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: { "conn1:public": makeSchemaTreePerfTables(1000) },
    });
  }

  it("attaches the virtualizer's measureElement ref to each windowed row", async () => {
    seedThousandTables();

    const { unmount } = await act(async () =>
      render(<SchemaTree connectionId="conn1" />),
    );
    // Let measurement + the scrollMargin layout effect settle.
    await act(async () => {});

    // The fix wires `ref={rowVirtualizer.measureElement}` on every row, so
    // the virtualizer observes each `data-index` wrapper to replace the
    // 26px estimate with the real height. Before the fix no such row is
    // ever observed and `getTotalSize()` under-counts, clipping the tail.
    const observedRows = observedNodes.filter((n) =>
      n.hasAttribute("data-index"),
    );
    expect(observedRows.length).toBeGreaterThan(0);

    unmount();
  });

  it("offsets the virtual window by the header height (scrollMargin) when scrolled", async () => {
    seedThousandTables();

    const { unmount } = await act(async () =>
      render(<SchemaTree connectionId="conn1" />),
    );
    await act(async () => {});

    const container = document.querySelector(
      ".flex.flex-col.select-none.overflow-y-auto",
    ) as HTMLDivElement;
    expect(container).not.toBeNull();

    // jsdom doesn't reflow, so set scrollTop directly then dispatch the
    // event the virtualizer listens for.
    container.scrollTop = 520;
    // #1197/#1238 — the scroll event arms @tanstack/virtual-core's
    // isScrolling-reset debounce (a 150ms `setTimeout`,
    // `isScrollingResetDelay`). unmount cleanup only detaches the scroll
    // listener; it does NOT clear this pending timer. Left pending it fires
    // after jsdom teardown and crashes the whole vitest run with an
    // unhandled `ReferenceError: window is not defined`. Fake timers flush
    // it deterministically here, while the window still exists — the same
    // pattern as SchemaTree.workspace-state.test.tsx (a real-timer wait is
    // slower and races the debounce under a loaded CI event loop).
    vi.useFakeTimers();
    try {
      await act(async () => {
        container.dispatchEvent(new Event("scroll"));
      });
      act(() => {
        vi.runOnlyPendingTimers();
      });
    } finally {
      vi.useRealTimers();
    }

    // Scrolled 520px, but the 260px header means the list itself is only
    // 260px in. With `scrollMargin` the window is computed from the list
    // top, so the first rows stay inside the overscan band and table_0000
    // is still rendered. Without it the virtualizer thinks the list is
    // 520px deep and drops table_0000 far above the window.
    expect(screen.getByLabelText("table_0000 table")).toBeInTheDocument();

    unmount();
  });
});
