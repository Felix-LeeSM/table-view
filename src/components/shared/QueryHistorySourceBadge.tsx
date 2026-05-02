import type { QueryHistorySource } from "@stores/queryHistoryStore";

// Sprint 196 (AC-196-06) — small badge that surfaces non-`raw` history
// sources. `raw` (the default for editor-driven queries) is suppressed to
// keep the row visually quiet — only commits / DDL / Mongo ops light up.

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
