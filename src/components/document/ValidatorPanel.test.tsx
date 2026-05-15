// Sprint 327 (2026-05-15) — Slice K placeholder guard. Sprint 329 swaps for
// live $jsonSchema editor + collMod dispatch.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ValidatorPanel } from "./ValidatorPanel";

describe("ValidatorPanel (Sprint 327)", () => {
  it("renders placeholder for given collection", () => {
    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    expect(
      screen.getByTestId("validator-panel-placeholder"),
    ).toBeInTheDocument();
    expect(screen.getByText(/app\.users/)).toBeInTheDocument();
    expect(screen.getByText(/Sprint 329/)).toBeInTheDocument();
  });
});
