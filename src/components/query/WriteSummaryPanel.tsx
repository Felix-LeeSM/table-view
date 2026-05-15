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
  const [expanded, setExpanded] = useState(false);
  const n = summary.insertedIds.length;
  const headline =
    n === 1 ? "Inserted 1 document" : `Inserted ${n} document(s)`;

  return (
    <div className="flex flex-1 flex-col gap-2 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-secondary-foreground">
        {n > 0 && (
          <button
            type="button"
            aria-label={expanded ? "Hide inserted ids" : "Show inserted ids"}
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
  const { matchedCount, modifiedCount } = summary;
  const modifiedNoun = modifiedCount === 1 ? "document" : "document(s)";
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-sm text-secondary-foreground">
      Modified {modifiedCount} {modifiedNoun} (matched {matchedCount})
    </div>
  );
}

// ── Delete ────────────────────────────────────────────────────────────────

interface DeleteSummaryProps {
  summary: Extract<WriteSummaryData, { kind: "delete" }>;
}

function DeleteSummary({ summary }: DeleteSummaryProps) {
  const n = summary.deletedCount;
  const headline = n === 1 ? "Deleted 1 document" : `Deleted ${n} document(s)`;
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
  const { result } = summary;
  // Render every numeric counter unconditionally — users want to see
  // "0 across the board" in the trivial case rather than a blank table.
  const rows: { label: string; value: string }[] = [
    { label: "inserted_count", value: String(result.inserted_count) },
    { label: "matched_count", value: String(result.matched_count) },
    { label: "modified_count", value: String(result.modified_count) },
    { label: "deleted_count", value: String(result.deleted_count) },
  ];
  return (
    <div className="flex flex-1 flex-col gap-3 p-4 text-sm">
      <table
        className="w-fit min-w-[18rem] border-collapse text-left"
        aria-label="bulkWrite result counters"
      >
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border">
              <th
                scope="row"
                className="px-3 py-1.5 font-mono text-xs text-muted-foreground"
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
                className="px-3 py-1.5 align-top font-mono text-xs text-muted-foreground"
              >
                upserted_ids
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
