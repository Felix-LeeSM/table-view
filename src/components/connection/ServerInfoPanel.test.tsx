// Sprint 327 (2026-05-15) — U4 placeholder guard.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ServerInfoPanel } from "./ServerInfoPanel";

describe("ServerInfoPanel (Sprint 327)", () => {
  it("renders placeholder for Mongo paradigm", () => {
    render(<ServerInfoPanel connectionId="conn-mongo" paradigm="document" />);
    expect(screen.getByTestId("server-info-panel")).toBeInTheDocument();
    expect(
      screen.getByText(/buildInfo \+ serverStatus wrappers pending/),
    ).toBeInTheDocument();
  });
});
