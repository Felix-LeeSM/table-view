import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentColumn } from "@/types/document";

/**
 * Slice E.1: client-side accumulated schema that absorbs column changes
 * across pages of a schemaless collection.
 *
 * Problem:
 * - Mongo collections are schemaless. Page N's documents may have only
 *   fields `a, b`, and page N+1 may have `a, c`. If the backend's
 *   `result.columns` surfaced as the columns as-is, the grid header would
 *   shift on every page move.
 *
 * Solution:
 * - The hook keeps an accumulated set per `(connId, db, collection)`
 *   triple. Each `merge(columns)` call adds only new fields and keeps the
 *   existing ones.
 * - Order: `_id` first (convention), the rest alphabetical
 *   (case-insensitive).
 * - Type conflicts on the same field name: first-wins. Types from later
 *   calls are ignored. Heuristic — type churn surfacing in the grid confuses
 *   users. Accurate mixed-type labeling is left to a later slice.
 * - Auto-reset when `(connId, db, collection)` changes (so another
 *   collection's schema does not leak).
 *
 * Slice E.2 wires it into DocumentDataGrid.
 */

export interface UseDocumentSchemaAccumulatorResult {
  columns: readonly DocumentColumn[];
  merge: (incoming: readonly DocumentColumn[]) => void;
  reset: () => void;
}

interface AccumulatorKey {
  connId: string;
  db: string;
  collection: string;
}

function sortColumns(columns: DocumentColumn[]): DocumentColumn[] {
  // `_id` always first; the rest case-insensitive alphabetical.
  const pinned = columns.filter((c) => c.name === "_id");
  const rest = columns
    .filter((c) => c.name !== "_id")
    .sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en"),
    );
  return [...pinned, ...rest];
}

export function useDocumentSchemaAccumulator(
  key?: AccumulatorKey,
): UseDocumentSchemaAccumulatorResult {
  const [columns, setColumns] = useState<readonly DocumentColumn[]>([]);
  // First-wins: lookup by name into the existing accumulator. A ref is
  // adequate because all mutations route through `setColumns` and
  // happen within the same render cycle as the read.
  const seenRef = useRef<Map<string, DocumentColumn>>(new Map());

  const merge = useCallback((incoming: readonly DocumentColumn[]) => {
    setColumns((prev) => {
      const seen = seenRef.current;
      let changed = false;
      for (const col of incoming) {
        if (!seen.has(col.name)) {
          seen.set(col.name, col);
          changed = true;
        }
      }
      if (!changed) return prev;
      return sortColumns(Array.from(seen.values()));
    });
  }, []);

  const reset = useCallback(() => {
    seenRef.current = new Map();
    setColumns([]);
  }, []);

  // Auto-reset when the (connId, db, collection) triple changes — every
  // collection has its own schema lifecycle. Serialise the triple via a
  // stable JSON spelling so React's identity-aware deps work even when
  // callers reconstruct the object every render.
  const tripleKey = key ? `${key.connId}␟${key.db}␟${key.collection}` : "";
  useEffect(() => {
    seenRef.current = new Map();
    setColumns([]);
  }, [tripleKey]);

  return { columns, merge, reset };
}
