import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
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
beforeEach(() => {
  setupTauriMock({
    exportConnections: vi.fn(),
    importConnections: vi.fn(),
    exportConnectionsEncrypted: vi.fn(),
    importConnectionsEncrypted: vi.fn(),
  });
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
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: hasPw,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

function typeInto(label: RegExp | string, value: string) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

const MNEMONIC =
  "abandon ability able about above absent absorb abstract absurd abuse access accident";
const ENCRYPTED_PAYLOAD =
  '{"v":1,"kdf":"argon2id","salt":"AAAA","nonce":"AAAA","alg":"aes-256-gcm","ciphertext":"AAAA","tag_attached":true}';

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
      expect(screen.getByText(/pw set/i)).toBeInTheDocument();
    });

    it("states export includes saved connections only and excludes active-session file analytics", () => {
      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      expect(
        screen.getByText(
          /passwords and active-session file analytics registrations are not embedded/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /active-session file analytics sources\s+and local file registrations are\s+not included/i,
        ),
      ).toBeInTheDocument();
    });

    it("calls exportConnectionsEncrypted with selected ids only and surfaces the auto-generated recovery phrase", async () => {
      const { exportConnectionsEncrypted } = await import("@lib/tauri");
      (
        exportConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        password: MNEMONIC,
        json: ENCRYPTED_PAYLOAD,
      });

      useConnectionStore.setState({
        connections: [makeConn("c1"), makeConn("c2")],
      });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /generate encrypted export/i }),
        );
      });

      // Backend now receives ids only — no password argument.
      expect(exportConnectionsEncrypted).toHaveBeenCalledWith(["c1", "c2"]);
      // Recovery phrase appears verbatim in the read-only textarea.
      const phraseField = screen.getByLabelText(
        "Generated recovery phrase",
      ) as HTMLTextAreaElement;
      expect(phraseField.value).toBe(MNEMONIC);
    });

    it("Generate button is disabled when 0 connections are selected", async () => {
      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      // Uncheck the only connection via select-all.
      await act(async () => {
        fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
      });
      expect(
        screen.getByRole("button", { name: /generate encrypted export/i }),
      ).toBeDisabled();
    });

    it("hides the encrypted JSON textarea behind a 'I have saved the recovery phrase' acknowledgement", async () => {
      const { exportConnectionsEncrypted } = await import("@lib/tauri");
      (
        exportConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        password: MNEMONIC,
        json: ENCRYPTED_PAYLOAD,
      });

      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /generate encrypted export/i }),
        );
      });

      const ta = screen.getByLabelText(
        "Generated export JSON",
      ) as HTMLTextAreaElement;
      // Until the user ticks the acknowledgement, the JSON is hidden and
      // the copy button is disabled.
      expect(ta).toBeDisabled();
      expect(ta.value).toBe("");
      const copyJsonBtn = screen.getByRole("button", {
        name: /copy export json to clipboard/i,
      });
      expect(copyJsonBtn).toBeDisabled();

      // Tick the acknowledgement — JSON becomes readable + copy enabled.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: /i have saved the recovery phrase/i,
          }),
        );
      });
      expect(ta).not.toBeDisabled();
      expect(ta.value).toBe(ENCRYPTED_PAYLOAD);
      expect(copyJsonBtn).not.toBeDisabled();
    });

    it("renders error alert when exportConnectionsEncrypted rejects", async () => {
      const { exportConnectionsEncrypted } = await import("@lib/tauri");
      (
        exportConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("backend exploded"));

      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /generate encrypted export/i }),
        );
      });

      expect(screen.getByRole("alert")).toHaveTextContent(/backend exploded/i);
    });

    it("Copy buttons write the recovery phrase and (after acknowledgement) the JSON to the clipboard", async () => {
      const { exportConnectionsEncrypted } = await import("@lib/tauri");
      (
        exportConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        password: MNEMONIC,
        json: ENCRYPTED_PAYLOAD,
      });

      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /generate encrypted export/i }),
        );
      });

      // Recovery phrase copy works immediately.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /copy recovery phrase/i }),
        );
      });
      expect(writeText).toHaveBeenCalledWith(MNEMONIC);

      // JSON copy is gated on the acknowledgement.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: /i have saved the recovery phrase/i,
          }),
        );
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", {
            name: /copy export json to clipboard/i,
          }),
        );
      });
      expect(writeText).toHaveBeenCalledWith(ENCRYPTED_PAYLOAD);
      await waitFor(() => {
        expect(screen.getAllByText(/copied/i).length).toBeGreaterThan(0);
      });
    });
  });

  describe("Import", () => {
    it("Import button is disabled until input is non-empty", () => {
      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);
      const btn = screen.getByRole("button", { name: /^import$/i });
      expect(btn).toBeDisabled();
    });

    it("states imported connections need passwords and DuckDB file analytics re-registration", () => {
      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      expect(
        screen.getByText(
          /imported connections start\s+without passwords and without registered local file analytics sources/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /re-register files in a DuckDB session before using file analytics/i,
        ),
      ).toBeInTheDocument();
    });

    it("envelope round-trip: encrypted payload + recovery phrase → importConnectionsEncrypted", async () => {
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

      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: ENCRYPTED_PAYLOAD } });
      });
      expect(
        screen.getByText(/encrypted envelope detected/i),
      ).toBeInTheDocument();

      await act(async () => {
        typeInto(/^recovery phrase$/i, MNEMONIC);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      expect(importConnectionsEncrypted).toHaveBeenCalledWith(
        ENCRYPTED_PAYLOAD,
        MNEMONIC,
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
      expect(screen.queryByText(/encrypted envelope detected/i)).toBeNull();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      expect(importConnections).toHaveBeenCalledWith(plainJson);
      expect(importConnectionsEncrypted).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByText(/imported 1 connection/i)).toBeInTheDocument();
      });
      expect(
        screen.getByText(
          /registered local file analytics sources are not imported;\s+re-register files in a DuckDB session/i,
        ),
      ).toBeInTheDocument();
    });

    it("envelope without recovery phrase shows inline 'master password required' error", async () => {
      const { importConnectionsEncrypted } = await import("@lib/tauri");
      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: ENCRYPTED_PAYLOAD } });
      });
      // Leave recovery phrase empty.
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      expect(importConnectionsEncrypted).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        /master password required/i,
      );
    });

    it("wrong recovery phrase surfaces the canonical 'Incorrect master password' inline error", async () => {
      const { importConnectionsEncrypted } = await import("@lib/tauri");
      (
        importConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockRejectedValue(
        "Encryption error: Incorrect master password — the file could not be decrypted",
      );

      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: ENCRYPTED_PAYLOAD } });
      });
      await act(async () => {
        typeInto(/^recovery phrase$/i, "wrong phrase here");
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

    it("masks the recovery phrase from import error alert and live regions", async () => {
      const { importConnectionsEncrypted } = await import("@lib/tauri");
      const encoded = encodeURIComponent(MNEMONIC);
      (
        importConnectionsEncrypted as ReturnType<typeof vi.fn>
      ).mockRejectedValue(
        new Error(`decrypt failed for ${MNEMONIC} and ${encoded}`),
      );

      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);

      const ta = screen.getByLabelText(
        "Import JSON input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(ta, { target: { value: ENCRYPTED_PAYLOAD } });
      });
      await act(async () => {
        typeInto(/^recovery phrase$/i, MNEMONIC);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/decrypt failed/i);
      });

      const regions = [
        ...document.querySelectorAll('[role="alert"]'),
        ...document.querySelectorAll('[role="status"]'),
        ...document.querySelectorAll("[aria-live]"),
      ];
      expect(regions.length).toBeGreaterThan(0);
      for (const region of regions) {
        const text = region.textContent ?? "";
        expect(text).not.toContain(MNEMONIC);
        expect(text).not.toContain(encoded);
      }
      expect(screen.getByRole("alert")).toHaveTextContent(/\*\*\*/);
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
