/**
 * Sprint-88 AC-02: DOM identity stability helper.
 *
 * Captures the live DOM node returned by a getter at one moment in time and
 * provides an `assertStillSame()` method that re-invokes the getter and asserts
 * the returned reference is `===` the original. This is the standard tool for
 * proving that a re-render did **not** unmount/remount the underlying element
 * (which kills focus, animations, IME composition, etc.).
 *
 * Usage:
 * ```ts
 * const stable = expectNodeStable(() => screen.getByTestId("editor"));
 * fireEvent.input(input, { target: { value: "x" } });
 * stable.assertStillSame();
 * ```
 *
 * The helper is intentionally framework-agnostic: it accepts any getter
 * callback and works with Testing Library, query selectors, or hand-written
 * DOM lookups.
 */

export interface NodeStableHandle<T extends Node = Element> {
  /** The node captured at construction time. */
  readonly initial: T;
  /**
   * Re-invokes the getter and asserts the returned node is `===` the captured
   * node. Throws an `Error` with a descriptive message on mismatch.
   *
   * @param label - Optional label to include in the failure message so the
   *                test report points at the right element.
   */
  assertStillSame(label?: string): void;
}

/**
 * Capture the current node returned by `getter` and return a handle whose
 * `assertStillSame()` re-runs the getter and asserts identity preservation.
 *
 * Throws synchronously if the getter throws or returns a falsy value at
 * capture time — this means the element doesn't exist yet, which is almost
 * always a test bug rather than a stability violation.
 */
export function expectNodeStable<T extends Node = Element>(
  getter: () => T,
): NodeStableHandle<T> {
  const initial = getter();
  if (!initial) {
    throw new Error(
      "expectNodeStable: getter returned a falsy value at capture time. " +
        "The element must exist before stability can be tracked.",
    );
  }

  return {
    initial,
    assertStillSame(label?: string): void {
      let current: T;
      try {
        current = getter();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `expectNodeStable${label ? `(${label})` : ""}: getter threw on ` +
            `re-invocation, which means the node was unmounted between ` +
            `snapshots. Original error: ${reason}`,
        );
      }
      if (current !== initial) {
        throw new Error(
          `expectNodeStable${label ? `(${label})` : ""}: DOM node identity ` +
            `changed between snapshots. The element was unmounted/remounted ` +
            `(or replaced) instead of being updated in place. This typically ` +
            `breaks focus, IME composition, and animation continuity.`,
        );
      }
    },
  };
}
