// Sprint 327 (2026-05-15) — U3 placeholder guard.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CollectionStatsPanel } from "./CollectionStatsPanel";

describe("CollectionStatsPanel (Sprint 327)", () => {
  it("renders placeholder for Mongo paradigm", () => {
    render(
      <CollectionStatsPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        paradigm="document"
      />,
    );
    expect(screen.getByTestId("collection-stats-panel")).toBeInTheDocument();
    expect(screen.getByText(/app\.users/)).toBeInTheDocument();
    expect(
      screen.getByText(/collStats runCommand wrapper pending/),
    ).toBeInTheDocument();
  });
});
