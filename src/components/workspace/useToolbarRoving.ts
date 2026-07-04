import { useCallback, useEffect, type RefObject } from "react";

/**
 * WAI-ARIA `role="toolbar"` roving-tabindex + arrow navigation for a
 * horizontal toolbar whose controls are owned by heterogeneous child
 * components (DbSwitcher, RowCapSetting, SafeModeToggle, DisconnectButton, …).
 * We can't prop-drill `tabIndex` into every child, so the hook works on the
 * DOM: it enumerates the enabled `<button>` descendants in visual order,
 * keeps exactly one tab stop, and moves focus with ArrowLeft/Right + Home/End.
 *
 * Popover interaction: Radix popovers (the DbSwitcher listbox, RowCap) portal
 * their content to `<body>`, so a popover's own ArrowUp/Down roving never
 * bubbles into this toolbar `onKeyDown` — the two key models don't collide.
 * The trigger button is just one toolbar stop; opening its popover moves focus
 * into the portal, out of the toolbar's reach.
 *
 * React never resets an attribute it doesn't own, so the imperatively-set
 * `tabindex` survives child re-renders. `focusin` reasserts the single tab
 * stop when a control is (un)mounted or toggled enabled between renders.
 *
 * ponytail: enumerates `<button>` only — every current toolbar control is a
 * button. Widen the selector if a non-button focusable control joins.
 */
export function useToolbarRoving(containerRef: RefObject<HTMLElement | null>): {
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
} {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const items = () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).filter((b) => !b.disabled);

    // Initial single tab stop: only the first enabled control is tabbable.
    items().forEach((el, i) => (el.tabIndex = i === 0 ? 0 : -1));

    // Reassert on focus entry so a control that (un)mounted or flipped
    // enabled between renders can't leave a stray second tab stop.
    const onFocusIn = (e: FocusEvent) => {
      const list = items();
      if (!list.includes(e.target as HTMLButtonElement)) return;
      list.forEach((el) => (el.tabIndex = el === e.target ? 0 : -1));
    };
    container.addEventListener("focusin", onFocusIn);
    return () => container.removeEventListener("focusin", onFocusIn);
  }, [containerRef]);

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
      const container = containerRef.current;
      if (!container) return;
      const list = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).filter((b) => !b.disabled);
      if (list.length === 0) return;

      e.preventDefault();
      const cur = Math.max(
        0,
        list.findIndex((el) => el === document.activeElement),
      );
      const last = list.length - 1;
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

      list.forEach((el, i) => (el.tabIndex = i === next ? 0 : -1));
      list[next]!.focus();
    },
    [containerRef],
  );

  return { onKeyDown };
}
