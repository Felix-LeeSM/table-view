// #2153 — the parser is pinned to the recorded `_search` profile sections
// (#2198) rather than a hand-written stub, so a capture that stops matching
// fails here instead of drifting. No assertion against a capture reads a
// timing value out of it; those assertions are on structure, labels and units.
// The arithmetic rules — unit factor, slowest-first ranking, breakdown cap,
// zero filter — run on synthetic payloads built in this file instead, because
// the two single-shard captures do not exercise them.

import { describe, expect, it } from "vitest";
import profileFixtureRaw from "../../../tests/fixtures/search-profile-response.json?raw";
import {
  extractSearchProfilePlan,
  type SearchProfileNode,
} from "./searchProfile";

const fixture = JSON.parse(profileFixtureRaw) as {
  captures: Array<{ product: string; profile: unknown }>;
};

function findNode(
  nodes: SearchProfileNode[],
  title: string,
): SearchProfileNode | null {
  for (const node of nodes) {
    if (node.title === title) return node;
    const nested = findNode(node.children, title);
    if (nested !== null) return nested;
  }
  return null;
}

function requireNode(
  nodes: SearchProfileNode[],
  title: string,
): SearchProfileNode {
  const found = findNode(nodes, title);
  if (found === null) {
    throw new Error(`profile tree has no ${title} node`);
  }
  return found;
}

function metricLabels(node: SearchProfileNode): string[] {
  return node.metrics.map((metric) => metric.label);
}

function capturedProfile(product: string): unknown {
  const found = fixture.captures.find((entry) => entry.product === product);
  if (!found) {
    throw new Error(`fixture has no ${product} capture`);
  }
  return found.profile;
}

function shardsOf(product: string): SearchProfileNode[] {
  const plan = extractSearchProfilePlan(capturedProfile(product));
  if (plan === null) {
    throw new Error(`${product} capture did not parse`);
  }
  return plan.shards;
}

/**
 * A profile whose only Lucene node is `raw`. Synthetic on purpose: the rules
 * below (unit factor, slowest-first ranking, breakdown cap, zero filter) are
 * about arithmetic the captures happen not to exercise, and pinning them to a
 * capture's timings would make a re-capture red instead of the parser.
 */
function queryNodeOf(raw: Record<string, unknown>): SearchProfileNode {
  const plan = extractSearchProfilePlan({
    shards: [{ id: "[n][i][0]", searches: [{ query: [raw] }] }],
  });
  if (plan === null) {
    throw new Error("synthetic profile did not parse");
  }
  return requireNode(plan.shards, String(raw.type));
}

describe("extractSearchProfilePlan", () => {
  it.each(fixture.captures.map((entry) => entry.product))(
    "reads the recorded %s profile into a shard tree",
    (product) => {
      const shards = shardsOf(product);

      expect(shards).toHaveLength(1);
      // The shard id is the cluster's own `[node][index][n]` string; matching
      // its shape keeps the capture's node id out of the assertion.
      expect(shards[0]?.title).toMatch(/^\[.+\]\[.+\]\[\d+\]$/);

      expect(metricLabels(requireNode(shards, "Search #1"))).toContain(
        "Rewrite Time",
      );

      const query = requireNode(shards, "TermQuery");
      expect(query.subtitle).toBe("message:fixture");
      expect(metricLabels(query)[0]).toBe("Time");
      // `create_weight` is the slowest timer in both captures, so this pins
      // the ranking, not merely the presence of a breakdown.
      expect(metricLabels(query)[1]).toBe("create_weight");

      // The root collector is named differently per product
      // (QueryPhaseCollector / MultiCollector), so what is pinned is that the
      // group keeps the nesting rather than flattening it.
      const collector = requireNode(shards, "Collector");
      expect(collector.children).toHaveLength(1);
      expect(collector.children[0]?.children.map((c) => c.title)).toContain(
        "SimpleTopScoreDocCollector",
      );
      expect(requireNode(shards, "SimpleTopScoreDocCollector").subtitle).toBe(
        "search_top_hits",
      );

      const aggregation = requireNode(
        shards,
        "GlobalOrdinalsStringTermsAggregator",
      );
      expect(aggregation.subtitle).toBe("by_status");
      expect(metricLabels(aggregation)).toContain("Time");
    },
  );

  it("renders every timer as milliseconds and drops the *_count counters", () => {
    const query = requireNode(shardsOf("elasticsearch"), "TermQuery");

    for (const metric of query.metrics) {
      expect(metric.value).toMatch(/^[\d.]+ ms$/);
      expect(metric.label).not.toMatch(/_count$/);
    }
    // Time + at most 5 breakdown timers. A full breakdown is ~20 entries and
    // belongs in the raw JSON panel, not in the summary rows.
    expect(query.metrics.length).toBeLessThanOrEqual(6);
  });

  it("reads every shard, not just the first", () => {
    const shard = (
      capturedProfile("elasticsearch") as { shards: Record<string, unknown>[] }
    ).shards[0] as Record<string, unknown>;

    const plan = extractSearchProfilePlan({
      shards: [
        { ...shard, id: "[n][i][0]" },
        { ...shard, id: "[n][i][1]" },
      ],
    });

    // A cluster reports one profile section per shard. Both captures are
    // single-shard containers, so nothing above notices a parser that stops
    // after the first section — and on a real index that is most of the plan.
    expect(plan?.shards.map((node) => node.title)).toEqual([
      "[n][i][0]",
      "[n][i][1]",
    ]);
  });

  it("converts nanosecond timers with the nanosecond factor", () => {
    const node = queryNodeOf({
      type: "TermQuery",
      time_in_nanos: 2_500_000,
      breakdown: { create_weight: 1_000_000 },
    });

    // Both conversion sites — the node's own `time_in_nanos` and the breakdown
    // timers. A wrong factor still renders a ` ms` suffix, so only the value
    // separates milliseconds from microseconds.
    expect(node.metrics).toEqual([
      { label: "Time", value: "2.5 ms" },
      { label: "create_weight", value: "1 ms" },
    ]);
  });

  it("keeps only the slowest breakdown timers", () => {
    const breakdown: Record<string, number> = { slow_count: 99e6 };
    for (let rank = 1; rank <= 9; rank += 1) {
      breakdown[`timer_${rank}`] = rank * 1e6;
    }

    // The cap needs a node that exceeds it: the captures' nodes are down to
    // four timers once the counters and the zeroes are dropped, so they pass
    // whatever the cap is set to.
    expect(metricLabels(queryNodeOf({ type: "TermQuery", breakdown }))).toEqual(
      ["timer_9", "timer_8", "timer_7", "timer_6", "timer_5"],
    );
  });

  it("drops timers that never ran", () => {
    const node = queryNodeOf({
      type: "TermQuery",
      breakdown: { create_weight: 1_000_000, build_scorer: 0, match: 0 },
    });

    // A zero timer answers nothing about where the time went, and it would
    // take a row the slowest timers need.
    expect(metricLabels(node)).toEqual(["create_weight"]);
  });

  it("keeps the Elasticsearch-only shard fields and fetch phase", () => {
    const shards = shardsOf("elasticsearch");

    expect(metricLabels(shards[0] as SearchProfileNode)).toEqual([
      "Index",
      "Node",
      "Cluster",
    ]);
    expect(
      requireNode(shards, "fetch").children.map((child) => child.title),
    ).toEqual(["FetchSourcePhase", "StoredFieldsPhase"]);
  });

  it("keeps the OpenSearch-only shard network timers", () => {
    const shards = shardsOf("opensearch");

    expect(metricLabels(shards[0] as SearchProfileNode)).toEqual([
      "Inbound Network",
      "Outbound Network",
    ]);
    // OpenSearch 2.13.0 answers without a fetch section; the node must not be
    // invented for it.
    expect(findNode(shards, "fetch")).toBeNull();
  });

  it("returns null for payloads that carry no shards", () => {
    const notProfiles: unknown[] = [
      null,
      "profile",
      [],
      {},
      { shards: [] },
      { shards: "one" },
    ];

    for (const payload of notProfiles) {
      expect(extractSearchProfilePlan(payload)).toBeNull();
    }
  });

  it("stops descending a pathological children chain", () => {
    let deepest: Record<string, unknown> = { type: "Leaf" };
    for (let level = 0; level < 200; level += 1) {
      deepest = { type: `Level${level}`, children: [deepest] };
    }

    const plan = extractSearchProfilePlan({
      shards: [{ id: "s0", searches: [{ query: [deepest] }] }],
    });

    let depth = 0;
    let node: SearchProfileNode | null = plan?.shards[0] ?? null;
    while (node !== null && node.children.length > 0) {
      depth += 1;
      node = node.children[0] ?? null;
    }
    expect(depth).toBeLessThan(200);
    expect(findNode(plan?.shards ?? [], "Leaf")).toBeNull();
  });
});
