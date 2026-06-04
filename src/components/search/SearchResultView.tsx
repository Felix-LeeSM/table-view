import {
  AlertTriangle,
  BarChart3,
  Clock3,
  Database,
  FileJson,
  Loader2,
  Search,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@components/ui/skeleton";
import type { QueryState } from "@/types/query";
import type {
  SearchAggregationEnvelope,
  SearchHitEnvelope,
  SearchRawAggregationEnvelope,
  SearchResultEnvelope,
  SearchShardSummary,
  SearchTermsAggregationEnvelope,
  SearchValueCountAggregationEnvelope,
} from "@/types/search";
import {
  formatSearchInline,
  formatSearchJson,
  normalizeSearchResult,
} from "./searchResultViewModel";

export interface SearchResultViewProps {
  result?: SearchResultEnvelope;
  queryState?: QueryState;
}

const LARGE_SOURCE_LENGTH = 4000;
const LONG_HIGHLIGHT_LENGTH = 1600;

export function SearchResultView({
  result,
  queryState,
}: SearchResultViewProps) {
  const state =
    queryState ??
    (result
      ? ({ status: "completedSearch", result } as const)
      : ({ status: "idle" } as const));

  if (state.status === "running") {
    return <SearchLoadingState />;
  }

  if (state.status === "error") {
    return <SearchErrorState message={state.error} />;
  }

  if (state.status === "cancelled") {
    return <SearchCancelledState message={state.message} />;
  }

  if (state.status === "completedSearch") {
    return <CompletedSearchResult result={state.result} />;
  }

  if (state.status === "completed") {
    return (
      <SearchMalformedState message="Search renderer received a tabular query result. Search hits must stay on the completedSearch state." />
    );
  }

  return <SearchIdleState />;
}

function SearchIdleState() {
  return (
    <section
      aria-label="Search results"
      className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden bg-background p-6 text-sm text-muted-foreground"
    >
      <Search className="mb-2" size={22} aria-hidden="true" />
      <p>Run a Search DSL request to inspect hits.</p>
    </section>
  );
}

function SearchLoadingState() {
  return (
    <section
      aria-label="Search results"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-sm"
    >
      <div
        role="status"
        className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground"
      >
        <Loader2 className="animate-spin" size={14} aria-hidden="true" />
        <span>Search query running</span>
      </div>
      <div className="grid gap-3 p-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </section>
  );
}

function SearchErrorState({ message }: { message: string }) {
  return (
    <section
      aria-label="Search results"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-sm"
    >
      <div
        role="alert"
        className="border-b border-border bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>Search query failed</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-xs">{message}</p>
      </div>
    </section>
  );
}

function SearchCancelledState({ message }: { message?: string }) {
  return (
    <section
      aria-label="Search results"
      className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden bg-background p-6 text-sm text-muted-foreground"
    >
      <p role="status">{message ?? "Search query cancelled"}</p>
    </section>
  );
}

function SearchMalformedState({ message }: { message: string }) {
  return (
    <section
      aria-label="Search results"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-sm"
    >
      <div
        role="alert"
        className="border-b border-border bg-warning/10 px-3 py-2 text-sm text-warning"
      >
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>Malformed Search result payload</span>
        </div>
        <p className="mt-1 text-xs">{message}</p>
      </div>
    </section>
  );
}

function CompletedSearchResult({ result }: { result: SearchResultEnvelope }) {
  const normalized = normalizeSearchResult(result);

  if (!normalized.ok) {
    return <SearchMalformedState message={normalized.message} />;
  }

  const { result: data } = normalized;
  const shownHits = data.hits.length;

  return (
    <section
      aria-label="Search results"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-sm"
    >
      <header className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Metric icon={Search}>
            {formatTotalHits(data.total.value, data.total.relation)} hits
          </Metric>
          <Metric icon={Clock3}>{data.tookMs} ms</Metric>
          <Metric icon={FileJson}>Showing {shownHits} hits</Metric>
          {data.shards ? <ShardMetric shards={data.shards} /> : null}
          {data.timedOut ? (
            <span className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
              timed out
            </span>
          ) : null}
        </div>
      </header>

      {data.shards && data.shards.failed > 0 ? (
        <ShardFailures shards={data.shards} />
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div
          aria-label="Search hits"
          className="min-h-0 overflow-auto border-b border-border lg:border-r lg:border-b-0"
        >
          {data.hits.length === 0 ? (
            <div className="p-4 text-muted-foreground">No Search hits</div>
          ) : (
            <ol className="divide-y divide-border">
              {data.hits.map((hit, index) => (
                <SearchHitItem
                  key={`${hit.index}:${hit.id}:${index}`}
                  hit={hit}
                  position={index + 1}
                />
              ))}
            </ol>
          )}
        </div>

        <aside className="min-h-0 overflow-auto p-3">
          <section aria-label="Search aggregations">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
              <BarChart3 size={14} aria-hidden="true" />
              <span>Aggregations</span>
            </div>
            {data.aggregations.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No aggregations
              </div>
            ) : (
              <ul className="space-y-2">
                {data.aggregations.map((aggregation, index) => (
                  <AggregationItem
                    key={`${aggregation.name}:${aggregation.kind}:${index}`}
                    aggregation={aggregation}
                  />
                ))}
              </ul>
            )}
          </section>

          <ExpandablePayload label="Explain payload" value={data.explain} />
          <ExpandablePayload label="Profile payload" value={data.profile} />
        </aside>
      </div>
    </section>
  );
}

function SearchHitItem({
  hit,
  position,
}: {
  hit: SearchHitEnvelope;
  position: number;
}) {
  const sourceJson = formatSearchJson(hit.source);
  const highlightJson =
    hit.highlight === undefined ? "" : formatSearchJson(hit.highlight);
  const hasLargeSource = sourceJson.length > LARGE_SOURCE_LENGTH;
  const hasLongHighlight = highlightJson.length > LONG_HIGHLIGHT_LENGTH;

  return (
    <li aria-label={`Search hit ${hit.id}`} className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-muted-foreground">
          #{position}
        </span>
        <SearchLabel label="_id" value={hit.id} />
        <SearchLabel label="_index" value={hit.index} />
        {hit.score === undefined ? null : (
          <SearchLabel label="_score" value={String(hit.score)} />
        )}
        {hit.sort.length > 0 ? (
          <SearchLabel label="sort" value={`${hit.sort.length} values`} />
        ) : null}
        {hasLargeSource ? <StateBadge>Large _source</StateBadge> : null}
        {hasLongHighlight ? <StateBadge>Long highlight</StateBadge> : null}
      </div>

      <div className="grid gap-2">
        <JsonBlock label="_source" value={hit.source} />
        {hit.fields === undefined ? null : (
          <JsonBlock label="fields" value={hit.fields} compact />
        )}
        {hit.highlight === undefined ? null : (
          <JsonBlock label="highlight" value={hit.highlight} compact />
        )}
        {hit.sort.length === 0 ? null : (
          <JsonBlock label="sort" value={hit.sort} compact />
        )}
        {hit.explanation === undefined ? null : (
          <ExpandablePayload
            label={`Explain payload for ${hit.id}`}
            value={hit.explanation}
          />
        )}
      </div>
    </li>
  );
}

function SearchLabel({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-muted/40 px-2 py-0.5">
      <span className="font-mono text-muted-foreground">{label}</span>
      <span className="max-w-[18rem] truncate text-foreground">{value}</span>
    </span>
  );
}

function StateBadge({ children }: { children: string }) {
  return (
    <span className="rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
      {children}
    </span>
  );
}

function Metric({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-1">
      <Icon size={13} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

function ShardMetric({ shards }: { shards: SearchShardSummary }) {
  return (
    <Metric icon={Database}>
      shards {shards.successful}/{shards.total}
      {shards.failed > 0 ? `, ${shards.failed} failed` : ""}
    </Metric>
  );
}

function ShardFailures({ shards }: { shards: SearchShardSummary }) {
  return (
    <div
      role="alert"
      className="shrink-0 border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle size={14} aria-hidden="true" />
        <span>Shard failures: {shards.failed}</span>
      </div>
      <ul className="mt-1 space-y-1">
        {shards.failures.map((failure, index) => (
          <li key={index} className="font-mono">
            {failure.index ?? "unknown-index"}
            {failure.shard === undefined ? "" : ` shard ${failure.shard}`}:{" "}
            {formatSearchInline(failure.reason)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function JsonBlock({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: unknown;
  compact?: boolean;
}) {
  return (
    <section
      aria-label={label}
      className="rounded border border-border bg-muted/20"
    >
      <div className="border-b border-border px-2 py-1 font-mono text-3xs text-muted-foreground">
        {label}
      </div>
      <pre
        className={
          "overflow-auto p-2 font-mono text-xs leading-5 text-foreground " +
          (compact ? "max-h-32" : "max-h-56")
        }
      >
        {formatSearchJson(value)}
      </pre>
    </section>
  );
}

function AggregationItem({
  aggregation,
}: {
  aggregation: SearchAggregationEnvelope;
}) {
  switch (aggregation.kind) {
    case "terms":
      return <TermsAggregation aggregation={aggregation} />;
    case "value_count":
      return <ValueCountAggregation aggregation={aggregation} />;
    case "raw":
      return <RawAggregation aggregation={aggregation} />;
  }
}

function TermsAggregation({
  aggregation,
}: {
  aggregation: SearchTermsAggregationEnvelope;
}) {
  return (
    <li className="rounded border border-border p-2">
      <AggregationHeader
        name={aggregation.name}
        kind="terms"
        summary={`${aggregation.buckets.length} buckets`}
      />
      <ul className="mt-2 space-y-1">
        {aggregation.buckets.map((bucket) => (
          <li
            key={bucket.key}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="truncate font-mono text-foreground">
              {bucket.key}
            </span>
            <span className="shrink-0 text-muted-foreground">
              doc_count {bucket.docCount}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function ValueCountAggregation({
  aggregation,
}: {
  aggregation: SearchValueCountAggregationEnvelope;
}) {
  return (
    <li className="rounded border border-border p-2">
      <AggregationHeader
        name={aggregation.name}
        kind="value_count"
        summary={aggregation.value.toLocaleString()}
      />
    </li>
  );
}

function RawAggregation({
  aggregation,
}: {
  aggregation: SearchRawAggregationEnvelope;
}) {
  return (
    <li className="rounded border border-warning/40 bg-warning/5 p-2">
      <AggregationHeader
        name={aggregation.name}
        kind="raw"
        summary={aggregation.aggregationType ?? "unsupported shape"}
      />
      <p className="mt-2 text-xs text-warning">
        Unsupported aggregation shape rendered as raw JSON.
      </p>
      <pre className="mt-2 max-h-44 overflow-auto rounded bg-background/70 p-2 font-mono text-xs leading-5 text-foreground">
        {formatSearchJson(aggregation.raw)}
      </pre>
    </li>
  );
}

function AggregationHeader({
  name,
  kind,
  summary,
}: {
  name: string;
  kind: string;
  summary: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{name}</div>
        <div className="mt-0.5 font-mono text-3xs text-muted-foreground">
          {kind}
        </div>
      </div>
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground">
        {summary}
      </span>
    </div>
  );
}

function ExpandablePayload({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  if (value === undefined) return null;

  return (
    <details className="mt-3 rounded border border-border bg-muted/20">
      <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-foreground">
        {label}
      </summary>
      <pre className="max-h-52 overflow-auto border-t border-border p-2 font-mono text-xs leading-5 text-foreground">
        {formatSearchJson(value)}
      </pre>
    </details>
  );
}

function formatTotalHits(value: number, relation: "eq" | "gte"): string {
  return relation === "gte"
    ? `>= ${value.toLocaleString()}`
    : value.toLocaleString();
}
