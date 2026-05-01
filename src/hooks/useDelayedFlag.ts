import { useEffect, useState } from "react";

/**
 * Sprint 180 — Doherty + Goal-Gradient async UX threshold gate.
 *
 * Returns `true` only after `active` has been continuously `true` for
 * `delay` ms; flips back to `false` synchronously when `active` becomes
 * `false`. Use to gate the appearance of progress overlays so sub-second
 * fetches never paint a flicker of overlay UI.
 *
 * Implementation notes:
 *  - The internal `setTimeout` is reset every time `active` toggles, so
 *    rapid on/off cycles never accumulate stale timers (AC-180-01).
 *  - The cleanup closure clears the timeout when `active` becomes
 *    `false`, when `delay` changes, or when the host unmounts; this
 *    prevents a delayed-fire-after-unmount React warning.
 *  - Returns `false` synchronously when `active` toggles to `false`
 *    because we update state imperatively in the same effect body
 *    instead of waiting for the timer to fire and a re-schedule.
 */
export function useDelayedFlag(active: boolean, delay = 1000): boolean {
  const [flagged, setFlagged] = useState(false);

  useEffect(() => {
    if (!active) {
      // Synchronous reset: the consumer expects the flag to drop to
      // false immediately when the source toggles off. Without this
      // the overlay would linger for `delay` ms after the source op
      // resolved/cancelled.
      setFlagged(false);
      return;
    }
    const handle = setTimeout(() => {
      setFlagged(true);
    }, delay);
    return () => {
      clearTimeout(handle);
    };
  }, [active, delay]);

  return flagged;
}
