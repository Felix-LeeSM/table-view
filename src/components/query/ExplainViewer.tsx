// Sprint 337 (2026-05-15) — U2 live wire. RDB EXPLAIN (FORMAT JSON) and
// Mongo runCommand({explain: …}) wrapped behind a single
// component. PostgreSQL plans render a compact summary/tree, with raw JSON
// retained for fallback and troubleshooting.

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  describePostgresPlanNode,
  describePostgresPlanTiming,
  extractPostgresExplainPlan,
  getPostgresPlanChildren,
  type PlanMetric,
  type PostgresPlanNode,
} from "@/lib/explain/postgresPlan";
import {
  explainMongoFind,
  explainRdbQuery,
  type ExplainMongoFindArgs,
} from "@/lib/api/explain";
import { safeStringifyCell } from "@/lib/jsonCell";

export interface ExplainViewerProps {
  connectionId: string;
  paradigm: "table" | "document";
  /** RDB only — the SQL to explain. */
  rdbSql?: string;
  /** RDB only — workspace database expected by the caller. */
  expectedDatabase?: string;
  /** Mongo only — `{database, collection, filter?, verbosity?}` */
  mongoSpec?: ExplainMongoFindArgs;
  onPlanSettled?: (result: {
    status: "success" | "error";
    durationMs: number;
    executedAt: number;
    errorMessage?: string;
  }) => void | Promise<void>;
}

export function ExplainViewer({
  connectionId,
  paradigm,
  rdbSql,
  expectedDatabase,
  mongoSpec,
  onPlanSettled,
}: ExplainViewerProps) {
  const [plan, setPlan] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const startedAt = Date.now();
    setLoading(true);
    setError(null);
    try {
      const next =
        paradigm === "document"
          ? await explainMongoFind(
              connectionId,
              mongoSpec ?? {
                database: "",
                collection: "",
              },
            )
          : await explainRdbQuery(connectionId, rdbSql ?? "", expectedDatabase);
      setPlan(next);
      await onPlanSettled?.({
        status: "success",
        durationMs: Date.now() - startedAt,
        executedAt: startedAt,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      await onPlanSettled?.({
        status: "error",
        durationMs: Date.now() - startedAt,
        executedAt: startedAt,
        errorMessage: message,
      });
    } finally {
      setLoading(false);
    }
  }, [
    connectionId,
    paradigm,
    rdbSql,
    expectedDatabase,
    mongoSpec,
    onPlanSettled,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const postgresPlan =
    paradigm === "table" ? extractPostgresExplainPlan(plan) : null;

  return (
    <section
      aria-label="Explain viewer"
      data-paradigm={paradigm}
      data-testid="explain-viewer"
      className="flex flex-col gap-2 p-3"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>Explain ({paradigm === "table" ? "PG" : "Mongo"})</span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="explain-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={12} aria-hidden />
          ) : (
            <RefreshCw size={12} aria-hidden />
          )}
          Refresh
        </Button>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="explain-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {!loading && error === null && plan !== null && (
        <>
          {postgresPlan !== null ? (
            <PostgresPlanView plan={postgresPlan} rawPlan={plan} />
          ) : (
            <pre
              data-testid="explain-plan"
              className="max-h-96 overflow-auto rounded-md border border-border bg-secondary/30 p-2 font-mono text-xs leading-relaxed text-foreground"
            >
              {safeStringifyCell(plan, 2)}
            </pre>
          )}
        </>
      )}
    </section>
  );
}

interface PostgresPlanViewProps {
  plan: NonNullable<ReturnType<typeof extractPostgresExplainPlan>>;
  rawPlan: unknown;
}

function PostgresPlanView({ plan, rawPlan }: PostgresPlanViewProps) {
  const root = describePostgresPlanNode(plan.root);
  const timing = describePostgresPlanTiming(plan);

  return (
    <div
      data-testid="explain-plan"
      className="max-h-96 overflow-auto rounded-md border border-border bg-secondary/20 text-xs text-foreground"
    >
      <div
        data-testid="explain-plan-summary"
        className="border-b border-border bg-background/70 px-3 py-2"
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">Plan Summary</span>
          <span className="text-muted-foreground">{root.title}</span>
          {root.subtitle !== undefined && (
            <span className="text-muted-foreground">{root.subtitle}</span>
          )}
        </div>
        {timing.length > 0 && <MetricList metrics={timing} compact />}
      </div>

      <ol className="space-y-2 p-2">
        <PostgresPlanNodeView node={plan.root} depth={0} />
      </ol>

      <details className="border-t border-border bg-background/60 px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
          Raw JSON
        </summary>
        <pre
          data-testid="explain-raw-json"
          className="mt-2 overflow-auto rounded border border-border bg-secondary/30 p-2 font-mono text-xs leading-relaxed text-foreground"
        >
          {safeStringifyCell(rawPlan, 2)}
        </pre>
      </details>
    </div>
  );
}

interface PostgresPlanNodeViewProps {
  node: PostgresPlanNode;
  depth: number;
}

function PostgresPlanNodeView({ node, depth }: PostgresPlanNodeViewProps) {
  const description = describePostgresPlanNode(node);
  const children = getPostgresPlanChildren(node);

  return (
    <li
      data-depth={depth}
      className="rounded border border-border bg-background/80 px-3 py-2"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">{description.title}</span>
        {description.subtitle !== undefined && (
          <span className="text-muted-foreground">{description.subtitle}</span>
        )}
      </div>
      <MetricList metrics={description.metrics} />

      {children.length > 0 && (
        <ol className="mt-2 space-y-2 border-l border-border pl-3">
          {children.map((child, index) => (
            <PostgresPlanNodeView
              key={`${String(child["Node Type"] ?? "node")}-${index}`}
              node={child}
              depth={depth + 1}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

interface MetricListProps {
  metrics: PlanMetric[];
  compact?: boolean;
}

function MetricList({ metrics, compact = false }: MetricListProps) {
  if (metrics.length === 0) return null;

  return (
    <dl
      className={
        compact
          ? "mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground"
          : "mt-2 grid gap-x-3 gap-y-1 text-muted-foreground sm:grid-cols-[max-content_1fr]"
      }
    >
      {metrics.map((metric) => (
        <div
          key={`${metric.label}-${metric.value}`}
          className={compact ? "flex gap-1" : "contents"}
        >
          <dt className="font-medium">{metric.label}</dt>
          <dd className="break-words text-foreground">{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}
