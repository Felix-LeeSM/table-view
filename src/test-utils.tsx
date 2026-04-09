import { render, type RenderOptions } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactElement } from "react";

/**
 * Create a reusable Tauri IPC mock factory.
 * Each mock function starts as vi.fn() resolving to a sensible default.
 * Override individual functions via the `overrides` parameter.
 */
export function createTauriMock(
  overrides: Record<string, ReturnType<typeof vi.fn>> = {},
) {
  const defaults: Record<string, ReturnType<typeof vi.fn>> = {
    listConnections: vi.fn(() => Promise.resolve([])),
    saveConnection: vi.fn((conn: unknown) => Promise.resolve(conn)),
    deleteConnection: vi.fn(() => Promise.resolve()),
    testConnection: vi.fn(() => Promise.resolve("Connection successful")),
    connectToDatabase: vi.fn(() => Promise.resolve()),
    disconnectFromDatabase: vi.fn(() => Promise.resolve()),
    listGroups: vi.fn(() => Promise.resolve([])),
    saveGroup: vi.fn((group: unknown) => Promise.resolve(group)),
    deleteGroup: vi.fn(() => Promise.resolve()),
    moveConnectionToGroup: vi.fn(() => Promise.resolve()),
    listSchemas: vi.fn(() => Promise.resolve([])),
    listTables: vi.fn(() => Promise.resolve([])),
    getTableColumns: vi.fn(() => Promise.resolve([])),
    queryTableData: vi.fn(() =>
      Promise.resolve({
        columns: [],
        rows: [],
        total_count: 0,
        page: 1,
        page_size: 100,
        executed_query: "SELECT * FROM test",
      }),
    ),
    getTableIndexes: vi.fn(() => Promise.resolve([])),
    getTableConstraints: vi.fn(() => Promise.resolve([])),
  };
  return { ...defaults, ...overrides };
}

/**
 * Reset a Zustand store to its initial blank state.
 * Pass `initialState` to seed specific values.
 */
export function resetStore<T extends object>(
  useStore: { setState: (partial: Partial<T>) => void; getState: () => T },
  initialState?: Partial<T>,
) {
  // Zustand stores expose setState — use it to wipe everything
  const current = useStore.getState();
  const blank: Record<string, unknown> = {};
  for (const key of Object.keys(current)) {
    blank[key] = undefined;
  }
  useStore.setState({ ...(blank as Partial<T>), ...initialState });
}

/**
 * Render with shared providers.
 * Currently no providers are required (Zustand works without Provider),
 * but this wrapper leaves room for future context providers.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, options);
}
