import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KvValueBody } from "./KvValueBody";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { ConnectionConfig } from "@/types/connection";
import type { KvValueEnvelope } from "@/types/kv";

// Purpose: KV JSON tree write core (PR3, 2026-07-18) — a single-value key whose
// value is JSON (`string` JSON or native `json`/ReJSON) is node-editable in the
// tree and Save → confirm → issues the exact overwrite command. These cases pin
// the write contract (correct command string, correct Tauri command) and the
// data-safety invariant that non-JSON / no-context values never get an editor.

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function jsonEnvelope(value: unknown): KvValueEnvelope {
  return {
    key: "doc:1",
    metadata: { key: "doc:1", keyType: "json", ttl: { state: "persistent" } },
    value: { type: "json", value },
  };
}

function utf8Envelope(text: string): KvValueEnvelope {
  return {
    key: "doc:1",
    metadata: { key: "doc:1", keyType: "string", ttl: { state: "persistent" } },
    value: { type: "string", encoding: "utf8", text, byteLength: text.length },
  };
}

function binaryEnvelope(hex: string): KvValueEnvelope {
  return {
    key: "doc:1",
    metadata: { key: "doc:1", keyType: "string", ttl: { state: "persistent" } },
    value: {
      type: "string",
      encoding: "binary",
      hex,
      byteLength: hex.length / 2,
    },
  };
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
    environment: "development",
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

function writeProps(onWriteSuccess = vi.fn(() => Promise.resolve())) {
  return {
    connectionId: "redis-1",
    database: 0,
    mutationEnabled: true,
    onWriteSuccess,
  };
}

describe("KvValueBody write (KV JSON tree)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Safe Mode off + non-production → a safe overwrite is allowed after the
    // explicit Confirm, so no confirm dialog; the command preview is the
    // see-before-write surface.
    useSafeModeStore.setState({ mode: "off" });
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "execute_kv_command")
        return Promise.resolve(mutationQueryResult());
      if (command === "set_kv_string_value")
        return Promise.resolve({
          key: "doc:1",
          changed: true,
          ttl: { state: "persistent" },
        });
      return Promise.resolve(undefined);
    });
  });

  // Reason: the ReJSON write path — edit a node, Save, Confirm, and the whole
  // value is re-serialized into a single `JSON.SET key $ <json>` executed
  // through the existing execute_kv_command bridge (2026-07-18).
  it("edits a json node and writes the whole value via JSON.SET", async () => {
    const user = userEvent.setup();
    const onWriteSuccess = vi.fn(() => Promise.resolve());
    render(
      <KvValueBody
        envelope={jsonEnvelope({ name: "Ada", active: true })}
        {...writeProps(onWriteSuccess)}
      />,
    );

    await user.click(screen.getByTestId("tree-leaf-name"));
    const input = screen.getByTestId("tree-edit-name");
    await user.clear(input);
    await user.type(input, '"Bob"');
    await user.keyboard("{Enter}");

    // Nothing has run yet — the command is only built + previewed on Save.
    expect(invokeMock).not.toHaveBeenCalledWith(
      "execute_kv_command",
      expect.anything(),
    );

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(screen.getByLabelText(/command to run/i).textContent).toContain(
      "JSON.SET doc:1 $",
    );
    await user.click(screen.getByRole("button", { name: /confirm write/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
        connectionId: "redis-1",
        queryId: undefined,
        request: {
          database: 0,
          command:
            'JSON.SET doc:1 $ "{\\"name\\":\\"Bob\\",\\"active\\":true}"',
        },
      });
    });
    expect(onWriteSuccess).toHaveBeenCalledWith("doc:1");
    // Non-production safe overwrite skips the destructive confirm dialog.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  // Reason: a `string` key holding JSON reuses the dedicated set_kv_string_value
  // command, sending the re-serialized JSON verbatim (number stays a number).
  it("edits a JSON-string node and writes via set_kv_string_value", async () => {
    const user = userEvent.setup();
    render(
      <KvValueBody envelope={utf8Envelope('{"n":1}')} {...writeProps()} />,
    );

    await user.click(screen.getByTestId("tree-leaf-n"));
    const input = screen.getByTestId("tree-edit-n");
    await user.clear(input);
    await user.type(input, "2");
    await user.keyboard("{Enter}");

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await user.click(screen.getByRole("button", { name: /confirm write/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_kv_string_value", {
        connectionId: "redis-1",
        request: {
          database: 0,
          key: "doc:1",
          value: '{"n":2}',
          safety: "allowOverwrite",
        },
      });
    });
  });

  // Reason: discarding clears the pending edits without ever touching Redis.
  it("discards pending edits without writing", async () => {
    const user = userEvent.setup();
    render(
      <KvValueBody
        envelope={jsonEnvelope({ name: "Ada" })}
        {...writeProps()}
      />,
    );

    await user.click(screen.getByTestId("tree-leaf-name"));
    await user.clear(screen.getByTestId("tree-edit-name"));
    await user.type(screen.getByTestId("tree-edit-name"), '"Bob"');
    await user.keyboard("{Enter}");

    await user.click(screen.getByRole("button", { name: /discard/i }));

    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "execute_kv_command",
      expect.anything(),
    );
  });

  // Reason: data safety — without a wired write context the tree stays
  // read-only; clicking a leaf opens no editor and offers no Save.
  it("stays read-only when no write context is supplied", async () => {
    const user = userEvent.setup();
    render(<KvValueBody envelope={jsonEnvelope({ name: "Ada" })} />);

    await user.click(screen.getByTestId("tree-leaf-name"));
    expect(screen.queryByTestId("tree-edit-name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });

  // Reason: data safety — a binary (non-JSON) string is never editable even
  // with full write context; it renders raw hex with no tree/editor.
  it("keeps a binary string read-only even with write context", () => {
    render(
      <KvValueBody envelope={binaryEnvelope("deadbeef")} {...writeProps()} />,
    );
    expect(screen.queryByTestId("document-tree-panel")).not.toBeInTheDocument();
    expect(screen.getByText("deadbeef")).toBeInTheDocument();
  });
});
