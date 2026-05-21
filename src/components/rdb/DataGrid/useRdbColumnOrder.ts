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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.columns]);

  return columnOrder;
}
