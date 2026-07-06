import { useEffect, useState } from "react";
import type { TableData } from "@/types/schema";

interface UseRdbColumnOrderParams {
  connectionId: string;
  table: string;
  schema: string;
  data: TableData | null;
}

export function useRdbColumnOrder({
  connectionId,
  table,
  schema,
  data,
}: UseRdbColumnOrderParams): number[] {
  const [columnOrder, setColumnOrder] = useState<number[]>([]);

  useEffect(() => {
    setColumnOrder([]);
  }, [connectionId, table, schema]);

  useEffect(() => {
    if (data) {
      setColumnOrder(data.columns.map((_, i) => i));
    }
    // Issue #1369 — key off `data.columns` identity only. Depending on the
    // whole `data` object would reset the user's column order on every
    // unrelated data change (row refetch, pagination), not just when the
    // column set itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.columns]);

  return columnOrder;
}
