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
import { useWorkspaceStore } from "@stores/workspaceStore";
import type { ConnectionConfig } from "@/types/connection";

// Purpose: KV key selection navigates to a right-hand detail tab instead of an
// inline sidebar preview — Redis/Valkey KV UX redesign (2026-07-07). Mirrors
// the search paradigm (SearchSidebar → addTab → MainArea detail panel).

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

describe("KvSidebar → detail tab navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
    useSafeModeStore.setState({ mode: "off" });
    invokeMock.mockImplementation((command: string) => {
      if (command === "current_kv_database") return Promise.resolve(0);
      if (command === "scan_kv_keys") {
        return Promise.resolve({
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
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });
  });

  // Reason: clicking a scanned key must open a kv-paradigm detail tab in the
  // workspace (the observable navigation), not just flip local sidebar state.
  it("opens a kv detail tab for the clicked key", async () => {
    render(<KvSidebar connectionId="redis-1" />);

    const tree = await screen.findByRole("tree", { name: /redis keys/i });
    fireEvent.click(
      await within(tree).findByRole("treeitem", { name: /user:1/i }),
    );

    await waitFor(() => {
      const tabs =
        useWorkspaceStore.getState().workspaces["redis-1"]?.["0"]?.tabs ?? [];
      const kvTab = tabs.find(
        (t) =>
          t.type === "table" && t.paradigm === "kv" && t.table === "user:1",
      );
      expect(kvTab).toBeDefined();
    });
  });
});
