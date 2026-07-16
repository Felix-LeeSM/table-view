import { useMemo, useRef } from "react";
import type { RowPending } from "./DataRow";

/**
 * Issue #1446 (F13) — group the grid's cell-keyed pending-edit state by row
 * so each `DataRow` receives only its own slice. Reconcile every rebuild
 * against the previous result so a row whose slice is unchanged keeps its
 * object identity — that lets the memoized `DataRow` skip re-render when a
 * *different* row's edit changes, instead of every visible row reacting to
 * one edit.
 */

// Keys are `${rowIdx}-${colIdx}` (and nested `${rowIdx}-${colIdx}:path`); the
// leading integer is the row.
function rowOfKey(key: string): number {
  return Number.parseInt(key, 10);
}

function mapsEqual<V>(
  a: ReadonlyMap<string, V> | undefined,
  b: ReadonlyMap<string, V> | undefined,
): boolean {
  if (a === b) return true;
  const as = a?.size ?? 0;
  const bs = b?.size ?? 0;
  if (as !== bs) return false;
  if (as === 0) return true;
  for (const [k, v] of a!) {
    // Snapshot values are stable arrays captured at edit-time, so a
    // reference compare is exact (a new snapshot is a new array).
    if (!b!.has(k) || b!.get(k) !== v) return false;
  }
  return true;
}

function rowPendingEqual(a: RowPending, b: RowPending): boolean {
  return (
    mapsEqual(a.edits, b.edits) &&
    mapsEqual(a.errors, b.errors) &&
    mapsEqual(a.snapshots, b.snapshots)
  );
}

export function useRowPending(
  pendingEdits: Map<string, string | null>,
  pendingEditErrors: Map<string, string> | undefined,
  pendingEditRowSnapshots:
    | ReadonlyMap<string, ReadonlyArray<unknown>>
    | undefined,
): Map<number, RowPending> {
  const prevRef = useRef<Map<number, RowPending>>(new Map());
  return useMemo(() => {
    const raw = new Map<
      number,
      {
        edits: Map<string, string | null>;
        errors?: Map<string, string>;
        snapshots?: Map<string, ReadonlyArray<unknown>>;
      }
    >();
    const ensure = (r: number) => {
      let e = raw.get(r);
      if (!e) {
        e = { edits: new Map() };
        raw.set(r, e);
      }
      return e;
    };
    pendingEdits.forEach((v, k) => ensure(rowOfKey(k)).edits.set(k, v));
    pendingEditErrors?.forEach((v, k) => {
      const e = ensure(rowOfKey(k));
      (e.errors ??= new Map()).set(k, v);
    });
    pendingEditRowSnapshots?.forEach((v, k) => {
      const e = ensure(rowOfKey(k));
      (e.snapshots ??= new Map()).set(k, v);
    });

    const prev = prevRef.current;
    const next = new Map<number, RowPending>();
    raw.forEach((slice, r) => {
      const prevSlice = prev.get(r);
      next.set(
        r,
        prevSlice && rowPendingEqual(prevSlice, slice) ? prevSlice : slice,
      );
    });
    prevRef.current = next;
    return next;
  }, [pendingEdits, pendingEditErrors, pendingEditRowSnapshots]);
}
