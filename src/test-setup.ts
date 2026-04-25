import "@testing-library/jest-dom/vitest";

// crypto.randomUUID polyfill for jsdom (used by FilterBar)
if (typeof crypto.randomUUID !== "function") {
  let counter = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (crypto as any).randomUUID = () => `test-uuid-${++counter}`;
}

// window.matchMedia mock (used by useTheme)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Sprint-112: Radix Select uses pointer-capture + scrollIntoView APIs that
// jsdom doesn't implement. Polyfill them here so the Radix-based <Select>
// component can be opened, navigated, and have its options clicked in tests.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

// Sprint-114: `@tanstack/react-virtual` reads a ResizeObserver from the
// scroll container to react to viewport resizes. jsdom doesn't ship one,
// so the virtualizer crashes during render without this polyfill. We only
// need the no-op surface — tests drive size via `getBoundingClientRect` /
// `clientHeight` overrides where needed.
if (typeof globalThis !== "undefined") {
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  if (!g.ResizeObserver) {
    class NoopResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
}
