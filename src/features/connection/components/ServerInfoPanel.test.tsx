// Sprint 339 (2026-05-15) — U4 live wire. Verifies ServerInfoPanel
// dispatches the paradigm-neutral `server_info` IPC through
// `@/lib/api/serverInfo` and renders the result grid.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const infoMock = vi.fn();

vi.mock("@/lib/api/serverInfo", () => ({
  serverInfo: (...args: unknown[]) => infoMock(...args),
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
