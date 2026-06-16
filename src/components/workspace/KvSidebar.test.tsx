import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import KvSidebar from "./KvSidebar";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { ConnectionConfig } from "@/types/connection";
import type { KvValueEnvelope } from "@/types/kv";

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

function valkeyConnection(): ConnectionConfig {
  return {
    ...redisConnection(),
    id: "valkey-1",
    name: "Valkey",
    dbType: "valkey",
  };
}

describe("KvSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
    useSafeModeStore.setState({ mode: "strict" });
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([
          { name: "0", index: 0, keyCount: 1 },
          { name: "1", index: 1, keyCount: 0 },
        ]);
      }
      if (command === "current_kv_database") {
        const id = (payload as { connectionId: string }).connectionId;
        const status = useConnectionStore.getState().activeStatuses[id];
        const raw = status?.type === "connected" ? status.activeDb : "0";
        return Promise.resolve(Number.parseInt(raw ?? "0", 10) || 0);
      }
      if (command === "switch_kv_database") {
        return Promise.resolve((payload as { database: number }).database);
      }
      if (command === "scan_kv_keys") {
        return Promise.resolve(defaultKeyPage());
      }
      if (command === "get_kv_value") {
        return Promise.resolve(defaultValueEnvelope());
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });
  });

  it("loads Redis catalog without scanning keys when Safe Mode is enabled", async () => {
    render(<KvSidebar connectionId="redis-1" />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("current_kv_database", {
        connectionId: "redis-1",
      });
    });
    expect(scanRequests()).toHaveLength(0);
    expect(
      screen.queryByRole("combobox", { name: /redis database/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("redis-scan-status")).toHaveTextContent(
      /scan paused/i,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /safe mode paused automatic key scan/i,
    );
    expect(screen.queryByText("user:1")).not.toBeInTheDocument();
  });

  it("runs exactly one bounded entry scan when Safe Mode is off", async () => {
    useSafeModeStore.setState({ mode: "off" });

    render(<KvSidebar connectionId="redis-1" />);

    expect(await screen.findByText("user:1")).toBeInTheDocument();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("scan_kv_keys", {
        connectionId: "redis-1",
        queryId: undefined,
        request: {
          database: 0,
          cursor: "0",
          pattern: "*",
          limit: 100,
        },
      });
    });
    expect(scanRequests()).toHaveLength(1);
    expect(
      screen.getByRole("tree", { name: /redis keys/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("hash")).toBeInTheDocument();
    expect(screen.getByText("128 B")).toBeInTheDocument();
    expect(screen.queryByText(/loading value/i)).not.toBeInTheDocument();
  });

  it("renders a typed value envelope when a Redis key is selected", async () => {
    await renderAndScan();
    const tree = await screen.findByRole("tree", { name: /redis keys/i });
    const userKey = await within(tree).findByRole("treeitem", {
      name: /user:1/i,
    });

    fireEvent.click(userKey);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_kv_value", {
        connectionId: "redis-1",
        queryId: undefined,
        request: {
          database: 0,
          key: "user:1",
          limit: 100,
        },
      });
    });
    expect(screen.getByText(/name: Ada/)).toBeInTheDocument();
    expect(screen.getAllByText(/persistent/)).toHaveLength(2);
  });

  it("labels Valkey key browsing and hides mutation controls", async () => {
    useConnectionStore.setState({
      connections: [valkeyConnection()],
      activeStatuses: { "valkey-1": { type: "connected", activeDb: "0" } },
    });
    await renderAndScan("valkey-1");

    const tree = await screen.findByRole("tree", { name: /valkey keys/i });

    fireEvent.click(
      await within(tree).findByRole("treeitem", { name: /user:1/i }),
    );

    expect(await screen.findByText(/name: Ada/)).toBeInTheDocument();
    expect(screen.queryByText("Mutation")).not.toBeInTheDocument();
  });

  it("uses the toolbar active database for key scans", async () => {
    const { rerender } = render(<KvSidebar connectionId="redis-1" />);

    useConnectionStore.setState({
      activeStatuses: { "redis-1": { type: "connected", activeDb: "1" } },
    });
    rerender(<KvSidebar connectionId="redis-1" />);

    await clickScanButton();

    await waitFor(() => {
      const requests = scanRequests();
      expect(requests[requests.length - 1]).toMatchObject({ database: 1 });
    });
    expect(commandCalls("switch_kv_database")).toHaveLength(0);
  });

  it("waits for catalog before the Safe Mode off entry scan", async () => {
    useSafeModeStore.setState({ mode: "off" });
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([
          { name: "0", index: 0, keyCount: 0 },
          { name: "2", index: 2, keyCount: 1 },
        ]);
      }
      if (command === "current_kv_database") return Promise.resolve(2);
      if (command === "scan_kv_keys") {
        const database = (payload as { request: { database: number } }).request
          .database;
        if (database === 0) {
          return Promise.reject(new Error("stale DB 0 scan should not run"));
        }
        return Promise.resolve({
          ...defaultKeyPage(),
          database: 2,
          keys: [
            {
              key: "tv:string",
              keyType: "string",
              ttl: { state: "persistent" },
              length: 5,
              memoryBytes: 80,
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    render(<KvSidebar connectionId="redis-1" />);

    expect(await screen.findByText("tv:string")).toBeInTheDocument();
    expect(screen.getByTestId("redis-scan-status")).toHaveTextContent("1 key");
    expect(scanRequests()).toEqual([
      expect.objectContaining({
        database: 2,
        cursor: "0",
        limit: 100,
      }),
    ]);
  });

  it("names the pattern when a filtered key scan returns empty", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([{ name: "0", index: 0, keyCount: 0 }]);
      }
      if (command === "current_kv_database") return Promise.resolve(0);
      if (command === "scan_kv_keys") {
        return Promise.resolve({ ...defaultKeyPage(), keys: [] });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    render(<KvSidebar connectionId="redis-1" />);
    fireEvent.change(
      screen.getByRole("textbox", { name: /redis key pattern/i }),
      {
        target: { value: "session:*" },
      },
    );
    await clickScanButton();

    await waitFor(() => {
      const requests = scanRequests();
      expect(requests[requests.length - 1]).toMatchObject({
        database: 0,
        cursor: "0",
        pattern: "session:*",
        limit: 100,
      });
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /no keys match pattern session:\*/i,
      );
    });
  });

  it("exposes SCAN cursor state and appends the next page without blocking the first page", async () => {
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([{ name: "0", index: 0, keyCount: 2 }]);
      }
      if (command === "current_kv_database") return Promise.resolve(0);
      if (command === "scan_kv_keys") {
        const cursor = (payload as { request: { cursor: string } }).request
          .cursor;
        return Promise.resolve(
          cursor === "42"
            ? {
                ...defaultKeyPage(),
                cursor: "42",
                nextCursor: "0",
                done: true,
                keys: [
                  {
                    key: "session:2",
                    keyType: "string",
                    ttl: { state: "expires", seconds: 30 },
                    length: 5,
                    memoryBytes: 96,
                  },
                ],
              }
            : {
                ...defaultKeyPage(),
                nextCursor: "42",
                done: false,
              },
        );
      }
      if (command === "get_kv_value") {
        return Promise.resolve(defaultValueEnvelope());
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    await renderAndScan();

    expect(await screen.findByText("user:1")).toBeInTheDocument();
    expect(screen.getByTestId("redis-scan-status")).toHaveTextContent(
      /limit 100/i,
    );
    expect(screen.getByTestId("redis-scan-status")).toHaveTextContent(
      /cursor 42/i,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /more from cursor 42/i }),
    );

    expect(await screen.findByText("session:2")).toBeInTheDocument();
    const requests = scanRequests();
    expect(requests[requests.length - 1]).toMatchObject({
      cursor: "42",
      limit: 100,
    });
    expect(screen.getByText("user:1")).toBeInTheDocument();
  });

  it("renders stream metadata in the key row and value preview", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([{ name: "0", index: 0, keyCount: 1 }]);
      }
      if (command === "current_kv_database") return Promise.resolve(0);
      if (command === "scan_kv_keys") {
        return Promise.resolve({
          ...defaultKeyPage(),
          keys: [
            {
              key: "stream:events",
              keyType: "stream",
              ttl: { state: "expires", seconds: 60 },
              length: 2,
              memoryBytes: 256,
            },
          ],
        });
      }
      if (command === "get_kv_value") {
        return Promise.resolve(streamValueEnvelope());
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    await renderAndScan();
    const tree = await screen.findByRole("tree", { name: /redis keys/i });

    fireEvent.click(
      await within(tree).findByRole("treeitem", { name: /stream:events/i }),
    );

    expect(await screen.findByText("1-0")).toBeInTheDocument();
    expect(screen.getByText("type=login")).toBeInTheDocument();
    expect(screen.getByLabelText("Stream start")).toHaveValue("0-0");
    expect(screen.getByLabelText("Stream end")).toHaveValue("+");
    expect(screen.getByLabelText("Stream count")).toHaveValue(100);
    expect(
      screen.getByRole("table", { name: /stream:events stream entries/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("stream")).toHaveLength(2);
    expect(screen.getByText("2 item(s)")).toBeInTheDocument();
    expect(screen.getAllByText("256 B")).toHaveLength(2);
  });

  it("refreshes selected stream entries with bounded range controls", async () => {
    let resolveStreamRead: (value: unknown) => void = () => {};
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([{ name: "0", index: 0, keyCount: 1 }]);
      }
      if (command === "current_kv_database") return Promise.resolve(0);
      if (command === "scan_kv_keys") {
        return Promise.resolve({
          ...defaultKeyPage(),
          keys: [streamValueEnvelope().metadata],
        });
      }
      if (command === "get_kv_value") {
        return Promise.resolve(streamValueEnvelope());
      }
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

    await renderAndScan();
    const tree = await screen.findByRole("tree", { name: /redis keys/i });

    fireEvent.click(
      await within(tree).findByRole("treeitem", { name: /stream:events/i }),
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
      entries: [
        {
          id: "2-0",
          fields: [{ field: "type", value: "logout" }],
        },
      ],
      start: "1-0",
      end: "+",
      limit: 25,
    });

    expect(await screen.findByText("2-0")).toBeInTheDocument();
    expect(screen.getByText("type=logout")).toBeInTheDocument();
    expect(commandCalls("read_kv_stream")).toHaveLength(1);
    expect(commandCalls("execute_kv_command")).toHaveLength(0);
  });

  it("surfaces stream refresh errors without clearing the selected entries", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([{ name: "0", index: 0, keyCount: 1 }]);
      }
      if (command === "current_kv_database") return Promise.resolve(0);
      if (command === "scan_kv_keys") {
        return Promise.resolve({
          ...defaultKeyPage(),
          keys: [streamValueEnvelope().metadata],
        });
      }
      if (command === "get_kv_value") {
        return Promise.resolve(streamValueEnvelope());
      }
      if (command === "read_kv_stream") {
        return Promise.reject(new Error("XRANGE failed"));
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    await renderAndScan();
    const tree = await screen.findByRole("tree", { name: /redis keys/i });

    fireEvent.click(
      await within(tree).findByRole("treeitem", { name: /stream:events/i }),
    );
    expect(await screen.findByText("type=login")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /refresh stream entries/i }),
    );

    expect(await screen.findByText("XRANGE failed")).toBeInTheDocument();
    expect(screen.getByText("1-0")).toBeInTheDocument();
    expect(screen.getByText("type=login")).toBeInTheDocument();
  });

  it("surfaces key scan refresh errors", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([{ name: "0", index: 0, keyCount: 1 }]);
      }
      if (command === "current_kv_database") return Promise.resolve(0);
      if (command === "scan_kv_keys") {
        return Promise.reject(new Error("SCAN timeout"));
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    render(<KvSidebar connectionId="redis-1" />);
    await clickScanButton();

    expect(await screen.findByRole("alert")).toHaveTextContent("SCAN timeout");
    expect(screen.getByTestId("redis-scan-status")).toHaveTextContent("0 keys");
  });

  it("keeps loaded keys visible when loading the next SCAN cursor fails", async () => {
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([{ name: "0", index: 0, keyCount: 2 }]);
      }
      if (command === "current_kv_database") return Promise.resolve(0);
      if (command === "scan_kv_keys") {
        const cursor = (payload as { request: { cursor: string } }).request
          .cursor;
        if (cursor === "42") {
          return Promise.reject(new Error("SCAN cursor failed"));
        }
        return Promise.resolve({
          ...defaultKeyPage(),
          nextCursor: "42",
          done: false,
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    await renderAndScan();
    expect(await screen.findByText("user:1")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /more from cursor 42/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "SCAN cursor failed",
    );
    expect(screen.getByText("user:1")).toBeInTheDocument();
    expect(screen.getByTestId("redis-scan-status")).toHaveTextContent(
      /1 key · cursor 42/i,
    );
  });
});

function defaultKeyPage() {
  return {
    database: 0,
    cursor: "0",
    nextCursor: "0",
    done: true,
    limit: 100,
    keys: [
      {
        key: "user:1",
        keyType: "hash",
        ttl: { state: "persistent" },
        length: 2,
        memoryBytes: 128,
      },
    ],
  };
}

function defaultValueEnvelope(): KvValueEnvelope {
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

function streamValueEnvelope(): KvValueEnvelope {
  return {
    key: "stream:events",
    metadata: {
      key: "stream:events",
      keyType: "stream",
      ttl: { state: "expires", seconds: 60 },
      length: 2,
      memoryBytes: 256,
    },
    value: {
      type: "stream",
      key: "stream:events",
      entries: [
        {
          id: "1-0",
          fields: [{ field: "type", value: "login" }],
        },
      ],
      start: "0-0",
      end: "+",
      limit: 100,
    },
  };
}

function scanRequests() {
  return invokeMock.mock.calls
    .filter(([command]) => command === "scan_kv_keys")
    .map(([, payload]) => (payload as { request: unknown }).request);
}

function commandCalls(commandName: string) {
  return invokeMock.mock.calls.filter(([command]) => command === commandName);
}

async function renderAndScan(connectionId = "redis-1") {
  render(<KvSidebar connectionId={connectionId} />);
  await clickScanButton();
}

async function clickScanButton() {
  const scanButton = await screen.findByRole("button", {
    name: /scan 100 keys/i,
  });
  await waitFor(() => expect(scanButton).toBeEnabled());
  fireEvent.click(scanButton);
}
