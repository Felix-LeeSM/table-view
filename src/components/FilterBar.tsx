import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import type {
  ColumnInfo,
  FilterCondition,
  FilterMode,
  FilterOperator,
} from "@/types/schema";
import { validateRawSql } from "@/types/schema";

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
    <div className="border-b border-border bg-secondary px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-secondary-foreground">
            Filters
          </span>
          {/* Mode toggle — segmented control */}
          <ToggleGroup
            type="single"
            value={filterMode}
            onValueChange={(v) => v && onFilterModeChange(v as FilterMode)}
          >
            <ToggleGroupItem
              value="structured"
              className="data-[state=on]:bg-primary data-[state=on]:text-white data-[state=on]:shadow-none"
            >
              Structured
            </ToggleGroupItem>
            <ToggleGroupItem
              value="raw"
              className="data-[state=on]:bg-primary data-[state=on]:text-white data-[state=on]:shadow-none"
            >
              Raw SQL
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-secondary-foreground"
          onClick={onClose}
          aria-label="Close filter bar"
        >
          <X size={12} />
        </Button>
      </div>

      {filterMode === "raw" ? (
        /* Raw SQL mode */
        <div>
          <Input
            type="text"
            className="h-7 w-full border-border bg-background px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground"
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
            <div className="mt-1 text-2xs text-destructive" role="alert">
              {rawSqlError}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => {
                onRawSqlChange("");
                setRawSqlError(null);
                onClearAll();
              }}
            >
              Clear
            </Button>
            <Button
              size="xs"
              className="bg-primary text-white hover:bg-primary/90"
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
            </Button>
          </div>
        </div>
      ) : (
        /* Structured mode — existing dropdown filters */
        <>
          {filters.map((filter, index) => (
            <div key={filter.id} className="mb-1.5 flex items-center gap-2">
              {/* Column selector */}
              <select
                className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
                aria-label="Filter column"
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
                className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
                aria-label="Filter operator"
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
                <Input
                  type="text"
                  className="h-7 min-w-[120px] flex-1 border-border bg-background px-2 py-1 text-xs text-foreground"
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
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => removeFilter(index)}
                aria-label="Remove filter"
              >
                <Trash2 size={12} />
              </Button>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="xs"
              className="text-primary"
              onClick={addFilter}
            >
              <Plus size={12} /> Add Filter
            </Button>
            {filters.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={clearAll}
                >
                  Clear All
                </Button>
                <Button
                  size="xs"
                  className="bg-primary text-white hover:bg-primary/90"
                  onClick={onApply}
                >
                  Apply
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
