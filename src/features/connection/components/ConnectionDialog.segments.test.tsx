import { useConnectionStore } from "@stores/connectionStore";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/types/connection";
import ConnectionDialog from "./ConnectionDialog";

// #1366 — mock the toast lib boundary (P6: mock only at lib boundaries) so the
// dialog's real `useConnectionMutations` success path doesn't push into the
// process-wide `toastStore` singleton and leak a lingering toast into a
// sibling spec's assertion under parallel-suite load (#1270 flake class).
vi.mock("@lib/runtime/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Issue #2436 — the connection form is split into Basic / Advanced / SSH-SSL
// segments, and Radix unmounts the panel of an inactive segment.
//
// The risk that split creates is one: the user stands on a segment, presses
// Save (or Test Connection), the draft is rejected, and the field at fault is
// behind another tab. Before this file the dialog's recovery was
// `document.getElementById(id)?.focus()` (#1135) — a lookup that returns
// `null` the moment its panel is unmounted, so the save silently refused with
// nothing on screen changing except a banner that names a field the user
// cannot see.
//
// The contract asserted here therefore has two halves:
//   1. a rejected field is *reached* — the dialog returns to the segment that
//      holds it and focuses it, from Save and from Test Connection alike, and
//      the segment stays marked while the user browses elsewhere; and
//   2. the split itself holds — transport controls in SSH/SSL, tuning in
//      Advanced, and no SSH/SSL tab at all for a connection that dials nothing.
//
// PostgreSQL is the representative server DBMS; SQLite the representative file
// one.
// ---------------------------------------------------------------------------

function makeConnection(
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    id: "conn-1",
    name: "My DB",
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: true,
    database: "mydb",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
    ...overrides,
  };
}

const mockAddConnection = vi.fn();
const mockUpdateConnection = vi.fn();
const mockTestConnection = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockAddConnection.mockResolvedValue(makeConnection());
  mockUpdateConnection.mockResolvedValue(undefined);
  mockTestConnection.mockResolvedValue("Connection successful");
  useConnectionStore.setState({
    addConnection: mockAddConnection,
    updateConnection: mockUpdateConnection,
    testConnection: mockTestConnection,
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
});

function renderDialog(connection?: ConnectionConfig) {
  return render(<ConnectionDialog connection={connection} onClose={vi.fn()} />);
}

/**
 * Radix `TabsTrigger` selects on `mousedown`, not on `click` — the same reason
 * `StructurePanel.columns.test.tsx` drives its tabs this way.
 */
async function openSegment(name: string) {
  await act(async () => {
    fireEvent.mouseDown(screen.getByRole("tab", { name }));
  });
}

async function type(label: string, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("ConnectionDialog form segments (#2436)", () => {
  it("[conn-segment] Save from the SSH/SSL segment returns to Basic and focuses the rejected Host", async () => {
    renderDialog();
    await type("Name", "Segmented");
    await type("Host", "");

    await openSegment("SSH/SSL");
    // The panel that owns Host is unmounted — this is the state the plain
    // `getElementById` focus move could not recover from.
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();

    await press("Save");

    expect(screen.getByRole("alert")).toHaveTextContent("Host is required");
    const reachedHost = screen.getByLabelText("Host");
    expect(reachedHost).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(reachedHost);
    expect(mockAddConnection).not.toHaveBeenCalled();
  });

  it("[conn-segment] Test Connection from the Advanced segment returns to Basic and focuses the rejected Database", async () => {
    // #2437 wired Save and Test Connection to the same `validateConnectionDraft`,
    // so the recovery has to hang off the validator, not off the Save handler.
    renderDialog();
    await type("Name", "Segmented");
    await type("Database", "");

    await openSegment("Advanced");
    expect(screen.queryByLabelText("Database")).not.toBeInTheDocument();

    await press("Test Connection");

    expect(screen.getByRole("alert")).toHaveTextContent("Database is required");
    const reachedDatabase = screen.getByLabelText("Database");
    expect(reachedDatabase).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(reachedDatabase);
    // Nothing left the dialog — the driver's timeout is not the error channel.
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  it("[conn-segment] the segment holding the rejected field stays marked while the user browses elsewhere", async () => {
    renderDialog();
    await type("Name", "Segmented");
    await type("Host", "");
    await press("Save");

    // Walk away from the recovered segment: the marker is the only thing that
    // still says where the blocked save is coming from.
    await openSegment("SSH/SSL");
    const basicTab = screen.getByRole("tab", { name: /Basic/ });
    expect(within(basicTab).getByText("has an error")).toBeInTheDocument();
    expect(basicTab).toHaveAttribute("aria-selected", "false");
  });

  it("[conn-segment] a segment with nothing rejected carries no marker", async () => {
    renderDialog();
    // Exact-name match: the marker's `sr-only` phrase would extend the tab's
    // accessible name, so this query fails the moment one is rendered.
    expect(screen.getByRole("tab", { name: "Basic" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Advanced" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "SSH/SSL" })).toBeInTheDocument();
  });

  it("[conn-segment] transport security controls live in SSH/SSL, not in Basic", async () => {
    renderDialog();
    expect(screen.queryByLabelText("SSL mode")).not.toBeInTheDocument();

    await openSegment("SSH/SSL");

    expect(screen.getByLabelText("SSL mode")).toBeInTheDocument();
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
  });

  it("[conn-segment] connection timeout and keep-alive live in Advanced, not in Basic", async () => {
    renderDialog();
    expect(
      screen.queryByLabelText("Connection Timeout (seconds)"),
    ).not.toBeInTheDocument();

    await openSegment("Advanced");

    expect(
      screen.getByLabelText("Connection Timeout (seconds)"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Keep-Alive Interval (seconds)"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
  });

  it("[conn-segment] a file connection is offered no SSH/SSL segment", () => {
    // SQLite dials nothing, so an SSH/SSL tab would open onto an empty panel.
    renderDialog(
      makeConnection({ dbType: "sqlite", database: "/tmp/app.sqlite" }),
    );

    expect(screen.getByRole("tab", { name: "Basic" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Advanced" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "SSH/SSL" }),
    ).not.toBeInTheDocument();
  });

  it("[conn-segment] the SQLite path is reached the same way when Save is rejected from Advanced", async () => {
    // The file DBMS routes `database` to a different input id, so the recovery
    // has to follow the validator's field key rather than a fixed element.
    renderDialog(makeConnection({ dbType: "sqlite", database: "" }));
    await openSegment("Advanced");

    await press("Update");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Database file is required",
    );
    const pathInput = screen.getByLabelText("Database File");
    expect(document.activeElement).toBe(pathInput);
    expect(mockUpdateConnection).not.toHaveBeenCalled();
  });

  it("[conn-segment] a value typed in Basic survives a round trip through SSH/SSL", async () => {
    // The panels unmount, so anything held in a segment's own state would be
    // lost here rather than in the draft the dialog owns.
    renderDialog();
    await type("Host", "db.example.com");

    await openSegment("SSH/SSL");
    await openSegment("Basic");

    expect(screen.getByLabelText("Host")).toHaveValue("db.example.com");
  });

  it("[conn-segment] a reopened dialog starts on Basic", async () => {
    // The segment is plain component state on purpose — see the comment on
    // `segment` in ConnectionDialog.tsx for why it is not remembered.
    const { unmount } = renderDialog();
    await openSegment("SSH/SSL");
    expect(screen.getByRole("tab", { name: "SSH/SSL" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    unmount();
    renderDialog();

    expect(screen.getByRole("tab", { name: "Basic" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
