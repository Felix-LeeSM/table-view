import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ImportExportDialog from "./ImportExportDialog";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";

const ENCRYPTED_PAYLOAD =
  '{"v":1,"kdf":"argon2id","salt":"AAAA","nonce":"AAAA","alg":"aes-256-gcm","ciphertext":"AAAA","tag_attached":true}';

function makeConn(id: string, hasPassword = false): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

function liveRegions(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>('[role="alert"]'),
    ...document.querySelectorAll<HTMLElement>('[role="status"]'),
    ...document.querySelectorAll<HTMLElement>("[aria-live]"),
  ];
}

function expectSecretAbsent(secret: string) {
  const encoded = encodeURIComponent(secret);
  for (const region of liveRegions()) {
    const text = region.textContent ?? "";
    expect(text).not.toContain(secret);
    expect(text).not.toContain(encoded);
  }
}

beforeEach(() => {
  setupTauriMock({
    exportConnections: vi.fn(),
    importConnections: vi.fn(),
    exportConnectionsEncrypted: vi.fn(),
    importConnectionsEncrypted: vi.fn(),
  });
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(() => Promise.resolve()) },
    configurable: true,
  });
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    loadConnections: vi.fn().mockResolvedValue(undefined),
    loadGroups: vi.fn().mockResolvedValue(undefined),
  });
});

describe("ImportExportDialog critical accessibility smoke", () => {
  it("exposes export selection controls and empty-selection status", async () => {
    useConnectionStore.setState({ connections: [makeConn("c1", true)] });
    render(<ImportExportDialog onClose={vi.fn()} />);

    expect(
      screen.getByRole("checkbox", { name: "Select all (1)" }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Generate encrypted export" }),
    ).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select all (1)" }));
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Select at least one connection.",
    );
    expect(
      screen.getByRole("button", { name: "Generate encrypted export" }),
    ).toBeDisabled();
  });

  it("keeps recovery phrases out of import alert/status/live feedback", async () => {
    const { importConnectionsEncrypted } = await import("@lib/tauri");
    const secret = "pass@123ZZ recovery phrase";
    (importConnectionsEncrypted as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error(`decrypt failed for ${secret} / ${encodeURIComponent(secret)}`),
    );

    render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Import JSON input"), {
        target: { value: ENCRYPTED_PAYLOAD },
      });
      fireEvent.change(screen.getByLabelText("Recovery phrase"), {
        target: { value: secret },
      });
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/decrypt failed/i);
    });
    expectSecretAbsent(secret);
  });
});
