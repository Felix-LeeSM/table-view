/**
 * `prefers-reduced-motion: reduce` — the OS-level "cut the animation" setting.
 *
 * Read at the moment a transition starts rather than cached in React state: the
 * value feeds imperative animation calls, so a fresh read already tracks a user
 * flipping the setting mid-session, with no `change` subscription and no
 * re-render. A surface that must re-render when the preference flips needs a
 * subscription on top of this, in the shape of `subscribeSystemModeChange` in
 * `themeBoot.ts` (this repo's other media-query read).
 */
export function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
