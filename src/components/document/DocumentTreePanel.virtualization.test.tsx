import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DocumentTreePanel } from "./DocumentTreePanel";

/**
 * #1448 — DocumentTreePanel used to render its whole flat node list
 * (`nodes.map`), so a cell holding a 50k-node capped document (or a wide
 * object with thousands of keys) mounted every row and froze the tab. It now
 * hands rendering off to `@tanstack/react-virtual` past the shared 200-row
 * threshold. jsdom reports zero-size elements, so the virtualizer sees no
 * viewport and mounts nothing; the same `HTMLElement.prototype` size polyfill
 * BsonTreeViewer's virtualization test uses lifts it to a stable window.
 * RED (pre-fix): every row renders, so the windowed assertion fails.
 */

const VIEWPORT_HEIGHT = 600;

const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalClientHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientHeight",
);
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;

describe("DocumentTreePanel virtualization (#1448)", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return 320;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return VIEWPORT_HEIGHT;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return VIEWPORT_HEIGHT;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 320,
        bottom: VIEWPORT_HEIGHT,
        width: 320,
        height: VIEWPORT_HEIGHT,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  });

  afterEach(() => {
    cleanup();
    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        originalOffsetWidth,
      );
    }
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    }
    if (originalClientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientHeight",
        originalClientHeight,
      );
    }
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("windows a wide object instead of mounting every key row", () => {
    // 1,000 keys → root + 1,000 leaves = 1,001 rows, well past the 200 row
    // threshold. Root auto-expands (collapsed set starts empty).
    const wide: Record<string, number> = {};
    for (let i = 0; i < 1_000; i += 1) wide[`k${i}`] = i;
    render(<DocumentTreePanel value={wide} fieldName="wide" />);

    const treeitems = screen.getAllByRole("treeitem");
    // Windowed: only a viewport-sized slice (+ overscan) is in the DOM, not
    // all 1,001 rows.
    expect(treeitems.length).toBeGreaterThan(0);
    expect(treeitems.length).toBeLessThanOrEqual(100);
  });

  it("windows a pathologically deep document (DoS cap surfaces windowed)", () => {
    // 1,000-deep nesting is depth-capped to ~201 rows by jsonTree, which is
    // still past the threshold, so the panel windows it — the DoS defense is a
    // bounded DOM, not a full 201-row mount.
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 1_000; i += 1) deep = { nested: deep };
    render(<DocumentTreePanel value={deep} fieldName="deep" />);

    const treeitems = screen.getAllByRole("treeitem");
    expect(treeitems.length).toBeGreaterThan(0);
    expect(treeitems.length).toBeLessThan(201);
  });

  it("renders every row eagerly when below the threshold", () => {
    const small: Record<string, number> = {};
    for (let i = 0; i < 10; i += 1) small[`k${i}`] = i;
    render(<DocumentTreePanel value={small} fieldName="small" />);
    // root + 10 leaves = 11 rows, all present (no windowing).
    expect(screen.getAllByRole("treeitem")).toHaveLength(11);
  });
});
