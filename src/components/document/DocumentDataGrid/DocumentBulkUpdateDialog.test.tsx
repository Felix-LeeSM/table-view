import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DocumentBulkUpdateDialog from "./DocumentBulkUpdateDialog";

describe("DocumentBulkUpdateDialog", () => {
  it("shows the updateMany MQL preview and partial commit warning", () => {
    render(
      <DocumentBulkUpdateDialog
        open
        onOpenChange={vi.fn()}
        database="app"
        collection="users"
        activeFilter={{ status: "pending" }}
        patchInput='{ "status": "archived" }'
        onPatchInputChange={vi.fn()}
        error={null}
        loading={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("MQL bulk update preview")).toHaveTextContent(
      'db.users.updateMany({"status":"pending"}, { $set: {"status":"archived"} })',
    );
    const warning = screen.getByLabelText("MongoDB bulk update warning");
    expect(warning).toHaveTextContent("not wrapped in a transaction");
    expect(warning).toHaveTextContent(
      "some matched documents may already be updated",
    );
  });

  it("does not show an updateMany preview until the patch is valid JSON object", () => {
    render(
      <DocumentBulkUpdateDialog
        open
        onOpenChange={vi.fn()}
        database="app"
        collection="users"
        activeFilter={{ status: "pending" }}
        patchInput="{ invalid"
        onPatchInputChange={vi.fn()}
        error={null}
        loading={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("MQL bulk update preview")).toBeNull();
    expect(
      screen.getByText("Enter a valid JSON object to preview updateMany."),
    );
  });

  it("keeps the updateMany preview and warning when a server error is shown", () => {
    render(
      <DocumentBulkUpdateDialog
        open
        onOpenChange={vi.fn()}
        database="app"
        collection="users"
        activeFilter={{ status: "pending" }}
        patchInput='{ "status": "archived" }'
        onPatchInputChange={vi.fn()}
        error="updateMany is not wrapped in a transaction. duplicate key"
        loading={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("MQL bulk update preview")).toHaveTextContent(
      'db.users.updateMany({"status":"pending"}, { $set: {"status":"archived"} })',
    );
    expect(screen.getByText(/duplicate key/)).toBeInTheDocument();
    expect(
      screen.getByLabelText("MongoDB bulk update warning"),
    ).toHaveTextContent("not wrapped in a transaction");
  });
});
