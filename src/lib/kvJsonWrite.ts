// KV JSON tree write core (PR3, 2026-07-18) — the pure transform behind the
// inline node editor for single-value `string` (JSON string) and `json`
// (ReJSON) keys.
//
// Redis has no partial-patch write for a JSON slot: both `SET key <json>` and
// `JSON.SET key $ <json>` overwrite the WHOLE value. So unlike the Mongo tree
// (which emits a `$set` dot-path patch), we take the original parsed value plus
// the panel's per-path pending edits, apply them onto a deep clone, and hand
// back the re-serialized full value for a single overwrite command.
//
// Pure + deterministic: no React, no I/O. The Safe Mode confirm dialog shows
// the exact command this produces before it ever reaches Redis.

import { coerceTreeAddValue } from "@/lib/jsonTree";
import { UNSET_OP } from "@/components/document/DocumentTreePanel/types";

export type TreePathSegment = string | number;

export interface TreeEditResult {
  /** The edited value (a deep clone of `original`; `original` is untouched). */
  value: unknown;
  /** `JSON.stringify(value)` — the exact payload for the overwrite command. */
  json: string;
}

/**
 * Tokenize a DocumentTreePanel path into segments. The panel builds paths with
 * `jsonTree.joinPath` — object keys joined by `.`, array indices as `[N]`
 * (e.g. `meta.tags[2].name`, `[0]`, `list[3]`). Numbers are array indices,
 * strings are object keys.
 *
 * Known limitation (shared with the Mongo dot-path contract): an object key
 * that itself contains `.` / `[` / `]` cannot be round-tripped, because the
 * joiner does not escape them. Such keys are rare in Redis JSON; the Safe Mode
 * command preview surfaces the resulting JSON so a mis-resolved path is caught
 * before the write.
 */
export function parseTreePath(path: string): TreePathSegment[] {
  const segments: TreePathSegment[] = [];
  const token = /\[(\d+)\]|([^.[\]]+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(path)) !== null) {
    if (match[1] !== undefined) segments.push(Number.parseInt(match[1], 10));
    else if (match[2] !== undefined) segments.push(match[2]);
  }
  return segments;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Walk `root` to the container holding the last path segment, returning that
 * container plus the final key/index. Returns null when the parent chain does
 * not exist or has the wrong shape (defensive — the panel only edits paths
 * whose parent container is already present).
 */
function resolveParent(
  root: unknown,
  segments: TreePathSegment[],
): [Record<string, unknown> | unknown[], TreePathSegment] | null {
  let node: unknown = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    if (typeof seg === "number") {
      if (!Array.isArray(node)) return null;
      node = node[seg];
    } else {
      if (!isRecord(node) || seg === undefined) return null;
      node = node[seg];
    }
  }
  const last = segments[segments.length - 1];
  if (last === undefined) return null;
  if (typeof last === "number") {
    if (!Array.isArray(node)) return null;
    return [node, last];
  }
  if (!isRecord(node)) return null;
  return [node, last];
}

function leafExists(
  parent: Record<string, unknown> | unknown[],
  last: TreePathSegment,
): boolean {
  return typeof last === "number"
    ? Array.isArray(parent) && last < parent.length
    : isRecord(parent) && Object.prototype.hasOwnProperty.call(parent, last);
}

/**
 * Coerce a pending EDIT string (from `useTreeEditing.commitDraft`, which has
 * already stripped a string leaf's outer quotes) back to a JSON value, keyed
 * off the ORIGINAL leaf's type:
 *
 * - original string → keep the pending value a string. Critical for type
 *   preservation: a string leaf like `"42"` must never be silently retyped to
 *   the number `42` just because its content parses as JSON.
 * - original number / boolean / null → `coerceTreeAddValue` (JSON.parse), so
 *   `42 → 43` stays a number, `true → false` a boolean, `null → 5` a number.
 */
function coerceEditValue(original: unknown, raw: string): unknown {
  return typeof original === "string" ? raw : coerceTreeAddValue(raw);
}

/**
 * Apply the panel's pending edits onto a deep clone of `original` and return
 * the new value plus its serialized JSON.
 *
 * Pending entries come in three shapes from DocumentTreePanel:
 * - leaf edit → `raw` is a string; coerced by the original leaf's type.
 * - `+ key` / `+ item` add → `raw` is a value already coerced by the tree
 *   hooks (may be a non-string); used verbatim.
 * - delete → `raw === UNSET_OP`; the leaf/element is removed.
 *
 * Deletes are applied after all sets, and array-index deletes descending, so a
 * splice never shifts an index that a later delete still targets.
 */
export function applyTreeEdits(
  original: unknown,
  pending: ReadonlyMap<string, string | Record<string, unknown>>,
): TreeEditResult {
  const root = structuredClone(original);
  const deletes: TreePathSegment[][] = [];
  const sets: Array<[TreePathSegment[], string | Record<string, unknown>]> = [];

  for (const [path, raw] of pending) {
    const segments = parseTreePath(path);
    if (segments.length === 0) continue;
    if (raw === UNSET_OP) deletes.push(segments);
    else sets.push([segments, raw]);
  }

  // Apply shallower paths first so a parent object/array add always lands
  // before an edit of a child inside it (stable sort keeps same-depth adds,
  // e.g. sequential array appends, in their insertion order).
  sets.sort(([a], [b]) => a.length - b.length);
  for (const [segments, raw] of sets) {
    const resolved = resolveParent(root, segments);
    if (resolved === null) continue;
    const [parent, last] = resolved;
    let next: unknown;
    if (typeof raw !== "string") {
      // add carrying an object/array value coerced upstream — verbatim.
      next = raw;
    } else if (leafExists(parent, last)) {
      const current = (parent as Record<string, unknown>)[last as string];
      next = coerceEditValue(current, raw);
    } else {
      // add whose coerced value was a string — verbatim (already final).
      next = raw;
    }
    if (typeof last === "number") {
      (parent as unknown[])[last] = next;
    } else {
      (parent as Record<string, unknown>)[last] = next;
    }
  }

  // Descending by path so deeper / higher-index deletes land first.
  deletes.sort((a, b) => comparePathDesc(a, b));
  for (const segments of deletes) {
    const resolved = resolveParent(root, segments);
    if (resolved === null) continue;
    const [parent, last] = resolved;
    if (typeof last === "number") {
      if (Array.isArray(parent) && last < parent.length) parent.splice(last, 1);
    } else if (isRecord(parent)) {
      delete parent[last];
    }
  }

  return { value: root, json: JSON.stringify(root) };
}

/** Order two paths so the deeper, then higher-index/key, comes first. */
function comparePathDesc(a: TreePathSegment[], b: TreePathSegment[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) continue;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    if (typeof av === "number" && typeof bv === "number") return bv - av;
    return String(bv).localeCompare(String(av));
  }
  return 0;
}
