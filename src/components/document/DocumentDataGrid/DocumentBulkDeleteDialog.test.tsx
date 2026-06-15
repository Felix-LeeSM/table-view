import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DocumentBulkDeleteDialog from "./DocumentBulkDeleteDialog";

describe("DocumentBulkDeleteDialog", () => {
  it("shows the deleteMany MQL preview and partial commit warning", () => {
    render(
      <DocumentBulkDeleteDialog
        open
        onOpenChange={vi.fn()}
        database="app"
        collection="users"
        activeFilter={{ status: "stale" }}
        loading={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("MQL bulk delete preview")).toHaveTextContent(
      'db.users.deleteMany({"status":"stale"})',
    );
    const warning = screen.getByLabelText("MongoDB bulk delete warning");
    expect(warning).toHaveTextContent("not wrapped in a transaction");
    expect(warning).toHaveTextContent(
      "some matched documents may already be deleted",
    );
  });

  it("keeps the deleteMany preview and warning when a server error is shown", () => {
    render(
      <DocumentBulkDeleteDialog
        open
        onOpenChange={vi.fn()}
        database="app"
        collection="users"
        activeFilter={{ status: "stale" }}
        error="deleteMany is not wrapped in a transaction. write concern failed"
        loading={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("MQL bulk delete preview")).toHaveTextContent(
      'db.users.deleteMany({"status":"stale"})',
    );
    expect(screen.getByText(/write concern failed/)).toBeInTheDocument();
    expect(
      screen.getByLabelText("MongoDB bulk delete warning"),
    ).toHaveTextContent("not wrapped in a transaction");
  });
});
