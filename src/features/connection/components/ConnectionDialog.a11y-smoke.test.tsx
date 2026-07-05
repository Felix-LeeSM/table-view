import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ConnectionDialog from "./ConnectionDialog";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";

// #1366 — mock the toast lib boundary (P6: mock only at lib boundaries) so the
// dialog's real `useConnectionMutations` success path doesn't push into the
// process-wide `toastStore` singleton and leak a lingering toast into a
// sibling spec's assertion under parallel-suite load (#1270 flake class).
vi.mock("@lib/runtime/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockAddConnection = vi.fn();
const mockUpdateConnection = vi.fn();
const mockTestConnection = vi.fn();

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
    database: "postgres",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
    ...overrides,
  };
}

function setStoreState() {
  useConnectionStore.setState({
    addConnection: mockAddConnection,
    updateConnection: mockUpdateConnection,
    testConnection: mockTestConnection,
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
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

describe("ConnectionDialog critical accessibility smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddConnection.mockResolvedValue(makeConnection({ id: "new-id" }));
    mockUpdateConnection.mockResolvedValue(undefined);
    mockTestConnection.mockResolvedValue("Connection successful");
    setStoreState();
  });

  it("exposes dialog labels and save validation through an alert region", async () => {
    render(<ConnectionDialog onClose={vi.fn()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    for (const label of [
      "Name",
      "Database Type",
      "Host",
      "Port",
      "User",
      "Password",
      "Database",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
  });

  it("keeps connection passwords out of alert/status/live feedback", async () => {
    const secret = "pass@123ZZ";
    mockTestConnection.mockRejectedValue(
      new Error(
        `connection refused at postgres://user:${encodeURIComponent(secret)}@localhost/db`,
      ),
    );
    render(<ConnectionDialog onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: secret },
      });
      fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    });

    await waitFor(() => {
      expect(
        document.querySelector('[data-slot="test-feedback"]')?.textContent,
      ).toMatch(/connection refused/i);
    });
    expectSecretAbsent(secret);
  });

  // Reason: #1366 — the a11y-smoke masking test above only covered the Test
  // Connection failure path; the Save failure path (`handleSave` catch →
  // `setError(sanitizeMessage(...))`, ConnectionDialog.tsx:284-289) was
  // unguarded, leaving ADR-0005 (no plaintext password leaves the frontend)
  // open to regression on save. A backend that echoes the connection string
  // in its save error must not surface the password in the footer alert.
  // (2026-07-06)
  it("keeps connection passwords out of the save-failure alert", async () => {
    const secret = "pass@789ZZ";
    mockAddConnection.mockRejectedValue(
      new Error(
        `save failed: postgres://user:${encodeURIComponent(secret)}@localhost/db`,
      ),
    );
    render(<ConnectionDialog onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "My DB" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: secret },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/save failed/i);
    });
    expectSecretAbsent(secret);
    // The mask token proves the sanitizer ran on the echoed connection string
    // rather than the error simply not containing the secret.
    expect(screen.getByRole("alert")).toHaveTextContent("***");
  });
});
