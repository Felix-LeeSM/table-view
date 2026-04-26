import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import ImportExportDialog from "./ImportExportDialog";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";

vi.mock("@lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/tauri")>("@lib/tauri");
  return {
    ...actual,
    exportConnections: vi.fn(),
    importConnections: vi.fn(),
    exportConnectionsEncrypted: vi.fn(),
    importConnectionsEncrypted: vi.fn(),
  };
});

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
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

function makeConn(id: string, hasPw = false): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: hasPw,
    database: "test",
    group_id: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

/** Helper: type a value into a labelled input via fireEvent.change. */
function typeInto(label: RegExp | string, value: string) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

const VALID_PW = "open-sesame!";

describe("ImportExportDialog", () => {
  describe("Export", () => {
    it("renders 'No connections to export' when store is empty", () => {
      render(<ImportExportDialog onClose={vi.fn()} />);
      expect(screen.getByText(/no connections to export/i)).toBeInTheDocument();
    });

    it("lists all connections with select-all checked by default", () => {
      useConnectionStore.setState({
        connections: [makeConn("c1"), makeConn("c2", true)],
      });
      render(<ImportExportDialog onClose={vi.fn()} />);
      expect(screen.getByText(/select all \(2\)/i)).toBeInTheDocument();
      expect(screen.getByText("c1 DB")).toBeInTheDocument();
      expect(screen.getByText("c2 DB")).toBeInTheDocument();
      // pw badge for c2
      expect(screen.getByText(/pw set/i)).toBeInTheDocument();
    });

    it("calls exportConnectionsEncrypted with selected ids and master password and shows JSON", async () => {
      const { exportConnectionsEncrypted } = await import("@lib/tauri");
      const envelopeJson =
        '{"v":1,"kdf":"argon2id","salt":"AAAA","nonce":"AAAA","alg":"aes-256-gcm","ciphertext":"AAAA","tag_attached":true}';
      (
        exportConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockResolvedValue(envelopeJson);

      useConnectionStore.setState({
        connections: [makeConn("c1"), makeConn("c2")],
      });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        typeInto(/^master password$/i, VALID_PW);
      });

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /generate encrypted json/i }),
        );
      });

      expect(exportConnectionsEncrypted).toHaveBeenCalledWith(
        ["c1", "c2"],
        VALID_PW,
      );
      expect(
        screen.getByLabelText("Generated export JSON"),
      ).toBeInTheDocument();
      expect(
        (screen.getByLabelText("Generated export JSON") as HTMLTextAreaElement)
          .value,
      ).toContain("kdf");
    });

    it("Generate button is disabled when 0 connections are selected", async () => {
      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      // Provide a valid password first so password length is not the blocker.
      await act(async () => {
        typeInto(/^master password$/i, VALID_PW);
      });
      // Uncheck the only connection via select-all
      await act(async () => {
        fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
      });
      expect(
        screen.getByRole("button", { name: /generate encrypted json/i }),
      ).toBeDisabled();
    });

    it("Generate button is disabled when password is shorter than 8 characters", async () => {
      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        typeInto(/^master password$/i, "short");
      });
      expect(
        screen.getByRole("button", { name: /generate encrypted json/i }),
      ).toBeDisabled();
    });

    it("renders error alert when exportConnectionsEncrypted rejects", async () => {
      const { exportConnectionsEncrypted } = await import("@lib/tauri");
      (
        exportConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("backend exploded"));

      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        typeInto(/^master password$/i, VALID_PW);
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /generate encrypted json/i }),
        );
      });

      expect(screen.getByRole("alert")).toHaveTextContent(/backend exploded/i);
    });

    it("Copy button writes the generated JSON to the clipboard", async () => {
      const { exportConnectionsEncrypted } = await import("@lib/tauri");
      const expectedJson =
        '{"v":1,"kdf":"argon2id","ciphertext":"abc","alg":"aes-256-gcm","salt":"a","nonce":"a","tag_attached":true}';
      (
        exportConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockResolvedValue(expectedJson);

      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        typeInto(/^master password$/i, VALID_PW);
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /generate encrypted json/i }),
        );
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /copy export json/i }),
        );
      });

      expect(writeText).toHaveBeenCalledWith(expectedJson);
      await waitFor(() => {
        expect(screen.getByText(/copied/i)).toBeInTheDocument();
      });
    });
  });

  describe("Import", () => {
    it("Import button is disabled until input is non-empty", () => {
      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);
      const btn = screen.getByRole("button", { name: /^import$/i });
      expect(btn).toBeDisabled();
    });

    it("envelope round-trip: encrypted payload + password → importConnectionsEncrypted", async () => {
      const { importConnectionsEncrypted } = await import("@lib/tauri");
      (
        importConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        imported: ["new-1", "new-2"],
        renamed: [],
        created_groups: [],
        skipped_groups: [],
      });

      const loadConnections = vi.fn().mockResolvedValue(undefined);
      const loadGroups = vi.fn().mockResolvedValue(undefined);
      useConnectionStore.setState({ loadConnections, loadGroups });

      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      const envelopeJson =
        '{"v":1,"kdf":"argon2id","alg":"aes-256-gcm","ciphertext":"AAAA","salt":"AA","nonce":"AA","tag_attached":true}';
      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: envelopeJson } });
      });
      // The dialog should hint that an envelope was detected.
      expect(
        screen.getByText(/encrypted envelope detected/i),
      ).toBeInTheDocument();

      await act(async () => {
        typeInto(/^master password$/i, VALID_PW);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      expect(importConnectionsEncrypted).toHaveBeenCalledWith(
        envelopeJson,
        VALID_PW,
      );
      expect(loadConnections).toHaveBeenCalled();
      expect(loadGroups).toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByText(/imported 2 connections/i)).toBeInTheDocument();
      });
    });

    it("plain JSON path (regression): non-envelope payload routes to importConnections without password", async () => {
      const { importConnections, importConnectionsEncrypted } =
        await import("@lib/tauri");
      (importConnections as ReturnType<typeof vi.fn>).mockResolvedValue({
        imported: ["new-1"],
        renamed: [],
        created_groups: [],
        skipped_groups: [],
      });

      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      const plainJson = '{"schema_version":1,"connections":[],"groups":[]}';
      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: plainJson } });
      });
      // No envelope hint should appear for plain JSON.
      expect(screen.queryByText(/encrypted envelope detected/i)).toBeNull();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      expect(importConnections).toHaveBeenCalledWith(plainJson);
      expect(importConnectionsEncrypted).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByText(/imported 1 connection/i)).toBeInTheDocument();
      });
    });

    it("envelope without password shows inline 'master password required' error", async () => {
      const { importConnectionsEncrypted } = await import("@lib/tauri");
      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      const envelopeJson =
        '{"v":1,"kdf":"argon2id","alg":"aes-256-gcm","ciphertext":"AAAA","salt":"AA","nonce":"AA","tag_attached":true}';
      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: envelopeJson } });
      });
      // Leave master password empty
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      expect(importConnectionsEncrypted).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        /master password required/i,
      );
    });

    it("wrong password surfaces the canonical 'Incorrect master password' inline error", async () => {
      const { importConnectionsEncrypted } = await import("@lib/tauri");
      // Backend returns the variant-prefixed error string.
      (
        importConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockRejectedValue(
        "Encryption error: Incorrect master password — the file could not be decrypted",
      );

      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      const envelopeJson =
        '{"v":1,"kdf":"argon2id","alg":"aes-256-gcm","ciphertext":"AAAA","salt":"AA","nonce":"AA","tag_attached":true}';
      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: envelopeJson } });
      });
      await act(async () => {
        typeInto(/^master password$/i, "wrong-pw-1");
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /incorrect master password — the file could not be decrypted/i,
        );
      });
    });

    it("renders renamed entries in a collapsed details", async () => {
      const { importConnections } = await import("@lib/tauri");
      (importConnections as ReturnType<typeof vi.fn>).mockResolvedValue({
        imported: ["new-1"],
        renamed: [{ original_name: "MyDB", new_name: "MyDB (imported)" }],
        created_groups: [],
        skipped_groups: [],
      });

      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: "{}" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      await waitFor(() => {
        expect(
          screen.getByText(/1 name conflict.*auto-resolved/i),
        ).toBeInTheDocument();
      });
      expect(screen.getByText(/MyDB \(imported\)/i)).toBeInTheDocument();
    });

    it("renders skipped_groups in a collapsed details when groups are missing", async () => {
      const { importConnections } = await import("@lib/tauri");
      (importConnections as ReturnType<typeof vi.fn>).mockResolvedValue({
        imported: ["new-1"],
        renamed: [],
        created_groups: [],
        skipped_groups: ["Lonely"],
      });

      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: "{}" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      await waitFor(() => {
        expect(
          screen.getByText(/1 connection placed at root/i),
        ).toBeInTheDocument();
      });
    });

    it("renders error alert when importConnections rejects", async () => {
      const { importConnections } = await import("@lib/tauri");
      (importConnections as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Invalid import JSON"),
      );

      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: "garbage" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /invalid import json/i,
        );
      });
    });
  });

  describe("Tabs", () => {
    it("respects initialTab='import'", () => {
      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);
      expect(screen.getByLabelText("Import JSON input")).toBeInTheDocument();
    });

    it("switches between Export and Import tabs", async () => {
      render(<ImportExportDialog onClose={vi.fn()} />);
      expect(screen.queryByLabelText("Import JSON input")).toBeNull();

      await act(async () => {
        // Sprint-96: TabsDialog renders Radix Tabs (role="tab") — Radix
        // Tabs activates on mouseDown rather than synthetic click.
        fireEvent.mouseDown(screen.getByRole("tab", { name: /import/i }));
      });
      expect(screen.getByLabelText("Import JSON input")).toBeInTheDocument();
    });
  });
});
