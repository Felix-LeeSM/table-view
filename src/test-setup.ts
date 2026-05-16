import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import { useDataGridEditStore } from "@stores/dataGridEditStore";

// sprint-366 (2026-05-16, Phase 4 Q15) — workspace tree components read
// their connection identity from `useCurrentWindowConnectionId()` which
// delegates to `getCurrentWindowLabel()`. The real implementation calls
// `getCurrentWebviewWindow()` and returns `null` outside Tauri (which
// would already be safe in jsdom), but tests that need to drive a
// *specific* connection id via the label must override the mock per
// test. Hoist the mock to setup so every test file gets a `vi.fn()`
// that can be re-pointed by `setFakeWindowConnectionId()` without
// per-file `vi.mock` boilerplate. Tests that need the real helpers
// (`window-label.test.ts`) declare their own `vi.mock` with
// `vi.importActual` to opt back in.
vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(() => null),
  };
});

// Sprint 251 — `dataGridEditStore` is a singleton across the test process.
// Without a per-test reset, pending state from one test leaks into the
// next via the `(connectionId, schema, table)` keying — many existing
// suites (`useDataGridEdit.undo.test.ts`, `useDataGridEdit.onblur.test.ts`,
// `DataGrid.editing.test.tsx`, etc.) share the canonical
// `("conn1", "public", "users")` fixture. Resetting in setup keeps those
// tests byte-identical (no `beforeEach` edits required) while the new
// store backs the per-mount lifecycle correctly.
beforeEach(() => {
  useDataGridEditStore.setState({ entries: new Map() });
});

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
