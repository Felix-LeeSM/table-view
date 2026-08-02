/**
 * jsdom shims for `@xyflow/react`.
 *
 * React Flow needs three things jsdom does not provide, and all three are
 * required together — dropping any one leaves the canvas with zero rendered
 * nodes:
 *
 * 1. Explicit `width`/`height` on every node object (the caller's job — jsdom
 *    measures every element as 0x0, so React Flow would never adopt a node).
 * 2. A `ResizeObserver` that invokes its callback on `observe()`. The global
 *    one in `src/test-setup.ts` is a no-op because `@tanstack/react-virtual`
 *    needs it to stay quiet; React Flow's `updateNodeInternals` never fires
 *    without a synchronous first callback.
 * 3. `window.DOMMatrixReadOnly`, which `@xyflow/system` constructs from the
 *    viewport transform to read the current zoom (`m22`).
 *
 * On top of that, `updateNodeInternals` skips any node whose `offsetWidth` or
 * `offsetHeight` is 0 — jsdom reports 0 for everything — and a node without
 * measured handle bounds has no edges drawn to it. The `offset*` getters below
 * mirror the inline `style.width` / `style.height` React Flow already writes
 * from `node.width` / `node.height`, which is exactly what a browser would
 * report for these absolutely-sized cards.
 *
 * Install per test file rather than globally: the immediate-callback
 * ResizeObserver and the layout getters change behaviour for the virtualized
 * surfaces that rely on the no-op one.
 */
export function installReactFlowJsdomShims(): () => void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const previousResizeObserver = scope.ResizeObserver;
  const previousDomMatrix = scope.DOMMatrixReadOnly;
  const previousOffsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  const previousOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );

  class ImmediateResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }

    unobserve() {}
    disconnect() {}
  }

  class StubDomMatrixReadOnly {
    // `@xyflow/system` reads only the vertical scale off the viewport
    // transform. Pinning it to 1 means jsdom always reports 100% zoom, so the
    // zoom-percent readout in `SchemaErdCanvas` has no unit coverage: the
    // controls are proven by `e2e/smoke/erd-dense.spec.ts` alone. Driving a
    // real zoom here would need d3-zoom's transitions to run under fake
    // timers, which buys a flaky test for a value e2e already asserts.
    readonly m22 = 1;
  }

  scope.ResizeObserver = ImmediateResizeObserver;
  scope.DOMMatrixReadOnly = StubDomMatrixReadOnly;
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).DOMMatrixReadOnly =
      StubDomMatrixReadOnly;
  }
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return parsePixels(this.style.width);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return parsePixels(this.style.height);
    },
  });

  return () => {
    scope.ResizeObserver = previousResizeObserver;
    scope.DOMMatrixReadOnly = previousDomMatrix;
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>).DOMMatrixReadOnly =
        previousDomMatrix;
    }
    restoreDescriptor("offsetWidth", previousOffsetWidth);
    restoreDescriptor("offsetHeight", previousOffsetHeight);
  };
}

function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function restoreDescriptor(
  property: "offsetWidth" | "offsetHeight",
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(HTMLElement.prototype, property, descriptor);
    return;
  }
  Reflect.deleteProperty(HTMLElement.prototype, property);
}
