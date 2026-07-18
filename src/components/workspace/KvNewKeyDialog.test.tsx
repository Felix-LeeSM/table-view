import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import KvNewKeyDialog from "./KvNewKeyDialog";
import { executeKvCommand, getKvValue, setKvStringValue } from "@lib/tauri/kv";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { ConnectionConfig } from "@/types/connection";
import type { KvValueEnvelope } from "@/types/kv";

// Purpose: the new-key composer must block creation when the target key already
// exists (aggregate writes MERGE into an existing key) and, on success, hand the
// new key to `onCreated` (which opens its detail tab). Mocked at the kv lib
// boundary only (testing-scenarios P6).

vi.mock("@lib/tauri/kv", () => ({
  getKvValue: vi.fn(),
  executeKvCommand: vi.fn(),
  setKvStringValue: vi.fn(),
}));

const getKvValueMock = vi.mocked(getKvValue);
const executeKvCommandMock = vi.mocked(executeKvCommand);
const setKvStringValueMock = vi.mocked(setKvStringValue);

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
    environment: "local",
  };
}

function envelope(value: KvValueEnvelope["value"]): KvValueEnvelope {
  return {
    key: "user:1",
    metadata: { key: "user:1", keyType: "string", ttl: { state: "missing" } },
    value,
  };
}

function renderDialog(onCreated = vi.fn()) {
  const onClose = vi.fn();
  render(
    <KvNewKeyDialog
      connectionId="redis-1"
      database={0}
      onClose={onClose}
      onCreated={onCreated}
    />,
  );
  return { onCreated, onClose };
}

// Drive the composer into a valid single-member set create.
function fillSetForm(member = "alpha") {
  fireEvent.click(screen.getByRole("button", { name: /^set$/ }));
  fireEvent.change(screen.getByLabelText("Key name"), {
    target: { value: "user:1" },
  });
  fireEvent.change(screen.getByLabelText("Member 1"), {
    target: { value: member },
  });
}

describe("KvNewKeyDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [redisConnection()],
      activeStatuses: {},
    });
    useSafeModeStore.setState({ mode: "off" });
    executeKvCommandMock.mockResolvedValue(undefined as never);
    setKvStringValueMock.mockResolvedValue(undefined as never);
  });

  it("blocks creation when the key already exists, leaving the value unchanged", async () => {
    // Existing key → getKvValue returns a non-missing envelope.
    getKvValueMock.mockResolvedValue(
      envelope({
        type: "set",
        members: ["x"],
        cursor: "0",
        nextCursor: "0",
        done: true,
        total: 1,
      }),
    );
    const { onCreated } = renderDialog();

    fillSetForm();
    fireEvent.click(screen.getByRole("button", { name: /create key/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /user:1 already exists/i,
    );
    // The merge command never runs, so the existing value is untouched.
    expect(executeKvCommandMock).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("creates a new key and hands it to onCreated for the detail tab", async () => {
    // Missing key → safe to create.
    getKvValueMock.mockResolvedValue(envelope({ type: "missing" }));
    const { onCreated } = renderDialog();

    fillSetForm("alpha");
    fireEvent.click(screen.getByRole("button", { name: /create key/i }));

    await waitFor(() => {
      expect(executeKvCommandMock).toHaveBeenCalledWith("redis-1", {
        database: 0,
        command: "SADD user:1 alpha",
      });
    });
    expect(onCreated).toHaveBeenCalledWith("user:1");
  });
});
