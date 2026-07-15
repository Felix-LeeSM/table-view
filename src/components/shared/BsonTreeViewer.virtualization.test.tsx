import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import BsonTreeViewer from "./BsonTreeViewer";

/**
 * #1445 — BsonTreeViewer used to render its entire flat node list
 * (`flat.map`), so expanding a 10k-element array mounted 10k rows and hung
 * the tab. It now hands rendering off to `@tanstack/react-virtual` past the
 * shared threshold. jsdom reports zero-size elements, which makes the
 * virtualizer think there's no viewport; the same `HTMLElement.prototype`
 * size polyfill SchemaTree's virtualization test uses lifts it to a stable
 * window. RED (pre-fix): every array element renders, so the windowed
 * assertion fails.
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

describe("BsonTreeViewer virtualization (#1445)", () => {
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

  it("windows a large root array instead of rendering every element", () => {
    // Root array auto-expands (depth <= 1), so a 2,000-element array flattens
    // to ~2,001 rows — well past the 200-row threshold.
    const value = Array.from({ length: 2_000 }, (_, i) => i);
    render(<BsonTreeViewer value={value} />);

    const treeitems = screen.getAllByRole("treeitem");
    // Windowed: only a viewport-sized slice (+overscan) is in the DOM, not
    // all 2,001 rows.
    expect(treeitems.length).toBeGreaterThan(0);
    expect(treeitems.length).toBeLessThanOrEqual(100);
  });

  it("renders every row eagerly when below the threshold", () => {
    const value = Array.from({ length: 10 }, (_, i) => i);
    render(<BsonTreeViewer value={value} />);
    // root + 10 elements = 11 treeitems, all present (no windowing).
    expect(screen.getAllByRole("treeitem")).toHaveLength(11);
  });
});
