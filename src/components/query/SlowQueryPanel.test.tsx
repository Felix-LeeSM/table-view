// Sprint 327 (2026-05-15) — U5 placeholder guard.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SlowQueryPanel } from "./SlowQueryPanel";

describe("SlowQueryPanel (Sprint 327)", () => {
  it("renders placeholder for RDB paradigm", () => {
    render(<SlowQueryPanel connectionId="conn-pg" paradigm="table" />);
    expect(screen.getByTestId("slow-query-panel")).toBeInTheDocument();
    expect(
      screen.getByText(/pg_stat_statements wiring pending/),
    ).toBeInTheDocument();
  });

  it("renders placeholder for Mongo paradigm", () => {
    render(<SlowQueryPanel connectionId="conn-mongo" paradigm="document" />);
    expect(screen.getByText(/system\.profile/)).toBeInTheDocument();
  });
});
