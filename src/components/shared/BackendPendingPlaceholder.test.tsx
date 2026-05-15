// Sprint 327 (2026-05-15) — Smoke for the shared deferred-backend placeholder
// used by 9 scaffolding panels (J~M + U1~U5). Sprint 327 contract D-73:
// placeholder must surface (a) a title, (b) a sprint pointer, (c) a stable
// testid so wire-up sprints can target it.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BackendPendingPlaceholder } from "./BackendPendingPlaceholder";

describe("BackendPendingPlaceholder (Sprint 327)", () => {
  it("renders title, sprint pointer, and stable testid", () => {
    render(
      <BackendPendingPlaceholder
        title="Indexes"
        pendingSprint="Sprint 328"
        testId="placeholder-indexes"
      />,
    );

    expect(screen.getByText("Indexes")).toBeInTheDocument();
    expect(screen.getByText(/Sprint 328/)).toBeInTheDocument();
    expect(screen.getByTestId("placeholder-indexes")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("renders optional description when provided", () => {
    render(
      <BackendPendingPlaceholder
        title="Explain"
        pendingSprint="Sprint 333"
        description="RDB EXPLAIN ANALYZE will reuse execute_query."
        testId="placeholder-explain"
      />,
    );

    expect(
      screen.getByText("RDB EXPLAIN ANALYZE will reuse execute_query."),
    ).toBeInTheDocument();
  });
});
