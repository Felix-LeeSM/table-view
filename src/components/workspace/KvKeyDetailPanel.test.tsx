import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import KvKeyDetailPanel from "./KvKeyDetailPanel";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { ConnectionConfig } from "@/types/connection";
import type { KvValueEnvelope } from "@/types/kv";

// Purpose: the right-hand KV key detail panel loads the selected key's value
// and hosts the mutation surface (KV UX redesign, 2026-07-07). This is the new
// home of value inspection/mutation that used to live inline in KvSidebar.

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function redisConnection(): ConnectionConfig {
  return {
    id: "redis-1",
    name: "Redis",
    dbType: "redis",
    host: "localhost",
    port: 6379,
    user: "",
    database: "0",
    groupId: null,
    color: null,
    hasPassword: false,
    paradigm: "kv",
  };
}

function hashEnvelope(): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: {
      key: "user:1",
      keyType: "hash",
      ttl: { state: "persistent" },
      length: 2,
    },
    value: {
      type: "hash",
      fields: [{ field: "name", value: "Ada" }],
      cursor: "0",
      nextCursor: "0",
      done: true,
      total: 1,
    },
  };
}

function stringEnvelope(text: string): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: {
      key: "user:1",
      keyType: "string",
      ttl: { state: "persistent" },
      length: text.length,
    },
    value: { type: "string", encoding: "utf8", text, byteLength: text.length },
  };
}

function streamEnvelope(): KvValueEnvelope {
  return {
    key: "stream:events",
    metadata: {
      key: "stream:events",
      keyType: "stream",
      ttl: { state: "expires", seconds: 60 },
      length: 1,
      memoryBytes: 256,
    },
    value: {
      type: "stream",
      key: "stream:events",
      entries: [{ id: "1-0", fields: [{ field: "type", value: "login" }] }],
      start: "0-0",
      end: "+",
      limit: 100,
    },
  };
}

describe("KvKeyDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
    useSafeModeStore.setState({ mode: "strict" });
  });

  // Reason: opening a hash key must fetch its value and show the decoded body
  // + type/ttl metadata (the user-visible outcome of selecting the key).
  it("loads and renders the selected hash key value", async () => {
    invokeMock.mockResolvedValue(hashEnvelope());

    render(
      <KvKeyDetailPanel connectionId="redis-1" database={0} keyName="user:1" />,
    );

    expect(await screen.findByText(/name: Ada/)).toBeInTheDocument();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_kv_value", {
        connectionId: "redis-1",
        queryId: undefined,
        request: { database: 0, key: "user:1", limit: 100 },
      });
    });
    expect(screen.getByText("hash")).toBeInTheDocument();
    expect(screen.getByText("persistent")).toBeInTheDocument();
  });

  // Reason: stream keys route to the bounded stream reader table, not the raw
  // <pre> body.
  it("renders the stream reader for a stream key", async () => {
    invokeMock.mockResolvedValue(streamEnvelope());

    render(
      <KvKeyDetailPanel
        connectionId="redis-1"
        database={0}
        keyName="stream:events"
      />,
    );

    expect(await screen.findByText("1-0")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: /stream:events stream entries/i }),
    ).toBeInTheDocument();
  });

  // Reason: the panel hosts the mutation surface — a string overwrite must
  // preview, dispatch the set IPC on confirm, then reflect the new value.
  it("previews and confirms a string overwrite, then refreshes the value", async () => {
    let text = "Ada";
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === "get_kv_value")
        return Promise.resolve(stringEnvelope(text));
      if (command === "set_kv_string_value") {
        text = (payload as { request: { value: string } }).request.value;
        return Promise.resolve({
          key: "user:1",
          changed: true,
          ttl: { state: "persistent" },
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    render(
      <KvKeyDetailPanel connectionId="redis-1" database={0} keyName="user:1" />,
    );

    fireEvent.change(await screen.findByLabelText("String value"), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /preview string set/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm string set/i }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_kv_string_value", {
        connectionId: "redis-1",
        request: {
          database: 0,
          key: "user:1",
          value: "Grace Hopper",
          safety: "allowOverwrite",
        },
      });
    });
    expect(await screen.findByDisplayValue("Grace Hopper")).toBeInTheDocument();
  });

  // Reason: the hosted stream reader refreshes bounded ranges via read_kv_stream
  // (coverage migrated from KvSidebar when the reader moved into the panel).
  it("refreshes stream entries with bounded range controls", async () => {
    let resolveStreamRead: (value: unknown) => void = () => {};
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === "get_kv_value") return Promise.resolve(streamEnvelope());
      if (command === "read_kv_stream") {
        expect(payload).toEqual({
          connectionId: "redis-1",
          queryId: undefined,
          request: {
            database: 0,
            key: "stream:events",
            start: "1-0",
            end: "+",
            limit: 25,
          },
        });
        return new Promise((resolve) => {
          resolveStreamRead = resolve;
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    render(
      <KvKeyDetailPanel
        connectionId="redis-1"
        database={0}
        keyName="stream:events"
      />,
    );
    await screen.findByText("type=login");

    fireEvent.change(screen.getByLabelText("Stream start"), {
      target: { value: "1-0" },
    });
    fireEvent.change(screen.getByLabelText("Stream count"), {
      target: { value: "25" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /refresh stream entries/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /loading stream entries/i,
    );
    resolveStreamRead({
      key: "stream:events",
      entries: [{ id: "2-0", fields: [{ field: "type", value: "logout" }] }],
      start: "1-0",
      end: "+",
      limit: 25,
    });

    expect(await screen.findByText("2-0")).toBeInTheDocument();
    expect(screen.getByText("type=logout")).toBeInTheDocument();
  });

  it("surfaces stream refresh errors without clearing entries", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_kv_value") return Promise.resolve(streamEnvelope());
      if (command === "read_kv_stream") {
        return Promise.reject(new Error("XRANGE failed"));
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    render(
      <KvKeyDetailPanel
        connectionId="redis-1"
        database={0}
        keyName="stream:events"
      />,
    );
    expect(await screen.findByText("type=login")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /refresh stream entries/i }),
    );

    expect(await screen.findByText("XRANGE failed")).toBeInTheDocument();
    expect(screen.getByText("1-0")).toBeInTheDocument();
  });

  // Reason: a value fetch failure must surface as an alert, not a blank panel
  // (P4 — error branch parity).
  it("surfaces a value load error", async () => {
    invokeMock.mockRejectedValue(new Error("GET failed"));

    render(
      <KvKeyDetailPanel connectionId="redis-1" database={0} keyName="user:1" />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("GET failed");
  });
});
