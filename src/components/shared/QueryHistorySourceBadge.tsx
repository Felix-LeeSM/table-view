import { useTranslation } from "react-i18next";
import type { QueryHistorySource } from "@stores/queryHistoryStore";

// Small badge that surfaces non-`raw` history sources. `raw` (the default
// for editor-driven queries) is suppressed to keep the row visually quiet
// — only commits / DDL / Mongo ops light up.

interface SourceMeta {
  label: string;
  className: string;
  title: string;
}

// Static class and label info — only `title` is i18n'd (done inside the component).
const META_STATIC: Record<
  Exclude<QueryHistorySource, "raw">,
  { label: string; className: string }
> = {
  "grid-edit": {
    label: "GRID",
    // Same blue family as the production-tier neutral info color used in
    // the Safe Mode banner so non-destructive commits feel calm.
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
  "ddl-structure": {
    // Structure ops are louder — these alter the schema, so use the warn
    // tier color so they catch the eye in a long log.
    label: "DDL",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  "mongo-op": {
    label: "MQL",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  explain: {
    label: "PLAN",
    className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  },
  "file-analytics": {
    label: "FILE",
    className: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
  // sprint-373 (2026-05-17) — sidebar 의 collection / table 클릭이 trigger
  // 한 preview-row SELECT 가 본 source 로 기록. user-initiated 지만 dialog
  // 가 없는 background-ish 경로라 muted gray 패턴.
  "sidebar-prefetch": {
    label: "PREV",
    className: "bg-muted text-muted-foreground",
  },
};

const SOURCES = new Set<QueryHistorySource>([
  "raw",
  "grid-edit",
  "ddl-structure",
  "mongo-op",
  "explain",
  "file-analytics",
  "sidebar-prefetch",
]);

interface QueryHistorySourceBadgeProps {
  source?: string | null;
  sourceLabel?: string | null;
}

function isQueryHistorySource(source: string): source is QueryHistorySource {
  return SOURCES.has(source as QueryHistorySource);
}

export function QueryHistorySourceBadge({
  source,
  sourceLabel,
}: QueryHistorySourceBadgeProps) {
  const { t } = useTranslation("shared");

  if (!source || !isQueryHistorySource(source) || source === "raw") return null;
  const staticMeta = META_STATIC[source];
  const META: Record<Exclude<QueryHistorySource, "raw">, SourceMeta> = {
    "grid-edit": {
      ...META_STATIC["grid-edit"],
      title: t("historyBadge.gridTitle"),
    },
    "ddl-structure": {
      ...META_STATIC["ddl-structure"],
      title: t("historyBadge.ddlTitle"),
    },
    "mongo-op": {
      ...META_STATIC["mongo-op"],
      title: t("historyBadge.mongoTitle"),
    },
    explain: {
      ...META_STATIC["explain"],
      title: t("historyBadge.explainTitle"),
    },
    "file-analytics": {
      ...META_STATIC["file-analytics"],
      title: t("historyBadge.fileTitle"),
    },
    "sidebar-prefetch": {
      ...META_STATIC["sidebar-prefetch"],
      title: t("historyBadge.sidebarTitle"),
    },
  };
  const meta = META[source];
  const label =
    source === "file-analytics" && sourceLabel
      ? (sourceLabel.split(/[\\/]/).filter(Boolean).pop() ?? staticMeta.label)
      : staticMeta.label;
  const title =
    source === "file-analytics" && label !== staticMeta.label
      ? t("historyBadge.fileCustomTitle", { label })
      : meta.title;
  const labelClass =
    source === "file-analytics" && label !== staticMeta.label
      ? "inline-block max-w-48 truncate align-bottom"
      : "";
  return (
    <span
      data-testid="query-history-source-badge"
      data-source={source}
      title={title}
      className={`shrink-0 rounded px-1.5 py-0.5 text-3xs font-semibold tracking-wide ${labelClass} ${staticMeta.className}`}
    >
      {label}
    </span>
  );
}

export default QueryHistorySourceBadge;
