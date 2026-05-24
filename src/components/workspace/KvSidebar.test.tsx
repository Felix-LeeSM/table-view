import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import KvSidebar from "./KvSidebar";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";

const listKvDatabasesMock = vi.fn();
const currentKvDatabaseMock = vi.fn();
const switchKvDatabaseMock = vi.fn();
const scanKvKeysMock = vi.fn();

vi.mock("@lib/tauri/kv", () => ({
  listKvDatabases: (...args: unknown[]) => listKvDatabasesMock(...args),
  currentKvDatabase: (...args: unknown[]) => currentKvDatabaseMock(...args),
  switchKvDatabase: (...args: unknown[]) => switchKvDatabaseMock(...args),
  scanKvKeys: (...args: unknown[]) => scanKvKeysMock(...args),
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
    listKvDatabasesMock.mockResolvedValue([
      { name: "0", index: 0, keyCount: 1 },
      { name: "1", index: 1, keyCount: 0 },
    ]);
    currentKvDatabaseMock.mockResolvedValue(0);
    switchKvDatabaseMock.mockImplementation(
      async (_connectionId: string, database: number) => database,
    );
    scanKvKeysMock.mockResolvedValue({
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
    });
  });

  it("requests Redis catalog and keys with a bounded scan limit", async () => {
    render(<KvSidebar connectionId="redis-1" />);

    await waitFor(() => {
      expect(listKvDatabasesMock).toHaveBeenCalledWith("redis-1");
      expect(currentKvDatabaseMock).toHaveBeenCalledWith("redis-1");
      expect(scanKvKeysMock).toHaveBeenCalledWith("redis-1", {
        database: 0,
        cursor: "0",
        pattern: "*",
        limit: 100,
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

  it("switches database through KV IPC and reloads keys", async () => {
    render(<KvSidebar connectionId="redis-1" />);
    const selector = await screen.findByRole("combobox", {
      name: /redis database/i,
    });

    fireEvent.click(selector);
    fireEvent.click(await screen.findByRole("option", { name: /DB 1/ }));

    await waitFor(() => {
      expect(switchKvDatabaseMock).toHaveBeenCalledWith("redis-1", 1);
      expect(scanKvKeysMock).toHaveBeenLastCalledWith("redis-1", {
        database: 1,
        cursor: "0",
        pattern: "*",
        limit: 100,
      });
    });
  });

  it("names the pattern when a filtered key scan returns empty", async () => {
    scanKvKeysMock.mockResolvedValue({
      database: 0,
      cursor: "0",
      nextCursor: "0",
      done: true,
      limit: 100,
      keys: [],
    });

    render(<KvSidebar connectionId="redis-1" />);
    fireEvent.change(
      screen.getByRole("textbox", { name: /redis key pattern/i }),
      {
        target: { value: "session:*" },
      },
    );

    await waitFor(() => {
      expect(scanKvKeysMock).toHaveBeenLastCalledWith("redis-1", {
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
