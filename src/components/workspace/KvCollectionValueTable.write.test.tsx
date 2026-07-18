import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KvCollectionValueTable } from "./KvCollectionValueTable";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { ConnectionConfig } from "@/types/connection";
import type { KvHashValue, KvListValue, KvSetValue } from "@/types/kv";

// Purpose: KV JSON tree write for collections (PR4, 2026-07-18) — a mutable hash
// field / list element whose value is JSON is tree-editable in the chip dialog
// and Save → confirm issues the exact whole-value overwrite (HSET / LSET). These
// pin the two new command mappings through the real UI + Safe Mode gate, plus
// the data-safety invariant that without a write context the tree stays
// read-only. The pure 4-way mapping lives in kvMutationCommands.treeWrite.test.

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function hash(fields: { field: string; value: string }[]): KvHashValue {
  return {
    type: "hash",
    fields,
    cursor: "0",
    nextCursor: "0",
    done: true,
    total: fields.length,
  };
}

function list(entries: { index: number; value: string }[]): KvListValue {
  return { type: "list", entries, total: entries.length };
}

function set(members: string[]): KvSetValue {
  return {
    type: "set",
    members,
    cursor: "0",
    nextCursor: "0",
    done: true,
    total: members.length,
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

function writeContext(onWriteSuccess = vi.fn(() => Promise.resolve())) {
  return { connectionId: "redis-1", database: 0, onWriteSuccess };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Safe Mode off + non-production → the safe whole-value overwrite runs right
  // after the explicit Confirm; the command preview is the see-before-write
  // surface (no destructive dialog).
  useSafeModeStore.setState({ mode: "off" });
  useConnectionStore.setState({
    connections: [redisConnection()],
    activeStatuses: { "redis-1": { type: "connected", activeDb: "0" } },
  });
  invokeMock.mockImplementation((command: string) => {
    if (command === "execute_kv_command")
      return Promise.resolve({
        columns: [{ name: "command", data_type: "text", category: "text" }],
        rows: [["ok"]],
        total_count: 1,
        execution_time_ms: 1,
        query_type: "dml",
      });
    return Promise.resolve(undefined);
  });
});

describe("KvCollectionValueTable write (KV JSON tree)", () => {
  // Reason: PR4 hash path — edit a node inside a hash field's JSON value, Save,
  // Confirm, and the whole field value is re-serialized into one HSET command
  // through execute_kv_command (2026-07-18).
  it("edits a hash field JSON value and writes via HSET", async () => {
    const user = userEvent.setup();
    const onWriteSuccess = vi.fn(() => Promise.resolve());
    render(
      <KvCollectionValueTable
        keyName="user:1"
        value={hash([{ field: "profile", value: '{"plan":"pro"}' }])}
        writeContext={writeContext(onWriteSuccess)}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /expand profile value/i }),
    );
    await user.click(await screen.findByTestId("tree-leaf-plan"));
    const input = screen.getByTestId("tree-edit-plan");
    await user.clear(input);
    await user.type(input, '"enterprise"');
    await user.keyboard("{Enter}");

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(screen.getByLabelText(/command to run/i).textContent).toContain(
      "HSET user:1 profile",
    );
    await user.click(screen.getByRole("button", { name: /confirm write/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
        connectionId: "redis-1",
        queryId: undefined,
        request: {
          database: 0,
          command: 'HSET user:1 profile "{\\"plan\\":\\"enterprise\\"}"',
        },
      });
    });
    expect(onWriteSuccess).toHaveBeenCalledWith("user:1");
    // Non-production safe overwrite skips the destructive confirm dialog.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  // Reason: PR4 list path — edit a node inside a list element's JSON value and
  // write via LSET at the element's index (emitted raw as an integer operand)
  // (2026-07-18).
  it("edits a list element JSON value and writes via LSET at its index", async () => {
    const user = userEvent.setup();
    render(
      <KvCollectionValueTable
        keyName="queue"
        value={list([{ index: 2, value: '{"done":false}' }])}
        writeContext={writeContext()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /expand 2 value/i }));
    await user.click(await screen.findByTestId("tree-leaf-done"));
    const input = screen.getByTestId("tree-edit-done");
    await user.clear(input);
    await user.type(input, "true");
    await user.keyboard("{Enter}");

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await user.click(screen.getByRole("button", { name: /confirm write/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_kv_command", {
        connectionId: "redis-1",
        queryId: undefined,
        request: {
          database: 0,
          command: 'LSET queue 2 "{\\"done\\":true}"',
        },
      });
    });
  });

  // Reason: data safety — without a write context the collection cell tree stays
  // read-only; opening a JSON value offers no leaf editor and no Save, so no
  // overwrite path exists (2026-07-18).
  it("stays read-only when no write context is supplied", async () => {
    const user = userEvent.setup();
    render(
      <KvCollectionValueTable
        keyName="user:1"
        value={hash([{ field: "profile", value: '{"plan":"pro"}' }])}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /expand profile value/i }),
    );
    await user.click(await screen.findByTestId("tree-leaf-plan"));
    expect(screen.queryByTestId("tree-edit-plan")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "execute_kv_command",
      expect.anything(),
    );
  });

  // Reason: PR5a (#1683) — set members have no in-place edit, so even with a
  // write context the JSON value tree stays read-only (copy-to-form is the only
  // mutation path). Opening a JSON member offers no leaf editor and no Save.
  it("keeps a set member JSON value read-only even with a write context", async () => {
    const user = userEvent.setup();
    render(
      <KvCollectionValueTable
        keyName="tags"
        value={set(['{"plan":"pro"}'])}
        writeContext={writeContext()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /expand .* value/i }));
    await user.click(await screen.findByTestId("tree-leaf-plan"));
    expect(screen.queryByTestId("tree-edit-plan")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });
});
