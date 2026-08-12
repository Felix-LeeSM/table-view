// Sprint 337 (2026-05-15) — U2 live wire. RDB EXPLAIN (FORMAT JSON) and
// Mongo runCommand({explain: …}) wrapped behind a single
// component. PostgreSQL plans render a compact summary/tree, with raw JSON
// retained for fallback and troubleshooting.
// #2153 — the search paradigm joined through the same component: its plan is
// the `profile` section of a `_search` re-run (#1818), rendered as the same
// summary/tree shape.

import { Loader2, RefreshCw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  type ExplainMongoFindArgs,
  explainMongoFind,
  explainRdbQuery,
  explainSearchQuery,
} from "@/lib/api/explain";
import {
  describePostgresPlanNode,
  describePostgresPlanTiming,
  extractPostgresExplainPlan,
  getPostgresPlanChildren,
  type PlanMetric,
  type PostgresPlanNode,
} from "@/lib/explain/postgresPlan";
import {
  extractSearchProfilePlan,
  type SearchProfileNode,
  type SearchProfilePlan,
} from "@/lib/explain/searchProfile";
import { safeStringifyCell } from "@/lib/jsonCell";
import { cancelQuery } from "@/lib/tauri";
import {
  DATABASE_TYPE_LABELS,
  type DatabaseType,
  paradigmOf,
} from "@/types/connection";
import type { SearchQueryRequest } from "@/types/search";

export interface ExplainViewerProps {
  connectionId: string;
  /** Source engine — the paradigm branch and display label derive from it. */
  dbType: DatabaseType;
  /** RDB only — the SQL to explain. */
  rdbSql?: string;
  /** RDB only — workspace database expected by the caller. */
  expectedDatabase?: string;
  /** Mongo only — `{database, collection, body?, verbosity?}` (#1210: the
   * body carries filter/sort/projection/skip/limit so the plan matches the
   * real find execution). */
  mongoSpec?: ExplainMongoFindArgs;
  /** Search only — the parsed `_search` request (#2153). Elasticsearch and
   * OpenSearch have no plan endpoint: the plan is the `profile` section of
   * the same request re-run with `profile: true` (#1818), so the viewer needs
   * the request itself rather than a statement to explain. */
  searchSpec?: SearchQueryRequest;
  onPlanSettled?: (result: {
    status: "success" | "error";
    durationMs: number;
    executedAt: number;
    errorMessage?: string;
  }) => void | Promise<void>;
}

export function ExplainViewer({
  connectionId,
  dbType,
  rdbSql,
  expectedDatabase,
  mongoSpec,
  searchSpec,
  onPlanSettled,
}: ExplainViewerProps) {
  const { t } = useTranslation("query");
  const paradigm = paradigmOf(dbType);
  // #2153 — `undefined` is "no fetch has settled" (mount, or a first fetch the
  // user stopped); `null` is "the source settled and handed back no plan". The
  // search empty state below speaks about the cluster's answer, so it must not
  // be reachable from a state where there was never an answer.
  const [plan, setPlan] = useState<unknown>(undefined);
  // The mount effect always starts a fetch, so idle-before-first-fetch is not
  // a state this component is ever in. Starting at `false` rendered one frame
  // claiming a settled empty plan.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #1269 — id of the in-flight plan so the Stop button can fire the same
  // cooperative `cancelQuery` the query tab uses. Held in a ref (not state) so
  // cancelling never re-renders and the id survives the refresh closure.
  const queryIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const queryId = `explain-${crypto.randomUUID()}`;
    queryIdRef.current = queryId;
    const startedAt = Date.now();
    setLoading(true);
    setError(null);
    try {
      const next =
        paradigm === "search"
          ? await explainSearchQuery(
              connectionId,
              searchSpec ?? { index: "", body: {} },
              queryId,
            )
          : paradigm === "document"
            ? await explainMongoFind(
                connectionId,
                mongoSpec ?? {
                  database: "",
                  collection: "",
                },
                queryId,
              )
            : await explainRdbQuery(
                connectionId,
                rdbSql ?? "",
                expectedDatabase,
                queryId,
              );
      setPlan(next);
      await onPlanSettled?.({
        status: "success",
        durationMs: Date.now() - startedAt,
        executedAt: startedAt,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // #1269 — a user-initiated cancel is not an error: swallow it so the
      // viewer just returns to idle (no red alert, no error-logged plan).
      if (/cancel/i.test(message)) {
        return;
      }
      setError(message);
      await onPlanSettled?.({
        status: "error",
        durationMs: Date.now() - startedAt,
        executedAt: startedAt,
        errorMessage: message,
      });
    } finally {
      setLoading(false);
      queryIdRef.current = null;
    }
  }, [
    connectionId,
    paradigm,
    rdbSql,
    expectedDatabase,
    mongoSpec,
    searchSpec,
    onPlanSettled,
  ]);

  const cancel = useCallback(() => {
    const id = queryIdRef.current;
    if (id === null) return;
    void cancelQuery(id).catch(() => {
      // Best-effort — a plan that already settled has no token to fire.
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The tree view only understands PostgreSQL's `EXPLAIN (FORMAT JSON)`
  // shape. Other rdb engines (mysql/mssql/oracle) fall through to the raw
  // JSON view because `extractPostgresExplainPlan` returns null for any
  // non-PG payload — no engine is claimed that isn't actually parsed.
  const postgresPlan =
    paradigm === "rdb" ? extractPostgresExplainPlan(plan) : null;

  // #2153 — the search plan is the cluster's own `profile` section. Anything
  // without shards falls through to the raw JSON view for the same reason the
  // PG branch does: no engine is claimed that isn't actually parsed.
  const searchProfile =
    paradigm === "search" ? extractSearchProfilePlan(plan) : null;

  return (
    <section
      aria-label={t("explain.viewerAria")}
      data-paradigm={paradigm}
      data-testid="explain-viewer"
      // #1137 — busy while the plan refreshes (error already role="alert").
      aria-busy={loading || undefined}
      className="flex flex-col gap-2 p-3"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          {t("explain.header", { paradigm: DATABASE_TYPE_LABELS[dbType] })}
        </span>
        {loading ? (
          // #1269 — same Stop affordance as the query tab. Cooperative-only:
          // the client stops awaiting the plan (see tooltip); the server op is
          // not natively killed.
          <Button
            variant="ghost"
            size="sm"
            data-testid="explain-cancel"
            onClick={cancel}
            aria-label={t("explain.cancelAria")}
            title={t("explain.cancelTooltip")}
          >
            <Square className="text-destructive" size={12} aria-hidden />
            <Loader2 className="animate-spin" size={12} aria-hidden />
            {t("explain.cancel")}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            data-testid="explain-refresh"
            onClick={() => void refresh()}
          >
            <RefreshCw size={12} aria-hidden />
            {t("explain.refresh")}
          </Button>
        )}
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

      {/* #2153 — a cluster can answer a `profile: true` request without a
          profile section (the built-in fixture source does; it has no Lucene
          behind it). Say so instead of leaving the pane blank. */}
      {!loading && error === null && paradigm === "search" && plan === null && (
        <p
          data-testid="explain-empty"
          className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground"
        >
          {t("explain.noSearchProfile")}
        </p>
      )}

      {!loading &&
        error === null &&
        plan !== null &&
        plan !== undefined &&
        (postgresPlan !== null ? (
          <PostgresPlanView plan={postgresPlan} rawPlan={plan} />
        ) : searchProfile !== null ? (
          <SearchProfileView plan={searchProfile} rawPlan={plan} />
        ) : (
          <pre
            data-testid="explain-plan"
            className="max-h-96 overflow-auto rounded-md border border-border bg-secondary/30 p-2 font-mono text-xs leading-relaxed text-foreground"
          >
            {safeStringifyCell(plan, 2)}
          </pre>
        ))}
    </section>
  );
}

interface PostgresPlanViewProps {
  plan: NonNullable<ReturnType<typeof extractPostgresExplainPlan>>;
  rawPlan: unknown;
}

function PostgresPlanView({ plan, rawPlan }: PostgresPlanViewProps) {
  const { t } = useTranslation("query");
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
          <span className="font-medium text-foreground">
            {t("explain.planSummary")}
          </span>
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
          {t("explain.rawJson")}
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

interface SearchProfileViewProps {
  plan: SearchProfilePlan;
  rawPlan: unknown;
}

// #2153 — same summary / tree / raw-JSON layout the PG branch uses, so the
// two paradigms read the same way. The parser already flattened the cluster's
// per-section vocabulary, so one recursive node view covers shards, searches,
// Lucene query nodes, collectors, aggregators and fetch phases.
function SearchProfileView({ plan, rawPlan }: SearchProfileViewProps) {
  const { t } = useTranslation("query");

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
          <span className="font-medium text-foreground">
            {t("explain.searchProfileSummary")}
          </span>
          <span className="text-muted-foreground">
            {t("explain.searchShards", { shards: plan.shards.length })}
          </span>
        </div>
      </div>

      <ol className="space-y-2 p-2">
        {plan.shards.map((shard, index) => (
          <SearchProfileNodeView
            key={`${shard.title}-${index}`}
            node={shard}
            depth={0}
          />
        ))}
      </ol>

      <details className="border-t border-border bg-background/60 px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
          {t("explain.rawJson")}
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

interface SearchProfileNodeViewProps {
  node: SearchProfileNode;
  depth: number;
}

function SearchProfileNodeView({ node, depth }: SearchProfileNodeViewProps) {
  return (
    <li
      data-depth={depth}
      className="rounded border border-border bg-background/80 px-3 py-2"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">{node.title}</span>
        {node.subtitle !== undefined && (
          <span className="text-muted-foreground">{node.subtitle}</span>
        )}
      </div>
      <MetricList metrics={node.metrics} />

      {node.children.length > 0 && (
        <ol className="mt-2 space-y-2 border-l border-border pl-3">
          {node.children.map((child, index) => (
            <SearchProfileNodeView
              key={`${child.title}-${index}`}
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
