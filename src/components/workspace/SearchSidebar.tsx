import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Boxes,
  Database,
  FileStack,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@components/ui/button";
import { Checkbox } from "@components/ui/checkbox";
import { Skeleton } from "@components/ui/skeleton";
import { useConnectionStore } from "@stores/connectionStore";
import { useMruStore } from "@stores/mruStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  formatSearchUiError,
  type SearchUiError,
} from "@lib/search/searchUiError";
import { listSearchCatalogSummary } from "@lib/tauri/search";
import type {
  SearchAliasInfo,
  SearchCatalogSummary,
  SearchDataStreamInfo,
  SearchIndexInfo,
} from "@/types/search";
import { DATABASE_TYPE_LABELS } from "@/types/connection";

export interface SearchSidebarProps {
  connectionId: string;
}

type CatalogEntry =
  | { kind: "index"; id: string; item: SearchIndexInfo }
  | { kind: "alias"; id: string; item: SearchAliasInfo }
  | { kind: "dataStream"; id: string; item: SearchDataStreamInfo };

const SEARCH_WORKSPACE_DB = "_search";
const SEARCH_QUERY_TEMPLATE = JSON.stringify(
  {
    query: { match_all: {} },
    size: 10,
    track_total_hits: true,
  },
  null,
  2,
);

export default function SearchSidebar({ connectionId }: SearchSidebarProps) {
  const { t } = useTranslation("workspace");
  const connection = useConnectionStore((s) =>
    s.connections.find((c) => c.id === connectionId),
  );
  const productLabel = connection
    ? DATABASE_TYPE_LABELS[connection.dbType]
    : "Search";
  const addTab = useWorkspaceStore((s) => s.addTab);
  const addQueryTab = useWorkspaceStore((s) => s.addQueryTab);
  const setActiveDb = useConnectionStore((s) => s.setActiveDb);
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);
  const [catalog, setCatalog] = useState<SearchCatalogSummary | null>(null);
  const [filter, setFilter] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SearchUiError | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextCatalog = await listSearchCatalogSummary(connectionId);
      setCatalog(nextCatalog);
      setSelectedId((prev) => keepSelected(prev, nextCatalog));
    } catch (err) {
      setCatalog(null);
      setSelectedId(null);
      setError(formatSearchUiError("catalog", err));
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    setCatalog(null);
    setSelectedId(null);
    setError(null);
    void loadCatalog();
  }, [loadCatalog]);

  const visible = useMemo(
    () => filterCatalog(catalog, filter, showSystem),
    [catalog, filter, showSystem],
  );
  const identity = catalog?.identity;
  const version = identity
    ? `${identity.version.number}${identity.version.distribution ? ` · ${identity.version.distribution}` : ""}`
    : "fixture-backed catalog";
  const summaryText = catalog
    ? `${catalog.indexes.length} index${catalog.indexes.length === 1 ? "" : "es"} · ${catalog.aliases.length} alias${catalog.aliases.length === 1 ? "" : "es"} · ${catalog.dataStreams.length} data stream${catalog.dataStreams.length === 1 ? "" : "s"}`
    : "catalog pending";
  const openIndex = useCallback(
    (entry: CatalogEntry, permanent = false) => {
      setSelectedId(entry.id);
      if (entry.kind !== "index") return;
      setActiveDb(connectionId, SEARCH_WORKSPACE_DB);
      addTab(connectionId, {
        title: entry.item.name,
        connectionId,
        type: "table",
        closable: true,
        database: SEARCH_WORKSPACE_DB,
        schema: SEARCH_WORKSPACE_DB,
        table: entry.item.name,
        subView: "structure",
        paradigm: "search",
        permanent,
      });
      markConnectionUsed(connectionId);
    },
    [addTab, connectionId, markConnectionUsed, setActiveDb],
  );
  const openSearchQuery = useCallback(
    (entry: CatalogEntry) => {
      if (!canQueryTarget(entry)) return;
      setSelectedId(entry.id);
      setActiveDb(connectionId, SEARCH_WORKSPACE_DB);
      addQueryTab(connectionId, SEARCH_WORKSPACE_DB, {
        paradigm: "search",
        queryLanguage: "search-dsl",
        title: `Query ${entry.item.name}`,
        sql: SEARCH_QUERY_TEMPLATE,
        searchTarget: { kind: entry.kind, name: entry.item.name },
      });
      markConnectionUsed(connectionId);
    },
    [addQueryTab, connectionId, markConnectionUsed, setActiveDb],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium text-secondary-foreground">
            <Search size={13} aria-hidden />
            <span className="truncate">{t("search.catalogHeader")}</span>
          </div>
          <div className="mt-1 truncate text-3xs text-muted-foreground">
            {identity?.clusterName ?? productLabel} · {version}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("search.refreshAria", { productLabel })}
          title={t("search.refreshAria", { productLabel })}
          disabled={loading}
          onClick={() => {
            void loadCatalog();
          }}
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <Search size={12} className="text-muted-foreground" aria-hidden />
        <input
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          aria-label={t("search.filterAria", { productLabel })}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("search.filterPlaceholder")}
        />
      </div>

      <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-3xs text-muted-foreground">
        <Checkbox
          aria-label={t("search.showSystemAria")}
          checked={showSystem}
          onCheckedChange={(checked) => setShowSystem(checked === true)}
        />
        {t("search.showSystemLabel")}
      </label>

      <div
        className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-3xs text-muted-foreground"
        data-testid="search-catalog-status"
      >
        <span>search-native</span>
        <span>{summaryText}</span>
      </div>

      {error && (
        <div
          role="alert"
          className="border-b border-border px-3 py-2 text-destructive"
        >
          <div className="font-medium">{error.label}</div>
          <p className="mt-1 whitespace-pre-wrap text-3xs">{error.detail}</p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !catalog ? (
          <SearchCatalogSkeleton />
        ) : (
          <div
            role="tree"
            aria-label={t("search.catalogAria", { productLabel })}
            className="py-1"
          >
            <CatalogSection
              title={t("search.section.indexes")}
              empty={t("search.empty.indexes")}
            >
              {visible.indexes.map((item) => (
                <CatalogRow
                  key={item.name}
                  entry={{ kind: "index", id: `index:${item.name}`, item }}
                  selectedId={selectedId}
                  onSelect={openIndex}
                  onOpenQuery={openSearchQuery}
                />
              ))}
            </CatalogSection>
            <CatalogSection
              title={t("search.section.aliases")}
              empty={t("search.empty.aliases")}
            >
              {visible.aliases.map((item) => (
                <CatalogRow
                  key={`${item.name}:${item.index}`}
                  entry={{
                    kind: "alias",
                    id: `alias:${item.name}:${item.index}`,
                    item,
                  }}
                  selectedId={selectedId}
                  onSelect={openIndex}
                  onOpenQuery={openSearchQuery}
                />
              ))}
            </CatalogSection>
            <CatalogSection
              title={t("search.section.dataStreams")}
              empty={t("search.empty.dataStreams")}
            >
              {visible.dataStreams.map((item) => (
                <CatalogRow
                  key={item.name}
                  entry={{
                    kind: "dataStream",
                    id: `dataStream:${item.name}`,
                    item,
                  }}
                  selectedId={selectedId}
                  onSelect={openIndex}
                  onOpenQuery={openSearchQuery}
                />
              ))}
            </CatalogSection>
          </div>
        )}
      </div>
    </div>
  );
}

function CatalogSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className="border-b border-border last:border-b-0">
      <div className="px-3 pt-2 pb-1 text-3xs font-medium tracking-normal text-muted-foreground uppercase">
        {title}
      </div>
      {children.length > 0 ? (
        children
      ) : (
        <div role="status" className="px-3 pb-2 text-3xs text-muted-foreground">
          {empty}
        </div>
      )}
    </section>
  );
}

function CatalogRow({
  entry,
  selectedId,
  onSelect,
  onOpenQuery,
}: {
  entry: CatalogEntry;
  selectedId: string | null;
  onSelect: (entry: CatalogEntry, permanent?: boolean) => void;
  onOpenQuery: (entry: CatalogEntry) => void;
}) {
  const { t } = useTranslation("workspace");
  const selected = selectedId === entry.id;
  const Icon =
    entry.kind === "alias"
      ? FileStack
      : entry.kind === "dataStream"
        ? Boxes
        : Database;
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      data-selected={selected || undefined}
      tabIndex={0}
      className="grid min-h-9 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground data-[selected]:bg-accent data-[selected]:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={() => onSelect(entry)}
      onDoubleClick={() => onSelect(entry, true)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(entry);
      }}
    >
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 text-left"
        onClick={(event) => {
          event.stopPropagation();
          onSelect(entry);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onSelect(entry, true);
        }}
      >
        <Icon
          size={12}
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0">
          <div className="truncate font-medium text-secondary-foreground">
            {entryTitle(entry)}
          </div>
          <div className="truncate text-3xs text-muted-foreground">
            {entrySubtitle(entry)}
          </div>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1.5 text-3xs text-muted-foreground">
        {entryBadges(entry).map((badge) => (
          <span key={badge} className="rounded bg-muted px-1.5 py-0.5">
            {badge}
          </span>
        ))}
        {canQueryTarget(entry) ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("search.openQueryAria", { name: entryTitle(entry) })}
            title={t("search.openQueryTitle", { name: entryTitle(entry) })}
            onClick={(event) => {
              event.stopPropagation();
              onOpenQuery(entry);
            }}
          >
            <Search size={12} aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SearchCatalogSkeleton() {
  const { t } = useTranslation("workspace");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("search.loadingCatalogAria")}
      className="space-y-2 px-3 py-3"
    >
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-5/6" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

function filterCatalog(
  catalog: SearchCatalogSummary | null,
  filter: string,
  showSystem: boolean,
) {
  const q = filter.trim().toLowerCase();
  const indexes = catalog?.indexes ?? [];
  const aliases = catalog?.aliases ?? [];
  const dataStreams = catalog?.dataStreams ?? [];
  return {
    indexes: indexes.filter(
      (item) =>
        (showSystem || !isSystemName(item.name)) &&
        matchesQuery(q, [item.name, ...item.aliases]),
    ),
    aliases: aliases.filter(
      (item) =>
        (showSystem || !isSystemName(item.name)) &&
        matchesQuery(q, [item.name, item.index]),
    ),
    dataStreams: dataStreams.filter(
      (item) =>
        (showSystem || (!item.hidden && !isSystemName(item.name))) &&
        matchesQuery(q, [item.name, ...item.backingIndices]),
    ),
  };
}

function matchesQuery(query: string, values: readonly string[]) {
  if (!query) return true;
  return values.some((value) => value.toLowerCase().includes(query));
}

function keepSelected(
  selectedId: string | null,
  catalog: SearchCatalogSummary,
) {
  if (!selectedId) return null;
  const allIds = new Set([
    ...catalog.indexes.map((item) => `index:${item.name}`),
    ...catalog.aliases.map((item) => `alias:${item.name}:${item.index}`),
    ...catalog.dataStreams.map((item) => `dataStream:${item.name}`),
  ]);
  return allIds.has(selectedId) ? selectedId : null;
}

function entryTitle(entry: CatalogEntry) {
  switch (entry.kind) {
    case "index":
      return entry.item.name;
    case "alias":
      return entry.item.name;
    case "dataStream":
      return entry.item.name;
  }
}

function entrySubtitle(entry: CatalogEntry) {
  switch (entry.kind) {
    case "index":
      return `${entry.item.open ? "open" : "closed"} · ${entry.item.aliases.length} alias${entry.item.aliases.length === 1 ? "" : "es"}`;
    case "alias":
      return `${entry.item.index}${entry.item.writeIndex ? " · write index" : ""}`;
    case "dataStream":
      return `${entry.item.backingIndices.length} backing index${entry.item.backingIndices.length === 1 ? "" : "es"}`;
  }
}

function entryBadges(entry: CatalogEntry) {
  switch (entry.kind) {
    case "index":
      return [
        entry.item.health,
        formatOptionalNumber(entry.item.docsCount, "docs"),
        formatOptionalBytes(entry.item.storeSizeBytes),
        formatShards(entry.item.primaryShards, entry.item.replicaShards),
      ].filter(Boolean);
    case "alias":
      return [entry.item.writeIndex ? "write" : "read"];
    case "dataStream":
      return [
        entry.item.health,
        formatOptionalNumber(entry.item.docsCount, "docs"),
        formatOptionalBytes(entry.item.storeSizeBytes),
        formatShards(entry.item.primaryShards, entry.item.replicaShards),
      ].filter(Boolean);
  }
}

function canQueryTarget(
  entry: CatalogEntry,
): entry is Extract<CatalogEntry, { kind: "index" | "alias" }> {
  return entry.kind === "index" || entry.kind === "alias";
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
