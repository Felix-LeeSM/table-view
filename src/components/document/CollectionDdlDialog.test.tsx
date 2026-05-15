// Sprint 327 (2026-05-15) — Slice L placeholder guard. Sprint 330 swaps
// for the live create/rename/drop UX.

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CollectionDdlDialog } from "./CollectionDdlDialog";

describe("CollectionDdlDialog (Sprint 327)", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CollectionDdlDialog
        open={false}
        mode="create"
        connectionId="conn-mongo"
        database="app"
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders placeholder with mode label when open", () => {
    render(
      <CollectionDdlDialog
        open
        mode="rename"
        connectionId="conn-mongo"
        database="app"
        collection="users"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("collection-ddl-dialog")).toBeInTheDocument();
    expect(screen.getByText(/Collection rename/)).toBeInTheDocument();
    expect(
      screen.getByLabelText("Close collection DDL dialog"),
    ).toBeInTheDocument();
  });
});
