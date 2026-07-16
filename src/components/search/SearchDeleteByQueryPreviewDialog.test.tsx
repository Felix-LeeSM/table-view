import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { ConnectionConfig } from "@/types/connection";
import { SearchDeleteByQueryPreviewDialog } from "./SearchDeleteByQueryPreviewDialog";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function makeConn(
  id: string,
  environment: ConnectionConfig["environment"],
): ConnectionConfig {
  return {
    id,
    name: `${id} cluster`,
    dbType: "elasticsearch",
    host: "localhost",
    port: 9200,
    user: "elastic",
    hasPassword: false,
    database: "",
    groupId: null,
    color: null,
    environment,
    paradigm: "search",
  };
}

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

const livePlan = {
  operation: "deleteByQuery",
  target: "logs-elastic-2026.05.24",
  previewOnly: true,
  requiresConfirmation: true,
  warnings: [
    "Delete-by-query permanently removes every matched document and cannot be undone",
  ],
  estimatedDocumentCount: 7,
};

describe("SearchDeleteByQueryPreviewDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // Default: no connection resolved (non-production) + warn mode → the Safe
    // Mode allow tier, so the delete runs without a confirm dialog.
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "warn" });
  });

  it("generates a live delete-by-query plan with warnings and an estimated count", async () => {
    invokeMock.mockResolvedValueOnce(livePlan);

    renderDialog();

    expect(
      screen.getByText(/run a live _delete_by_query/i),
    ).toBeInTheDocument();
    // No Delete affordance before a plan exists.
    expect(
      screen.queryByRole("button", { name: /delete .*document/i }),
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
    ).toHaveTextContent("Live (Safe Mode confirmation)");
    expect(
      screen.getByLabelText("Delete-by-query preview plan"),
    ).toHaveTextContent("cannot be undone");
    expect(
      screen.getByRole("button", { name: /delete 7 documents/i }),
    ).toBeInTheDocument();
  });

  it("runs the live delete directly in the non-production allow tier and shows the deleted count", async () => {
    invokeMock.mockResolvedValueOnce(livePlan).mockResolvedValueOnce({
      target: "logs-elastic-2026.05.24",
      tookMs: 12,
      timedOut: false,
      total: 7,
      deleted: 7,
      versionConflicts: 0,
      batches: 1,
      failures: [],
    });

    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /generate plan/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /delete 7 documents/i }),
    );

    await waitFor(() =>
      expect(invokeMock).toHaveBeenLastCalledWith(
        "execute_search_delete_by_query",
        {
          connectionId: "search-1",
          request: {
            indexPattern: "logs-elastic-2026.05.24",
            body: { query: { match_all: {} } },
            previewOnly: false,
            safety: { acknowledgedRisk: false, allowWildcard: false },
          },
          // allow tier: unconfirmed flag — the backend gate re-decides.
          safetyConfirmed: false,
        },
      ),
    );
    expect(
      await screen.findByLabelText("Delete-by-query result"),
    ).toHaveTextContent("Deleted 7 of 7 matched document(s).");
  });

  it("surfaces a partial delete as deleted + failed counts", async () => {
    invokeMock.mockResolvedValueOnce(livePlan).mockResolvedValueOnce({
      target: "logs-elastic-2026.05.24",
      tookMs: 12,
      timedOut: false,
      total: 7,
      deleted: 5,
      versionConflicts: 2,
      batches: 1,
      failures: [{ index: "logs-elastic-2026.05.24", id: "d9", status: 409 }],
    });

    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /generate plan/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /delete 7 documents/i }),
    );

    const result = await screen.findByLabelText("Delete-by-query result");
    expect(result).toHaveTextContent("Deleted 5 of 7 matched document(s).");
    expect(result).toHaveTextContent("2 version conflicts.");
    expect(result).toHaveTextContent("1 document failed to delete.");
  });

  it("routes a production connection through the confirm dialog before executing", async () => {
    useConnectionStore.setState({
      connections: [makeConn("search-1", "production")],
    });
    invokeMock.mockResolvedValueOnce(livePlan);

    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /generate plan/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /delete 7 documents/i }),
    );

    // The production connection forces the shared confirm dialog; execution
    // has NOT fired yet (only the plan IPC ran).
    expect(await screen.findByText("PRODUCTION DATABASE")).toBeInTheDocument();
    expect(
      invokeMock.mock.calls.some(
        (call) => call[0] === "execute_search_delete_by_query",
      ),
    ).toBe(false);
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
      "Delete-by-query is unsupported by this Search connection.",
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
