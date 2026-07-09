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
import { KvMutationPanel } from "./KvMutationPanel";

// Purpose: KV mutation surface now lives in the right-hand KvKeyDetailPanel
// (moved out of KvSidebar in the 2026-07-07 KV UX redesign). These cases
// migrate the sidebar's mutation coverage to the panel: preview → confirm →
// bounded IPC, Safe Mode gating, and unsupported-surface messaging.

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Redis and Valkey share the same bounded collection-write surface (#1075).
const COLLECTION_EDIT_CASES = [
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
];

describe("KvKeyDetailPanel mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
    useSafeModeStore.setState({ mode: "strict" });
  });

  it("previews and confirms string overwrite before refreshing the selected value", async () => {
    let text = "Ada";
    mockRedisRuntime(() => stringValueEnvelope(text), {
      set_kv_string_value: (payload) => {
        text = (payload as { request: { value: string } }).request.value;
        return { key: "user:1", changed: true, ttl: { state: "persistent" } };
      },
    });

    renderPanel();
    await waitForValue();

    fireEvent.change(screen.getByLabelText("String value"), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /preview string set/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
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

  it("enables Valkey direct string set, expire, persist, and delete controls", async () => {
    let text = "Ada";
    useSafeModeStore.setState({ mode: "warn" });
    useConnectionStore.setState({
      connections: [valkeyConnection()],
      activeStatuses: { "valkey-1": { type: "connected", activeDb: "0" } },
    });
    mockRedisRuntime(() => stringValueEnvelope(text), {
      set_kv_string_value: (payload) => {
        text = (payload as { request: { value: string } }).request.value;
        return { key: "user:1", changed: true, ttl: { state: "persistent" } };
      },
    });

    renderPanel("valkey-1");
    await waitForValue();

    expect(screen.getByText("Mutation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /preview string set/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /preview expire/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /preview persist/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /preview delete/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /preview hset|rpush|sadd|zadd/i }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("String value"), {
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
        connectionId: "valkey-1",
        request: {
          database: 0,
          key: "user:1",
          value: "Grace Hopper",
          safety: "allowOverwrite",
        },
      });
    });

    fireEvent.change(screen.getByLabelText("Expire seconds"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview expire/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm expire/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_kv_ttl", {
        connectionId: "valkey-1",
        request: {
          database: 0,
          key: "user:1",
          update: { mode: "expire", seconds: 60 },
        },
      });
    });

    fireEvent.change(screen.getByLabelText("Persist confirm key"), {
      target: { value: "user:1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview persist/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm persist/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_kv_ttl", {
        connectionId: "valkey-1",
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
        connectionId: "valkey-1",
        request: { database: 0, key: "user:1", confirmKey: "user:1" },
      });
    });
    expect(commandCalls("execute_kv_command")).toHaveLength(0);
  });

  it("surfaces selected-key workbench actions and keeps create-key unsupported", async () => {
    mockRedisRuntime(stringValueEnvelope("Ada"));

    renderPanel();

    const newKeyAction = screen.getByRole("button", {
      name: /new key \(unsupported\)/i,
    });
    expect(newKeyAction).toBeDisabled();

    await waitForValue();

    const editAction = screen.getByRole("button", {
      name: /edit selected key/i,
    });
    expect(editAction).toBeEnabled();
    fireEvent.click(editAction);
    expect(screen.getByLabelText("String value")).toHaveFocus();

    const deleteAction = screen.getByRole("button", {
      name: /delete selected key/i,
    });
    expect(deleteAction).toBeEnabled();
    fireEvent.click(deleteAction);
    expect(screen.getByLabelText("Delete confirm key")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("Delete confirm key"), {
      target: { value: "user:1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview delete/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

    expect(commandCalls("delete_kv_key")).toHaveLength(0);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/kv delete key user:1/i);
  });

  it("keeps a dirty string draft when a same-key value refresh arrives before preview", async () => {
    mockRedisRuntime(stringValueEnvelope("Ada"));

    const onMutationSuccess = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <KvMutationPanel
        value={stringValueEnvelope("Ada")}
        connectionId="redis-1"
        database={0}
        onMutationSuccess={onMutationSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText("String value"), {
      target: { value: "Grace Hopper" },
    });
    rerender(
      <KvMutationPanel
        value={stringValueEnvelope("Ada")}
        connectionId="redis-1"
        database={0}
        onMutationSuccess={onMutationSuccess}
      />,
    );

    expect(screen.getByDisplayValue("Grace Hopper")).toBeInTheDocument();
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
  });

  it.each(COLLECTION_EDIT_CASES)(
    "previews and confirms $name edits through bounded Redis commands",
    async ({ envelope, fills, preview, confirm, command }) => {
      mockRedisRuntime(envelope, {
        execute_kv_command: () => mutationQueryResult(),
      });

      renderPanel();
      await waitForValue();

      for (const [label, value] of fills as [string, string][]) {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      }
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
      // Panel reloads its own value after a successful mutation (the sidebar
      // list refresh is a separate, user-driven Scan).
      expect(commandCalls("get_kv_value").length).toBeGreaterThan(1);
    },
  );

  it.each(COLLECTION_EDIT_CASES)(
    "previews and confirms Valkey $name edits through bounded commands (parity #1075)",
    async ({ envelope, fills, preview, confirm, command }) => {
      useConnectionStore.setState({
        connections: [valkeyConnection()],
        activeStatuses: { "valkey-1": { type: "connected", activeDb: "0" } },
      });
      mockRedisRuntime(envelope, {
        execute_kv_command: () => mutationQueryResult(),
      });

      renderPanel("valkey-1");
      await waitForValue();

      expect(screen.getByText("Mutation")).toBeInTheDocument();
      for (const [label, value] of fills as [string, string][]) {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      }
      fireEvent.click(screen.getByRole("button", { name: preview }));

      expect(await screen.findByRole("status")).toHaveTextContent(command);
      expect(commandCalls("execute_kv_command")).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: confirm }));

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
          connectionId: "valkey-1",
          queryId: undefined,
          request: { database: 0, command },
        });
      });
    },
  );

  it("previews and confirms expire, persist, and delete safety flows", async () => {
    useSafeModeStore.setState({ mode: "warn" });
    mockRedisRuntime(defaultValueEnvelope());

    renderPanel();
    await waitForValue();

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
    ["strict", "development", true],
    ["warn", "development", false],
    ["off", "development", false],
    ["off", "production", true],
  ] as const)(
    "routes Redis delete through Safe Mode %s on %s before backend mutation",
    async (mode, environment, expectsDialog) => {
      useSafeModeStore.setState({ mode });
      useConnectionStore.setState({
        connections: [{ ...redisConnection(), environment }],
        activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
      });
      mockRedisRuntime(defaultValueEnvelope());

      renderPanel();
      await waitForValue();

      fireEvent.change(screen.getByLabelText("Delete confirm key"), {
        target: { value: "user:1" },
      });
      fireEvent.click(screen.getByRole("button", { name: /preview delete/i }));
      fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

      if (expectsDialog) {
        expect(commandCalls("delete_kv_key")).toHaveLength(0);
        const dialog = await screen.findByRole("alertdialog");
        expect(dialog).toHaveTextContent(
          environment === "production"
            ? /production database/i
            : /destructive statement/i,
        );
        expect(dialog).toHaveTextContent(/kv delete key user:1/i);

        const confirmBtn = within(dialog).getByRole("button", {
          name: "Confirm",
        });
        // #1111 — Confirm arms after a short delay; wait before clicking.
        await waitFor(() => expect(confirmBtn).not.toBeDisabled());
        fireEvent.click(confirmBtn);
      }

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith("delete_kv_key", {
          connectionId: "redis-1",
          request: { database: 0, key: "user:1", confirmKey: "user:1" },
        });
      });
    },
  );

  it("keeps Redis string overwrite on the non-destructive Safe Mode path", async () => {
    useSafeModeStore.setState({ mode: "strict" });
    let text = "Ada";
    mockRedisRuntime(() => stringValueEnvelope(text), {
      set_kv_string_value: (payload) => {
        text = (payload as { request: { value: string } }).request.value;
        return { key: "user:1", changed: true, ttl: { state: "persistent" } };
      },
    });

    renderPanel();
    await waitForValue();

    fireEvent.change(screen.getByLabelText("String value"), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /preview string set/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm string set/i }),
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
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
  });

  it.each([
    [
      () => streamValueEnvelope(),
      "stream:events",
      /stream value mutation is unsupported/i,
    ],
    [
      () => partialHashValueEnvelope(),
      "user:1",
      /partial hash previews cannot be mutated/i,
    ],
  ])(
    "fails unsupported or partial mutation surfaces clearly",
    async (envelope, keyName, message) => {
      mockRedisRuntime(envelope);

      renderPanel("redis-1", keyName as string);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        message as RegExp,
      );
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

function mockRedisRuntime(
  envelope: KvValueEnvelope | (() => KvValueEnvelope),
  handlers: Partial<
    Record<MutatingCommand, (payload: unknown) => unknown>
  > = {},
) {
  const currentEnvelope = () =>
    typeof envelope === "function" ? envelope() : envelope;
  invokeMock.mockImplementation((command: string, payload?: unknown) => {
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
