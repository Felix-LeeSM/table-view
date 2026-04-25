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

    it("calls exportConnections with selected ids and shows JSON", async () => {
      const { exportConnections } = await import("@lib/tauri");
      (exportConnections as ReturnType<typeof vi.fn>).mockResolvedValue(
        '{"schema_version":1,"connections":[],"groups":[]}',
      );

      useConnectionStore.setState({
        connections: [makeConn("c1"), makeConn("c2")],
      });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /generate json/i }));
      });

      expect(exportConnections).toHaveBeenCalledWith(["c1", "c2"]);
      expect(
        screen.getByLabelText("Generated export JSON"),
      ).toBeInTheDocument();
      expect(
        (screen.getByLabelText("Generated export JSON") as HTMLTextAreaElement)
          .value,
      ).toContain("schema_version");
    });

    it("excludes unchecked connections", async () => {
      const { exportConnections } = await import("@lib/tauri");
      (exportConnections as ReturnType<typeof vi.fn>).mockResolvedValue("{}");

      useConnectionStore.setState({
        connections: [makeConn("c1"), makeConn("c2")],
      });
      render(<ImportExportDialog onClose={vi.fn()} />);

      // Uncheck c2
      const checkboxes = screen
        .getByText("c2 DB")
        .closest("label")!
        .querySelectorAll("input[type='checkbox']");
      await act(async () => {
        fireEvent.click(checkboxes[0]!);
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /generate json/i }));
      });

      expect(exportConnections).toHaveBeenCalledWith(["c1"]);
    });

    it("Copy button writes the generated JSON to the clipboard", async () => {
      const { exportConnections } = await import("@lib/tauri");
      const expectedJson = '{"schema_version":1,"connections":[]}';
      (exportConnections as ReturnType<typeof vi.fn>).mockResolvedValue(
        expectedJson,
      );

      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /generate json/i }));
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

    it("Generate button is disabled when no rows are selected", async () => {
      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      // Uncheck the only connection via select-all
      const selectAll = screen
        .getByText(/select all/i)
        .closest("label")!
        .querySelector("input[type='checkbox']") as HTMLInputElement;
      await act(async () => {
        fireEvent.click(selectAll);
      });
      expect(
        screen.getByRole("button", { name: /generate json/i }),
      ).toBeDisabled();
    });

    it("renders error alert when exportConnections rejects", async () => {
      const { exportConnections } = await import("@lib/tauri");
      (exportConnections as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("backend exploded"),
      );

      useConnectionStore.setState({ connections: [makeConn("c1")] });
      render(<ImportExportDialog onClose={vi.fn()} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /generate json/i }));
      });

      expect(screen.getByRole("alert")).toHaveTextContent(/backend exploded/i);
    });
  });

  describe("Import", () => {
    it("Import button is disabled until input is non-empty", () => {
      render(<ImportExportDialog onClose={vi.fn()} initialTab="import" />);
      const btn = screen.getByRole("button", { name: /^import$/i });
      expect(btn).toBeDisabled();
    });

    it("calls importConnections with the textarea content and refreshes the store", async () => {
      const { importConnections } = await import("@lib/tauri");
      (importConnections as ReturnType<typeof vi.fn>).mockResolvedValue({
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
        fireEvent.change(ta, { target: { value: '{"schema_version":1}' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      });

      expect(importConnections).toHaveBeenCalledWith('{"schema_version":1}');
      expect(loadConnections).toHaveBeenCalled();
      expect(loadGroups).toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByText(/imported 2 connections/i)).toBeInTheDocument();
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
