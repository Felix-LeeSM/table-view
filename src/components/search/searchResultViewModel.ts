import type {
  SearchAggregationEnvelope,
  SearchHitEnvelope,
  SearchResultEnvelope,
  SearchShardSummary,
} from "@/types/search";

export interface NormalizedSearchResult {
  tookMs: number;
  timedOut: boolean;
  total: {
    value: number;
    relation: "eq" | "gte";
  };
  hits: SearchHitEnvelope[];
  aggregations: SearchAggregationEnvelope[];
  shards?: SearchShardSummary;
  explain?: unknown;
  profile?: unknown;
}

export type NormalizedResult =
  | { ok: true; result: NormalizedSearchResult }
  | { ok: false; message: string };

export function normalizeSearchResult(
  raw: SearchResultEnvelope,
): NormalizedResult {
  if (!isRecord(raw)) {
    return { ok: false, message: "Expected an object result envelope." };
  }

  if (typeof raw.tookMs !== "number" || !Number.isFinite(raw.tookMs)) {
    return { ok: false, message: "Expected numeric tookMs." };
  }

  if (typeof raw.timedOut !== "boolean") {
    return { ok: false, message: "Expected boolean timedOut." };
  }

  const total = raw.total;
  if (
    !isRecord(total) ||
    typeof total.value !== "number" ||
    (total.relation !== "eq" && total.relation !== "gte")
  ) {
    return {
      ok: false,
      message: "Expected total.value and total.relation in Search result.",
    };
  }

  if (!Array.isArray(raw.hits)) {
    return { ok: false, message: "Expected Search hits array." };
  }

  const hits: SearchHitEnvelope[] = [];
  for (const [index, hit] of raw.hits.entries()) {
    const normalizedHit = normalizeHit(hit, index);
    if (!normalizedHit.ok) return normalizedHit;
    hits.push(normalizedHit.hit);
  }

  const aggregationsRaw = Array.isArray(raw.aggregations)
    ? raw.aggregations
    : [];
  const aggregations = aggregationsRaw.map((aggregation, index) =>
    normalizeAggregation(aggregation, index),
  );

  return {
    ok: true,
    result: {
      tookMs: raw.tookMs,
      timedOut: raw.timedOut,
      total: raw.total,
      hits,
      aggregations,
      shards: normalizeShards(raw.shards),
      explain: raw.explain,
      profile: raw.profile,
    },
  };
}

function normalizeHit(
  raw: unknown,
  index: number,
): { ok: true; hit: SearchHitEnvelope } | { ok: false; message: string } {
  if (!isRecord(raw)) {
    return { ok: false, message: `Expected hit ${index + 1} to be an object.` };
  }
  if (typeof raw.index !== "string" || typeof raw.id !== "string") {
    return {
      ok: false,
      message: `Expected hit ${index + 1} to include _index and _id labels.`,
    };
  }
  if (raw.score !== undefined && typeof raw.score !== "number") {
    return {
      ok: false,
      message: `Expected hit ${index + 1} score to be numeric.`,
    };
  }
  return {
    ok: true,
    hit: {
      index: raw.index,
      id: raw.id,
      score: raw.score,
      source: raw.source,
      fields: raw.fields,
      highlight: raw.highlight,
      explanation: raw.explanation,
      sort: Array.isArray(raw.sort) ? raw.sort : [],
    },
  };
}

function normalizeAggregation(
  raw: unknown,
  index: number,
): SearchAggregationEnvelope {
  if (!isRecord(raw)) {
    return {
      kind: "raw",
      name: `aggregation_${index + 1}`,
      raw,
    };
  }
  const name =
    typeof raw.name === "string" ? raw.name : `aggregation_${index + 1}`;
  if (raw.kind === "terms" && Array.isArray(raw.buckets)) {
    return {
      kind: "terms",
      name,
      buckets: raw.buckets.filter(isRecord).map((bucket) => ({
        key: String(bucket.key),
        docCount:
          typeof bucket.docCount === "number" &&
          Number.isFinite(bucket.docCount)
            ? bucket.docCount
            : 0,
      })),
    };
  }
  if (raw.kind === "value_count" && typeof raw.value === "number") {
    return {
      kind: "value_count",
      name,
      value: raw.value,
    };
  }
  if (raw.kind === "raw") {
    return {
      kind: "raw",
      name,
      aggregationType:
        typeof raw.aggregationType === "string"
          ? raw.aggregationType
          : undefined,
      raw: raw.raw,
    };
  }
  return {
    kind: "raw",
    name,
    aggregationType: typeof raw.kind === "string" ? raw.kind : undefined,
    raw,
  };
}

function normalizeShards(
  raw: SearchResultEnvelope["shards"],
): SearchShardSummary | undefined {
  if (!isRecord(raw)) return undefined;
  const total = numberOrZero(raw.total);
  const successful = numberOrZero(raw.successful);
  const skipped = numberOrZero(raw.skipped);
  const failed = numberOrZero(raw.failed);
  const failures = Array.isArray(raw.failures)
    ? raw.failures.filter(isRecord).map((failure) => ({
        shard: optionalNumber(failure.shard),
        index: typeof failure.index === "string" ? failure.index : undefined,
        node: typeof failure.node === "string" ? failure.node : undefined,
        reason: failure.reason,
      }))
    : [];
  return { total, successful, skipped, failed, failures };
}

export function formatSearchInline(value: unknown): string {
  const json = formatSearchJson(value);
  return json.length > 160 ? `${json.slice(0, 157)}...` : json;
}

export function formatSearchJson(value: unknown): string {
  try {
    const json = JSON.stringify(value, null, 2);
    return json ?? "null";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
