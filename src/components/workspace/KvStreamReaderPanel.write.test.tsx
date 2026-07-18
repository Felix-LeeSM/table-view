import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { KvStreamReaderPanel } from "./KvStreamReaderPanel";
import { executeKvCommand } from "@lib/tauri/kv";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { ConnectionConfig } from "@/types/connection";
import type { KvStreamReadResult } from "@/types/kv";

// Purpose: the append-only stream write surface (PR5b, #1683) — XADD add form,
// per-row XDEL, XTRIM MAXLEN, and copy-to-form. Streams have no in-place entry
// edit, so every write reuses the shared preview -> Safe Mode gate ->
// executeKvCommand path; XDEL/XTRIM are destructive (danger dialog), XADD is a
// warn-tier write, and the previewed string is exactly what executes.

vi.mock("@lib/tauri/kv", () => ({
  executeKvCommand: vi.fn().mockResolvedValue({}),
  readKvStream: vi.fn(),
}));

const executeMock = vi.mocked(executeKvCommand);

function streamValue(): KvStreamReadResult {
  return {
    type: "stream",
    key: "mystream",
    entries: [{ id: "1-0", fields: [{ field: "type", value: "login" }] }],
    start: "-",
    end: "+",
    limit: 100,
  };
}

function renderPanel(mutationEnabled = true) {
  const onMutationSuccess = vi.fn().mockResolvedValue(undefined);
  render(
    <KvStreamReaderPanel
      connectionId="redis-1"
      database={0}
      stream={streamValue()}
      mutationEnabled={mutationEnabled}
      onMutationSuccess={mutationEnabled ? onMutationSuccess : undefined}
    />,
  );
  return { onMutationSuccess };
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

describe("KvStreamReaderPanel write surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [redisConnection()] });
    useSafeModeStore.setState({ mode: "warn" });
  });

  it("appends an entry via XADD (warn dispatch, preview == execution)", async () => {
    const { onMutationSuccess } = renderPanel();

    fireEvent.change(screen.getByLabelText("Field"), {
      target: { value: "type" },
    });
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "login" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview xadd/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "XADD mystream * type login",
    );
    expect(executeMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirm xadd/i }));
    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith("redis-1", {
        database: 0,
        command: "XADD mystream * type login",
      });
    });
    await waitFor(() => expect(onMutationSuccess).toHaveBeenCalled());
  });

  it("deletes a whole entry via XDEL through the strict Safe Mode dialog", async () => {
    useSafeModeStore.setState({ mode: "strict" });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Delete entry 1-0" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "XDEL mystream 1-0",
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm xdel/i }));
    expect(executeMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/xdel mystream 1-0/i);
    const confirmBtn = within(dialog).getByRole("button", { name: "Confirm" });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith("redis-1", {
        database: 0,
        command: "XDEL mystream 1-0",
      });
    });
  });

  it("trims the log via XTRIM MAXLEN through the strict Safe Mode dialog", async () => {
    useSafeModeStore.setState({ mode: "strict" });
    renderPanel();

    fireEvent.change(screen.getByLabelText("Max length"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview xtrim/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "XTRIM mystream MAXLEN 50",
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm xtrim/i }));
    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", { name: "Confirm" });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith("redis-1", {
        database: 0,
        command: "XTRIM mystream MAXLEN 50",
      });
    });
  });

  it("rejects a non-integer trim length before preview", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Max length"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview xtrim/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      /non-negative integer/i,
    );
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("copies an entry's fields into the XADD add form with a fresh * id", async () => {
    renderPanel();

    fireEvent.click(
      screen.getByRole("button", { name: "Copy entry 1-0 into add form" }),
    );
    expect(screen.getByLabelText("Entry ID")).toHaveValue("*");
    expect(screen.getByLabelText("Field")).toHaveValue("type");
    expect(screen.getByLabelText("Value")).toHaveValue("login");

    fireEvent.click(screen.getByRole("button", { name: /preview xadd/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "XADD mystream * type login",
    );
  });

  it("stays read-only when mutation is disabled: no write surface, tree intact", () => {
    renderPanel(false);
    expect(
      screen.queryByRole("button", { name: /preview xadd/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete entry 1-0" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /copy entry/i }),
    ).not.toBeInTheDocument();
    // The read-only entry table still renders the entry id.
    expect(screen.getByText("1-0")).toBeInTheDocument();
  });
});
