import type { ForwardedRef } from "react";

/**
 * Assign a value to a forwarded ref, handling both callback and object refs.
 *
 * `useImperativeHandle(ref, () => viewRef.current, [])` snapshots the target in
 * the layout phase with empty deps — before the passive effect that creates the
 * view runs — so the handle is stuck at the initial (null) value. Assigning the
 * ref from inside the view-creation effect instead captures the real instance
 * (and clears it on teardown). See #1248 review.
 */
export function setForwardedRef<T>(
  ref: ForwardedRef<T>,
  value: T | null,
): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}
