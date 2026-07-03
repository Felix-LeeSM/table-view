import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import KvSidebar from "./KvSidebar";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { ConnectionConfig } from "@/types/connection";

/**
 * WAI-ARIA tree roving-tabindex + arrow-key navigation for the flat KV key
 * list (#1129). One tab stop, ArrowUp/Down move the anchor, Home/End jump.
 */

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

function keyRow(key: string) {
  return {
    key,
    keyType: "string" as const,
    ttl: { state: "persistent" as const },
    length: 3,
    memoryBytes: 64,
  };
}

function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe("KvSidebar roving tabindex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          keys: [keyRow("k:1"), keyRow("k:2"), keyRow("k:3")],
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });
  });

  async function renderScanned() {
    render(<KvSidebar connectionId="redis-1" />);
    await screen.findByText("k:1");
    return screen.getByRole("tree", { name: /redis keys/i });
  }

  it("puts exactly one key row in the tab order initially", async () => {
    const tree = await renderScanned();
    const items = within(tree).getAllByRole("treeitem");
    const tabbable = items.filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveTextContent("k:1");
  });

  it("ArrowDown moves focus + tabIndex to the next key row", async () => {
    const tree = await renderScanned();
    const first = within(tree).getByRole("treeitem", { name: /k:1/i });
    act(() => first.focus());

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await flushRaf();

    const second = within(tree).getByRole("treeitem", { name: /k:2/i });
    expect(second).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(second).toHaveFocus();
  });

  it("End jumps to the last key, Home back to the first", async () => {
    const tree = await renderScanned();
    const first = within(tree).getByRole("treeitem", { name: /k:1/i });
    act(() => first.focus());

    fireEvent.keyDown(tree, { key: "End" });
    await flushRaf();
    expect(within(tree).getByRole("treeitem", { name: /k:3/i })).toHaveFocus();

    fireEvent.keyDown(tree, { key: "Home" });
    await flushRaf();
    expect(first).toHaveFocus();
  });

  it("exposes aria-setsize/aria-posinset on key rows", async () => {
    const tree = await renderScanned();
    const rows = within(tree).getAllByRole("treeitem");
    expect(rows[0]).toHaveAttribute("aria-setsize", "3");
    expect(rows[0]).toHaveAttribute("aria-posinset", "1");
    expect(rows[2]).toHaveAttribute("aria-posinset", "3");
  });
});
