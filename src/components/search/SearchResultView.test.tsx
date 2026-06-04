import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SearchResultEnvelope } from "@/types/search";
import { SearchResultView } from "./SearchResultView";

const baseHit = {
  index: "logs-2026.05.24",
  id: "doc-1",
  score: 1,
  source: {
    "@timestamp": "2026-05-24T00:00:00Z",
    message: "fixture log",
    status: "ok",
  },
  fields: {
    "host.keyword": ["api-1"],
  },
  highlight: {
    message: ["<em>fixture</em> log"],
  },
  sort: ["2026-05-24T00:00:00Z", "doc-1"],
};

const result: SearchResultEnvelope = {
  tookMs: 3,
  timedOut: false,
  total: { value: 1, relation: "eq" },
  hits: [baseHit],
  aggregations: [
    {
      name: "by_status",
      kind: "terms",
      buckets: [{ key: "ok", docCount: 1 }],
    },
  ],
};

function expectNoGrid() {
  expect(screen.queryByRole("grid")).not.toBeInTheDocument();
}

describe("SearchResultView", () => {
  it("renders Search-native hit labels, fields, highlights, sort values, and source", () => {
    render(<SearchResultView result={result} />);

    expect(screen.getByLabelText("Search results")).toHaveTextContent("1 hits");
    const hit = screen.getByLabelText("Search hit doc-1");
    expect(within(hit).getByText("_id")).toBeInTheDocument();
    expect(within(hit).getByText("doc-1")).toBeInTheDocument();
    expect(within(hit).getByText("_index")).toBeInTheDocument();
    expect(within(hit).getByText("logs-2026.05.24")).toBeInTheDocument();
    expect(within(hit).getByText("_score")).toBeInTheDocument();
    expect(within(hit).getByLabelText("_source")).toHaveTextContent(
      "fixture log",
    );
    expect(within(hit).getByLabelText("fields")).toHaveTextContent(
      "host.keyword",
    );
    expect(within(hit).getByLabelText("highlight")).toHaveTextContent(
      "<em>fixture</em> log",
    );
    expect(within(hit).getByLabelText("sort")).toHaveTextContent("doc-1");
    expectNoGrid();
  });

  it("surfaces took time, gte total relation, timeout, and shard failures", () => {
    render(
      <SearchResultView
        result={{
          ...result,
          tookMs: 12,
          timedOut: true,
          total: { value: 10000, relation: "gte" },
          shards: {
            total: 5,
            successful: 4,
            skipped: 0,
            failed: 1,
            failures: [
              {
                shard: 2,
                index: "logs-2026.05.24",
                node: "node-a",
                reason: { type: "query_shard_exception", reason: "boom" },
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText(">= 10,000 hits")).toBeInTheDocument();
    expect(screen.getByText("12 ms")).toBeInTheDocument();
    expect(screen.getByText("timed out")).toBeInTheDocument();
    expect(screen.getByText("shards 4/5, 1 failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Shard failures: 1");
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    expectNoGrid();
  });

  it("renders typed aggregation summaries and raw fallback payloads", () => {
    render(
      <SearchResultView
        result={{
          ...result,
          aggregations: [
            {
              name: "by_status",
              kind: "terms",
              buckets: [
                { key: "ok", docCount: 7 },
                { key: "error", docCount: 2 },
              ],
            },
            {
              name: "message_count",
              kind: "value_count",
              value: 9,
            },
            {
              name: "latency_percentiles",
              kind: "raw",
              aggregationType: "percentiles",
              raw: { values: { "95.0": 42 } },
            },
          ],
        }}
      />,
    );

    const aggregations = screen.getByLabelText("Search aggregations");
    expect(within(aggregations).getByText("by_status")).toBeInTheDocument();
    expect(within(aggregations).getByText("doc_count 7")).toBeInTheDocument();
    expect(within(aggregations).getByText("message_count")).toBeInTheDocument();
    expect(within(aggregations).getByText("9")).toBeInTheDocument();
    expect(
      within(aggregations).getByText("latency_percentiles"),
    ).toBeInTheDocument();
    expect(
      within(aggregations).getByText(
        "Unsupported aggregation shape rendered as raw JSON.",
      ),
    ).toBeInTheDocument();
    expect(within(aggregations).getByText(/95.0/)).toBeInTheDocument();
    expectNoGrid();
  });

  it("renders explain and profile payloads as explicit expandable sections", () => {
    render(
      <SearchResultView
        result={{
          ...result,
          explain: { matched: true, explanation: "term matched" },
          profile: { shards: [{ id: "profile-debug" }] },
          hits: [
            {
              ...baseHit,
              explanation: { value: 1, description: "hit explanation" },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Explain payload")).toBeInTheDocument();
    expect(screen.getByText("Profile payload")).toBeInTheDocument();
    expect(screen.getByText("Explain payload for doc-1")).toBeInTheDocument();
    expect(screen.getByText(/term matched/)).toBeInTheDocument();
    expect(screen.getByText(/profile-debug/)).toBeInTheDocument();
    expect(screen.getByText(/hit explanation/)).toBeInTheDocument();
    expectNoGrid();
  });

  it("renders Search-native loading, error, and cancelled states", () => {
    const { rerender } = render(
      <SearchResultView queryState={{ status: "running", queryId: "q-1" }} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Search query running",
    );
    expectNoGrid();

    rerender(
      <SearchResultView
        queryState={{ status: "error", error: "fixture failure" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Search query failed");
    expect(screen.getByRole("alert")).toHaveTextContent("fixture failure");
    expectNoGrid();

    rerender(
      <SearchResultView
        queryState={{ status: "cancelled", message: "Search stopped" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Search stopped");
    expectNoGrid();
  });

  it("renders empty and malformed payload states safely", () => {
    const { rerender } = render(
      <SearchResultView
        result={{
          ...result,
          total: { value: 0, relation: "eq" },
          hits: [],
          aggregations: [],
        }}
      />,
    );

    expect(screen.getByText("No Search hits")).toBeInTheDocument();
    expect(screen.getByText("No aggregations")).toBeInTheDocument();
    expectNoGrid();

    rerender(
      <SearchResultView
        result={
          {
            ...result,
            total: { value: "many", relation: "eq" },
          } as unknown as SearchResultEnvelope
        }
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Malformed Search result payload",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("total.value");
    expectNoGrid();
  });

  it("keeps many hits, large source, and long highlight states bounded", () => {
    const manyHits = Array.from({ length: 35 }, (_, index) => ({
      ...baseHit,
      id: `doc-${index + 1}`,
      source:
        index === 0
          ? { message: "x".repeat(4200), status: "large" }
          : baseHit.source,
      highlight:
        index === 0
          ? { message: [`<em>${"match ".repeat(350)}</em>`] }
          : baseHit.highlight,
    }));

    render(
      <SearchResultView
        result={{
          ...result,
          total: { value: 35, relation: "eq" },
          hits: manyHits,
        }}
      />,
    );

    const hits = screen.getByLabelText("Search hits");
    expect(within(hits).getAllByRole("listitem")).toHaveLength(35);
    expect(screen.getByText("Showing 35 hits")).toBeInTheDocument();
    expect(screen.getByText("Large _source")).toBeInTheDocument();
    expect(screen.getByText("Long highlight")).toBeInTheDocument();
    expectNoGrid();
  });
});
