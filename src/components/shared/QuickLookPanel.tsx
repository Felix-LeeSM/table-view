import { useState, useCallback, useMemo } from "react";
import { X, Binary, GripHorizontal } from "lucide-react";
import { cn } from "@lib/utils";
import type { ColumnInfo, TableData } from "@/types/schema";
import BlobViewerDialog from "@components/datagrid/BlobViewerDialog";

// ── Helpers ───────────────────────────────────────────────────────────

function isBlobColumn(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return (
    lower.includes("blob") ||
    lower.includes("bytea") ||
    lower.includes("binary") ||
    lower.includes("varbinary") ||
    lower.includes("image")
  );
}

function isJsonColumn(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return lower.includes("json");
}

/** Try to detect JSON-like string values. */
function looksLikeJson(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function formatCellValue(value: unknown, col: ColumnInfo): string {
  if (value == null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  // String values that look like JSON
  if (isJsonColumn(col.data_type) || looksLikeJson(value)) {
    try {
      const parsed = JSON.parse(value as string);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// ── Field Row ─────────────────────────────────────────────────────────

interface FieldRowProps {
  column: ColumnInfo;
  value: unknown;
  onBlobView: (data: unknown, columnName: string) => void;
}

function FieldRow({ column, value, onBlobView }: FieldRowProps) {
  const isNull = value == null;
  const isBool = typeof value === "boolean";
  const isBlob = isBlobColumn(column.data_type) && value != null;
  const isObject = typeof value === "object" && value != null;
  const isJsonString =
    !isObject && isJsonColumn(column.data_type) && looksLikeJson(value);
  const isLargeText =
    typeof value === "string" && (value as string).length > 200;

  const displayValue = useMemo(
    () => formatCellValue(value, column),
    [value, column],
  );

  return (
    <div className="flex border-b border-border last:border-b-0">
      {/* Column name */}
      <div
        className="w-44 shrink-0 border-r border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground"
        title={column.data_type}
      >
        <span className="font-mono">{column.name}</span>
        <span className="ml-1.5 text-[10px] opacity-60">
          {column.data_type}
        </span>
      </div>

      {/* Value */}
      <div className="flex-1 overflow-hidden px-3 py-2 text-xs">
        {isNull ? (
          <span className="italic text-muted-foreground">NULL</span>
        ) : isBool ? (
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
              value
                ? "bg-green-500/15 text-green-600 dark:text-green-400"
                : "bg-red-500/15 text-red-600 dark:text-red-400",
            )}
          >
            {value ? "true" : "false"}
          </span>
        ) : isBlob ? (
          <button
            className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-muted-foreground hover:bg-secondary"
            onClick={() => onBlobView(value, column.name)}
            aria-label={`View BLOB data for ${column.name}`}
          >
            <Binary className="h-3 w-3" />
            <span>(BLOB)</span>
          </button>
        ) : isObject || isJsonString ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-foreground">
            {displayValue}
          </pre>
        ) : isLargeText ? (
          <textarea
            className="max-h-48 w-full resize-y bg-transparent font-mono text-foreground outline-none"
            value={String(value)}
            rows={3}
            readOnly
            aria-label={`Value for ${column.name}`}
          />
        ) : (
          <span className="font-mono text-foreground">{displayValue}</span>
        )}
      </div>
    </div>
  );
}

// ── QuickLookPanel ────────────────────────────────────────────────────

export interface QuickLookPanelProps {
  data: TableData;
  selectedRowIds: Set<number>;
  schema: string;
  table: string;
  onClose: () => void;
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 280;

export default function QuickLookPanel({
  data,
  selectedRowIds,
  schema,
  table,
  onClose,
}: QuickLookPanelProps) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [blobViewer, setBlobViewer] = useState<{
    data: unknown;
    columnName: string;
  } | null>(null);

  // Use the first selected row
  const firstSelectedId = useMemo(() => {
    if (selectedRowIds.size === 0) return null;
    return Math.min(...selectedRowIds);
  }, [selectedRowIds]);

  const row = useMemo(() => {
    if (firstSelectedId == null || firstSelectedId >= data.rows.length) {
      return null;
    }
    return data.rows[firstSelectedId];
  }, [firstSelectedId, data.rows]);

  const handleBlobView = useCallback(
    (blobData: unknown, columnName: string) => {
      setBlobViewer({ data: blobData, columnName });
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = height;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = startY - moveEvent.clientY; // dragging up = increase height
        const newHeight = Math.max(
          MIN_HEIGHT,
          Math.min(MAX_HEIGHT, startHeight + delta),
        );
        setHeight(newHeight);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  if (!row) return null;

  const displayTable = schema ? `${schema}.${table}` : table;

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-background"
      style={{ height }}
      role="region"
      aria-label="Row Details"
    >
      {/* Resize handle */}
      <div
        className="flex h-2 cursor-row-resize items-center justify-center border-b border-border bg-muted/30 hover:bg-muted"
        onMouseDown={handleMouseDown}
        aria-hidden="true"
      >
        <GripHorizontal className="h-3 w-3 text-muted-foreground" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <h3 className="text-xs font-semibold text-foreground">
          Row Details —{" "}
          <span className="font-mono text-muted-foreground">
            {displayTable}
          </span>
          {selectedRowIds.size > 1 && (
            <span className="ml-2 text-muted-foreground">
              ({selectedRowIds.size} selected, showing first)
            </span>
          )}
        </h3>
        <button
          className="rounded p-1 hover:bg-muted"
          onClick={onClose}
          aria-label="Close row details"
        >
          <X size={14} />
        </button>
      </div>

      {/* Scrollable field list */}
      <div className="flex-1 overflow-auto">
        {data.columns.map((col, idx) => {
          const cellValue = row[idx as number];
          return (
            <FieldRow
              key={col.name}
              column={col}
              value={cellValue}
              onBlobView={handleBlobView}
            />
          );
        })}
      </div>

      {/* BLOB viewer dialog */}
      {blobViewer && (
        <BlobViewerDialog
          open={blobViewer !== null}
          onOpenChange={(open) => {
            if (!open) setBlobViewer(null);
          }}
          data={blobViewer.data}
          columnName={blobViewer.columnName}
        />
      )}
    </div>
  );
}
