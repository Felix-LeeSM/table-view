// Sprint 312 (Phase 28 Slice A6, 2026-05-14) — Mongo scalar/list panel.
//
// Renders three modes that A5 introduced via `resultKind` on `QueryResult`:
//   - "count"          → big numeric (countDocuments / estimatedDocumentCount)
//   - "list"           → vertical list (distinct)
//   - "findOne-empty"  → "No matching document" centered placeholder
//
// Pure presentational component. The caller (`QueryResultGrid`) decides
// which mode based on the result shape:
//   - `resultKind === "scalar"` + columns[0].name === "count" → "count"
//   - `resultKind === "scalar"` + columns.length === 0        → "findOne-empty"
//   - `resultKind === "list"`                                 → "list"

import { useTranslation } from "react-i18next";
import { safeStringifyCell } from "@lib/jsonCell";
import type { QueryResult } from "@/types/query";

export interface ScalarOrListPanelProps {
  result: QueryResult;
  mode: "count" | "list" | "findOne-empty";
}

export default function ScalarOrListPanel({
  result,
  mode,
}: ScalarOrListPanelProps) {
  const { t } = useTranslation("query");
  if (mode === "findOne-empty") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {t("scalar.noMatchingDocument")}
      </div>
    );
  }
  if (mode === "count") {
    // `runDocumentCount` / `runDocumentEstimatedCount` always yields a
    // 1-row 1-col scalar — defaults to 0 if the IPC handed us an empty grid.
    const raw = result.rows[0]?.[0];
    const display = formatScalar(raw);
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <div className="text-5xl font-semibold tabular-nums text-foreground">
          {display}
        </div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("scalar.count")}
        </div>
      </div>
    );
  }
  // mode === "list"
  const title = result.columns[0]?.name ?? "value";
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-auto p-4">
      <h3 className="text-sm font-medium text-secondary-foreground">{title}</h3>
      <ul className="flex flex-col gap-0.5 text-xs font-mono text-foreground">
        {result.rows.map((row, idx) => (
          <li
            key={idx}
            className="border-b border-border/60 px-2 py-1 last:border-b-0"
          >
            {formatListValue(row[0])}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatScalar(value: unknown): string {
  if (value == null) return "0";
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  return String(value);
}

function formatListValue(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  return safeStringifyCell(value);
}
