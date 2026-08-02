// Sprint 339 (2026-05-15) — U4 live wire. Verifies ServerInfoPanel
// dispatches the paradigm-neutral `server_info` IPC through
// `@/lib/api/serverInfo` and renders the result grid.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const infoMock = vi.fn();
const runtimeMock = vi.fn();

vi.mock("@/lib/api/serverInfo", () => ({
  serverInfo: (...args: unknown[]) => infoMock(...args),
}));

vi.mock("@/lib/api/mongoRuntimeCapabilities", () => ({
  mongoRuntimeCapabilities: (...args: unknown[]) => runtimeMock(...args),
}));

import { ServerInfoPanel } from "./ServerInfoPanel";

const pgStub = {
  version: "PostgreSQL 16.1 on x86_64",
  host: "127.0.0.1/32",
  uptimeSec: 3600,
  connectionsActive: 4,
  extras: {
    server_version: { setting: "16.1", category: "Preset Options" },
  },
};

const mongoStub = {
  version: "7.0.5",
  host: "mongo-primary:27017",
  uptimeSec: 7200,
  connectionsActive: 1,
  extras: {
    gitVersion: "abc123",
    storageEngine: { name: "wiredTiger" },
  },
};

describe("ServerInfoPanel (Sprint 339 U4 live wire)", () => {
  beforeEach(() => {
    infoMock.mockReset();
    runtimeMock.mockReset();
    // The real wrapper never rejects and always resolves a capability, so the
    // default stub matches that contract; tests that care override it.
    runtimeMock.mockResolvedValue({ topology: "unknown" });
  });

  it("shows a loading skeleton while the initial fetch is pending (#1587)", () => {
    infoMock.mockReturnValueOnce(new Promise(() => {}));
    render(<ServerInfoPanel connectionId="conn-pg" dbType="postgresql" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("server-info-grid")).toBeNull();
  });

  it("renders RDB server identity grid after server_info resolves", async () => {
    infoMock.mockResolvedValueOnce(pgStub);
    render(<ServerInfoPanel connectionId="conn-pg" dbType="postgresql" />);
    expect(screen.getByTestId("server-info-panel")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("server-info-grid")).toBeInTheDocument(),
    );
    expect(infoMock).toHaveBeenCalledWith("conn-pg");
    expect(screen.getByText(/PostgreSQL 16\.1/)).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1/32")).toBeInTheDocument();
    expect(screen.getByText("3,600")).toBeInTheDocument();
    expect(screen.getByText(/server_version/)).toBeInTheDocument();
  });

  it("renders Mongo identity grid with extras", async () => {
    infoMock.mockResolvedValueOnce(mongoStub);
    render(<ServerInfoPanel connectionId="conn-m" dbType="mongodb" />);
    await waitFor(() =>
      expect(screen.getByTestId("server-info-grid")).toBeInTheDocument(),
    );
    expect(infoMock).toHaveBeenCalledWith("conn-m");
    expect(screen.getByText("7.0.5")).toBeInTheDocument();
    expect(screen.getByText(/wiredTiger/)).toBeInTheDocument();
  });

  // Issue #1821 (2/2) — the runtime capability the backend probes at connect()
  // reaches a user-visible row here. Before this, `mongo_runtime_capabilities`
  // had no production consumer at all.
  describe("Mongo deployment row (#1821)", () => {
    it.each([
      ["standalone", "Standalone"],
      ["replicaSet", "Replica set"],
      ["sharded", "Sharded cluster"],
    ])("renders the %s topology as a labelled row", async (topology, label) => {
      infoMock.mockResolvedValueOnce(mongoStub);
      runtimeMock.mockResolvedValueOnce({
        topology,
        version: { major: 7, minor: 0, patch: 5, raw: "7.0.5" },
      });

      render(<ServerInfoPanel connectionId="conn-m" dbType="mongodb" />);

      await waitFor(() =>
        expect(screen.getByTestId("server-info-grid")).toBeInTheDocument(),
      );
      expect(runtimeMock).toHaveBeenCalledWith("conn-m");
      expect(screen.getByText("Deployment")).toBeInTheDocument();
      expect(screen.getByTestId("server-info-deployment")).toHaveTextContent(
        label,
      );
    });

    it("shows an explicit unidentified row rather than hiding it (fail-closed is visible)", async () => {
      // This is the state in which every later version/topology gate closes.
      // A hidden row would leave the user unable to tell "not a cluster" from
      // "the server never answered the handshake".
      infoMock.mockResolvedValueOnce(mongoStub);
      runtimeMock.mockResolvedValueOnce({ topology: "unknown" });

      render(<ServerInfoPanel connectionId="conn-m" dbType="mongodb" />);

      await waitFor(() =>
        expect(screen.getByTestId("server-info-deployment")).toHaveTextContent(
          "Not identified",
        ),
      );
    });

    it("does not query or render deployment for a non-Mongo connection", async () => {
      infoMock.mockResolvedValueOnce(pgStub);

      render(<ServerInfoPanel connectionId="conn-pg" dbType="postgresql" />);

      await waitFor(() =>
        expect(screen.getByTestId("server-info-grid")).toBeInTheDocument(),
      );
      expect(runtimeMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("server-info-deployment")).toBeNull();
      expect(screen.queryByText("Deployment")).toBeNull();
    });

    it("keeps the version row, which already carries the server version", async () => {
      // The two halves of "expose topology + version" have different sources:
      // version comes from `server_info`'s live `buildInfo`, deployment from
      // the capability cached at connect(). Both must be on screen together.
      infoMock.mockResolvedValueOnce(mongoStub);
      runtimeMock.mockResolvedValueOnce({
        topology: "sharded",
        version: { major: 7, minor: 0, patch: 5, raw: "7.0.5" },
      });

      render(<ServerInfoPanel connectionId="conn-m" dbType="mongodb" />);

      await waitFor(() =>
        expect(screen.getByText("7.0.5")).toBeInTheDocument(),
      );
      expect(screen.getByTestId("server-info-deployment")).toHaveTextContent(
        "Sharded cluster",
      );
    });

    it("does not fail the panel when the capability read degrades", async () => {
      // `mongoRuntimeCapabilities` never rejects, so a refused probe must not
      // steal the rest of the grid.
      infoMock.mockResolvedValueOnce(mongoStub);
      runtimeMock.mockResolvedValueOnce({ topology: "unknown" });

      render(<ServerInfoPanel connectionId="conn-m" dbType="mongodb" />);

      await waitFor(() =>
        expect(screen.getByTestId("server-info-grid")).toBeInTheDocument(),
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("mongo-primary:27017")).toBeInTheDocument();
    });
  });

  it("renders error alert when fetch rejects", async () => {
    infoMock.mockRejectedValueOnce(new Error("admin command denied"));
    render(<ServerInfoPanel connectionId="conn-pg" dbType="postgresql" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/admin command denied/);
    expect(screen.queryByTestId("server-info-grid")).toBeNull();
  });

  it("re-fetches when Refresh is clicked", async () => {
    infoMock.mockResolvedValue(pgStub);
    const user = userEvent.setup();
    render(<ServerInfoPanel connectionId="conn-pg" dbType="postgresql" />);
    await waitFor(() => expect(infoMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId("server-info-refresh"));
    await waitFor(() => expect(infoMock).toHaveBeenCalledTimes(2));
  });
});
