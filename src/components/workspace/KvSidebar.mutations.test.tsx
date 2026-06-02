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
import type { KvValueEnvelope } from "@/types/kv";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("KvSidebar mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
  });

  it("previews and confirms string overwrite before refreshing the selected value", async () => {
    let text = "Ada";
    mockRedisRuntime(() => stringValueEnvelope(text), {
      set_kv_string_value: (payload) => {
        text = (payload as { request: { value: string } }).request.value;
        return { key: "user:1", changed: true, ttl: { state: "persistent" } };
      },
    });

    render(<KvSidebar connectionId="redis-1" />);
    await selectRenderedKey();

    fireEvent.change(screen.getByLabelText("String value"), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /preview string set/i }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /preview: set user:1/i,
    );
    expect(commandCalls("set_kv_string_value")).toHaveLength(0);

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

  it.each([
    {
      name: "hash",
      envelope: () => defaultValueEnvelope(),
      fills: [
        ["Hash field", "email"],
        ["Hash value", "ada@example.com"],
      ],
      preview: /preview hset/i,
      confirm: /confirm hset/i,
      command: "HSET user:1 email ada@example.com",
    },
    {
      name: "list",
      envelope: () => listValueEnvelope(),
      fills: [["List value", "queued"]],
      preview: /preview rpush/i,
      confirm: /confirm rpush/i,
      command: "RPUSH user:1 queued",
    },
    {
      name: "set",
      envelope: () => setValueEnvelope(),
      fills: [["Set member", "beta"]],
      preview: /preview sadd/i,
      confirm: /confirm sadd/i,
      command: "SADD user:1 beta",
    },
    {
      name: "zset",
      envelope: () => zSetValueEnvelope(),
      fills: [
        ["ZSet score", "9.5"],
        ["ZSet member", "ada"],
      ],
      preview: /preview zadd/i,
      confirm: /confirm zadd/i,
      command: "ZADD user:1 9.5 ada",
    },
  ])(
    "previews and confirms $name edits through bounded Redis commands",
    async ({ envelope, fills, preview, confirm, command }) => {
      mockRedisRuntime(envelope, {
        execute_kv_command: () => mutationQueryResult(),
      });

      render(<KvSidebar connectionId="redis-1" />);
      await selectRenderedKey();

      for (const [label, value] of fills as [string, string][]) {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      }
      fireEvent.click(screen.getByRole("button", { name: preview }));

      expect(screen.getByRole("status")).toHaveTextContent(command);
      expect(commandCalls("execute_kv_command")).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: confirm }));

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
          connectionId: "redis-1",
          queryId: undefined,
          request: { database: 0, command },
        });
      });
      expect(commandCalls("scan_kv_keys").length).toBeGreaterThan(1);
      expect(commandCalls("get_kv_value").length).toBeGreaterThan(1);
    },
  );

  it("previews and confirms expire, persist, and delete safety flows", async () => {
    mockRedisRuntime(defaultValueEnvelope());

    render(<KvSidebar connectionId="redis-1" />);
    await selectRenderedKey();

    fireEvent.change(screen.getByLabelText("Expire seconds"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview expire/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm expire/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_kv_ttl", {
        connectionId: "redis-1",
        request: {
          database: 0,
          key: "user:1",
          update: { mode: "expire", seconds: 60 },
        },
      });
    });

    fireEvent.change(screen.getByLabelText("Persist confirm key"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview persist/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/exact key/i);

    fireEvent.change(screen.getByLabelText("Persist confirm key"), {
      target: { value: "user:1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview persist/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm persist/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_kv_ttl", {
        connectionId: "redis-1",
        request: {
          database: 0,
          key: "user:1",
          update: { mode: "persist", confirmKey: "user:1" },
        },
      });
    });

    fireEvent.change(screen.getByLabelText("Delete confirm key"), {
      target: { value: "user:1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview delete/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_kv_key", {
        connectionId: "redis-1",
        request: { database: 0, key: "user:1", confirmKey: "user:1" },
      });
    });
  });

  it.each([
    [() => streamValueEnvelope(), /stream value mutation is unsupported/i],
    [
      () => partialHashValueEnvelope(),
      /partial hash previews cannot be mutated/i,
    ],
  ])(
    "fails unsupported or partial mutation surfaces clearly",
    async (envelope, message) => {
      mockRedisRuntime(envelope);

      render(<KvSidebar connectionId="redis-1" />);
      await selectRenderedKey();

      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(
        screen.queryByRole("button", { name: /preview delete/i }),
      ).not.toBeInTheDocument();
      expect(commandCalls("execute_kv_command")).toHaveLength(0);
    },
  );
});

type MutatingCommand =
  | "set_kv_string_value"
  | "execute_kv_command"
  | "delete_kv_key"
  | "update_kv_ttl";

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

function mockRedisRuntime(
  envelope: KvValueEnvelope | (() => KvValueEnvelope),
  handlers: Partial<
    Record<MutatingCommand, (payload: unknown) => unknown>
  > = {},
) {
  const currentEnvelope = () =>
    typeof envelope === "function" ? envelope() : envelope;
  invokeMock.mockImplementation((command: string, payload?: unknown) => {
    if (command === "list_kv_databases") {
      return Promise.resolve([{ name: "0", index: 0, keyCount: 1 }]);
    }
    if (command === "current_kv_database") return Promise.resolve(0);
    if (command === "scan_kv_keys") {
      return Promise.resolve({
        ...defaultKeyPage(),
        keys: [currentEnvelope().metadata],
      });
    }
    if (command === "get_kv_value") return Promise.resolve(currentEnvelope());
    if (command in handlers) {
      return Promise.resolve(handlers[command as MutatingCommand]?.(payload));
    }
    if (command === "execute_kv_command") {
      return Promise.resolve(mutationQueryResult());
    }
    if (
      command === "set_kv_string_value" ||
      command === "delete_kv_key" ||
      command === "update_kv_ttl"
    ) {
      return Promise.resolve({
        key: currentEnvelope().key,
        changed: true,
        ttl: { state: "persistent" },
      });
    }
    return Promise.reject(new Error(`Unhandled command: ${command}`));
  });
}

async function selectRenderedKey() {
  const tree = await screen.findByRole("tree", { name: /redis keys/i });
  fireEvent.click((await within(tree).findAllByRole("treeitem"))[0]!);
  await waitFor(() =>
    expect(screen.queryByText("Loading value")).not.toBeInTheDocument(),
  );
}

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

function stringValueEnvelope(text: string): KvValueEnvelope {
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

function listValueEnvelope(): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: {
      key: "user:1",
      keyType: "list",
      ttl: { state: "persistent" },
      length: 1,
    },
    value: { type: "list", entries: [{ index: 0, value: "ready" }], total: 1 },
  };
}

function setValueEnvelope(): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: {
      key: "user:1",
      keyType: "set",
      ttl: { state: "persistent" },
      length: 1,
    },
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
    metadata: {
      key: "user:1",
      keyType: "zSet",
      ttl: { state: "persistent" },
      length: 1,
    },
    value: { type: "zSet", entries: [{ member: "alpha", score: 1 }], total: 1 },
  };
}

function partialHashValueEnvelope(): KvValueEnvelope {
  return {
    ...defaultValueEnvelope(),
    value: {
      type: "hash",
      fields: [{ field: "name", value: "Ada" }],
      cursor: "0",
      nextCursor: "42",
      done: false,
      total: 2,
    },
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
