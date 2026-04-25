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
