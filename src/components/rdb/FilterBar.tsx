import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { getSqlDialectProfileForDatabaseType } from "@lib/sql/sqlDialectProfile";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SqlDialectCapabilities } from "@/lib/sql/sqlDialectProfile";
import type { DatabaseType } from "@/types/connection";
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
  /**
   * 연결된 DBMS. 연산자 목록이 이 방언의 capability 를 따라간다 (#2430).
   * 없으면(연결을 아직 못 읽었을 때) 방언 고유 연산자는 안 뜬다.
   */
  dbType?: DatabaseType;
}

/**
 * 연산자 표기(라벨 · 값 입력 필요 여부)의 SOT. `capability` 가 붙은 줄은 그
 * 이름의 `SqlDialectCapabilities` 플래그가 참인 방언에서만 목록에 뜬다 —
 * 어느 방언이 무엇을 갖는지의 SOT 는 `src/lib/sql/sqlDialectProfile.ts` 이고
 * 여기 복제하지 않는다 (#2430).
 */
const OPERATORS: {
  value: FilterOperator;
  label: string;
  needsValue: boolean;
  capability?: keyof SqlDialectCapabilities;
}[] = [
  { value: "Eq", label: "=", needsValue: true },
  { value: "Neq", label: "\u2260", needsValue: true },
  { value: "Gt", label: ">", needsValue: true },
  { value: "Lt", label: "<", needsValue: true },
  { value: "Gte", label: "\u2265", needsValue: true },
  { value: "Lte", label: "\u2264", needsValue: true },
  { value: "Like", label: "LIKE", needsValue: true },
  { value: "Ilike", label: "ILIKE", needsValue: true, capability: "ilike" },
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
  dbType,
}: FilterBarProps) {
  const { t } = useTranslation("rdb");
  const [rawSqlError, setRawSqlError] = useState<string | null>(null);
  const rawSqlErrorId = useId();

  // #2430 — 드롭다운에 뜨는 목록만 방언으로 좁힌다. `opInfo` 는 아래에서
  // 전체 `OPERATORS` 를 계속 보므로, 이미 걸려 있던 조건은 방언이 그 연산자를
  // 잃어도 라벨과 값 입력 여부를 그대로 찾는다.
  const visibleOperators = useMemo(() => {
    const capabilities =
      getSqlDialectProfileForDatabaseType(dbType)?.capabilities;
    return OPERATORS.filter(
      (op) => op.capability === undefined || capabilities?.[op.capability],
    );
  }, [dbType]);

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
            {t("filterBar.title")}
          </span>
          {/* Mode toggle — segmented control */}
          <ToggleGroup
            type="single"
            value={filterMode}
            onValueChange={(v) => v && onFilterModeChange(v as FilterMode)}
          >
            <ToggleGroupItem
              value="structured"
              className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-none"
            >
              {t("filterBar.structured")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="raw"
              className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-none"
            >
              {t("filterBar.rawSql")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-secondary-foreground"
          onClick={onClose}
          aria-label={t("filterBar.closeAria")}
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
            placeholder={t("filterBar.rawSqlPlaceholder")}
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
            aria-label={t("filterBar.rawSqlAria")}
            aria-invalid={rawSqlError ? true : undefined}
            aria-describedby={rawSqlError ? rawSqlErrorId : undefined}
          />
          {rawSqlError && (
            <div
              id={rawSqlErrorId}
              className="mt-1 text-2xs text-destructive"
              role="alert"
            >
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
              {t("filterBar.clear")}
            </Button>
            <Button
              size="xs"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
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
              {t("filterBar.apply")}
            </Button>
          </div>
        </div>
      ) : (
        /* Structured mode — existing dropdown filters */
        <>
          {filters.map((filter, index) => (
            <div key={filter.id} className="mb-1.5 flex items-center gap-2">
              {/* Column selector */}
              <Select
                value={filter.column}
                onValueChange={(v) => updateFilter(index, { column: v })}
              >
                <SelectTrigger
                  size="xs"
                  className="rounded border border-border bg-background text-foreground"
                  aria-label={t("filterBar.filterColumnAria")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((col) => (
                    <SelectItem key={col.name} value={col.name}>
                      {col.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Operator selector */}
              <Select
                value={filter.operator}
                onValueChange={(v) => {
                  const newOp = v as FilterOperator;
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
                <SelectTrigger
                  size="xs"
                  className="rounded border border-border bg-background text-foreground"
                  aria-label={t("filterBar.filterOperatorAria")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {visibleOperators.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Value input (hidden for IS NULL / IS NOT NULL) */}
              {opInfo(filter.operator)?.needsValue && (
                <Input
                  type="text"
                  className="h-7 min-w-30 flex-1 border-border bg-background px-2 py-1 text-xs text-foreground"
                  placeholder={t("filterBar.valuePlaceholder")}
                  aria-label={t("filterBar.valueForColumnAria", {
                    col: filter.column,
                  })}
                  value={filter.value ?? ""}
                  onChange={(e) =>
                    updateFilter(index, { value: e.target.value })
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
                aria-label={t("filterBar.removeFilterAria")}
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
              <Plus size={12} /> {t("filterBar.addFilter")}
            </Button>
            {filters.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={clearAll}
                >
                  {t("filterBar.clearAll")}
                </Button>
                <Button
                  size="xs"
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={onApply}
                >
                  {t("filterBar.apply")}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
