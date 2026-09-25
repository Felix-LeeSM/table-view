/**
 * Phase 28 Slice F.1: extract a sentinel cell's nested fields one level deep.
 *
 * Problem: DocumentDataGrid flattens nested object / array cells into the
 * `{...}` / `[N items]` sentinels, which are read-only. Without this utility,
 * seeing a field inside meant opening the Quick Look panel — no quick inspect
 * within the cell context.
 *
 * Solution: this utility turns a nested value into a one-level representation.
 * - object → `{ key, value, isNested }[]`
 * - array → `{ index, value, isNested }[]`
 * - nested-of-nested values show as sentinels again (`isNested === true`).
 *   A user who needs a deeper inspect uses Quick Look.
 *
 * Phase 28 Slice F.2 reuses the same function as the inline-edit
 * (dot-notation $set) entry point.
 */

import { isDocumentSentinel } from "@/types/document";

export interface NestedObjectEntry {
  kind: "object-entry";
  key: string;
  value: unknown;
  isNested: boolean;
}

export interface NestedArrayEntry {
  kind: "array-entry";
  index: number;
  value: unknown;
  isNested: boolean;
}

export type NestedEntry = NestedObjectEntry | NestedArrayEntry;

export interface NestedExpansion {
  containerKind: "object" | "array";
  entries: NestedEntry[];
}

/** Returns true if a value is itself a composite (nested object or array). */
function isComposite(value: unknown): boolean {
  if (value === null) return false;
  if (Array.isArray(value)) return true;
  if (typeof value !== "object") return false;
  // BSON-canonical singletons like `{ $oid: "..." }` are scalars from the
  // user's viewpoint — keep them as values, not as containers.
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 1) {
    const k = keys[0]!;
    if (k.startsWith("$")) return false;
  }
  return true;
}

/**
 * Expand a value one level deep. Returns `null` when the value is not a
 * composite (or is a sentinel string with no resolvable origin) — callers
 * use `null` to suppress the popover trigger.
 */
export function getNestedExpansion(value: unknown): NestedExpansion | null {
  if (typeof value === "string" && isDocumentSentinel(value)) {
    // sentinel string alone carries no nested data — caller must supply
    // the raw value (from `raw_documents`) instead.
    return null;
  }
  if (Array.isArray(value)) {
    return {
      containerKind: "array",
      entries: value.map((v, i) => ({
        kind: "array-entry",
        index: i,
        value: v,
        isNested: isComposite(v),
      })),
    };
  }
  if (value !== null && typeof value === "object") {
    if (!isComposite(value)) return null;
    return {
      containerKind: "object",
      entries: Object.entries(value as Record<string, unknown>).map(
        ([key, v]) => ({
          kind: "object-entry",
          key,
          value: v,
          isNested: isComposite(v),
        }),
      ),
    };
  }
  return null;
}
