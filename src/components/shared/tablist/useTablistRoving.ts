import { useCallback } from "react";

/**
 * WAI-ARIA tabs roving-tabindex + arrow-key navigation, shared by every
 * hand-rolled horizontal tablist (the editor TabBar, the Records/Structure/
 * ERD sub-tab bar, the search index detail tabs, …). Distinct from
 * `useTreeRoving`: the tabs key model is horizontal with *automatic
 * activation* — moving the roving anchor also selects the tab.
 *
 * - ArrowRight / ArrowLeft — previous / next tab, wrapping at the ends.
 * - Home / End — first / last tab.
 *
 * Each tab element must render `role="tab"`, `data-tab-value={value}`, and
 * `tabIndex={activeValue === value ? 0 : -1}` (exactly one tab stop). The
 * `role="tablist"` container wires `onKeyDown`. On a move the hook calls
 * `onActivate(next)` (automatic activation) then imperatively focuses the
 * target tab — the tab buttons stay mounted across a selection change, so no
 * deferred re-focus is needed (unlike the virtualized tree).
 */
export function useTablistRoving<T extends string>(
  // Tab values in visible order. Only the currently-rendered tabs (e.g. ERD
  // is present for rdb tables only) — the hook navigates exactly this set.
  values: readonly T[],
  activeValue: T | null,
  onActivate: (value: T) => void,
  containerRef: React.RefObject<HTMLElement | null>,
): { onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void } {
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const { key } = e;
      if (
        key !== "ArrowLeft" &&
        key !== "ArrowRight" &&
        key !== "Home" &&
        key !== "End"
      ) {
        return;
      }
      if (values.length === 0) return;

      e.preventDefault();

      // No active value yet (null) anchors at 0 so the first arrow lands on
      // the first / last tab predictably.
      const cur = Math.max(0, values.indexOf(activeValue as T));
      const last = values.length - 1;
      const next =
        key === "Home"
          ? 0
          : key === "End"
            ? last
            : key === "ArrowRight"
              ? cur === last
                ? 0
                : cur + 1
              : cur === 0
                ? last
                : cur - 1;

      const nextValue = values[next]!;
      onActivate(nextValue);
      containerRef.current
        ?.querySelector<HTMLElement>(
          `[data-tab-value="${CSS.escape(nextValue)}"]`,
        )
        ?.focus();
    },
    [values, activeValue, onActivate, containerRef],
  );

  return { onKeyDown };
}
