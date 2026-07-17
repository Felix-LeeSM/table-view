import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { DocumentTreePanel } from "./DocumentTreePanel";

function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

// A 1,000-deep object is depth-capped by jsonTree to `MAX_TREE_DEPTH = 200`
// levels; the deepest emitted container is flagged `truncated` and its children
// are cut from the walk. Each level's path is one more `nested` segment, so the
// truncated container sits at 200 segments and the last surviving container at
// 199.
function deepDoc(): Record<string, unknown> {
  let deep: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < 1000; i += 1) deep = { nested: deep };
  return deep;
}
const TRUNCATED_PATH = Array(200).fill("nested").join(".");
const SURVIVING_PATH = Array(199).fill("nested").join(".");

function scrollToBottom() {
  const list = screen.getByTestId("document-tree-list");
  Object.defineProperty(list, "scrollTop", {
    configurable: true,
    get: () => 10_000_000,
  });
  fireEvent.scroll(list);
}

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

  // #1448 review B2 — the "…truncated" marker must still surface. Without
  // onCommitEdit the flat row list is nodes-only, so the marker is the last
  // row; scrolling the windowed list to the bottom brings it into view.
  it("still surfaces the truncated marker for a depth-capped document", () => {
    render(<DocumentTreePanel value={deepDoc()} fieldName="deep" />);
    scrollToBottom();
    expect(screen.getByTestId("tree-truncated")).toBeInTheDocument();
  });

  // Issue #1619 E2 — a "…truncated" status row is `focusable: false` in the
  // roving map (rovingRows sets `focusable: !node.truncated`), so it must stay
  // OUT of the keyboard tab order. Pressing End (jump to last focusable row)
  // must land the single tab stop on the deepest SURVIVING container, never on
  // the truncated marker. Regression guard: if the marker became focusable, End
  // would anchor a key with no matching tab-stop element and the tree would
  // lose its only tab stop (zero rows with tabindex=0). (2026-07-17)
  it("keeps the truncated marker out of the roving tab order (End skips it)", async () => {
    render(<DocumentTreePanel value={deepDoc()} fieldName="deep" />);
    scrollToBottom();
    expect(screen.getByTestId("tree-truncated")).toHaveAttribute(
      "tabindex",
      "-1",
    );

    const list = screen.getByTestId("document-tree-list");
    fireEvent.keyDown(list, { key: "End" });
    await flushRaf();

    // The single tab stop survives and sits on the deepest surviving container
    // (depth 199), not on the truncated marker (depth 200).
    const surviving = screen.getByTestId(`tree-node-${SURVIVING_PATH}`);
    expect(surviving).toHaveAttribute("tabindex", "0");
    const tabbable = screen
      .getAllByRole("treeitem")
      .filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toEqual([surviving]);
  });

  // #1448 review B1 (data integrity) — a depth-capped truncated container had
  // its real children cut from the walk, so it must NOT get a trailing `+ key`
  // affordance: commitAddKey's duplicate check only scans the truncated node
  // list and would silently overwrite a cut child (the hostile-data path
  // #1445/#1508 defends). The next-shallower container still gets its affordance.
  it("does not emit an add-key affordance under a truncated container", () => {
    render(
      <DocumentTreePanel
        value={deepDoc()}
        fieldName="deep"
        onCommitEdit={() => {}}
      />,
    );
    scrollToBottom();
    expect(
      document.querySelector(
        `[data-testid="tree-add-key-row-${SURVIVING_PATH}"]`,
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(
        `[data-testid="tree-add-key-row-${TRUNCATED_PATH}"]`,
      ),
    ).toBeNull();
  });
});
