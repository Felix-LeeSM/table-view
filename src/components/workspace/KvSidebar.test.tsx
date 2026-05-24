import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import KvSidebar from "./KvSidebar";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";

const scanKvKeysMock = vi.fn();
const getKvValueMock = vi.fn();

vi.mock("@lib/tauri/kv", () => ({
  scanKvKeys: (...args: unknown[]) => scanKvKeysMock(...args),
  getKvValue: (...args: unknown[]) => getKvValueMock(...args),
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

// Purpose: Redis KV sidebar uses bounded SCAN and typed value envelopes
// instead of RDB schema assumptions (sprint 466-468, 2026-05-24).
describe("KvSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
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
        },
      ],
    });
    getKvValueMock.mockResolvedValue({
      key: "user:1",
      metadata: {
        key: "user:1",
        keyType: "hash",
        ttl: { state: "persistent" },
      },
      value: {
        type: "hash",
        fields: [{ field: "name", value: "Ada" }],
        cursor: "0",
        nextCursor: "0",
        done: true,
        total: 1,
      },
    });
  });

  it("requests keys with bounded scan limit on first render", async () => {
    // Reason: large keyspaces must not freeze the UI by enumerating all keys (2026-05-24).
    render(<KvSidebar connectionId="redis-1" />);

    await waitFor(() => {
      expect(scanKvKeysMock).toHaveBeenCalledWith("redis-1", {
        database: 0,
        cursor: "0",
        pattern: "*",
        limit: 100,
      });
    });
    expect(
      screen.getByRole("tree", { name: /redis keys/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: /user:1/i }),
    ).toBeInTheDocument();
  });

  it("renders typed value envelope when a key is selected", async () => {
    // Reason: KV value preview must render hash envelopes without table/schema data (2026-05-24).
    render(<KvSidebar connectionId="redis-1" />);
    const tree = await screen.findByRole("tree", { name: /redis keys/i });
    fireEvent.click(within(tree).getByRole("treeitem", { name: /user:1/i }));

    await waitFor(() => {
      expect(getKvValueMock).toHaveBeenCalledWith("redis-1", {
        database: 0,
        key: "user:1",
        limit: 100,
      });
    });
    expect(screen.getByText(/name: Ada/)).toBeInTheDocument();
    expect(screen.getByText(/persistent/)).toBeInTheDocument();
  });
});
