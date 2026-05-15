// Sprint 327 (2026-05-15) — U2 placeholder guard. Sprint 333 will replace
// the placeholder with the explain tree view.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ExplainViewer } from "./ExplainViewer";

describe("ExplainViewer (Sprint 327)", () => {
  it("renders placeholder mentioning the query when given", () => {
    render(
      <ExplainViewer
        connectionId="conn-pg"
        paradigm="table"
        query="SELECT 1"
      />,
    );
    expect(screen.getByTestId("explain-viewer")).toBeInTheDocument();
    expect(screen.getByText(/SELECT 1/)).toBeInTheDocument();
  });

  it("falls back to em-dash when query is absent", () => {
    render(<ExplainViewer connectionId="conn-mongo" paradigm="document" />);
    expect(
      screen.getByText(/Mongo cursor\.explain\(\) wrapper pending/),
    ).toBeInTheDocument();
  });
});
