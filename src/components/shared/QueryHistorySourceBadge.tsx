import type { QueryHistorySource } from "@stores/queryHistoryStore";

// Small badge that surfaces non-`raw` history sources. `raw` (the default
// for editor-driven queries) is suppressed to keep the row visually quiet
// — only commits / DDL / Mongo ops light up.

interface SourceMeta {
  label: string;
  className: string;
  title: string;
}

const META: Record<Exclude<QueryHistorySource, "raw">, SourceMeta> = {
  "grid-edit": {
    label: "GRID",
    // Same blue family as the production-tier neutral info color used in
    // the Safe Mode banner so non-destructive commits feel calm.
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    title: "Recorded from a grid commit (cell edits / row delete)",
  },
  "ddl-structure": {
    // Structure ops are louder — these alter the schema, so use the warn
    // tier color so they catch the eye in a long log.
    label: "DDL",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    title:
      "Recorded from a structure editor (columns / indexes / constraints / drop)",
  },
  "mongo-op": {
    label: "MQL",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    title: "Recorded from a Mongo single-document op (insert)",
  },
  explain: {
    label: "PLAN",
    className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    title: "Recorded from the query editor Explain plan action",
  },
  "file-analytics": {
    label: "FILE",
    className: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    title: "Recorded from a DuckDB local-file source query",
  },
  // sprint-373 (2026-05-17) — sidebar 의 collection / table 클릭이 trigger
  // 한 preview-row SELECT 가 본 source 로 기록. user-initiated 지만 dialog
  // 가 없는 background-ish 경로라 muted gray 패턴.
  "sidebar-prefetch": {
    label: "PREV",
    className: "bg-muted text-muted-foreground",
    title: "Recorded from a sidebar table/collection preview (DataGrid open)",
  },
};

interface QueryHistorySourceBadgeProps {
  source?: QueryHistorySource;
}

export function QueryHistorySourceBadge({
  source,
}: QueryHistorySourceBadgeProps) {
  if (!source || source === "raw") return null;
  const meta = META[source];
  return (
    <span
      data-testid="query-history-source-badge"
      data-source={source}
      title={meta.title}
      className={`shrink-0 rounded px-1.5 py-0.5 text-3xs font-semibold tracking-wide ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

export default QueryHistorySourceBadge;
