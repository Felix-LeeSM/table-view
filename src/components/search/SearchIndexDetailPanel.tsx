import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Braces,
  FileJson,
  FileStack,
  type LucideIcon,
  Settings2,
} from "lucide-react";
import { Skeleton } from "@components/ui/skeleton";
import {
  getSearchIndexFieldStats,
  getSearchIndexMapping,
  getSearchIndexSettings,
  listSearchCatalogSummary,
  listSearchIndexTemplates,
  sampleSearchDocuments,
} from "@lib/tauri/search";
import { SearchResultView } from "@components/search/SearchResultView";
import type {
  SearchCatalogSummary,
  SearchFieldStatsEnvelope,
  SearchIndexMapping,
  SearchIndexSettings,
  SearchIndexTemplateInfo,
  SearchResultEnvelope,
} from "@/types/search";

export interface SearchIndexDetailPanelProps {
  connectionId: string;
  index: string;
}

type DetailTab =
  | "overview"
  | "mapping"
  | "settings"
  | "templates"
  | "samples"
  | "stats";

type AsyncSlot<T> =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: null; error: null }
  | { status: "loaded"; data: T; error: null }
  | { status: "error"; data: null; error: string };

const idle = <T,>(): AsyncSlot<T> => ({
  status: "idle",
  data: null,
  error: null,
});

const tabItems: Array<{
  value: DetailTab;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "overview", label: "Overview", icon: FileJson },
  { value: "mapping", label: "Mapping", icon: Braces },
  { value: "settings", label: "Settings", icon: Settings2 },
  { value: "templates", label: "Templates", icon: FileStack },
  { value: "samples", label: "Samples", icon: FileJson },
  { value: "stats", label: "Field stats", icon: BarChart3 },
];

export default function SearchIndexDetailPanel({
  connectionId,
  index,
}: SearchIndexDetailPanelProps) {
  const [active, setActive] = useState<DetailTab>("overview");
  const [catalog, setCatalog] =
    useState<AsyncSlot<SearchCatalogSummary>>(idle());
  const [mapping, setMapping] = useState<AsyncSlot<SearchIndexMapping>>(idle());
  const [settings, setSettings] =
    useState<AsyncSlot<SearchIndexSettings>>(idle());
  const [templates, setTemplates] =
    useState<AsyncSlot<SearchIndexTemplateInfo[]>>(idle());
  const [samples, setSamples] =
    useState<AsyncSlot<SearchResultEnvelope>>(idle());
  const [stats, setStats] =
    useState<AsyncSlot<SearchFieldStatsEnvelope>>(idle());

  useEffect(() => {
    let cancelled = false;
    setCatalog({ status: "loading", data: null, error: null });
    setMapping(idle());
    setSettings(idle());
    setTemplates(idle());
    setSamples(idle());
    setStats(idle());
    setActive("overview");
    void listSearchCatalogSummary(connectionId)
      .then((next) => {
        if (!cancelled) {
          setCatalog({ status: "loaded", data: next, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCatalog({
            status: "error",
            data: null,
            error: errorMessage(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, index]);

  const loadMapping = useCallback(async () => {
    if (mapping.status !== "idle") return;
    setMapping({ status: "loading", data: null, error: null });
    try {
      const next = await getSearchIndexMapping(connectionId, index);
      setMapping({ status: "loaded", data: next, error: null });
    } catch (err) {
      setMapping({ status: "error", data: null, error: errorMessage(err) });
    }
  }, [connectionId, index, mapping.status]);

  const loadSettings = useCallback(async () => {
    if (settings.status !== "idle") return;
    setSettings({ status: "loading", data: null, error: null });
    try {
      const next = await getSearchIndexSettings(connectionId, index);
      setSettings({ status: "loaded", data: next, error: null });
    } catch (err) {
      setSettings({ status: "error", data: null, error: errorMessage(err) });
    }
  }, [connectionId, index, settings.status]);

  const loadTemplates = useCallback(async () => {
    if (templates.status !== "idle") return;
    setTemplates({ status: "loading", data: null, error: null });
    try {
      const next = await listSearchIndexTemplates(connectionId);
      setTemplates({ status: "loaded", data: next, error: null });
    } catch (err) {
      setTemplates({ status: "error", data: null, error: errorMessage(err) });
    }
  }, [connectionId, templates.status]);

  const loadSamples = useCallback(async () => {
    if (samples.status !== "idle") return;
    setSamples({ status: "loading", data: null, error: null });
    try {
      const next = await sampleSearchDocuments(connectionId, index, 5);
      setSamples({ status: "loaded", data: next, error: null });
    } catch (err) {
      setSamples({ status: "error", data: null, error: errorMessage(err) });
    }
  }, [connectionId, index, samples.status]);

  const loadStats = useCallback(async () => {
    if (stats.status !== "idle") return;
    setStats({ status: "loading", data: null, error: null });
    try {
      const next = await getSearchIndexFieldStats(connectionId, index);
      setStats({ status: "loaded", data: next, error: null });
    } catch (err) {
      setStats({ status: "error", data: null, error: errorMessage(err) });
    }
  }, [connectionId, index, stats.status]);

  useEffect(() => {
    if (active === "mapping") void loadMapping();
    if (active === "settings") void loadSettings();
    if (active === "templates") void loadTemplates();
    if (active === "samples") void loadSamples();
    if (active === "stats") void loadStats();
  }, [
    active,
    loadMapping,
    loadSamples,
    loadSettings,
    loadStats,
    loadTemplates,
  ]);

  const indexInfo = catalog.data?.indexes.find((item) => item.name === index);
  const identity = catalog.data?.identity;
  const matchingTemplates = useMemo(() => {
    if (templates.status !== "loaded") return [];
    return templates.data.filter((template) =>
      template.indexPatterns.some((pattern) => matchesPattern(index, pattern)),
    );
  }, [index, templates]);

  return (
    <section
      aria-label={`Search index details for ${index}`}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-sm"
    >
      <header className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-foreground">
              {index}
            </h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {identity
                ? `${identity.clusterName} · ${identity.version.number}${identity.version.distribution ? ` · ${identity.version.distribution}` : ""}`
                : "fixture-backed Search index"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-3xs text-muted-foreground">
            {indexInfo ? (
              <>
                <Badge>{indexInfo.health}</Badge>
                {indexInfo.docsCount === undefined ? null : (
                  <Badge>
                    {formatOptionalNumber(indexInfo.docsCount, "docs")}
                  </Badge>
                )}
                {indexInfo.storeSizeBytes === undefined ? null : (
                  <Badge>{formatOptionalBytes(indexInfo.storeSizeBytes)}</Badge>
                )}
              </>
            ) : null}
            {isSystemName(index) ? <Badge>system</Badge> : null}
          </div>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Search index detail sections"
        className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border bg-secondary"
      >
        {tabItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={active === item.value}
              className={`flex h-8 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-medium ${
                active === item.value
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-secondary-foreground"
              }`}
              onClick={() => setActive(item.value)}
            >
              <Icon size={12} aria-hidden />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {active === "overview" ? (
          <OverviewContent
            catalog={catalog}
            index={index}
            indexInfo={indexInfo}
          />
        ) : active === "mapping" ? (
          <MappingContent slot={mapping} />
        ) : active === "settings" ? (
          <SettingsContent slot={settings} />
        ) : active === "templates" ? (
          <TemplatesContent slot={templates} matches={matchingTemplates} />
        ) : active === "samples" ? (
          <SamplesContent slot={samples} />
        ) : (
          <StatsContent slot={stats} />
        )}
      </div>
    </section>
  );
}

function OverviewContent({
  catalog,
  index,
  indexInfo,
}: {
  catalog: AsyncSlot<SearchCatalogSummary>;
  index: string;
  indexInfo: SearchCatalogSummary["indexes"][number] | undefined;
}) {
  if (catalog.status === "loading" || catalog.status === "idle") {
    return <DetailSkeleton label="Loading Search index overview" />;
  }
  if (catalog.status === "error") return <ErrorBlock message={catalog.error} />;
  if (!indexInfo) {
    return <EmptyBlock message={`Index ${index} is not in the catalog.`} />;
  }
  const identity = catalog.data.identity;
  const aliases = indexInfo.aliases.length > 0 ? indexInfo.aliases : ["none"];
  return (
    <div className="space-y-3 p-3">
      <DetailGrid
        rows={[
          ["Product", identity.product],
          ["Version", identity.version.number],
          ["Distribution", identity.version.distribution ?? "unknown"],
          ["Template endpoint", identity.productDelta.defaultTemplateEndpoint],
          ["Open", indexInfo.open ? "yes" : "no"],
          [
            "Shards",
            formatShards(indexInfo.primaryShards, indexInfo.replicaShards),
          ],
          ["Aliases", aliases.join(", ")],
        ]}
      />
      <JsonBlock value={indexInfo} label="Index summary JSON" />
    </div>
  );
}

function MappingContent({ slot }: { slot: AsyncSlot<SearchIndexMapping> }) {
  if (slot.status === "idle" || slot.status === "loading") {
    return <DetailSkeleton label="Loading Search mapping" />;
  }
  if (slot.status === "error") return <ErrorBlock message={slot.error} />;
  if (slot.data.fields.length === 0) {
    return <EmptyBlock message="No mapping fields." />;
  }
  return (
    <div className="space-y-3 p-3">
      <div className="text-xs text-muted-foreground">
        {slot.data.fields.length.toLocaleString()} field
        {slot.data.fields.length === 1 ? "" : "s"}
      </div>
      <div className="divide-y divide-border rounded border border-border">
        {slot.data.fields.map((field) => (
          <FieldRow
            key={field.path}
            name={field.path}
            detail={field.fieldType}
            badges={[
              field.searchable ? "searchable" : "not searchable",
              field.aggregatable ? "aggregatable" : "not aggregatable",
              field.analyzer ? `analyzer ${field.analyzer}` : "",
            ]}
          />
        ))}
      </div>
      <JsonBlock value={slot.data.raw} label="Mapping JSON" />
    </div>
  );
}

function SettingsContent({ slot }: { slot: AsyncSlot<SearchIndexSettings> }) {
  if (slot.status === "idle" || slot.status === "loading") {
    return <DetailSkeleton label="Loading Search settings" />;
  }
  if (slot.status === "error") return <ErrorBlock message={slot.error} />;
  return (
    <div className="space-y-3 p-3">
      {slot.data.analyzers.length === 0 ? (
        <EmptyBlock message="No analyzers." />
      ) : (
        <div className="divide-y divide-border rounded border border-border">
          {slot.data.analyzers.map((analyzer) => (
            <FieldRow
              key={analyzer.name}
              name={analyzer.name}
              detail={analyzer.analyzerType}
              badges={[analyzer.tokenizer ?? "", ...analyzer.filters]}
            />
          ))}
        </div>
      )}
      <JsonBlock value={slot.data.raw} label="Settings JSON" />
    </div>
  );
}

function TemplatesContent({
  slot,
  matches,
}: {
  slot: AsyncSlot<SearchIndexTemplateInfo[]>;
  matches: SearchIndexTemplateInfo[];
}) {
  if (slot.status === "idle" || slot.status === "loading") {
    return <DetailSkeleton label="Loading Search templates" />;
  }
  if (slot.status === "error") return <ErrorBlock message={slot.error} />;
  if (matches.length === 0) {
    return <EmptyBlock message="No matching templates." />;
  }
  return (
    <div className="space-y-3 p-3">
      <div className="divide-y divide-border rounded border border-border">
        {matches.map((template) => (
          <FieldRow
            key={template.name}
            name={template.name}
            detail={template.endpoint}
            badges={[
              template.priority === undefined
                ? ""
                : `priority ${template.priority}`,
              ...template.indexPatterns,
            ]}
          />
        ))}
      </div>
      <JsonBlock
        value={matches.map((item) => item.raw)}
        label="Template JSON"
      />
    </div>
  );
}

function SamplesContent({ slot }: { slot: AsyncSlot<SearchResultEnvelope> }) {
  if (slot.status === "idle" || slot.status === "loading") {
    return <DetailSkeleton label="Loading Search sample documents" />;
  }
  if (slot.status === "error") return <ErrorBlock message={slot.error} />;
  return <SearchResultView result={slot.data} />;
}

function StatsContent({ slot }: { slot: AsyncSlot<SearchFieldStatsEnvelope> }) {
  if (slot.status === "idle" || slot.status === "loading") {
    return <DetailSkeleton label="Loading Search field stats" />;
  }
  if (slot.status === "error") return <ErrorBlock message={slot.error} />;
  if (slot.data.fields.length === 0) {
    return <EmptyBlock message="No field stats." />;
  }
  return (
    <div className="space-y-3 p-3">
      <div className="divide-y divide-border rounded border border-border">
        {slot.data.fields.map((field) => (
          <FieldRow
            key={field.path}
            name={field.path}
            detail={`${field.fieldType} · ${formatOptionalNumber(field.docsCount, "docs")}`}
            badges={[
              field.searchable ? "searchable" : "not searchable",
              field.aggregatable ? "aggregatable" : "not aggregatable",
              field.sampleValues.length > 0
                ? `${field.sampleValues.length} samples`
                : "",
            ]}
          />
        ))}
      </div>
    </div>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[9rem_minmax(0,1fr)] rounded border border-border text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="border-b border-r border-border bg-muted/40 px-2 py-1.5 font-medium text-muted-foreground last:border-b-0">
            {label}
          </dt>
          <dd className="min-w-0 truncate border-b border-border px-2 py-1.5 text-secondary-foreground last:border-b-0">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FieldRow({
  name,
  detail,
  badges,
}: {
  name: string;
  detail: string;
  badges: string[];
}) {
  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2 text-xs">
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{name}</div>
        <div className="mt-0.5 truncate text-3xs text-muted-foreground">
          {detail}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1 text-3xs text-muted-foreground">
        {badges.filter(Boolean).map((badge) => (
          <Badge key={badge}>{badge}</Badge>
        ))}
      </div>
    </div>
  );
}

function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <details className="rounded border border-border">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-secondary-foreground">
        {label}
      </summary>
      <pre className="max-h-80 overflow-auto border-t border-border bg-muted/30 p-3 font-mono text-xs leading-5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function Badge({ children }: { children: string }) {
  return <span className="rounded bg-muted px-1.5 py-0.5">{children}</span>;
}

function DetailSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="space-y-2 p-3"
    >
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-5/6" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div role="alert" className="border-b border-border p-3 text-destructive">
      {message}
    </div>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div role="status" className="p-3 text-xs text-muted-foreground">
      {message}
    </div>
  );
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function matchesPattern(index: string, pattern: string) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(index);
}

function isSystemName(name: string) {
  return name.startsWith(".");
}

function formatOptionalNumber(value: number | undefined, suffix: string) {
  if (value === undefined) return "";
  return `${new Intl.NumberFormat("en", { notation: "compact" }).format(
    value,
  )} ${suffix}`;
}

function formatOptionalBytes(value: number | undefined) {
  if (value === undefined) return "";
  if (value < 1024) return `${value} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function formatShards(
  primaryShards: number | undefined,
  replicaShards: number | undefined,
) {
  if (primaryShards === undefined && replicaShards === undefined) return "";
  return `${primaryShards ?? 0}p/${replicaShards ?? 0}r`;
}
