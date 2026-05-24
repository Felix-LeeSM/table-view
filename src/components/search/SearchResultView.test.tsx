import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SearchResultEnvelope } from "@/types/search";
import { SearchResultView } from "./SearchResultView";

const result: SearchResultEnvelope = {
  tookMs: 3,
  timedOut: false,
  total: { value: 1, relation: "eq" },
  hits: [
    {
      index: "logs-2026.05.24",
      id: "doc-1",
      score: 1,
      source: {
        "@timestamp": "2026-05-24T00:00:00Z",
        message: "fixture log",
        status: "ok",
      },
      sort: [],
    },
  ],
  aggregations: [
    {
      name: "by_status",
      kind: "terms",
      value: { buckets: [{ key: "ok", doc_count: 1 }] },
    },
  ],
};

describe("SearchResultView", () => {
  it("renders search hits and aggregations without tabular grid projection", () => {
    render(<SearchResultView result={result} />);

    expect(screen.getByLabelText("Search results")).toHaveTextContent("1 hits");
    const hits = screen.getByLabelText("Search hits");
    expect(within(hits).getByText("doc-1")).toBeInTheDocument();
    expect(within(hits).getByText("logs-2026.05.24")).toBeInTheDocument();
    expect(within(hits).getByText(/fixture log/)).toBeInTheDocument();

    const aggregations = screen.getByLabelText("Search aggregations");
    expect(within(aggregations).getByText("by_status")).toBeInTheDocument();
    expect(within(aggregations).getByText("terms")).toBeInTheDocument();
    expect(within(aggregations).getByText(/doc_count/)).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("renders empty states for empty search envelopes", () => {
    render(
      <SearchResultView
        result={{
          ...result,
          total: { value: 0, relation: "eq" },
          hits: [],
          aggregations: [],
        }}
      />,
    );

    expect(screen.getByText("No hits")).toBeInTheDocument();
    expect(screen.getByText("No aggregations")).toBeInTheDocument();
  });
});
