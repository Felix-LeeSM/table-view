import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";

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
