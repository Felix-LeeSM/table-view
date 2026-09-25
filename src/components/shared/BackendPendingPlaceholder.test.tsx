// Smoke for the shared deferred-backend placeholder used by the
// scaffolding panels. Contract D-73: the placeholder must surface (a) a
// title, (b) the `pendingSprint` pointer, (c) a stable testid so the
// wire-up can target it.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
        description="RDB EXPLAIN uses plan-only FORMAT JSON."
        testId="placeholder-explain"
      />,
    );

    expect(
      screen.getByText("RDB EXPLAIN uses plan-only FORMAT JSON."),
    ).toBeInTheDocument();
  });
});
