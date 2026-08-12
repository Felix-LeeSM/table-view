// #2153 — the parser is pinned to the recorded `_search` profile sections
// (#2198) rather than a hand-written stub, so a capture that stops matching
// fails here instead of drifting. Timing values and node ids differ per
// capture, so nothing below asserts one; the assertions are on structure,
// labels and units.

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
