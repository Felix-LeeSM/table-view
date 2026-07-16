import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import KvKeyDetailPanel from "./KvKeyDetailPanel";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { ConnectionConfig } from "@/types/connection";
import type { KvValueEnvelope } from "@/types/kv";

// Purpose: #1415 inline per-row edit/delete on the structured collection table.
// Row actions must reuse the #1466 preview -> Safe Mode gate -> executeKvCommand
// path (no second mutation path) and surface the two hazards the coordinator
// flagged: last-entry GC (Redis drops the key) and LREM first-match on a list
// value duplicated across rows.

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("KvKeyDetailPanel inline entry CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
    useSafeModeStore.setState({ mode: "warn" });
  });

  it("deletes a hash field via the inline row action (warn dispatch)", async () => {
    mockRedisRuntime(() =>
      hashEnvelope(
        [
          { field: "name", value: "Ada" },
          { field: "city", value: "Paris" },
        ],
        2,
      ),
    );
    renderPanel();
    await waitForValue();

    fireEvent.click(screen.getByRole("button", { name: "Delete name" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "HDEL user:1 name",
    );
    expect(commandCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /confirm hdel/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
        connectionId: "redis-1",
        queryId: undefined,
        request: { database: 0, command: "HDEL user:1 name" },
      });
    });
  });

  it("routes an inline set member removal through the strict Safe Mode dialog", async () => {
    useSafeModeStore.setState({ mode: "strict" });
    mockRedisRuntime(() => setEnvelope(["alpha", "beta"], 2));
    renderPanel();
    await waitForValue();

    fireEvent.click(screen.getByRole("button", { name: "Delete alpha" }));
    fireEvent.click(screen.getByRole("button", { name: /confirm srem/i }));
    expect(commandCalls()).toHaveLength(0);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/srem user:1 alpha/i);
    const confirmBtn = within(dialog).getByRole("button", { name: "Confirm" });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
        connectionId: "redis-1",
        queryId: undefined,
        request: { database: 0, command: "SREM user:1 alpha" },
      });
    });
  });

  it("warns that deleting the only entry drops the key", async () => {
    mockRedisRuntime(() => hashEnvelope([{ field: "name", value: "Ada" }], 1));
    renderPanel();
    await waitForValue();

    fireEvent.click(screen.getByRole("button", { name: "Delete name" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/last entry/i);
  });

  it("warns that a duplicated list value removes the first match", async () => {
    mockRedisRuntime(() =>
      listEnvelope(
        [
          { index: 0, value: "a" },
          { index: 1, value: "a" },
          { index: 2, value: "b" },
        ],
        3,
      ),
    );
    renderPanel();
    await waitForValue();

    fireEvent.click(screen.getByRole("button", { name: "Delete 1" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("LREM user:1 1 a");
    expect(status).toHaveTextContent(/first matching value/i);
  });

  it("prefills the edit form from a zSet row and previews ZADD", async () => {
    mockRedisRuntime(() => zSetEnvelope([{ member: "alpha", score: 1 }], 1));
    renderPanel();
    await waitForValue();

    fireEvent.click(screen.getByRole("button", { name: "Edit alpha" }));
    expect(screen.getByLabelText("ZSet score")).toHaveValue("1");
    expect(screen.getByLabelText("ZSet member")).toHaveValue("alpha");

    fireEvent.change(screen.getByLabelText("ZSet score"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview zadd/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm zadd/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
        connectionId: "redis-1",
        queryId: undefined,
        request: { database: 0, command: "ZADD user:1 5 alpha" },
      });
    });
  });

  it("offers no inline edit action for immutable set members", async () => {
    mockRedisRuntime(() => setEnvelope(["alpha"], 1));
    renderPanel();
    await waitForValue();

    expect(
      screen.getByRole("button", { name: "Delete alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit alpha" }),
    ).not.toBeInTheDocument();
  });

  it("hides inline actions for a partially loaded collection", async () => {
    mockRedisRuntime(() => ({
      key: "user:1",
      metadata: metadata("hash"),
      value: {
        type: "hash",
        fields: [{ field: "name", value: "Ada" }],
        cursor: "0",
        nextCursor: "1024",
        done: false,
        total: 9000,
      },
    }));
    renderPanel();
    await screen.findByRole("table", { name: /user:1 hash/i });

    expect(
      screen.queryByRole("button", { name: "Delete name" }),
    ).not.toBeInTheDocument();
  });
});

function renderPanel() {
  render(
    <KvKeyDetailPanel connectionId="redis-1" database={0} keyName="user:1" />,
  );
}

async function waitForValue() {
  await screen.findByRole("table");
}

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

function mockRedisRuntime(envelope: () => KvValueEnvelope) {
  invokeMock.mockImplementation((command: string) => {
    if (command === "get_kv_value") return Promise.resolve(envelope());
    if (command === "execute_kv_command")
      return Promise.resolve(mutationQueryResult());
    return Promise.reject(new Error(`Unhandled command: ${command}`));
  });
}

function metadata(keyType: KvValueEnvelope["metadata"]["keyType"]) {
  return {
    key: "user:1",
    keyType,
    ttl: { state: "persistent" as const },
    length: 1,
  };
}

function hashEnvelope(
  fields: { field: string; value: string }[],
  total: number,
): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: metadata("hash"),
    value: {
      type: "hash",
      fields,
      cursor: "0",
      nextCursor: "0",
      done: true,
      total,
    },
  };
}

function listEnvelope(
  entries: { index: number; value: string }[],
  total: number,
): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: metadata("list"),
    value: { type: "list", entries, total },
  };
}

function setEnvelope(members: string[], total: number): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: metadata("set"),
    value: {
      type: "set",
      members,
      cursor: "0",
      nextCursor: "0",
      done: true,
      total,
    },
  };
}

function zSetEnvelope(
  entries: { member: string; score: number }[],
  total: number,
): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: metadata("zSet"),
    value: { type: "zSet", entries, total },
  };
}

function mutationQueryResult() {
  return {
    columns: [{ name: "command", data_type: "text", category: "text" }],
    rows: [["ok"]],
    total_count: 1,
    execution_time_ms: 1,
    query_type: "dml",
  };
}

function commandCalls() {
  return invokeMock.mock.calls.filter(
    ([called]) => called === "execute_kv_command",
  );
}
