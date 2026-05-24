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
import type { ConnectionConfig } from "@/types/connection";

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

describe("KvSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([
          { name: "0", index: 0, keyCount: 1 },
          { name: "1", index: 1, keyCount: 0 },
        ]);
      }
      if (command === "current_kv_database") return Promise.resolve(0);
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

  it("requests Redis catalog and keys with a bounded scan limit", async () => {
    render(<KvSidebar connectionId="redis-1" />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("list_kv_databases", {
        connectionId: "redis-1",
      });
      expect(invokeMock).toHaveBeenCalledWith("current_kv_database", {
        connectionId: "redis-1",
      });
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
    expect(
      screen.getByRole("combobox", { name: /redis database/i }),
    ).toHaveTextContent("DB 0");
    expect(
      screen.getByRole("tree", { name: /redis keys/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("user:1")).toBeInTheDocument();
    expect(screen.getByText("hash")).toBeInTheDocument();
    expect(screen.getByText("128 B")).toBeInTheDocument();
    expect(screen.queryByText(/loading value/i)).not.toBeInTheDocument();
  });

  it("renders a typed value envelope when a Redis key is selected", async () => {
    render(<KvSidebar connectionId="redis-1" />);
    const tree = await screen.findByRole("tree", { name: /redis keys/i });

    fireEvent.click(within(tree).getByRole("treeitem", { name: /user:1/i }));

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

  it("switches database through KV IPC and reloads keys", async () => {
    render(<KvSidebar connectionId="redis-1" />);
    const selector = await screen.findByRole("combobox", {
      name: /redis database/i,
    });

    fireEvent.click(selector);
    fireEvent.click(await screen.findByRole("option", { name: /DB 1/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("switch_kv_database", {
        connectionId: "redis-1",
        database: 1,
      });
      const requests = scanRequests();
      expect(requests[requests.length - 1]).toMatchObject({
        database: 1,
        cursor: "0",
        pattern: "*",
        limit: 100,
      });
    });
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

    await waitFor(() => {
      const requests = scanRequests();
      expect(requests[requests.length - 1]).toMatchObject({
        database: 0,
        cursor: "0",
        pattern: "session:*",
        limit: 100,
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /no keys match pattern session:\*/i,
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

function defaultValueEnvelope() {
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

function scanRequests() {
  return invokeMock.mock.calls
    .filter(([command]) => command === "scan_kv_keys")
    .map(([, payload]) => (payload as { request: unknown }).request);
}
