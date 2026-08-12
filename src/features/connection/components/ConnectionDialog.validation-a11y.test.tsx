import { useConnectionStore } from "@stores/connectionStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/types/connection";
import ConnectionDialog from "./ConnectionDialog";
import { CONNECTION_ERROR_ID } from "./forms/fieldValidation";

// #1366 — mock the toast lib boundary (P6: mock only at lib boundaries) so the
// dialog's real `useConnectionMutations` success path doesn't push into the
// process-wide `toastStore` singleton and leak a lingering toast into a
// sibling spec's assertion under parallel-suite load (#1270 flake class).
vi.mock("@lib/runtime/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Issue #1135 — connection form validation-state exposure.
//
// Locks the three a11y contracts the audit found missing:
//   1. required fields advertise `required` / `aria-required`,
//   2. a failed save flags the offending input with `aria-invalid` +
//      `aria-describedby` pointing at the single footer alert, and moves focus
//      to it,
//   3. the body is a real <form> so submit (Enter) reaches handleSave.
// PostgreSQL is the representative DBMS; Name is validated for all of them.
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

const mockAddConnection = vi.fn().mockResolvedValue(makeConnection());
const mockUpdateConnection = vi.fn().mockResolvedValue(undefined);
const mockTestConnection = vi.fn().mockResolvedValue("ok");

beforeEach(() => {
  vi.clearAllMocks();
  mockAddConnection.mockResolvedValue(makeConnection());
  useConnectionStore.setState({
    addConnection: mockAddConnection,
    updateConnection: mockUpdateConnection,
    testConnection: mockTestConnection,
  } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
});

function renderDialog(connection?: ConnectionConfig) {
  return render(<ConnectionDialog connection={connection} onClose={vi.fn()} />);
}

describe("ConnectionDialog validation-state exposure (#1135)", () => {
  it("marks Name / Host / Database as required + aria-required (PostgreSQL)", () => {
    renderDialog();
    for (const label of ["Name", "Host", "Database"]) {
      const input = screen.getByLabelText(label);
      expect(input).toBeRequired();
      expect(input).toHaveAttribute("aria-required", "true");
    }
  });

  it("does not mark optional Database as required (MongoDB)", () => {
    renderDialog(
      makeConnection({ dbType: "mongodb", port: 27017, paradigm: "document" }),
    );
    // Host stays required; the optional default DB does not.
    expect(screen.getByLabelText("Host")).toBeRequired();
    expect(screen.getByLabelText("Database (optional)")).not.toBeRequired();
  });

  it("drops the Host requirement when the Oracle identifier field holds a TNS descriptor", async () => {
    // Reason: #2154 — a TNS descriptor carries its own HOST/PORT and the
    // backend dials those, so demanding the form's Host would block the save on
    // a value nothing reads. `usesTnsDescriptor` is the single predicate: the
    // Oracle form disables the input, this check stands down, and they cannot
    // drift apart. (2026-08-12)
    renderDialog(
      makeConnection({
        dbType: "oracle",
        port: 1521,
        host: "",
        database:
          "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dial-host.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)))",
      }),
    );

    const hostInput = screen.getByLabelText("Host");
    expect(hostInput).toBeDisabled();
    expect(hostInput).not.toBeRequired();

    await act(async () => {
      fireEvent.click(screen.getByText("Update"));
    });

    expect(mockUpdateConnection).toHaveBeenCalled();
  });

  it("flags the empty Name field and moves focus to it on save", async () => {
    renderDialog();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Name is required");
    expect(alert).toHaveAttribute("id", CONNECTION_ERROR_ID);
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveAttribute("aria-describedby", CONNECTION_ERROR_ID);
    expect(document.activeElement).toBe(nameInput);
    expect(mockAddConnection).not.toHaveBeenCalled();
  });

  it("moves focus to the first invalid field (Host) and clears the prior flag", async () => {
    renderDialog();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    const hostInput = screen.getByLabelText("Host") as HTMLInputElement;

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Valid" } });
      fireEvent.change(hostInput, { target: { value: "" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Host is required");
    expect(hostInput).toHaveAttribute("aria-invalid", "true");
    expect(hostInput).toHaveAttribute("aria-describedby", CONNECTION_ERROR_ID);
    // Name is no longer the flagged field.
    expect(nameInput).not.toHaveAttribute("aria-invalid");
    expect(document.activeElement).toBe(hostInput);
  });

  it("submits via the form (Enter) reaching handleSave", async () => {
    renderDialog();
    // Radix portals dialog content to document.body, so query the document.
    const form = document.querySelector("form");
    expect(form).not.toBeNull();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "New DB" },
      });
      fireEvent.change(screen.getByLabelText("Host"), {
        target: { value: "db.example.com" },
      });
    });

    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(mockAddConnection).toHaveBeenCalledTimes(1);
  });
});
