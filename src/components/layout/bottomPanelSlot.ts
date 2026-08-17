import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

/**
 * The bottom dock's Details tab body, published as a DOM node so the grid can
 * `createPortal` its `QuickLookPanel` into it (#2426).
 *
 * Why a portal and not a lift: the panel needs `data`, `selectedRowIds` and
 * the whole `DataGridEditState` (its commit/undo callbacks included), all of
 * which live in `DataGrid` / `DocumentDataGrid`. Moving them into a store to
 * render the panel from `BottomPanel` would push a callback-bearing object
 * through global state on every selection change. A portal leaves the panel
 * in the grid's React tree — props, context, i18n and focus all keep working
 * — and only relocates the DOM.
 *
 * `null` means no dock is mounted (a grid rendered standalone, as the grid
 * unit tests do). Callers render the panel in place then, which is what they
 * did before the dock existed.
 */
export const BottomPanelDetailsSlotContext = createContext<HTMLElement | null>(
  null,
);

export function useBottomPanelDetailsSlot(): HTMLElement | null {
  return useContext(BottomPanelDetailsSlotContext);
}

/**
 * Put `panel` in the dock's Details tab, or leave it where the caller
 * rendered it when there is no dock. Both grids go through this so the
 * fallback cannot drift between them.
 */
export function renderIntoDetailsSlot(
  slot: HTMLElement | null,
  panel: ReactNode,
): ReactNode {
  return slot ? createPortal(panel, slot) : panel;
}
