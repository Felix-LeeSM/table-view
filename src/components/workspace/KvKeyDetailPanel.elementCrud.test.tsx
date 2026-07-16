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

// Purpose: #1466 element-level hash/list/set/zSet CRUD. New verbs (HDEL, LPUSH,
// LSET, LREM, SREM, ZREM) ride the same preview -> confirm -> executeKvCommand
// path and Safe Mode gate as the collection add axis. Split into its own file
// (the sibling mutations spec is at its max-lines ceiling).

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("KvKeyDetailPanel element CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
    useSafeModeStore.setState({ mode: "warn" });
  });

  // Non-destructive element writes (LPUSH prepend, LSET edit-at-index) pass the
  // Safe Mode gate without a destructive dialog even in strict mode.
  const ELEMENT_WRITE_CASES = [
    {
      name: "list LPUSH prepend",
      envelope: () => listValueEnvelope(),
      fills: [["List value", "head"]],
      preview: /preview lpush/i,
      confirm: /confirm lpush/i,
      command: "LPUSH user:1 head",
    },
    {
      name: "list LSET edit at index",
      envelope: () => listValueEnvelope(),
      fills: [
        ["List index", "0"],
        ["List value", "fixed"],
      ],
      preview: /preview lset/i,
      confirm: /confirm lset/i,
      command: "LSET user:1 0 fixed",
    },
  ];

  it.each(ELEMENT_WRITE_CASES)(
    "previews and confirms $name without a destructive dialog (strict)",
    async ({ envelope, fills, preview, confirm, command }) => {
      useSafeModeStore.setState({ mode: "strict" });
      mockRedisRuntime(envelope);

      renderPanel();
      await waitForValue();

      fillFields(fills as [string, string][]);
      fireEvent.click(screen.getByRole("button", { name: preview }));
      expect(await screen.findByRole("status")).toHaveTextContent(command);

      fireEvent.click(screen.getByRole("button", { name: confirm }));

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
          connectionId: "redis-1",
          queryId: undefined,
          request: { database: 0, command },
        });
      });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    },
  );

  // Destructive element removals dispatch directly in warn mode (non-prod).
  const ELEMENT_REMOVE_CASES = [
    {
      name: "hash HDEL",
      envelope: () => hashValueEnvelope(),
      fills: [["Hash field", "name"]],
      preview: /preview hdel/i,
      confirm: /confirm hdel/i,
      command: "HDEL user:1 name",
    },
    {
      name: "list LREM",
      envelope: () => listValueEnvelope(),
      fills: [
        ["List remove count", "1"],
        ["List value", "ready"],
      ],
      preview: /preview lrem/i,
      confirm: /confirm lrem/i,
      command: "LREM user:1 1 ready",
    },
    {
      name: "set SREM",
      envelope: () => setValueEnvelope(),
      fills: [["Set member", "alpha"]],
      preview: /preview srem/i,
      confirm: /confirm srem/i,
      command: "SREM user:1 alpha",
    },
    {
      name: "zSet ZREM",
      envelope: () => zSetValueEnvelope(),
      fills: [["ZSet member", "alpha"]],
      preview: /preview zrem/i,
      confirm: /confirm zrem/i,
      command: "ZREM user:1 alpha",
    },
  ];

  it.each(ELEMENT_REMOVE_CASES)(
    "previews and confirms $name in warn mode via bounded commands",
    async ({ envelope, fills, preview, confirm, command }) => {
      mockRedisRuntime(envelope);

      renderPanel();
      await waitForValue();

      fillFields(fills as [string, string][]);
      fireEvent.click(screen.getByRole("button", { name: preview }));
      expect(await screen.findByRole("status")).toHaveTextContent(command);
      expect(commandCalls("execute_kv_command")).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: confirm }));

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
          connectionId: "redis-1",
          queryId: undefined,
          request: { database: 0, command },
        });
      });
    },
  );

  it("routes a hash HDEL removal through the Safe Mode strict dialog", async () => {
    // strict + non-production + destructive element removal -> confirm dialog,
    // the same gate as key delete (#1466 AC2).
    useSafeModeStore.setState({ mode: "strict" });
    mockRedisRuntime(() => hashValueEnvelope());

    renderPanel();
    await waitForValue();

    fireEvent.change(screen.getByLabelText("Hash field"), {
      target: { value: "name" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview hdel/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm hdel/i }));

    expect(commandCalls("execute_kv_command")).toHaveLength(0);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/destructive statement/i);
    expect(dialog).toHaveTextContent(/hdel user:1 name/i);

    const confirmBtn = within(dialog).getByRole("button", { name: "Confirm" });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
        connectionId: "redis-1",
        queryId: undefined,
        request: { database: 0, command: "HDEL user:1 name" },
      });
    });
  });

  it("rejects a non-integer LSET index before dispatch", async () => {
    mockRedisRuntime(() => listValueEnvelope());

    renderPanel();
    await waitForValue();

    fireEvent.change(screen.getByLabelText("List index"), {
      target: { value: "1e3" },
    });
    fireEvent.change(screen.getByLabelText("List value"), {
      target: { value: "fixed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview lset/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /index must be an integer/i,
    );
    expect(commandCalls("execute_kv_command")).toHaveLength(0);
  });

  it("carries element CRUD verbs across the Valkey parity surface (#1075)", async () => {
    useConnectionStore.setState({
      connections: [valkeyConnection()],
      activeStatuses: { "valkey-1": { type: "connected", activeDb: "0" } },
    });
    mockRedisRuntime(() => setValueEnvelope());

    renderPanel("valkey-1");
    await waitForValue();

    fireEvent.change(screen.getByLabelText("Set member"), {
      target: { value: "alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview srem/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm srem/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
        connectionId: "valkey-1",
        queryId: undefined,
        request: { database: 0, command: "SREM user:1 alpha" },
      });
    });
  });
});

function fillFields(fills: [string, string][]) {
  for (const [label, value] of fills) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

function renderPanel(connectionId = "redis-1", keyName = "user:1") {
  render(
    <KvKeyDetailPanel
      connectionId={connectionId}
      database={0}
      keyName={keyName}
    />,
  );
}

async function waitForValue() {
  await screen.findByText("Mutation");
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

function valkeyConnection(): ConnectionConfig {
  return {
    ...redisConnection(),
    id: "valkey-1",
    name: "Valkey",
    dbType: "valkey",
  };
}

function mockRedisRuntime(envelope: () => KvValueEnvelope) {
  invokeMock.mockImplementation((command: string) => {
    if (command === "get_kv_value") return Promise.resolve(envelope());
    if (command === "execute_kv_command") {
      return Promise.resolve(mutationQueryResult());
    }
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

function hashValueEnvelope(): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: metadata("hash"),
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

function listValueEnvelope(): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: metadata("list"),
    value: { type: "list", entries: [{ index: 0, value: "ready" }], total: 1 },
  };
}

function setValueEnvelope(): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: metadata("set"),
    value: {
      type: "set",
      members: ["alpha"],
      cursor: "0",
      nextCursor: "0",
      done: true,
      total: 1,
    },
  };
}

function zSetValueEnvelope(): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: metadata("zSet"),
    value: { type: "zSet", entries: [{ member: "alpha", score: 1 }], total: 1 },
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

function commandCalls(command: string) {
  return invokeMock.mock.calls.filter(([called]) => called === command);
}
