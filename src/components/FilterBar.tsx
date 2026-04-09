import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type {
  ColumnInfo,
  FilterCondition,
  FilterMode,
  FilterOperator,
} from "../types/schema";
import { validateRawSql } from "../types/schema";

interface FilterBarProps {
  columns: ColumnInfo[];
  filters: FilterCondition[];
  onFiltersChange: (filters: FilterCondition[]) => void;
  onApply: () => void;
  onClose: () => void;
  onClearAll: () => void;
  filterMode: FilterMode;
  rawSql: string;
  onFilterModeChange: (mode: FilterMode) => void;
  onRawSqlChange: (sql: string) => void;
}

const OPERATORS: {
  value: FilterOperator;
  label: string;
  needsValue: boolean;
}[] = [
  { value: "Eq", label: "=", needsValue: true },
  { value: "Neq", label: "\u2260", needsValue: true },
  { value: "Gt", label: ">", needsValue: true },
  { value: "Lt", label: "<", needsValue: true },
  { value: "Gte", label: "\u2265", needsValue: true },
  { value: "Lte", label: "\u2264", needsValue: true },
  { value: "Like", label: "LIKE", needsValue: true },
  { value: "IsNull", label: "IS NULL", needsValue: false },
  { value: "IsNotNull", label: "IS NOT NULL", needsValue: false },
];

export default function FilterBar({
  columns,
  filters,
  onFiltersChange,
  onApply,
  onClose,
  onClearAll,
  filterMode,
  rawSql,
  onFilterModeChange,
  onRawSqlChange,
}: FilterBarProps) {
  const [rawSqlError, setRawSqlError] = useState<string | null>(null);

  const addFilter = () => {
    const firstCol = columns[0]?.name ?? "";
    onFiltersChange([
      ...filters,
      { column: firstCol, operator: "Eq", value: "", id: crypto.randomUUID() },
    ]);
  };

  const removeFilter = (index: number) => {
    onFiltersChange(filters.filter((_, i) => i !== index));
  };

  const updateFilter = (index: number, patch: Partial<FilterCondition>) => {
    onFiltersChange(
      filters.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  };

  const clearAll = () => {
    onFiltersChange([]);
    onClearAll();
  };

  const opInfo = (op: FilterOperator) =>
    OPERATORS.find((o) => o.value === op) ?? OPERATORS[0]!;

  // Auto-create one empty filter when columns arrive and no filters exist yet.
  // The ref guard ensures this only fires once, even if columns update later.
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (!autoCreatedRef.current && filters.length === 0 && columns.length > 0) {
      autoCreatedRef.current = true;
      onFiltersChange([
        {
          column: columns[0]!.name,
          operator: "Eq",
          value: "",
          id: crypto.randomUUID(),
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onFiltersChange is stable; columns tracked by length
  }, [columns.length, filters.length]);

  return (
    <div className="border-b border-(--color-border) bg-(--color-bg-secondary) px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-(--color-text-secondary)">
            Filters
          </span>
          {/* Mode toggle — segmented control */}
          <div className="inline-flex rounded border border-(--color-border) overflow-hidden">
            <button
              className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                filterMode === "structured"
                  ? "bg-(--color-accent) text-white"
                  : "bg-(--color-bg-primary) text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
              }`}
              onClick={() => onFilterModeChange("structured")}
              aria-pressed={filterMode === "structured"}
            >
              Structured
            </button>
            <button
              className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                filterMode === "raw"
                  ? "bg-(--color-accent) text-white"
                  : "bg-(--color-bg-primary) text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
              }`}
              onClick={() => onFilterModeChange("raw")}
              aria-pressed={filterMode === "raw"}
            >
              Raw SQL
            </button>
          </div>
        </div>
        <button
          className="rounded p-0.5 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-text-secondary)"
          onClick={onClose}
          aria-label="Close filter bar"
        >
          <X size={12} />
        </button>
      </div>

      {filterMode === "raw" ? (
        /* Raw SQL mode */
        <div>
          <input
            type="text"
            className="w-full rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1 text-xs font-mono text-(--color-text-primary) placeholder:text-(--color-text-muted)"
            placeholder="e.g. id = 13 AND name LIKE '%test%'"
            value={rawSql}
            onChange={(e) => {
              onRawSqlChange(e.target.value);
              setRawSqlError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const err = validateRawSql(rawSql);
                if (err) {
                  setRawSqlError(err);
                } else {
                  setRawSqlError(null);
                  onApply();
                }
              }
            }}
            aria-label="Raw SQL WHERE clause"
          />
          {rawSqlError && (
            <div className="mt-1 text-[11px] text-(--color-danger)">
              {rawSqlError}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            <button
              className="rounded px-3 py-1 text-xs font-medium text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
              onClick={() => {
                onRawSqlChange("");
                setRawSqlError(null);
                onClearAll();
              }}
            >
              Clear
            </button>
            <button
              className="rounded bg-(--color-accent) px-3 py-1 text-xs font-medium text-white hover:opacity-90"
              onClick={() => {
                const err = validateRawSql(rawSql);
                if (err) {
                  setRawSqlError(err);
                } else {
                  setRawSqlError(null);
                  onApply();
                }
              }}
            >
              Apply
            </button>
          </div>
        </div>
      ) : (
        /* Structured mode — existing dropdown filters */
        <>
          {filters.map((filter, index) => (
            <div key={filter.id} className="mb-1.5 flex items-center gap-2">
              {/* Column selector */}
              <select
                className="rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1 text-xs text-(--color-text-primary)"
                value={filter.column}
                onChange={(e) =>
                  updateFilter(index, { column: e.target.value })
                }
              >
                {columns.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name}
                  </option>
                ))}
              </select>

              {/* Operator selector */}
              <select
                className="rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1 text-xs text-(--color-text-primary)"
                value={filter.operator}
                onChange={(e) => {
                  const newOp = e.target.value as FilterOperator;
                  const patch: Partial<FilterCondition> = { operator: newOp };
                  const info = opInfo(newOp);
                  if (!info.needsValue) {
                    patch.value = null;
                  } else if (filter.value === null) {
                    patch.value = "";
                  }
                  updateFilter(index, patch);
                }}
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>

              {/* Value input (hidden for IS NULL / IS NOT NULL) */}
              {opInfo(filter.operator)?.needsValue && (
                <input
                  type="text"
                  className="min-w-[120px] flex-1 rounded border border-(--color-border) bg-(--color-bg-primary) px-2 py-1 text-xs text-(--color-text-primary)"
                  placeholder="Value..."
                  value={filter.value ?? ""}
                  onChange={(e) =>
                    updateFilter(index, { value: e.target.value || null })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onApply();
                  }}
                />
              )}

              {/* Remove button */}
              <button
                className="rounded p-0.5 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-danger)"
                onClick={() => removeFilter(index)}
                aria-label="Remove filter"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--color-accent) hover:bg-(--color-bg-tertiary)"
              onClick={addFilter}
            >
              <Plus size={12} /> Add Filter
            </button>
            {filters.length > 0 && (
              <>
                <button
                  className="rounded px-2 py-1 text-xs text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
                  onClick={clearAll}
                >
                  Clear All
                </button>
                <button
                  className="rounded bg-(--color-accent) px-3 py-1 text-xs font-medium text-white hover:opacity-90"
                  onClick={onApply}
                >
                  Apply
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
