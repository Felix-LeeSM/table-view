// Sprint 312 (Phase 28 Slice A6, 2026-05-14) — Mongo write summary panel.
//
// Renders the four variants of `WriteSummaryData`:
//   - "insert"    → headline + chevron-expandable id list
//   - "update"    → "Modified N document(s) (matched M)"
//   - "delete"    → "Deleted N document(s)"
//   - "bulkWrite" → table, one row per non-zero counter + upserted ids row
//
// Pure presentational component — no IPC, no store reads. The
// `QueryResultGrid` router branches on `result.resultKind === "writeSummary"`
// and forwards `result.writeSummary` to this surface.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { WriteSummaryData } from "@/types/query";
import { formatDocumentIdForMql } from "@/types/documentMutate";

export interface WriteSummaryPanelProps {
  summary: WriteSummaryData;
}

export default function WriteSummaryPanel({ summary }: WriteSummaryPanelProps) {
  if (summary.kind === "insert") {
    return <InsertSummary summary={summary} />;
  }
  if (summary.kind === "update") {
    return <UpdateSummary summary={summary} />;
  }
  if (summary.kind === "delete") {
    return <DeleteSummary summary={summary} />;
  }
  return <BulkWriteSummary summary={summary} />;
}

// ── Insert ────────────────────────────────────────────────────────────────

interface InsertSummaryProps {
  summary: Extract<WriteSummaryData, { kind: "insert" }>;
}

function InsertSummary({ summary }: InsertSummaryProps) {
  const { t } = useTranslation("query");
  const [expanded, setExpanded] = useState(false);
  const n = summary.insertedIds.length;
  const headline =
    n === 1 ? t("write.insertedOne") : t("write.insertedMany", { count: n });

  return (
    <div className="flex flex-1 flex-col gap-2 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-secondary-foreground">
        {n > 0 && (
          <button
            type="button"
            aria-label={
              expanded ? t("write.hideInsertedIds") : t("write.showInsertedIds")
            }
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        <span>{headline}</span>
      </div>
      {expanded && n > 0 && (
        <ul className="ml-7 flex flex-col gap-0.5 text-xs font-mono text-muted-foreground">
          {summary.insertedIds.map((id, idx) => (
            <li key={idx}>{formatDocumentIdForMql(id)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Update ────────────────────────────────────────────────────────────────

interface UpdateSummaryProps {
  summary: Extract<WriteSummaryData, { kind: "update" }>;
}

function UpdateSummary({ summary }: UpdateSummaryProps) {
  const { t } = useTranslation("query");
  const { matchedCount, modifiedCount } = summary;
  const body =
    modifiedCount === 1
      ? t("write.modifiedOne", { matchedCount })
      : t("write.modifiedMany", { count: modifiedCount, matchedCount });
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-sm text-secondary-foreground">
      {body}
    </div>
  );
}

// ── Delete ────────────────────────────────────────────────────────────────

interface DeleteSummaryProps {
  summary: Extract<WriteSummaryData, { kind: "delete" }>;
}

function DeleteSummary({ summary }: DeleteSummaryProps) {
  const { t } = useTranslation("query");
  const n = summary.deletedCount;
  const headline =
    n === 1 ? t("write.deletedOne") : t("write.deletedMany", { count: n });
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-sm text-secondary-foreground">
      {headline}
    </div>
  );
}

// ── BulkWrite ─────────────────────────────────────────────────────────────

interface BulkWriteSummaryProps {
  summary: Extract<WriteSummaryData, { kind: "bulkWrite" }>;
}

function BulkWriteSummary({ summary }: BulkWriteSummaryProps) {
  const { t } = useTranslation("query");
  const { result } = summary;
  // Render every numeric counter unconditionally — users want to see
  // "0 across the board" in the trivial case rather than a blank table.
  // Labels use the same verbs as the single-op headlines above
  // (insert / update / delete) instead of the driver's snake_case field
  // names — issue #1059.
  const rows: { label: string; value: string }[] = [
    { label: "Inserted", value: String(result.inserted_count) },
    { label: "Matched", value: String(result.matched_count) },
    { label: "Modified", value: String(result.modified_count) },
    { label: "Deleted", value: String(result.deleted_count) },
  ];
  return (
    <div className="flex flex-1 flex-col gap-3 p-4 text-sm">
      <table
        className="w-fit min-w-[18rem] border-collapse text-left"
        aria-label={t("write.bulkWriteAria")}
      >
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border">
              <th
                scope="row"
                className="px-3 py-1.5 text-xs text-muted-foreground"
              >
                {r.label}
              </th>
              <td className="px-3 py-1.5 font-mono text-xs text-foreground">
                {r.value}
              </td>
            </tr>
          ))}
          {result.upserted_ids.length > 0 && (
            <tr className="border-b border-border">
              <th
                scope="row"
                className="px-3 py-1.5 align-top text-xs text-muted-foreground"
              >
                Upserted
              </th>
              <td className="px-3 py-1.5 font-mono text-xs text-foreground">
                <ul className="flex flex-col gap-0.5">
                  {result.upserted_ids.map((id, idx) => (
                    <li key={idx}>{formatDocumentIdForMql(id)}</li>
                  ))}
                </ul>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
