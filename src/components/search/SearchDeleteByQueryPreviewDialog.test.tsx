import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchDeleteByQueryPreviewDialog } from "./SearchDeleteByQueryPreviewDialog";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function renderDialog(
  overrides: Partial<
    ComponentProps<typeof SearchDeleteByQueryPreviewDialog>
  > = {},
) {
  return render(
    <SearchDeleteByQueryPreviewDialog
      open
      connectionId="search-1"
      target="logs-elastic-2026.05.24"
      supported
      docsCount={12}
      onOpenChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe("SearchDeleteByQueryPreviewDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("requests a preview-only delete-by-query plan and renders warnings plus estimated count", async () => {
    invokeMock.mockResolvedValueOnce({
      operation: "deleteByQuery",
      target: "logs-elastic-2026.05.24",
      previewOnly: true,
      requiresConfirmation: false,
      warnings: [
        "Delete-by-query is destructive; execution is unsupported in this milestone",
      ],
      estimatedDocumentCount: 7,
    });

    renderDialog();

    expect(
      screen.getByText(/Admin and destructive execution are unsupported/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /execute/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /confirm/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^delete$/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /generate plan/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("plan_search_delete_by_query", {
        connectionId: "search-1",
        request: {
          indexPattern: "logs-elastic-2026.05.24",
          body: { query: { match_all: {} } },
          previewOnly: true,
          safety: {
            acknowledgedRisk: false,
            allowWildcard: false,
          },
        },
      }),
    );
    expect(
      await screen.findByLabelText("Delete-by-query preview plan"),
    ).toHaveTextContent("Estimated documents7");
    expect(
      screen.getByLabelText("Delete-by-query preview plan"),
    ).toHaveTextContent("Unsupported in this milestone");
    expect(
      screen.getByLabelText("Delete-by-query preview plan"),
    ).toHaveTextContent("execution is unsupported");
  });

  it("shows scoped redacted preview errors from Search IPC", async () => {
    invokeMock.mockRejectedValueOnce(
      "Elasticsearch search request failed at https://elastic:leaked-pass@127.0.0.1:9200/_search password=leaked-pass",
    );

    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /generate plan/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Delete-by-query preview failed");
    expect(alert).toHaveTextContent("Elasticsearch search request failed");
    expect(alert).not.toHaveTextContent("leaked-pass");
    expect(alert).not.toHaveTextContent("https://elastic");
    expect(alert).not.toHaveTextContent("127.0.0.1:9200");
  });

  it("keeps unsupported connections on a no-IPC state", () => {
    renderDialog({ supported: false });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Delete-by-query preview is unsupported by this Search connection.",
    );
    expect(
      screen.getByRole("button", { name: /generate plan/i }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /generate plan/i }));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects wildcard targets before planning IPC", () => {
    renderDialog({ target: "logs-*" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "wildcard targets are unsupported",
    );
    expect(
      screen.getByRole("button", { name: /generate plan/i }),
    ).toBeDisabled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
