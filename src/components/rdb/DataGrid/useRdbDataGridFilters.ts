import { useCallback, useMemo, useState } from "react";
import type { FilterCondition, FilterMode } from "@/types/schema";

interface UseRdbDataGridFiltersParams {
  initialFilters?: FilterCondition[];
  onResetPage: () => void;
}

export interface RdbDataGridFilters {
  showFilters: boolean;
  filters: FilterCondition[];
  appliedFilters: FilterCondition[];
  filterMode: FilterMode;
  rawSql: string;
  appliedRawSql: string;
  activeFilterCount: number;
  setFilters: (filters: FilterCondition[]) => void;
  setFilterMode: (mode: FilterMode) => void;
  setRawSql: (sql: string) => void;
  toggleFilters: () => void;
  closeFilters: () => void;
  applyFilters: () => void;
  clearAppliedFilters: () => void;
  clearAllFilters: () => void;
}

export function useRdbDataGridFilters({
  initialFilters,
  onResetPage,
}: UseRdbDataGridFiltersParams): RdbDataGridFilters {
  const [showFilters, setShowFilters] = useState(
    () => (initialFilters?.length ?? 0) > 0,
  );
  const [filters, setFilters] = useState<FilterCondition[]>(
    () => initialFilters ?? [],
  );
  const [appliedFilters, setAppliedFilters] = useState<FilterCondition[]>(
    () => initialFilters ?? [],
  );
  const [filterMode, setFilterMode] = useState<FilterMode>("structured");
  const [rawSql, setRawSql] = useState("");
  const [appliedRawSql, setAppliedRawSql] = useState("");

  const toggleFilters = useCallback(() => {
    setShowFilters((visible) => !visible);
  }, []);

  const closeFilters = useCallback(() => {
    setShowFilters(false);
  }, []);

  const applyFilters = useCallback(() => {
    if (filterMode === "raw") {
      setAppliedRawSql(rawSql);
      setAppliedFilters([]);
    } else {
      setAppliedFilters(filters);
      setAppliedRawSql("");
    }
    onResetPage();
  }, [filterMode, filters, onResetPage, rawSql]);

  const clearAppliedFilters = useCallback(() => {
    setAppliedFilters([]);
    setAppliedRawSql("");
    onResetPage();
  }, [onResetPage]);

  const clearAllFilters = useCallback(() => {
    setFilters([]);
    setAppliedFilters([]);
    setRawSql("");
    setAppliedRawSql("");
    onResetPage();
  }, [onResetPage]);

  const activeFilterCount = useMemo(
    () => (appliedRawSql.trim().length > 0 ? 1 : appliedFilters.length),
    [appliedFilters.length, appliedRawSql],
  );

  return {
    showFilters,
    filters,
    appliedFilters,
    filterMode,
    rawSql,
    appliedRawSql,
    activeFilterCount,
    setFilters,
    setFilterMode,
    setRawSql,
    toggleFilters,
    closeFilters,
    applyFilters,
    clearAppliedFilters,
    clearAllFilters,
  };
}
