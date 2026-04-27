/**
 * Sprint 147 — AC-149-* regression tests.
 *
 * Sprint 140 already shipped the SelectionTree + encrypted-only export pane;
 * this file locks the AC-149-* invariants so a future change that
 *   (1) re-introduces a plaintext "Generate JSON" button,
 *   (2) silently drops connections / groups from the selection envelope, or
 *   (3) strips password-bearing connections,
 * surfaces as an explicit test failure rather than passing the existing
 * ImportExportDialog.test.tsx suite.
 *
 * Each `it(...)` name embeds the AC label (AC-149-N) for grep-ability.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ImportExportDialog from "./ImportExportDialog";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig, ConnectionGroup } from "@/types/connection";

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

beforeEach(() => {
  vi.clearAllMocks();
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    loadConnections: vi.fn().mockResolvedValue(undefined),
    loadGroups: vi.fn().mockResolvedValue(undefined),
  });
});

function makeConn(
  id: string,
  hasPw = false,
  groupId: string | null = null,
): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: hasPw,
    database: "test",
    group_id: groupId,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

function makeGroup(id: string, name: string): ConnectionGroup {
  return { id, name, color: null, collapsed: false };
}

function typeInto(label: RegExp | string, value: string) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

const VALID_PW = "open-sesame!";

const ENCRYPTED_PAYLOAD =
  '{"v":1,"kdf":"argon2id","salt":"AAAA","nonce":"AAAA","alg":"aes-256-gcm","ciphertext":"AAAA","tag_attached":true}';

describe("ImportExportDialog — AC-149-* regression locks", () => {
  it("AC-149-1: selecting exactly one connection sends a single-id array to exportConnectionsEncrypted", async () => {
    const { exportConnectionsEncrypted, exportConnections } =
      await import("@lib/tauri");
    (exportConnectionsEncrypted as ReturnType<typeof vi.fn>).mockResolvedValue(
      ENCRYPTED_PAYLOAD,
    );

    useConnectionStore.setState({
      connections: [makeConn("c1"), makeConn("c2"), makeConn("c3")],
    });
    render(<ImportExportDialog onClose={vi.fn()} />);

    // Start by clearing the default-all selection, then re-select only c2.
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /^c2 DB$/ }));
    });

    await act(async () => {
      typeInto(/^master password$/i, VALID_PW);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /generate encrypted json/i }),
      );
    });

    expect(exportConnectionsEncrypted).toHaveBeenCalledTimes(1);
    const firstCall = (exportConnectionsEncrypted as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    const [ids, password] = firstCall;
    expect(ids).toEqual(["c2"]);
    expect(ids).toHaveLength(1);
    expect(password).toBe(VALID_PW);
    // Plaintext path must never be wired up.
    expect(exportConnections).not.toHaveBeenCalled();
  });

  it("AC-149-2: ticking a group header sends only that group's connection ids and counter reads 'N connections, 1 group selected'", async () => {
    const { exportConnectionsEncrypted } = await import("@lib/tauri");
    (exportConnectionsEncrypted as ReturnType<typeof vi.fn>).mockResolvedValue(
      ENCRYPTED_PAYLOAD,
    );

    useConnectionStore.setState({
      connections: [
        makeConn("a1", false, "g-prod"),
        makeConn("a2", false, "g-prod"),
        makeConn("b1", false, "g-stage"),
      ],
      groups: [makeGroup("g-prod", "Prod"), makeGroup("g-stage", "Stage")],
    });
    render(<ImportExportDialog onClose={vi.fn()} />);

    // Clear default-all, then check the Prod group header only.
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /^Group Prod$/ }));
    });

    expect(
      screen.getByText(/2 connections, 1 group selected/i),
    ).toBeInTheDocument();

    await act(async () => {
      typeInto(/^master password$/i, VALID_PW);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /generate encrypted json/i }),
      );
    });

    const callArgs = (exportConnectionsEncrypted as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    const ids = callArgs[0] as string[];
    // Only the Prod group's children — never the Stage child.
    expect(new Set(ids)).toEqual(new Set(["a1", "a2"]));
    expect(ids).not.toContain("b1");
  });

  it("AC-149-3: partial group selection shows 'N connections, 0 groups selected' and the group checkbox reports aria-checked=mixed", async () => {
    useConnectionStore.setState({
      connections: [
        makeConn("a1", false, "g-prod"),
        makeConn("a2", false, "g-prod"),
      ],
      groups: [makeGroup("g-prod", "Prod")],
    });
    render(<ImportExportDialog onClose={vi.fn()} />);

    // Clear default-all so Prod becomes empty, then check just one child.
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /^a1 DB$/ }));
    });

    // Counter reads "1 connection, 0 groups selected" — partial group
    // never counts toward fully-selected groups.
    expect(
      screen.getByText(/1 connection, 0 groups selected/i),
    ).toBeInTheDocument();

    const groupCheckbox = screen.getByRole("checkbox", {
      name: /^Group Prod$/,
    });
    expect(groupCheckbox).toHaveAttribute("aria-checked", "mixed");
  });

  it("AC-149-4: password-bearing connections are not stripped from the envelope ids and the legacy plaintext exportConnections is never called", async () => {
    const { exportConnectionsEncrypted, exportConnections } =
      await import("@lib/tauri");
    (exportConnectionsEncrypted as ReturnType<typeof vi.fn>).mockResolvedValue(
      ENCRYPTED_PAYLOAD,
    );

    useConnectionStore.setState({
      // Mix has_password=true with has_password=false so a future "strip
      // password-bearing rows" regression would shrink the id array.
      connections: [
        makeConn("plain-1", false),
        makeConn("secret-1", true),
        makeConn("secret-2", true),
      ],
    });
    render(<ImportExportDialog onClose={vi.fn()} />);

    // Default selection already covers all three; just provide the password.
    await act(async () => {
      typeInto(/^master password$/i, VALID_PW);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /generate encrypted json/i }),
      );
    });

    const callArgs = (exportConnectionsEncrypted as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    const ids = callArgs[0] as string[];
    expect(new Set(ids)).toEqual(new Set(["plain-1", "secret-1", "secret-2"]));
    expect(ids).toHaveLength(3);
    // Plaintext command must remain unwired — Sprint 140 removed the
    // plaintext button and AC-149-5 keeps it removed.
    expect(exportConnections).not.toHaveBeenCalled();
  });

  it("AC-149-5: the dialog exposes only 'Generate encrypted JSON' — no plaintext 'Generate JSON' button or label is present", () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
    });
    render(<ImportExportDialog onClose={vi.fn()} />);

    // The encrypted button is the only generator surface.
    expect(
      screen.getByRole("button", { name: /generate encrypted json/i }),
    ).toBeInTheDocument();

    // No plaintext button (label without "encrypted").
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      const name = btn.getAttribute("aria-label") ?? btn.textContent ?? "";
      // Allow "Generate encrypted JSON" — reject any "Generate JSON" / "Generate Plain JSON" variants.
      if (/generate\s+(plain\s+)?json\b/i.test(name)) {
        expect(name.toLowerCase()).toContain("encrypted");
      }
    }

    // And no stray standalone text node either.
    expect(screen.queryByText(/^generate json$/i)).toBeNull();
    expect(screen.queryByText(/^generate plain json$/i)).toBeNull();
  });
});
