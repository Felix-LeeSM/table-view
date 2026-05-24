import type {
  SearchAggregationEnvelope,
  SearchResultEnvelope,
} from "@/types/search";

export interface SearchResultViewProps {
  result: SearchResultEnvelope;
}

export function SearchResultView({ result }: SearchResultViewProps) {
  return (
    <section
      aria-label="Search results"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-sm"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{result.total.value} hits</span>
        <span>{result.tookMs} ms</span>
        {result.timedOut ? (
          <span className="text-destructive">timed out</span>
        ) : null}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div
          aria-label="Search hits"
          className="min-h-0 overflow-auto border-b border-border lg:border-r lg:border-b-0"
        >
          {result.hits.length === 0 ? (
            <div className="p-4 text-muted-foreground">No hits</div>
          ) : (
            <ol className="divide-y divide-border">
              {result.hits.map((hit) => (
                <li key={`${hit.index}:${hit.id}`} className="p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {hit.id}
                    </span>
                    <span>{hit.index}</span>
                    {hit.score === undefined ? null : (
                      <span>score {hit.score}</span>
                    )}
                  </div>
                  <pre className="max-h-56 overflow-auto rounded border border-border bg-muted/30 p-2 font-mono text-xs leading-5">
                    {formatJson(hit.source)}
                  </pre>
                </li>
              ))}
            </ol>
          )}
        </div>
        <aside
          aria-label="Search aggregations"
          className="min-h-0 overflow-auto p-3"
        >
          {result.aggregations.length === 0 ? (
            <div className="text-muted-foreground">No aggregations</div>
          ) : (
            <ul className="space-y-2">
              {result.aggregations.map((aggregation) => (
                <li
                  key={aggregation.name}
                  className="rounded border border-border p-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-foreground">
                      {aggregation.name}
                    </span>
                    <span className="text-muted-foreground">
                      {aggregation.kind}
                    </span>
                  </div>
                  <pre className="max-h-44 overflow-auto font-mono text-xs leading-5 text-muted-foreground">
                    {formatAggregation(aggregation)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}

function formatAggregation(aggregation: SearchAggregationEnvelope): string {
  return formatJson(aggregation.value);
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}
