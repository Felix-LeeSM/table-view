import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentColumn } from "@/types/document";

/**
 * Sprint 319 — Slice E.1: schemaless collection 의 페이지 간 column
 * 변동을 흡수하는 client-side 누적 schema.
 *
 * 문제:
 * - Mongo collection 은 schemaless. 페이지 N 의 documents 는 field
 *   `a, b` 만 갖고, 페이지 N+1 는 `a, c` 일 수 있다. backend 의
 *   `result.columns` 가 그대로 column 으로 surfaced 되면, 페이지 이동마다
 *   grid header 가 흔들린다.
 *
 * 해결:
 * - hook 안에서 `(connId, db, collection)` triple 단위로 누적 set 을
 *   유지. `merge(columns)` 호출마다 새 field 만 추가하고 기존은 보존.
 * - 정렬: `_id` 가 first (관습), 나머지는 alphabetical
 *   (case-insensitive).
 * - 동일 field name 의 type 충돌 처리: first-wins. subsequent 호출의
 *   type 은 무시. heuristic — type 흔들림이 grid 에 노출되면 사용자
 *   혼란 유발. 정확한 mixed-type 표기는 후속 슬라이스.
 * - `(connId, db, collection)` 변경 시 자동 reset (다른 collection 의
 *   schema 가 leak 되지 않도록).
 *
 * Slice E.2 (Sprint 320) 가 DocumentDataGrid 에 wire 한다.
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
