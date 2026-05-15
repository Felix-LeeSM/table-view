// Sprint 327 (2026-05-15) — U1 placeholder guard. Sprint 332 swaps for
// the live activity grid + Kill button.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ServerActivityPanel } from "./ServerActivityPanel";

describe("ServerActivityPanel (Sprint 327)", () => {
  it("renders placeholder for RDB paradigm", () => {
    render(<ServerActivityPanel connectionId="conn-pg" paradigm="table" />);
    expect(screen.getByTestId("server-activity-panel")).toHaveAttribute(
      "data-paradigm",
      "table",
    );
    expect(screen.getByText(/pg_stat_activity/)).toBeInTheDocument();
  });

  it("renders placeholder for Mongo paradigm", () => {
    render(
      <ServerActivityPanel connectionId="conn-mongo" paradigm="document" />,
    );
    expect(screen.getByText(/currentOp \+ killOp/)).toBeInTheDocument();
  });
});
