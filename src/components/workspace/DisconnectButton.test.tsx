import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import DisconnectButton from "./DisconnectButton";
import { useConnectionStore } from "@stores/connectionStore";
import { useToastStore } from "@lib/toast";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

function makeConnection(
  id: string,
  overrides?: Partial<ConnectionConfig>,
): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "test",
    group_id: null,
    color: null,
    environment: null,
    paradigm: "rdb",
    ...overrides,
  };
}

function setStore(opts: {
  connections?: ConnectionConfig[];
  statuses?: Record<string, ConnectionStatus>;
  focusedConnId?: string | null;
  disconnectImpl?: (id: string) => Promise<void>;
}) {
  const conns = opts.connections ?? [];
  const statuses = opts.statuses ?? {};
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
    focusedConnId: opts.focusedConnId ?? null,
    ...(opts.disconnectImpl
      ? { disconnectFromDatabase: opts.disconnectImpl }
      : {}),
  });
}

describe("DisconnectButton", () => {
  beforeEach(() => {
    setStore({});
    useToastStore.getState().clear();
  });

  it("exposes an aria-label of 'Disconnect' (AC-S134-05)", () => {
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<DisconnectButton />);
    expect(
      screen.getByRole("button", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });

  it("is disabled when no connection is focused", () => {
    setStore({ focusedConnId: null });
    render(<DisconnectButton />);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).toBeDisabled();
  });

  it("is disabled when the focused connection is in the disconnected state", () => {
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "disconnected" } },
      focusedConnId: "c1",
    });
    render(<DisconnectButton />);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).toBeDisabled();
  });

  it("is disabled while the focused connection is in the connecting state", () => {
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connecting" } },
      focusedConnId: "c1",
    });
    render(<DisconnectButton />);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).toBeDisabled();
  });

  it("is enabled when the focused connection is connected", () => {
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<DisconnectButton />);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).not.toBeDisabled();
  });

  it("calls disconnectFromDatabase with the focused id on click", async () => {
    const spy = vi.fn(() => Promise.resolve());
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
      disconnectImpl: spy,
    });
    render(<DisconnectButton />);

    const btn = screen.getByRole("button", { name: "Disconnect" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("c1");
  });

  it("surfaces a toast and re-enables the button on disconnect failure", async () => {
    const spy = vi.fn(() => Promise.reject(new Error("network down")));
    setStore({
      connections: [makeConnection("c1", { name: "Prod" })],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
      disconnectImpl: spy,
    });
    render(<DisconnectButton />);

    const btn = screen.getByRole("button", { name: "Disconnect" });
    await act(async () => {
      fireEvent.click(btn);
    });

    // Toast must surface the failure with variant=error.
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]!.variant).toBe("error");
      expect(toasts[0]!.message).toMatch(/failed to disconnect/i);
      expect(toasts[0]!.message).toMatch(/Prod/);
    });

    // The button is enabled again so the user can retry.
    expect(btn).not.toBeDisabled();
  });

  it("flips aria-label to 'Disconnecting…' while a disconnect is in flight", async () => {
    let resolveDisconnect: (() => void) | null = null;
    const spy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDisconnect = resolve;
        }),
    );
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
      disconnectImpl: spy,
    });
    render(<DisconnectButton />);

    const btn = screen.getByRole("button", { name: "Disconnect" });
    act(() => {
      fireEvent.click(btn);
    });

    // While the promise is unresolved, the busy state must be visible
    // through the aria-label change.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /disconnecting/i }),
      ).toBeInTheDocument();
    });

    // Resolve and assert the busy state clears.
    await act(async () => {
      resolveDisconnect?.();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Disconnect" }),
      ).toBeInTheDocument();
    });
  });

  it("renders a tooltip mentioning the focused connection's name", () => {
    setStore({
      connections: [makeConnection("c1", { name: "Prod" })],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<DisconnectButton />);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).toHaveAttribute("title", "Disconnect from Prod");
  });
});
