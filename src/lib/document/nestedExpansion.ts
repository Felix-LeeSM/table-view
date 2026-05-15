/**
 * Sprint 321 — Slice F.1: sentinel cell 의 1-depth nested field 추출.
 *
 * 문제: DocumentDataGrid 의 nested object / array cell 은 `{...}` /
 * `[N items]` sentinel 으로 flatten 되어 read-only. 사용자가 그 안의
 * field 를 보려면 Quick Look 패널을 열어야 — cell context 안에서 빠른
 * inspect 어려움.
 *
 * 해결: 이 utility 가 nested 값을 1-depth 표현으로 변환한다.
 * - object → `{ key, value, isNested }[]`
 * - array → `{ index, value, isNested }[]`
 * - nested-of-nested 는 다시 sentinel 으로 표시 (`isNested === true`).
 *   사용자가 깊은 inspect 가 필요하면 Quick Look 활용.
 *
 * Sprint 322 (F.2) 가 같은 함수를 inline edit (dot-notation $set)
 * 진입점으로 재사용.
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
