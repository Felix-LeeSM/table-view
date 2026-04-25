import type { Paradigm } from "@/types/connection";

export type { Paradigm };

/**
 * Exhaustiveness guard. Place at the end of a `switch (paradigm)` chain so
 * that adding a new variant to the `Paradigm` union triggers a TypeScript
 * compile error in every site that has not yet been updated. The runtime
 * throw is a defensive belt-and-braces fallback for unreachable code paths
 * (e.g. data corruption or future server payloads outside the union).
 */
export function assertNever(value: never): never {
  throw new Error(
    `assertNever: unhandled paradigm value: ${JSON.stringify(value)}`,
  );
}
