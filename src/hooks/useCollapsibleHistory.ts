import { useState } from "react";

/**
 * Default visible count for history-like surfaces (#1309). The shared convention
 * is "show the most recent ~N, collapse the rest behind one toggle". Kept as a
 * constant so every history surface (query history panel, recent tables, …)
 * opens at the same depth.
 */
export const HISTORY_DEFAULT_VISIBLE = 5;

export interface CollapsibleHistory<T> {
  /** Items to render right now — first `defaultVisible` while collapsed. */
  visible: T[];
  /** Whether the caller has expanded to the full list. */
  expanded: boolean;
  /** True only when there is more than `defaultVisible` to collapse. */
  canToggle: boolean;
  /** How many items are currently hidden (0 when expanded or below cap). */
  hiddenCount: number;
  /** Flip the collapsed/expanded state (session-local). */
  toggle: () => void;
}

/**
 * Caps a list to the first `defaultVisible` items with an in-session
 * collapse/expand toggle. Pure view-model over an existing array — the source
 * list (store, IPC page, …) is untouched, so it composes with server
 * pagination or store limits already in place.
 */
export function useCollapsibleHistory<T>(
  items: T[],
  defaultVisible: number = HISTORY_DEFAULT_VISIBLE,
): CollapsibleHistory<T> {
  const [expanded, setExpanded] = useState(false);
  const canToggle = items.length > defaultVisible;
  const visible =
    expanded || !canToggle ? items : items.slice(0, defaultVisible);
  return {
    visible,
    expanded,
    canToggle,
    hiddenCount: items.length - visible.length,
    toggle: () => setExpanded((prev) => !prev),
  };
}
