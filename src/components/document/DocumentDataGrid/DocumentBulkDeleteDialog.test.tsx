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
});
