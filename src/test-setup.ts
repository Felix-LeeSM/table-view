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
