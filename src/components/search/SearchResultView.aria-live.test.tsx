// #1137 — search result-count announcement.
//
// The loading state already carries `role="status"`; on completion the hit
// count must land in a polite live region too, so SR users hear "N hits"
// instead of silence after the spinner disappears.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SearchResultEnvelope } from "@/types/search";
import { SearchResultView } from "./SearchResultView";

const result: SearchResultEnvelope = {
  tookMs: 3,
  timedOut: false,
  total: { value: 7, relation: "eq" },
  hits: [
    {
      index: "logs",
      id: "doc-1",
      score: 1,
      source: { message: "fixture" },
      fields: {},
      sort: ["doc-1"],
    },
  ],
  aggregations: [],
};

describe("SearchResultView — aria-live routing (#1137)", () => {
  it("completed hit count lives in a polite status region", () => {
    render(<SearchResultView result={result} />);
    const summary = screen
      .getAllByRole("status")
      .find((el) => /hits/i.test(el.textContent ?? ""));
    expect(summary).toBeDefined();
    expect(summary).toHaveAttribute("aria-live", "polite");
    expect(summary!.textContent).toMatch(/7 hits/);
  });
});
