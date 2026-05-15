// Sprint 327 (2026-05-15) — Slice M placeholder guard. Sprint 331 wires
// the live RDB CREATE/DROP DATABASE + Mongo dropDatabase flow.

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DbLifecycleDialog } from "./DbLifecycleDialog";

describe("DbLifecycleDialog (Sprint 327)", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <DbLifecycleDialog
        open={false}
        mode="create"
        connectionId="conn-pg"
        paradigm="table"
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders placeholder with mode + paradigm when open", () => {
    render(
      <DbLifecycleDialog
        open
        mode="drop"
        connectionId="conn-mongo"
        database="staging"
        paradigm="document"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("db-lifecycle-dialog")).toHaveAttribute(
      "data-paradigm",
      "document",
    );
    expect(screen.getByText(/Database drop — staging/)).toBeInTheDocument();
  });
});
