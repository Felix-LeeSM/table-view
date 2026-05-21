import { useCallback } from "react";
import type { SortInfo } from "@/types/schema";

type SetSorts = (
  updater: SortInfo[] | ((prev: SortInfo[]) => SortInfo[]),
) => void;

interface UseRdbDataGridSortHandlersParams {
  setSorts: SetSorts;
  onResetPage: () => void;
}

export function useRdbDataGridSortHandlers({
  setSorts,
  onResetPage,
}: UseRdbDataGridSortHandlersParams) {
  const handleSortColumn = useCallback(
    (columnName: string, direction: "ASC" | "DESC", append: boolean) => {
      setSorts((prev) => {
        const next: SortInfo = { column: columnName, direction };
        if (append) {
          const idx = prev.findIndex((s) => s.column === columnName);
          if (idx !== -1) {
            const out = [...prev];
            out[idx] = next;
            return out;
          }
          return [...prev, next];
        }
        return [next];
      });
      onResetPage();
    },
    [onResetPage, setSorts],
  );

  const handleClearColumnSort = useCallback(
    (columnName: string) => {
      setSorts((prev) => prev.filter((s) => s.column !== columnName));
      onResetPage();
    },
    [onResetPage, setSorts],
  );

  const handleClearAllSorts = useCallback(() => {
    setSorts(() => []);
    onResetPage();
  }, [onResetPage, setSorts]);

  const handleSort = useCallback(
    (columnName: string, shiftKey: boolean = false) => {
      if (shiftKey) {
        setSorts((prev) => {
          const existingIndex = prev.findIndex((s) => s.column === columnName);
          if (existingIndex !== -1) {
            const existing = prev[existingIndex]!;
            if (existing.direction === "ASC") {
              const newSorts = [...prev];
              newSorts[existingIndex] = {
                column: columnName,
                direction: "DESC",
              };
              return newSorts;
            }
            return prev.filter((s) => s.column !== columnName);
          }
          return [...prev, { column: columnName, direction: "ASC" }];
        });
      } else {
        setSorts((prev) => {
          if (prev.length === 0 || prev[0]!.column !== columnName) {
            return [{ column: columnName, direction: "ASC" }];
          }
          if (prev[0]!.direction === "ASC") {
            return [{ column: columnName, direction: "DESC" }];
          }
          return [];
        });
      }
      onResetPage();
    },
    [onResetPage, setSorts],
  );

  return {
    handleSort,
    handleSortColumn,
    handleClearColumnSort,
    handleClearAllSorts,
  };
}
