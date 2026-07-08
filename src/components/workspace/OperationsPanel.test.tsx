// Issue #1054 — OperationsPanel flyout guard. The panel is the single
// entry point for the connection-level ops surfaces (U1/U4/U5). These
// tests lock:
// (a) null driving connection → nothing rendered,
// (b) capability-gated tab visibility (postgres shows all three),
// (c) postgresql-only capability subset hides the missing tab,
// (d) the Server Activity tab mounts ServerActivityPanel,
// (e) close callback fires.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OperationsPanel from "./OperationsPanel";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

const listServerActivityMock = vi.fn();
const killServerActivityMock = vi.fn();

vi.mock("@/lib/api/serverActivity", () => ({
  listServerActivity: (...a: unknown[]) => listServerActivityMock(...a),
  killServerActivity: (...a: unknown[]) => killServerActivityMock(...a),
}));

function makeConnection(
  id: string,
  overrides?: Partial<ConnectionConfig>,
): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
    ...overrides,
  };
}

function seed(
  connections: ConnectionConfig[],
  statuses: Record<string, ConnectionStatus> = {},
  focusedConnId: string | null = null,
) {
  useConnectionStore.setState({
    connections,
    activeStatuses: statuses,
    focusedConnId,
  });
  // Clear any active tab so the panel falls back to the focused conn.
  useWorkspaceStore.setState({ workspaces: {} });
}

const CONNECTED: ConnectionStatus = { type: "connected" };

describe("OperationsPanel (#1054)", () => {
  beforeEach(() => {
    seed([], {}, null);
    listServerActivityMock.mockReset();
    killServerActivityMock.mockReset();
    // Default: no active sessions so ServerActivityPanel renders cleanly
    // for the capability/visibility tests. The kill test overrides with
    // mockResolvedValueOnce.
    listServerActivityMock.mockResolvedValue([]);
  });

  it("renders nothing when there is no driving connection", () => {
    render(<OperationsPanel visible onClose={() => {}} />);
    expect(screen.queryByTestId("operations-panel")).not.toBeInTheDocument();
  });

  it("renders nothing when visible is false even with a capable connection", () => {
    seed([makeConnection("conn-pg")], { "conn-pg": CONNECTED }, "conn-pg");
    render(<OperationsPanel visible={false} onClose={() => {}} />);
    expect(screen.queryByTestId("operations-panel")).not.toBeInTheDocument();
  });

  it("renders nothing when the driving connection has no operations capability", () => {
    // Redis has no `operations.*` capability.
    seed(
      [
        makeConnection("conn-redis", {
          dbType: "redis",
          paradigm: "kv",
        }),
      ],
      { "conn-redis": CONNECTED },
      "conn-redis",
    );
    render(<OperationsPanel visible onClose={() => {}} />);
    expect(screen.queryByTestId("operations-panel")).not.toBeInTheDocument();
  });

  it("shows all three capability-backed tabs for a connected postgresql", () => {
    seed([makeConnection("conn-pg")], { "conn-pg": CONNECTED }, "conn-pg");
    render(<OperationsPanel visible onClose={() => {}} />);

    expect(screen.getByTestId("operations-panel")).toBeInTheDocument();
    expect(screen.getByTestId("operations-tab-activity")).toBeInTheDocument();
    expect(screen.getByTestId("operations-tab-serverInfo")).toBeInTheDocument();
    expect(
      screen.getByTestId("operations-tab-slowQueries"),
    ).toBeInTheDocument();
  });

  it("mounts the Server Activity panel on the Activity tab and shows the driving connection name", () => {
    seed(
      [makeConnection("conn-pg", { name: "Analytics PG" })],
      { "conn-pg": CONNECTED },
      "conn-pg",
    );
    render(<OperationsPanel visible onClose={() => {}} />);

    expect(screen.getByText("Analytics PG")).toBeInTheDocument();
    expect(screen.getByTestId("server-activity-panel")).toBeInTheDocument();
  });

  it("invokes onClose when the close button is clicked", async () => {
    seed([makeConnection("conn-pg")], { "conn-pg": CONNECTED }, "conn-pg");
    const onClose = vi.fn();
    render(<OperationsPanel visible onClose={onClose} />);

    await userEvent.click(screen.getByTestId("operations-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("routes session kill through ConfirmDestructiveDialog", async () => {
    // #1054 — kill_session is destructive; the panel's `confirmKill`
    // gate must not let the IPC fire until the user confirms in the
    // workspace-layer dialog.
    listServerActivityMock
      .mockResolvedValueOnce([
        {
          id: 42,
          db: "analytics",
          user: "alice",
          state: "active",
          query: "SELECT 1",
          waitEvent: null,
          startedAt: null,
        },
      ])
      .mockResolvedValueOnce([]);
    killServerActivityMock.mockResolvedValueOnce(undefined);
    seed([makeConnection("conn-pg")], { "conn-pg": CONNECTED }, "conn-pg");
    const user = userEvent.setup();

    render(<OperationsPanel visible onClose={() => {}} />);

    await user.click(await screen.findByTestId("server-activity-kill-42"));

    // Confirm dialog opens; the kill IPC has not fired yet.
    expect(killServerActivityMock).not.toHaveBeenCalled();
    const confirmBtn = await screen.findByTestId("confirm-destructive-confirm");
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(killServerActivityMock).toHaveBeenCalledWith("conn-pg", 42);
    });
  });
});
