// #2153 — the `_search` `profile` payload (#1818) normalised into the tree
// the ExplainViewer renders. The shape evidence is the real cluster capture
// in `tests/fixtures/search-profile-response.json` (Elasticsearch 8.12.2 and
// OpenSearch 2.13.0, taken by `scripts/capture-search-profile-fixture.sh`
// once #2198 unlocked the bounded `profile` flag) — not a hand-written stub.

import type { PlanMetric } from "./postgresPlan";

export type { PlanMetric };

/**
 * One profile entry — a shard, a search, a Lucene query node, a collector, an
 * aggregator or a fetch phase. Each section names itself differently
 * (`type`/`name`, `description`/`reason`), so the parser flattens them to a
 * single node kind and the viewer stays one recursive component.
 */
export interface SearchProfileNode {
  title: string;
  subtitle?: string;
  metrics: PlanMetric[];
  children: SearchProfileNode[];
}

export interface SearchProfilePlan {
  shards: SearchProfileNode[];
}

/**
 * The payload crosses a trust boundary — it is whatever cluster the user
 * pointed the connection at. A pathological `children` chain must not recurse
 * the renderer off the stack, so the tree stops here. Nothing is hidden: the
 * untouched payload stays reachable in the viewer's raw JSON panel.
 */
const MAX_DEPTH = 32;

/** A breakdown carries ~20 timers; the slowest few are what "where did the
 * time go" asks for. The rest stay in the raw JSON panel. */
const MAX_BREAKDOWN_METRICS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getString(value: Record<string, unknown>, key: string): string | null {
  const next = value[key];
  return typeof next === "string" && next.trim().length > 0 ? next : null;
}

function getNumber(value: Record<string, unknown>, key: string): number | null {
  const next = value[key];
  return typeof next === "number" && Number.isFinite(next) ? next : null;
}

function formatMs(ms: number): string {
  return `${Number(ms.toFixed(3))} ms`;
}

function nanosToMs(nanos: number | null): string | null {
  return nanos === null ? null : formatMs(nanos / 1e6);
}

function millisToMs(millis: number | null): string | null {
  return millis === null ? null : formatMs(millis);
}

function pushMetric(
  metrics: PlanMetric[],
  label: string,
  value: string | null,
): void {
  if (value !== null && value.length > 0) {
    metrics.push({ label, value });
  }
}

/**
 * A `breakdown` mixes nanosecond timers with `*_count` occurrence counters.
 * Only the timers answer where the time went, so the counters are dropped
 * here and the timers are ranked slowest-first.
 */
function breakdownMetrics(node: Record<string, unknown>): PlanMetric[] {
  const breakdown = node.breakdown;
  if (!isRecord(breakdown)) return [];

  const timers: [string, number][] = [];
  for (const [key, value] of Object.entries(breakdown)) {
    if (key.endsWith("_count")) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      continue;
    }
    timers.push([key, value]);
  }
  timers.sort((left, right) => right[1] - left[1]);

  return timers
    .slice(0, MAX_BREAKDOWN_METRICS)
    .map(([label, nanos]) => ({ label, value: formatMs(nanos / 1e6) }));
}

function toNode(
  raw: Record<string, unknown>,
  depth: number,
): SearchProfileNode {
  const metrics: PlanMetric[] = [];
  pushMetric(metrics, "Time", nanosToMs(getNumber(raw, "time_in_nanos")));
  metrics.push(...breakdownMetrics(raw));

  return {
    title: getString(raw, "type") ?? getString(raw, "name") ?? "Profile node",
    subtitle:
      getString(raw, "description") ?? getString(raw, "reason") ?? undefined,
    metrics,
    children: toNodes(recordList(raw.children), depth + 1),
  };
}

function toNodes(
  raw: Record<string, unknown>[],
  depth: number,
): SearchProfileNode[] {
  if (depth > MAX_DEPTH) return [];
  return raw.map((node) => toNode(node, depth));
}

/** A group header for a section that has no timing of its own. */
function group(
  title: string,
  children: SearchProfileNode[],
): SearchProfileNode[] {
  return children.length === 0 ? [] : [{ title, metrics: [], children }];
}

function toSearchNode(
  raw: Record<string, unknown>,
  index: number,
): SearchProfileNode {
  const metrics: PlanMetric[] = [];
  pushMetric(
    metrics,
    "Rewrite Time",
    nanosToMs(getNumber(raw, "rewrite_time")),
  );

  return {
    title: `Search #${index + 1}`,
    metrics,
    children: [
      ...toNodes(recordList(raw.query), 1),
      ...group("Collector", toNodes(recordList(raw.collector), 1)),
    ],
  };
}

function toShardNode(raw: Record<string, unknown>): SearchProfileNode {
  const metrics: PlanMetric[] = [];
  pushMetric(metrics, "Index", getString(raw, "index"));
  pushMetric(metrics, "Node", getString(raw, "node_id"));
  pushMetric(metrics, "Cluster", getString(raw, "cluster"));
  // OpenSearch 2.13.0 reports coordinator↔shard transport time per shard and
  // Elasticsearch 8.12.2 does not; the reverse holds for `index`/`node_id`/
  // `cluster`. Both captures live in the fixture, so neither product's extra
  // keys are guessed and a missing one just drops its row.
  pushMetric(
    metrics,
    "Inbound Network",
    millisToMs(getNumber(raw, "inbound_network_time_in_millis")),
  );
  pushMetric(
    metrics,
    "Outbound Network",
    millisToMs(getNumber(raw, "outbound_network_time_in_millis")),
  );

  return {
    title: getString(raw, "id") ?? "shard",
    metrics,
    children: [
      ...recordList(raw.searches).map(toSearchNode),
      ...group("Aggregations", toNodes(recordList(raw.aggregations), 1)),
      ...(isRecord(raw.fetch) ? [toNode(raw.fetch, 1)] : []),
    ],
  };
}

/**
 * Reads the `profile` section of a `_search` response. Returns null for any
 * payload without shards so the viewer falls through to its raw JSON view —
 * no engine is claimed that isn't actually parsed.
 */
export function extractSearchProfilePlan(
  payload: unknown,
): SearchProfilePlan | null {
  if (!isRecord(payload)) return null;

  const shards = recordList(payload.shards);
  if (shards.length === 0) return null;

  return { shards: shards.map(toShardNode) };
}
