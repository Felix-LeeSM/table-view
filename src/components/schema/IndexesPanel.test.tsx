// Sprint 327 (2026-05-15) — Slice J scaffolding guard. Sprint 328 will
// rewrite this to assert the live grid; until then we only guard that the
// surface renders with the placeholder and the paradigm prop reaches the
// DOM (so Sprint 328 can branch on it without breaking the contract).

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { IndexesPanel } from "./IndexesPanel";

describe("IndexesPanel (Sprint 327)", () => {
  it("renders placeholder with collection label for Mongo paradigm", () => {
    render(
      <IndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        paradigm="document"
      />,
    );

    expect(screen.getByTestId("indexes-panel-placeholder")).toBeInTheDocument();
    expect(screen.getByText(/app\.users/)).toBeInTheDocument();
    expect(screen.getByLabelText("Indexes panel")).toHaveAttribute(
      "data-paradigm",
      "document",
    );
  });

  it("renders placeholder for RDB paradigm", () => {
    render(
      <IndexesPanel
        connectionId="conn-pg"
        database="public"
        collection="users"
        paradigm="table"
      />,
    );

    expect(screen.getByLabelText("Indexes panel")).toHaveAttribute(
      "data-paradigm",
      "table",
    );
  });
});
