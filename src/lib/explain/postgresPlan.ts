export type PostgresPlanNode = Record<string, unknown>;

export interface PostgresExplainPlan {
  root: PostgresPlanNode;
  planningTimeMs?: number;
  executionTimeMs?: number;
}

export interface PlanMetric {
  label: string;
  value: string;
}

export interface PostgresPlanNodeDescription {
  title: string;
  subtitle?: string;
  metrics: PlanMetric[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const next = value[key];
  return isRecord(next) ? next : null;
}

function getString(value: Record<string, unknown>, key: string): string | null {
  const next = value[key];
  return typeof next === "string" && next.trim().length > 0 ? next : null;
}

function getNumber(value: Record<string, unknown>, key: string): number | null {
  const next = value[key];
  return typeof next === "number" && Number.isFinite(next) ? next : null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPair(
  first: number | null,
  second: number | null,
  unit = "",
): string | null {
  if (first === null && second === null) return null;
  const suffix = unit === "" ? "" : ` ${unit}`;
  if (first !== null && second !== null) {
    return `${formatNumber(first)}..${formatNumber(second)}${suffix}`;
  }
  return `${formatNumber(first ?? second ?? 0)}${suffix}`;
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

function formatUnknown(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatNumber(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const parts = value
      .map(formatUnknown)
      .filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

export function extractPostgresExplainPlan(
  payload: unknown,
): PostgresExplainPlan | null {
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!isRecord(first)) return null;

  const root = getRecord(first, "Plan");
  if (root === null) return null;

  return {
    root,
    planningTimeMs: getNumber(first, "Planning Time") ?? undefined,
    executionTimeMs: getNumber(first, "Execution Time") ?? undefined,
  };
}

export function getPostgresPlanChildren(
  node: PostgresPlanNode,
): PostgresPlanNode[] {
  const plans = node.Plans;
  if (!Array.isArray(plans)) return [];
  return plans.filter(isRecord);
}

export function describePostgresPlanNode(
  node: PostgresPlanNode,
): PostgresPlanNodeDescription {
  const title = getString(node, "Node Type") ?? "Plan node";
  const relation = getString(node, "Relation Name");
  const schema = getString(node, "Schema");
  const index = getString(node, "Index Name");
  const alias = getString(node, "Alias");
  const subtitleParts: string[] = [];

  if (relation !== null) {
    subtitleParts.push(`on ${schema !== null ? `${schema}.` : ""}${relation}`);
  }
  if (index !== null) {
    subtitleParts.push(`using ${index}`);
  }
  if (alias !== null && alias !== relation) {
    subtitleParts.push(`alias ${alias}`);
  }

  const metrics: PlanMetric[] = [];
  pushMetric(
    metrics,
    "Cost",
    formatPair(getNumber(node, "Startup Cost"), getNumber(node, "Total Cost")),
  );
  pushMetric(metrics, "Plan Rows", formatUnknown(node["Plan Rows"]));
  pushMetric(metrics, "Plan Width", formatUnknown(node["Plan Width"]));
  pushMetric(
    metrics,
    "Actual Time",
    formatPair(
      getNumber(node, "Actual Startup Time"),
      getNumber(node, "Actual Total Time"),
      "ms",
    ),
  );
  pushMetric(metrics, "Actual Rows", formatUnknown(node["Actual Rows"]));
  pushMetric(metrics, "Actual Loops", formatUnknown(node["Actual Loops"]));
  pushMetric(
    metrics,
    "Rows Removed by Filter",
    formatUnknown(node["Rows Removed by Filter"]),
  );
  pushMetric(
    metrics,
    "Rows Removed by Index Recheck",
    formatUnknown(node["Rows Removed by Index Recheck"]),
  );
  pushMetric(metrics, "Filter", formatUnknown(node.Filter));
  pushMetric(metrics, "Index Cond", formatUnknown(node["Index Cond"]));
  pushMetric(metrics, "Recheck Cond", formatUnknown(node["Recheck Cond"]));
  pushMetric(metrics, "Join Filter", formatUnknown(node["Join Filter"]));
  pushMetric(metrics, "Hash Cond", formatUnknown(node["Hash Cond"]));
  pushMetric(metrics, "Sort Key", formatUnknown(node["Sort Key"]));
  pushMetric(metrics, "Group Key", formatUnknown(node["Group Key"]));

  return {
    title,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(" / ") : undefined,
    metrics,
  };
}

export function describePostgresPlanTiming(
  plan: PostgresExplainPlan,
): PlanMetric[] {
  const metrics: PlanMetric[] = [];
  pushMetric(
    metrics,
    "Planning Time",
    plan.planningTimeMs === undefined
      ? null
      : `${formatNumber(plan.planningTimeMs)} ms`,
  );
  pushMetric(
    metrics,
    "Execution Time",
    plan.executionTimeMs === undefined
      ? null
      : `${formatNumber(plan.executionTimeMs)} ms`,
  );
  return metrics;
}
